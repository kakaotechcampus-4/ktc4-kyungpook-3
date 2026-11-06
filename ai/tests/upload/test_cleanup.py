"""upload.cleanup: 지정 결과가 오지 않는 업로드의 로컬 정리. 가짜 BE·가짜 분리기·가짜 시계만 쓴다.
준비는 실제 intake_one -> report_one 으로 reported 까지 간다."""
from __future__ import annotations

import io
import json
import logging
import os
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
import soundfile as sf

from capture.handoff import BeClient, BeError
from capture.recorder import backoff_s, manifest_path, try_lock
from tests.capture.fake_be import FakeBe
from tests.conftest import SEGS, FakeDiarizer
from upload.cleanup import EXPIRE_AFTER_S, KEEP_S, PROBE_EVERY_S, cleanup_one
from upload.intake import intake_one
from upload.report import report_one

MID = "mtg-1"


class Clock:
    def __init__(self):
        self.t = datetime(2026, 11, 4, 3, 0, tzinfo=timezone.utc)

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += timedelta(seconds=seconds)


class Wrapped:
    """진짜 BeClient 를 감싸고, 정해 둔 오류를 재전송에서 먼저 낸다. 호출한 본문도 적는다."""

    def __init__(self, inner):
        self.inner = inner
        self.error = None
        self.bodies = []

    def report_speakers(self, mid, speakers):
        self.bodies.append(speakers)
        if self.error:
            raise self.error
        return self.inner.report_speakers(mid, speakers)


def _wav_bytes(secs=12):
    t = np.arange(secs * 16000) / 16000
    buf = io.BytesIO()
    sf.write(buf, (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), 16000, format="WAV", subtype="PCM_16")
    return buf.getvalue()


@pytest.fixture
def env(tmp_path):
    be = FakeBe()
    client = BeClient("http://be", session=be, service_token="svc-token")
    be.add_upload(MID, audio=_wav_bytes(), stored_filename="audio.wav", original_filename="회의.wav")
    rec, tr = tmp_path / "rec", tmp_path / "tr"
    rec.mkdir()
    tr.mkdir()
    clock = Clock()
    diarizer = FakeDiarizer(SEGS)
    for _ in range(30):
        ev = intake_one(rec, client=client, diarizer=diarizer, now=clock, timezone="Asia/Seoul")
        if ev is None or ev.event == "done":
            break
    assert report_one(rec, client=client, now=clock) == (MID, "reported")
    (tr / f"session_upload_{MID}.json").write_text("{}", encoding="utf-8")   # 전사본이 남아 있는 상태
    return type("Env", (), {"be": be, "client": client, "wrapped": Wrapped(client), "rec": rec, "tr": tr,
                            "clock": clock})


def _go(e, client=None):
    return cleanup_one(e.rec, e.tr, client=client or e.client, now=e.clock)


def _intake(e):
    return json.loads((e.rec / ".uploads" / MID / "intake.json").read_text(encoding="utf-8"))


def _manifest_file(e):
    return manifest_path(e.rec, f"upload_{MID}")


def _kept(e):
    m = _manifest_file(e)
    return m.exists() and (e.rec / f"upload_{MID}").exists() and (e.tr / f"session_upload_{MID}.json").exists()


def _gone(e):
    m = _manifest_file(e)
    return (not m.exists() and not m.with_suffix(".lock").exists() and not (e.rec / f"upload_{MID}").exists()
            and not (e.tr / f"session_upload_{MID}.json").exists())


def _posts(e):
    return [b for m, p, b in e.be.calls if m == "POST" and p.endswith("/speakers")]


def _fails(e):
    return [p for m, p, _ in e.be.calls if m == "PATCH" and p.endswith("/fail")]


def test_expired_upload_is_dropped_after_be_says_ended(env):
    env.be.expire(MID)
    env.clock.advance(EXPIRE_AFTER_S)
    assert _go(env) == (MID, "expired")
    assert _gone(env)
    assert _intake(env)["expire"]["state"] == "expired"
    assert _fails(env) == []
    assert _go(env) is None


