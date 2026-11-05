"""upload.assign: PM 지정 결과를 받아 diarized 매니페스트를 mapped 로. 가짜 BE·가짜 분리기·가짜 시계만 쓴다."""
from __future__ import annotations

import io
import json
import logging
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
import requests
import soundfile as sf

from capture import recorder as R
from capture.handoff import BeClient, BeError
from capture.recorder import RECOVERY_MAX_ATTEMPTS, backoff_s, manifest_path
from tests.capture.fake_be import FakeBe
from tests.conftest import SEGS, FakeDiarizer
from upload import assign as A
from upload.assign import assign_one
from upload.intake import intake_one

MID = "mtg-1"
GOOD = {"SPEAKER_00": "u1", "SPEAKER_01": None}


class Clock:
    def __init__(self):
        self.t = datetime(2026, 11, 3, 3, 0, tzinfo=timezone.utc)

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += timedelta(seconds=seconds)


class Crash(BaseException):
    """프로세스가 죽은 것을 흉내 낸다(assign_one 의 except Exception 에 걸리지 않는다)."""


class Wrapped:
    """진짜 BeClient 를 감싸고, 정해 둔 오류를 resume·fail 에서 먼저 낸다."""

    def __init__(self, inner):
        self.inner = inner
        self.resume_error = None
        self.fail_error = None

    def assigned_uploads(self):
        return self.inner.assigned_uploads()

    def resume_upload(self, mid):
        if self.resume_error:
            raise self.resume_error
        return self.inner.resume_upload(mid)

    def fail_meeting(self, mid, stage):
        if self.fail_error:
            raise self.fail_error
        return self.inner.fail_meeting(mid, stage)


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
    rec = tmp_path / "rec"
    rec.mkdir()
    clock = Clock()
    for _ in range(30):   # intake 로 diarized 매니페스트까지 간다
        ev = intake_one(rec, client=client, diarizer=FakeDiarizer(SEGS), now=clock, timezone="Asia/Seoul")
        if ev is None or ev.event == "done":
            break
    assert manifest_path(rec, f"upload_{MID}").exists()
    A._skip_logged.clear()
    A._list_failing = False
    return type("Env", (), {"be": be, "client": client, "wrapped": Wrapped(client), "rec": rec, "clock": clock})


def _go(e, client=None):
    return assign_one(e.rec, client=client or e.client, now=e.clock)


def _manifest(e, mid=MID):
    return json.loads(manifest_path(e.rec, f"upload_{mid}").read_text(encoding="utf-8"))


def _intake(e, mid=MID):
    return json.loads((e.rec / ".uploads" / mid / "intake.json").read_text(encoding="utf-8"))


def _count(e, suffix):
    return sum(1 for m, p, _ in e.be.calls if m == "PATCH" and p.endswith(suffix))


def _local_gone(e, mid=MID):
    return (not manifest_path(e.rec, f"upload_{mid}").exists() and not (e.rec / f"upload_{mid}").exists()
            and not manifest_path(e.rec, f"upload_{mid}").with_suffix(".lock").exists())


def test_nothing_assigned_returns_none_and_does_not_resume(env):
    assert _go(env) is None
    assert _count(env, "/resume") == 0
    assert "resume" not in _intake(env)


def test_assigned_becomes_mapped_with_one_resume(env):
    before = _intake(env)
    env.be.assign(MID, GOOD)
    assert _go(env) == A.Progress(MID, "mapped")
    m = _manifest(env)
    assert m["status"] == "mapped"
    assert {s["user_id"]: s["member_id"] for s in m["speakers"]} == {"SPEAKER00": "u1", "SPEAKER01": None}
    assert _count(env, "/resume") == 1
    after = _intake(env)
    assert after["resume"]["state"] == "mapped"
    assert {k: v for k, v in after.items() if k != "resume"} == before   # intake 상태는 그대로
    assert _go(env) is None and _count(env, "/resume") == 1


def test_uses_resume_response_mapping_not_assigned_item(env):
    env.be.assign(MID, GOOD)

    class Lying(Wrapped):
        def assigned_uploads(self):
            return [dict(i, mapping={"SPEAKER_00": "WRONG", "SPEAKER_01": "WRONG"}) for i in super().assigned_uploads()]

    assert _go(env, Lying(env.client)).event == "mapped"
    assert [s["member_id"] for s in _manifest(env)["speakers"]] == ["u1", None]


def test_lost_resume_response_is_retried_from_local_record(env):
    env.be.assign(MID, GOOD)
    env.be.resume_lost = True
    assert _go(env) == A.Progress(MID, "retry")
    assert _manifest(env)["status"] == "diarized"
    r = _intake(env)["resume"]
    assert r["state"] == "resuming" and r["attempts"] == 1 and r["next_at"]
    env.be.resume_lost = False
    assert _go(env) is None                       # 대기 시각 전이고, assigned 에서도 사라졌다
    assert _count(env, "/resume") == 1
    env.clock.advance(backoff_s(1))
    assert _go(env) == A.Progress(MID, "mapped")
    assert _count(env, "/resume") == 2
    assert _manifest(env)["status"] == "mapped"


