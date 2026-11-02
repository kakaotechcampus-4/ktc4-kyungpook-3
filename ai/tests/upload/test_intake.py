"""upload.intake: BE 업로드 회의를 가져와 화자 분리하고 diarized 매니페스트로 만든다. 가짜 BE·가짜 분리기·가짜 시계만 쓴다."""
from __future__ import annotations

import io
import json
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
import soundfile as sf

from capture.handoff import BeClient, BeError
from capture.recorder import RECOVERY_MAX_ATTEMPTS, backoff_s
from tests.capture.fake_be import FakeBe
from tests.conftest import SEGS, FakeDiarizer
from upload.diarize import JobNotFound
from upload.intake import SUBMIT_TIMEOUT_S, intake_one

MID = "mtg-1"
TZ = "Asia/Seoul"


class Clock:
    def __init__(self):
        self.t = datetime(2026, 11, 3, 3, 0, tzinfo=timezone.utc)

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += timedelta(seconds=seconds)


def _wav_bytes(secs=12):
    t = np.arange(secs * 16000) / 16000
    buf = io.BytesIO()
    sf.write(buf, (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), 16000, format="WAV", subtype="PCM_16")
    return buf.getvalue()


@pytest.fixture
def env(tmp_path):
    be = FakeBe()
    client = BeClient("http://be", session=be, service_token="svc-token")
    audio = _wav_bytes()
    item = be.add_upload(MID, audio=audio, stored_filename="audio.wav", original_filename="회의.wav")
    rec = tmp_path / "rec"
    rec.mkdir()
    return type("Env", (), {"be": be, "client": client, "rec": rec, "item": item, "clock": Clock(),
                            "diar": FakeDiarizer(SEGS), "audio": audio})


def _step(e, diar=None, client=None):
    return intake_one(e.rec, client=client or e.client, diarizer=diar or e.diar, now=e.clock, timezone=TZ)


def _drive(e, diar=None, client=None, limit=30):
    events = []
    for _ in range(limit):
        ev = _step(e, diar, client)
        events.append(ev.event if ev else None)
        if ev is None or ev.event in ("done", "failed", "fail_pending", "retry"):
            break
    return events


def _state(e, mid=MID):
    return json.loads((e.rec / ".uploads" / mid / "intake.json").read_text(encoding="utf-8"))


def _paths(e, mid=MID):
    return [p for _, p, _ in e.be.calls if p.startswith("/uploads") or p.endswith("/fail")], mid


def test_nothing_pending_returns_none(env):
    env.be.uploads.clear()
    assert _step(env) is None
    assert not (env.rec / ".uploads").exists()


def test_happy_path_goes_through_every_stage_one_step_per_call(env):
    env.diar = FakeDiarizer(SEGS, pending_fetches=1)
    events = _drive(env)
    assert events == ["claimed", "converted", "submitted", "waiting", "done"]
    assert [(m, p) for m, p, _ in env.be.calls] == [
        ("GET", "/uploads/pending"), ("PATCH", f"/uploads/{MID}/claim"), ("GET", f"/uploads/{MID}/file")]
    assert env.diar.submits and len(env.diar.submits) == 1 and env.diar.fetches == ["job-1", "job-1"]
    assert env.diar.submits[0].suffix == ".wav" and env.diar.calls == []   # diarize() 는 부르지 않는다
    m = json.loads((env.rec / f"session_upload_{MID}.json").read_text(encoding="utf-8"))
    assert m["status"] == "diarized" and m["source"] == "upload" and m["session"] == f"upload_{MID}"
    assert m["be"] == {"meeting_id": MID, "status": "processing"} and m["workspace_id"] == "ws-1"
    assert m["attendees"] == env.item["attendees"] and m["started_at"] == env.item["started_at"]
    assert m["title"] == "주간 회의" and m["timezone"] == TZ and m["meeting_dir"] == f"upload_{MID}"
    assert m["upload"] == {"original_filename": "회의.wav", "stored_filename": "audio.wav", "content_type": "audio/mp4",
                           "size_bytes": len(env.audio), "uploaded_at": "2026-11-03T02:00:00+00:00"}
    assert [s["user_id"] for s in m["speakers"]] == ["SPEAKER00", "SPEAKER01"]
    assert all((env.rec / s["file"]).exists() for s in m["speakers"])
    d = env.rec / ".uploads" / MID
    assert sorted(p.name for p in d.iterdir()) == ["intake.json"]   # 원본·변환 wav 는 지워지고 기록만 남는다
    assert _state(env)["state"] == "done"
    assert _step(env) is None   # 끝난 건은 다시 집지 않는다


def test_pyannote_gets_the_16k_mono_wav(env, monkeypatch):
    seen = {}

    class Spy(FakeDiarizer):
        def submit(self, path):
            info = sf.info(str(path))
            seen.update(sr=info.samplerate, ch=info.channels)
            return super().submit(path)

    _drive(env, diar=Spy(SEGS))
    assert seen == {"sr": 16000, "ch": 1}