def test_still_awaiting_is_kept_and_rechecked_hourly(env):
    env.clock.advance(EXPIRE_AFTER_S)
    assert _go(env) == (MID, "still_waiting")
    assert _kept(env)
    assert _intake(env)["expire"]["next_at"] == (env.clock.t + timedelta(seconds=PROBE_EVERY_S)).replace(microsecond=0).isoformat()
    sent = len(_posts(env))
    env.clock.advance(PROBE_EVERY_S / 2)
    assert _go(env) is None
    assert len(_posts(env)) == sent
    env.clock.advance(PROBE_EVERY_S / 2)
    assert _go(env) == (MID, "still_waiting")
    assert _fails(env) == []


def test_not_a_candidate_before_seven_days(env):
    env.be.expire(MID)
    env.clock.advance(EXPIRE_AFTER_S - 1)
    sent = len(_posts(env))
    assert _go(env) is None
    assert len(_posts(env)) == sent and _kept(env)


@pytest.mark.parametrize("state", ["resuming", "mapped"])
def test_assigned_upload_is_never_probed(env, state):
    d = env.rec / ".uploads" / MID
    rec = _intake(env)
    rec["resume"] = {"state": state, "attempts": 0, "next_at": None, "error": None}
    (d / "intake.json").write_text(json.dumps(rec), encoding="utf-8")
    env.clock.advance(EXPIRE_AFTER_S * 3)
    sent = len(_posts(env))
    assert _go(env) is None
    assert len(_posts(env)) == sent and _kept(env)


@pytest.mark.parametrize("err", [BeError("NETWORK", "끊김"), BeError("HTTP_500", "x", status=500),
                                 BeError("UPLOAD_NOT_CLAIMED", "x", status=409), BeError("HTTP_404", "x", status=404)])
def test_transient_errors_back_off_without_dropping(env, err):
    env.wrapped.error = err
    env.clock.advance(EXPIRE_AFTER_S)
    assert _go(env, env.wrapped) == (MID, "retry")
    assert _kept(env)
    ex = _intake(env)["expire"]
    assert ex["attempts"] == 1 and ex["error"]
    assert ex["next_at"] == (env.clock.t + timedelta(seconds=backoff_s(1))).replace(microsecond=0).isoformat()
    assert _fails(env) == []


def test_success_resets_attempts(env):
    env.wrapped.error = BeError("NETWORK", "끊김")
    env.clock.advance(EXPIRE_AFTER_S)
    _go(env, env.wrapped)
    env.wrapped.error = None
    env.clock.advance(backoff_s(1))
    assert _go(env, env.wrapped) == (MID, "still_waiting")
    assert _intake(env)["expire"]["attempts"] == 0


def test_resent_body_is_the_recorded_report(env):
    env.clock.advance(EXPIRE_AFTER_S)
    _go(env, env.wrapped)
    assert env.wrapped.bodies == [_intake(env)["report"]["speakers"]]


def test_enveloped_404_drops(env):
    del env.be.meetings[MID], env.be.uploads[MID]   # 회의와 업로드 행이 함께 지워진 BE
    env.clock.advance(EXPIRE_AFTER_S)
    assert _go(env) == (MID, "expired")
    assert _gone(env)


def test_locked_manifest_is_not_dropped(env):
    env.be.expire(MID)
    env.clock.advance(EXPIRE_AFTER_S)
    lock = try_lock(_manifest_file(env))
    assert lock is not None
    try:
        assert _go(env) == (MID, "locked")
        assert _kept(env)
    finally:
        lock.release()
    assert _go(env) == (MID, "expired")
    assert _gone(env)


