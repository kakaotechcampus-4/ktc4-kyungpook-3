"""upload.cleanup: 지정 결과가 오지 않는 업로드의 로컬 정리. 가짜 BE·가짜 분리기·가짜 시계만 쓴다.
준비는 실제 intake_one -> report_one 으로 reported 까지 간다."""
from __future__ import annotations

import io
import json
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
import soundfile as sf

from capture.handoff import BeClient, BeError
from capture.recorder import backoff_s, manifest_path, try_lock
from tests.capture.fake_be import FakeBe
from tests.conftest import SEGS, FakeDiarizer
from upload.cleanup import EXPIRE_AFTER_S, PROBE_EVERY_S, cleanup_one
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