def test_claim_response_lost_then_continue_from_claiming_record(env):
    env.be.claim_lost = True
    ev = _step(env)
    assert ev.event == "retry" and _state(env)["state"] == "claiming" and _state(env)["attempts"] == 1
    env.be.claim_lost = False
    env.clock.advance(backoff_s(1) + 1)
    assert _drive(env)[-1] == "done"   # 409 MEETING_PROCESSING_IN_PROGRESS 를 이전 실행의 흔적으로 보고 이어 간다


class StaleList(BeClient):
    """대기 목록을 받은 뒤 다른 쪽이 먼저 처리한 상황."""
    def __init__(self, inner, item):
        self.__dict__.update(inner.__dict__)
        self._item = item

    def pending_uploads(self):
        return [self._item]


def test_claim_409_in_progress_on_fresh_record_means_someone_else_has_it(env):
    env.be.uploads[MID]["claimed"] = True
    ev = _step(env, client=StaleList(env.client, env.item))
    assert ev.event == "skipped" and not (env.rec / ".uploads" / MID).exists()
    assert not any(p.endswith("/file") for _, p, _ in env.be.calls)


@pytest.mark.parametrize("how", ["ended", "gone"])
def test_claim_ended_or_missing_is_dropped(env, how):
    if how == "ended":
        env.be.meetings[MID]["status"] = "done"
    else:
        del env.be.uploads[MID]
    ev = _step(env, client=StaleList(env.client, env.item))
    assert ev.event == "skipped" and not (env.rec / ".uploads" / MID).exists()
    assert not any(m == "PATCH" and p.endswith("/fail") for m, p, _ in env.be.calls)


def test_started_at_without_timezone_fails_without_calling_diarizer(env):
    env.be.uploads[MID]["item"]["started_at"] = "2026-11-03T10:00:00"
    assert _drive(env)[-1] == "failed"
    assert env.diar.submits == [] and env.diar.calls == []
    assert env.be.meetings[MID]["status"] == "failed" and env.be.meetings[MID]["failed_stage"] == "diarize"
    assert _state(env)["state"] == "failed"


def test_undecodable_audio_fails_and_cleans_files(env):
    env.be.uploads[MID]["audio"] = b"this is not audio"
    env.be.uploads[MID]["item"]["size_bytes"] = len(b"this is not audio")
    assert _drive(env)[-1] == "failed"
    assert env.be.meetings[MID]["failed_stage"] == "diarize"
    assert sorted(p.name for p in (env.rec / ".uploads" / MID).iterdir()) == ["intake.json"]
    assert env.diar.submits == []


def test_file_404_fails_permanently(env):
    env.be.uploads[MID]["audio"] = None
    assert _drive(env)[-1] == "failed" and env.be.meetings[MID]["status"] == "failed"


def test_no_speaker_segments_fails(env):
    assert _drive(env, diar=FakeDiarizer([]))[-1] == "failed"
    assert env.be.meetings[MID]["failed_stage"] == "diarize"
    assert not list(env.rec.glob("session_*.json"))


class FlakySubmit(FakeDiarizer):
    def __init__(self, segs, fail_times):
        super().__init__(segs)
        self.fail_times = fail_times

    def submit(self, path):
        if self.fail_times > 0:
            self.fail_times -= 1
            raise RuntimeError("pyannoteAI 503")
        return super().submit(path)


def test_transient_failure_backs_off_then_recovers(env):
    diar = FlakySubmit(SEGS, 1)
    assert _drive(env, diar)[-1] == "retry"
    s = _state(env)
    assert s["state"] == "converted" and s["attempts"] == 1
    assert datetime.fromisoformat(s["next_at"]) == env.clock.t + timedelta(seconds=backoff_s(1))
    assert _step(env, diar) is None and diar.submits == []   # 아직 때가 아니다(BE 에 새로 물을 것도 없다)
    env.clock.advance(backoff_s(1))
    assert _drive(env, diar)[-1] == "done"
    assert env.be.meetings[MID]["status"] == "processing"


def test_transient_failures_give_up_at_the_limit_and_report_fail(env):
    diar = FlakySubmit(SEGS, 99)
    last = None
    for _ in range(RECOVERY_MAX_ATTEMPTS + 2):
        last = _step(env, diar)
        if last is None or last.event == "failed":
            break
        env.clock.advance(backoff_s(_state(env)["attempts"]) + 1)
    assert last.event == "failed" and _state(env)["attempts"] == RECOVERY_MAX_ATTEMPTS
    assert env.be.meetings[MID]["failed_stage"] == "diarize"
    assert sorted(p.name for p in (env.rec / ".uploads" / MID).iterdir()) == ["intake.json"]