def test_discord_and_cli_uploads_are_untouched(env):
    env.be.expire(MID)
    env.clock.advance(EXPIRE_AFTER_S * 5)
    (env.rec / "session_77_500.json").write_text(json.dumps({"session": "77_500", "source": "discord", "speakers": [
        {"file": "77_500/a.wav"}]}), encoding="utf-8")
    (env.rec / "77_500").mkdir()
    (env.rec / "77_500" / "a.wav").write_bytes(b"x")
    (env.tr / "session_77_500.json").write_text("{}", encoding="utf-8")
    (env.tr / "a__m.json").write_text("{}", encoding="utf-8")
    (env.rec / "session_upload_cli.json").write_text(json.dumps({"session": "upload_cli", "source": "upload"}), encoding="utf-8")
    (env.rec / "upload_cli").mkdir()
    assert _go(env) == (MID, "expired")   # 정리 대상은 intake.json 이 있는 이 회의뿐이다
    ts = env.clock.t.timestamp()
    os.utime(env.rec / ".uploads" / MID / "intake.json", (ts, ts))   # 끝난 기록 폴더는 KEEP_S 뒤에 지우니 이 테스트에서는 아직이다
    snap = sorted(p.name for p in env.rec.iterdir()) + sorted(p.name for p in env.tr.iterdir())
    for _ in range(3):
        assert _go(env) is None
    assert sorted(p.name for p in env.rec.iterdir()) + sorted(p.name for p in env.tr.iterdir()) == snap
    assert (env.rec / "session_77_500.json").exists() and (env.rec / "77_500" / "a.wav").exists()
    assert (env.tr / "a__m.json").exists() and (env.rec / "session_upload_cli.json").exists()


def test_one_step_per_call_and_none_when_idle(tmp_path):
    be = FakeBe()
    client = BeClient("http://be", session=be, service_token="svc-token")
    assert cleanup_one(tmp_path, tmp_path / "tr", client=client, now=Clock()) is None
    assert be.calls == []


def test_one_step_per_call(env):
    be = env.be
    be.add_upload("mtg-2", audio=_wav_bytes(), stored_filename="audio.wav", original_filename="b.wav")
    client, clock, rec = env.client, env.clock, env.rec
    diarizer = FakeDiarizer(SEGS)
    for _ in range(40):
        ev = intake_one(rec, client=client, diarizer=diarizer, now=clock, timezone="Asia/Seoul")
        if ev is None:
            break
    assert report_one(rec, client=client, now=clock) == ("mtg-2", "reported")
    be.expire(MID)
    be.expire("mtg-2")
    clock.advance(EXPIRE_AFTER_S)
    assert _go(env) == (MID, "expired")
    assert manifest_path(rec, "upload_mtg-2").exists()
    assert _go(env) == ("mtg-2", "expired")
    assert _go(env) is None


def _second_upload(env):
    env.be.add_upload("mtg-2", audio=_wav_bytes(), stored_filename="audio.wav", original_filename="b.wav")
    diarizer = FakeDiarizer(SEGS)
    for _ in range(40):
        if intake_one(env.rec, client=env.client, diarizer=diarizer, now=env.clock, timezone="Asia/Seoul") is None:
            break
    assert report_one(env.rec, client=env.client, now=env.clock) == ("mtg-2", "reported")
    env.be.expire(MID)
    env.be.expire("mtg-2")
    env.clock.advance(EXPIRE_AFTER_S)


def test_locked_meeting_is_skipped_without_a_resend_and_does_not_block_the_next(env):
    _second_upload(env)
    lock = try_lock(_manifest_file(env))
    try:
        env.be.calls.clear()
        assert _go(env) == ("mtg-2", "expired")
        assert [p for _, p, _ in env.be.calls if MID in p] == []   # 잠긴 회의에는 재전송이 없다
        assert _kept(env)
        assert _go(env) == (MID, "locked")                          # 남은 후보가 모두 잠겨 있다
        assert [p for _, p, _ in env.be.calls if MID in p] == []
    finally:
        lock.release()
    assert _go(env) == (MID, "expired")