def test_death_before_apply_resumes_again_to_same_result(env, monkeypatch):
    env.be.assign(MID, GOOD)
    real = A.apply_mapping

    def die(*a, **k):
        raise Crash()

    monkeypatch.setattr(A, "apply_mapping", die)
    with pytest.raises(Crash):
        _go(env)
    assert _intake(env)["resume"]["state"] == "resuming" and _manifest(env)["status"] == "diarized"
    monkeypatch.setattr(A, "apply_mapping", real)
    assert _go(env) == A.Progress(MID, "mapped")        # 대기 시각 없이 바로 이어 간다
    assert _count(env, "/resume") == 2
    assert [s["member_id"] for s in _manifest(env)["speakers"]] == ["u1", None]


def test_speakers_not_assigned_waits_without_fail(env):
    env.be.assign(MID, GOOD)
    env.wrapped.resume_error = BeError("SPEAKERS_NOT_ASSIGNED", "x", status=409, details={"status": "processing"})
    assert _go(env, env.wrapped) == A.Progress(MID, "waiting")
    assert _manifest(env)["status"] == "diarized" and _count(env, "/fail") == 0
    r = _intake(env)["resume"]
    assert r["state"] == "resuming" and r["next_at"]
    assert _go(env, env.wrapped) is None                   # 대기 중
    env.wrapped.resume_error = None
    env.clock.advance(backoff_s(1))
    assert _go(env, env.wrapped) == A.Progress(MID, "mapped")


@pytest.mark.parametrize("how", ["ended", "missing"])
def test_ended_or_missing_cleans_local_without_fail(env, how):
    env.be.assign(MID, GOOD)
    env.be.resume_lost = True
    assert _go(env).event == "retry"
    env.be.resume_lost = False
    if how == "ended":
        env.be.meetings[MID]["status"] = "failed"
    else:
        del env.be.uploads[MID]
    env.clock.advance(backoff_s(1))
    assert _go(env) == A.Progress(MID, "ended")
    assert _local_gone(env)
    assert _intake(env)["resume"]["state"] == "ended"
    assert _count(env, "/fail") == 0
    assert _go(env) is None


def test_assigned_without_local_manifest_is_skipped_and_logged_once(env, caplog):
    env.be.add_upload("other", audio=b"x")
    env.be.assign("other", GOOD)
    caplog.set_level(logging.WARNING)
    assert _go(env) is None and _go(env) is None
    assert _count(env, "/resume") == 0
    assert sum("other" in r.getMessage() for r in caplog.records) == 1


def test_skips_item_without_manifest_and_takes_next(env):
    env.be.add_upload("other", audio=b"x")
    env.be.assign("other", GOOD)
    env.be.assign(MID, GOOD)
    assert _go(env) == A.Progress(MID, "mapped")


def test_label_mismatch_reports_fail_diarize_and_cleans(env):
    env.be.assign(MID, {"SPEAKER_00": "u1"})   # SPEAKER_01 이 빠졌다
    assert _go(env) == A.Progress(MID, "failed")
    assert ("PATCH", f"/meetings/{MID}/fail", {"failed_stage": "diarize"}) in env.be.calls
    assert env.be.meetings[MID]["status"] == "failed"
    assert _local_gone(env)
    assert _intake(env)["resume"]["state"] == "failed"
    assert _go(env) is None


def test_fail_report_error_is_kept_and_retried(env):
    env.be.assign(MID, {"SPEAKER_00": "u1"})
    env.wrapped.fail_error = requests.ConnectionError("down")
    assert _go(env, env.wrapped) == A.Progress(MID, "fail_pending")
    assert _local_gone(env)
    r = _intake(env)["resume"]
    assert r["state"] == "failing" and r["next_at"]
    assert _go(env, env.wrapped) is None
    env.wrapped.fail_error = None
    env.clock.advance(backoff_s(1))
    assert _go(env, env.wrapped) == A.Progress(MID, "failed")
    assert env.be.meetings[MID]["status"] == "failed" and _count(env, "/resume") == 1
    assert _intake(env)["resume"]["state"] == "failed"


def test_lock_contention_is_transient(env):
    env.be.assign(MID, GOOD)
    path = manifest_path(env.rec, f"upload_{MID}")
    lock = R.try_lock(path)
    try:
        assert _go(env) == A.Progress(MID, "retry")
        assert _manifest(env)["status"] == "diarized" and _count(env, "/fail") == 0
    finally:
        lock.release()
    env.clock.advance(backoff_s(1))
    assert _go(env) == A.Progress(MID, "mapped")