def test_size_mismatch_is_transient_and_leaves_no_partial_file(env):
    env.be.uploads[MID]["item"]["size_bytes"] += 1
    ev = _step(env)  # claim
    ev = _step(env)
    assert ev.event == "retry" and _state(env)["state"] == "claimed" and _state(env)["attempts"] == 1
    assert env.be.meetings[MID]["status"] == "processing"


def test_download_cut_off_is_transient(env):
    env.be.file_break_after = 10
    _step(env)
    assert _step(env).event == "retry" and _state(env)["state"] == "claimed"


class FailOnce(BeClient):
    def __init__(self, inner):
        self.__dict__.update(inner.__dict__)
        self.sent = 0
        self.up = False

    def fail_meeting(self, meeting_id, failed_stage):
        self.sent += 1
        if not self.up:
            raise BeError("NETWORK", "down")
        return super().fail_meeting(meeting_id, failed_stage)


def test_failed_fail_report_is_kept_and_resent(env):
    env.be.uploads[MID]["item"]["started_at"] = "2026-11-03T10:00:00"
    client = FailOnce(env.client)
    events = _drive(env, client=client)
    assert events[-1] == "fail_pending" and _state(env)["fail_pending"] and env.be.meetings[MID]["status"] == "processing"
    assert sorted(p.name for p in (env.rec / ".uploads" / MID).iterdir()) == ["intake.json"]   # 실패 보고 전에도 원본은 필요 없다
    client.up = True
    assert _step(env, client=client).event == "failed"
    assert env.be.meetings[MID]["status"] == "failed" and client.sent == 2
    assert _state(env)["state"] == "failed" and not _state(env).get("fail_pending")


def test_restart_with_manifest_already_written_only_cleans_up(env):
    _drive(env)
    s = _state(env)
    s["state"] = "submitted"
    (env.rec / ".uploads" / MID / "intake.json").write_text(json.dumps(s), encoding="utf-8")
    (env.rec / ".uploads" / MID / "source.wav").write_bytes(b"x")
    (env.rec / ".uploads" / MID / "audio_16k.wav").write_bytes(b"x")
    d2 = FakeDiarizer(SEGS)
    assert _step(env, d2).event == "done"
    assert d2.submits == [] and d2.fetches == []
    assert sorted(p.name for p in (env.rec / ".uploads" / MID).iterdir()) == ["intake.json"]
    assert _state(env)["state"] == "done"


def test_restart_with_job_id_fetches_without_resubmitting(env):
    first = FakeDiarizer(SEGS, pending_fetches=99)
    assert _drive(env, first, limit=4)[-1] == "waiting"
    assert len(first.submits) == 1 and _state(env)["job_id"] == "job-1"
    second = FakeDiarizer(SEGS)   # 재시작: 새 프로세스
    assert _drive(env, second)[-1] == "done"
    assert second.submits == [] and second.fetches == ["job-1"]


def test_restart_removes_track_folder_left_without_manifest(env):
    stale = env.rec / f"upload_{MID}"
    stale.mkdir()
    (stale / "old.wav").write_bytes(b"x")
    assert _drive(env)[-1] == "done"
    assert not (stale / "old.wav").exists() and sorted(p.name for p in stale.iterdir()) == \
        sorted(["diarization.json"] + [s["file"].split("/")[1] for s in json.loads(
            (env.rec / f"session_upload_{MID}.json").read_text(encoding="utf-8"))["speakers"]])


def test_result_timeout_resubmits(env):
    diar = FakeDiarizer(SEGS, pending_fetches=99)
    _drive(env, diar, limit=4)
    env.clock.advance(SUBMIT_TIMEOUT_S - 1)
    assert _step(env, diar).event == "waiting" and len(diar.submits) == 1
    env.clock.advance(2)
    assert _step(env, diar).event == "retry"
    s = _state(env)
    assert s["state"] == "converted" and s["attempts"] == 1 and not s.get("job_id")
    env.clock.advance(backoff_s(1))
    diar.pending_fetches = 0
    assert _drive(env, diar)[-1] == "done" and len(diar.submits) == 2


def test_job_not_found_resubmits(env):
    class Gone(FakeDiarizer):
        def fetch(self, job_id):
            raise JobNotFound(job_id)

    diar = Gone(SEGS)
    _drive(env, diar, limit=4)
    assert _state(env)["state"] == "converted" and _state(env)["attempts"] == 1


def test_unfinished_local_record_is_continued_before_asking_be(env):
    env.diar = FakeDiarizer(SEGS, pending_fetches=99)
    _drive(env, limit=3)   # claimed, converted, submitted
    env.be.add_upload("mtg-2", audio=env.audio, stored_filename="a.wav")
    env.be.calls.clear()
    assert _step(env).meeting_id == MID
    assert not any(p == "/uploads/pending" for _, p, _ in env.be.calls)