def test_lock_taken_during_the_resend_keeps_files_and_retries_in_a_minute(env):
    env.be.expire(MID)
    env.clock.advance(EXPIRE_AFTER_S)
    held = []

    class Racer:
        def report_speakers(self, mid, speakers):
            held.append(try_lock(_manifest_file(env)))   # 재전송 사이에 다른 쪽이 잠근다
            return env.client.report_speakers(mid, speakers)

    assert _go(env, Racer()) == (MID, "locked")
    held[0].release()
    assert _kept(env)
    assert _intake(env)["expire"]["next_at"] == (env.clock.t + timedelta(seconds=60)).replace(microsecond=0).isoformat()
    assert _go(env) is None
    env.clock.advance(60)
    assert _go(env) == (MID, "expired")


def test_os_error_while_dropping_is_a_transient_failure(env, monkeypatch):
    import upload.cleanup as c
    env.be.expire(MID)
    env.clock.advance(EXPIRE_AFTER_S)

    def boom(*a, **k):
        raise PermissionError("잠겨 있다")
    monkeypatch.setattr(c, "drop_transcripts", boom)
    assert _go(env) == (MID, "retry")
    assert _kept(env)
    ex = _intake(env)["expire"]
    assert ex["state"] == "checking" and ex["attempts"] == 1 and "PermissionError" in ex["error"]


def _iso(t):
    return t.replace(microsecond=0).isoformat()


def _set_manifest(e, **over):
    m = _manifest_file(e)
    data = json.loads(m.read_text(encoding="utf-8"))
    for k, v in over.items():
        data[k] = v
    m.write_text(json.dumps(data), encoding="utf-8")


def _set_intake(e, **over):
    p = e.rec / ".uploads" / MID / "intake.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    for k, v in over.items():
        if v is None:
            data.pop(k, None)
        else:
            data[k] = v
    p.write_text(json.dumps(data), encoding="utf-8")
    return p


def _settle(e):
    """지정 결과 확인 대상에서 빼기 위해 resume 이 mapped 인 상태로 둔다(처리가 이미 시작된 업로드)."""
    _set_intake(e, resume={"state": "mapped", "attempts": 0, "next_at": None, "error": None})


def test_given_up_upload_is_dropped_after_keep(env):
    _settle(env)
    t0 = env.clock.t
    _set_manifest(env, source="upload", status="failed", be={"status": "failed"},
                  recovery={"attempts": 5, "gave_up_at": _iso(t0), "failed_stage": "transcribe"})
    env.be.calls.clear()
    env.clock.t = t0 + timedelta(seconds=KEEP_S - 1)
    assert _go(env) is None
    assert _kept(env)
    env.clock.t = t0 + timedelta(seconds=KEEP_S)
    assert _go(env) == (MID, "dropped")
    assert _gone(env)
    assert _intake(env)["expire"]["state"] == "dropped"
    assert env.be.calls == []


def test_handed_off_upload_drops_only_tracks_after_keep(env):
    _settle(env)
    t0 = env.clock.t
    _set_manifest(env, source="upload", status="handed_off", be={"status": "done"},
                  stages={"handed_off": _iso(t0)})
    env.clock.t = t0 + timedelta(seconds=KEEP_S - 1)
    assert _go(env) is None
    assert _kept(env)
    env.clock.t = t0 + timedelta(seconds=KEEP_S)
    assert _go(env) == (MID, "tracks_dropped")
    assert not (env.rec / f"upload_{MID}").exists()
    assert _manifest_file(env).exists() and (env.tr / f"session_upload_{MID}.json").exists()
    assert (env.rec / ".uploads" / MID / "intake.json").exists()
    assert _intake(env)["expire"]["state"] == "tracks_dropped"
    assert _go(env) is None
    assert env.be.calls[-1][0] != "DELETE"