def test_transient_resume_failure_never_gives_up(env):
    env.be.assign(MID, GOOD)
    env.wrapped.resume_error = BeError("INTERNAL", "boom", status=503)
    for i in range(RECOVERY_MAX_ATTEMPTS + 3):
        assert _go(env, env.wrapped) == A.Progress(MID, "retry")
        env.clock.advance(backoff_s(i + 1) + 1)
    assert _count(env, "/fail") == 0 and _manifest(env)["status"] == "diarized"
    env.wrapped.resume_error = None
    assert _go(env, env.wrapped).event == "mapped"


def test_manifest_gone_after_resuming_record_fails_diarize_once(env):
    env.be.assign(MID, GOOD)
    env.be.resume_lost = True
    assert _go(env).event == "retry"
    env.be.resume_lost = False
    manifest_path(env.rec, f"upload_{MID}").unlink()      # resuming 기록이 남은 뒤 매니페스트가 사라졌다
    env.clock.advance(backoff_s(1))
    assert _go(env) == A.Progress(MID, "failed")
    assert _count(env, "/fail") == 1
    assert _intake(env)["resume"]["state"] == "failed"
    assert _go(env) is None and _count(env, "/fail") == 1


def test_assigned_is_skipped_until_intake_record_is_done(env):
    d = env.rec / ".uploads" / MID
    rec = _intake(env)
    rec["state"] = "submitted"      # 매니페스트를 쓴 뒤 done 저장 전에 죽은 모양
    (d / "intake.json").write_text(json.dumps(rec), encoding="utf-8")
    env.be.assign(MID, GOOD)
    assert _go(env) is None
    assert _count(env, "/resume") == 0 and "resume" not in _intake(env)


# --- 리뷰(Y-Jimin) 반영: 오류 봉투 없는 404 는 "회의가 사라짐" 이 아니다 / 목록 조회 실패는 흔적을 남긴다 ---

def _bare_404():
    return BeError("HTTP_404", "not found", status=404)   # 잘못된 경로·프록시·BE 배포 중: 오류 봉투가 없는 404


def test_a_bare_404_on_resume_is_retried_and_never_deletes_local_files(env):
    env.be.assign(MID, GOOD)
    env.wrapped.resume_error = _bare_404()
    assert _go(env, env.wrapped) == A.Progress(MID, "retry")
    assert not _local_gone(env)
    assert _manifest(env)["status"] == "diarized"
    assert _intake(env)["resume"]["state"] == "resuming" and _count(env, "/fail") == 0
    env.wrapped.resume_error = None
    env.clock.advance(backoff_s(1))
    assert _go(env, env.wrapped) == A.Progress(MID, "mapped")   # 고쳐지면 이어서 받는다


def test_a_meeting_not_found_envelope_on_resume_still_cleans_local(env):
    env.be.assign(MID, GOOD)
    env.wrapped.resume_error = BeError("MEETING_NOT_FOUND", "없다", status=404)
    assert _go(env, env.wrapped) == A.Progress(MID, "ended")
    assert _local_gone(env) and _count(env, "/fail") == 0


def test_a_bare_404_on_the_fail_report_is_retried_not_treated_as_done(env, monkeypatch):
    """지정을 쓸 수 없어 fail 을 보내는 중에 오류 봉투 없는 404 를 받으면 보고가 끝난 것으로 보지 않고 다시 보낸다."""
    env.be.assign(MID, GOOD)

    def unusable(*a, **k):   # 라벨 불일치 등 영구 실패를 흉내 낸다(가짜 BE 의 지정 검사와 무관하게 돈다)
        raise ValueError("라벨이 맞지 않는다")

    monkeypatch.setattr(A, "apply_mapping", unusable)
    env.wrapped.fail_error = _bare_404()
    ev = _go(env, env.wrapped)
    assert ev.event == "fail_pending"
    assert _intake(env)["resume"]["state"] == "failing"
    env.wrapped.fail_error = None
    env.clock.advance(backoff_s(1))
    assert _go(env, env.wrapped).event == "failed"


def test_assigned_list_failure_leaves_one_warning_per_outage(env, caplog):
    class Down(Wrapped):
        def assigned_uploads(self):
            raise requests.ConnectionError("BE 가 꺼져 있다")

    with caplog.at_level(logging.WARNING, logger="upload.assign"):
        assert _go(env, Down(env.client)) is None
        assert _go(env, Down(env.client)) is None
        assert sum("assigned" in r.getMessage() for r in caplog.records) == 1   # 같은 장애는 한 번만
        assert _go(env) is None   # BE 가 돌아와 조회에 성공하면 알림 상태를 푼다
        assert _go(env, Down(env.client)) is None
        assert sum("assigned" in r.getMessage() for r in caplog.records) == 2   # 새 장애는 다시 남긴다