def test_locked_given_up_upload_is_not_dropped(env):
    _settle(env)
    t0 = env.clock.t
    _set_manifest(env, source="upload", status="failed", be={"status": "failed"},
                  recovery={"attempts": 5, "gave_up_at": _iso(t0), "failed_stage": "transcribe"})
    env.clock.t = t0 + timedelta(seconds=KEEP_S)
    lock = try_lock(_manifest_file(env))
    try:
        assert _go(env) is None
        assert _kept(env)
    finally:
        lock.release()
    assert _go(env) == (MID, "dropped")


def _age(e, seconds):
    p = e.rec / ".uploads" / MID / "intake.json"
    ts = (e.clock.t - timedelta(seconds=seconds)).timestamp()
    os.utime(p, (ts, ts))


def _finish_record(e, **over):
    """매니페스트와 트랙·전사본을 치운 채 intake.json 만 정해진 모양으로 둔다."""
    _set_intake(e, **over)
    from capture.recorder import drop_local
    drop_local(e.rec, f"upload_{MID}")
    (e.tr / f"session_upload_{MID}.json").unlink()


_FINISHED_RECORDS = {
    "intake failed": dict(state="failed", fail_pending=None, report=None),
    "report ended": dict(report={"state": "ended"}),
    "report failed": dict(report={"state": "failed"}),
    "resume ended": dict(resume={"state": "ended"}),
    "resume failed": dict(resume={"state": "failed"}),
    "expired": dict(expire={"state": "expired"}),
}


@pytest.mark.parametrize("over", list(_FINISHED_RECORDS.values()), ids=list(_FINISHED_RECORDS))
def test_finished_record_folder_is_removed_after_keep(env, over):
    _finish_record(env, **over)
    folder = env.rec / ".uploads" / MID
    _age(env, KEEP_S - 1)
    assert _go(env) is None
    assert folder.exists()
    _age(env, KEEP_S)
    assert _go(env) == (MID, "record_removed")
    assert not folder.exists()
    assert _go(env) is None


_OPEN_RECORDS = {
    "claiming": dict(state="claiming"),
    "claimed": dict(state="claimed"),
    "converted": dict(state="converted"),
    "submitted": dict(state="submitted"),
    "fail_pending": dict(state="failed", fail_pending={"error": "x"}),
    "report reporting": dict(report={"state": "reporting"}),
    "report failing": dict(report={"state": "failing"}),
    "resume resuming": dict(resume={"state": "resuming"}),
    "resume failing": dict(resume={"state": "failing"}),
}


@pytest.mark.parametrize("over", list(_OPEN_RECORDS.values()), ids=list(_OPEN_RECORDS))
def test_open_records_are_never_removed(env, over):
    _finish_record(env, **over)
    _age(env, KEEP_S * 100)
    env.clock.advance(KEEP_S * 100)
    assert _go(env) is None
    assert (env.rec / ".uploads" / MID / "intake.json").exists()


def test_record_is_kept_while_manifest_exists(env):
    _set_intake(env, expire={"state": "expired"})
    _age(env, KEEP_S * 3)
    assert _manifest_file(env).exists()
    assert _go(env) is None
    assert (env.rec / ".uploads" / MID / "intake.json").exists()


def test_broken_record_is_logged_once_not_removed(env, caplog):
    _settle(env)   # 이 회의는 정리할 것이 없다: 깨진 폴더만 본다
    folder = env.rec / ".uploads" / "broken"
    folder.mkdir()
    (folder / "intake.json").write_text("{not json", encoding="utf-8")
    ts = (env.clock.t - timedelta(seconds=KEEP_S * 3)).timestamp()
    os.utime(folder / "intake.json", (ts, ts))
    env.clock.advance(KEEP_S * 3)
    with caplog.at_level(logging.WARNING, logger="upload.cleanup"):
        assert _go(env) is None
        assert _go(env) is None
    assert (folder / "intake.json").exists()
    assert len([r for r in caplog.records if "broken" in r.getMessage()]) == 1
