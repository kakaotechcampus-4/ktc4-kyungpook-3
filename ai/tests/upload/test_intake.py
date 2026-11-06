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
from upload.intake import FETCH_POLL_S, INTAKE_DEADLINE_S, SUBMIT_TIMEOUT_S, intake_one

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
        if ev is not None and ev.event == "waiting":
            e.clock.advance(FETCH_POLL_S)   # 기다리는 건은 다음 확인 시각까지 쉰다
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
    assert sorted(p.name for p in (env.rec / ".uploads" / MID).iterdir()) == ["intake.json"]   # .part·원본이 남지 않는다


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


def test_failed_fail_report_is_kept_and_resent_after_backoff(env):
    env.be.uploads[MID]["item"]["started_at"] = "2026-11-03T10:00:00"
    client = FailOnce(env.client)
    events = _drive(env, client=client)
    assert events[-1] == "fail_pending" and _state(env)["fail_pending"] and env.be.meetings[MID]["status"] == "processing"
    assert sorted(p.name for p in (env.rec / ".uploads" / MID).iterdir()) == ["intake.json"]   # 실패 보고 전에도 원본은 필요 없다
    client.up = True
    assert _step(env, client=client) is None and client.sent == 1   # 아직 때가 아니다: 대기가 지나기 전에는 다시 보내지 않는다
    env.clock.advance(backoff_s(1))
    assert _step(env, client=client).event == "failed"
    assert env.be.meetings[MID]["status"] == "failed" and client.sent == 2
    assert _state(env)["state"] == "failed" and not _state(env).get("fail_pending")


def test_a_stuck_fail_report_does_not_block_other_uploads(env):
    env.be.uploads[MID]["item"]["started_at"] = "2026-11-03T10:00:00"
    env.be.add_upload("mtg-2", audio=env.audio, stored_filename="a.wav")
    client = FailOnce(env.client)
    assert _drive(env, client=client)[-1] == "fail_pending"
    ev = _step(env, client=client)   # mtg-1 의 보고는 대기 중이다. 다른 건을 가져온다
    assert ev.meeting_id == "mtg-2" and ev.event == "claimed" and client.sent == 1
    env.clock.advance(backoff_s(1) + 1)
    client.up = True
    assert _step(env, client=client).meeting_id == MID   # 때가 되면 보고를 다시 보낸다
    assert env.be.meetings[MID]["status"] == "failed"


def test_fail_report_backoff_grows_with_each_failed_report(env):
    env.be.uploads[MID]["item"]["started_at"] = "2026-11-03T10:00:00"
    client = FailOnce(env.client)
    _drive(env, client=client)
    first = datetime.fromisoformat(_state(env)["next_at"])
    assert first == env.clock.t + timedelta(seconds=backoff_s(1))
    env.clock.advance(backoff_s(1))
    assert _step(env, client=client).event == "fail_pending"
    assert datetime.fromisoformat(_state(env)["next_at"]) == env.clock.t + timedelta(seconds=backoff_s(2))


def test_fail_report_404_means_the_meeting_is_gone_so_we_are_done(env):
    class Gone(FailOnce):
        def fail_meeting(self, meeting_id, failed_stage):
            self.sent += 1
            raise BeError("MEETING_NOT_FOUND", "없다", status=404)

    env.be.uploads[MID]["item"]["started_at"] = "2026-11-03T10:00:00"
    client = Gone(env.client)
    assert _drive(env, client=client)[-1] == "failed"
    s = _state(env)
    assert s["state"] == "failed" and not s.get("fail_pending") and client.sent == 1
    assert _step(env, client=client) is None


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
    _drive(env, diar, limit=4)                   # 마지막 waiting 뒤 FETCH_POLL_S 가 흘렀다
    env.clock.advance(SUBMIT_TIMEOUT_S - FETCH_POLL_S - 1)
    assert _step(env, diar).event == "waiting" and len(diar.submits) == 1
    env.clock.advance(FETCH_POLL_S)               # 다음 확인 때는 제출 뒤 결과 시간을 넘었다
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


def _json_error():
    return json.JSONDecodeError("Expecting value", "", 0)   # requests.JSONDecodeError 도 ValueError 하위다


def test_a_valueerror_from_the_diarizer_submit_is_transient_not_a_fail(env):
    class BadJsonSubmit(FakeDiarizer):
        def submit(self, path):
            raise _json_error()

    assert _drive(env, BadJsonSubmit(SEGS))[-1] == "retry"
    assert _state(env)["state"] == "converted" and _state(env)["attempts"] == 1
    assert env.be.meetings[MID]["status"] == "processing" and not _state(env).get("fail_pending")


def test_a_valueerror_from_the_diarizer_fetch_is_transient_not_a_fail(env):
    class BadJsonFetch(FakeDiarizer):
        def fetch(self, job_id):
            raise _json_error()

    assert _drive(env, BadJsonFetch(SEGS), limit=4)[-1] == "retry"
    assert env.be.meetings[MID]["status"] == "processing" and not _state(env).get("fail_pending")


def test_job_not_found_submits_a_second_time_after_backoff(env):
    class Gone(FakeDiarizer):
        def fetch(self, job_id):
            if len(self.submits) < 2:
                raise JobNotFound(job_id)
            return super().fetch(job_id)

    diar = Gone(SEGS)
    _drive(env, diar, limit=4)
    assert len(diar.submits) == 1
    env.clock.advance(backoff_s(1))
    assert _drive(env, diar)[-1] == "done" and len(diar.submits) == 2


@pytest.mark.parametrize("how", ["ended", "gone"])
def test_claiming_record_with_claim_ended_or_missing_is_dropped(env, how):
    env.be.claim_lost = True
    assert _step(env).event == "retry" and _state(env)["state"] == "claiming"   # fresh=False 로 이어 갈 기록
    if how == "ended":
        env.be.meetings[MID]["status"] = "done"
    else:
        del env.be.uploads[MID]
    env.clock.advance(backoff_s(1) + 1)
    assert _step(env).event == "skipped" and not (env.rec / ".uploads" / MID).exists()
    assert not any(m == "PATCH" and p.endswith("/fail") for m, p, _ in env.be.calls)


@pytest.mark.parametrize("content", [None, "{not json", "[]", '{"meeting_id": "mtg-1"}'])
def test_a_folder_with_no_usable_record_is_claimed_again(env, content):
    d = env.rec / ".uploads" / MID
    d.mkdir(parents=True)
    if content is not None:
        (d / "intake.json").write_text(content, encoding="utf-8")
    assert _drive(env)[-1] == "done"


def test_a_garbled_next_at_means_due_now_and_never_escapes(env):
    diar = FlakySubmit(SEGS, 1)
    assert _drive(env, diar)[-1] == "retry"
    s = _state(env)
    s["next_at"] = "not-a-time"
    (env.rec / ".uploads" / MID / "intake.json").write_text(json.dumps(s), encoding="utf-8")
    assert _drive(env, diar)[-1] == "done"


# --- BE sweeper(#301, #288 합의): claim 시각부터 기한 안에 끝내고, BE 가 먼저 실패 처리했으면 정리만 하고 끝낸다 ---

def _claim_then_submit(e, diar):
    """claim → 변환 → 제출까지. 마지막 상태는 submitted."""
    events = [_step(e, diar).event for _ in range(3)]
    assert events == ["claimed", "converted", "submitted"]


def test_claim_time_is_recorded(env):
    _step(env)
    assert _state(env)["claimed_at"] == "2026-11-03T03:00:00+00:00"


def test_past_the_deadline_while_waiting_fails_without_resubmitting(env):
    diar = FakeDiarizer(SEGS, pending_fetches=99)
    _claim_then_submit(env, diar)
    env.clock.advance(INTAKE_DEADLINE_S + 1)
    assert _step(env, diar).event == "failed"
    assert len(diar.submits) == 1   # 다시 맡기지 않는다
    assert env.be.meetings[MID]["status"] == "failed" and env.be.meetings[MID]["failed_stage"] == "diarize"
    assert sorted(p.name for p in (env.rec / ".uploads" / MID).iterdir()) == ["intake.json"]
    assert "기한" in _state(env)["error"]


def test_deadline_is_checked_before_writing_tracks(env):
    diar = FakeDiarizer(SEGS)   # 결과는 준비돼 있지만 기한이 지났다
    _claim_then_submit(env, diar)
    env.clock.advance(INTAKE_DEADLINE_S + 1)
    assert _step(env, diar).event == "failed"
    assert not (env.rec / f"session_upload_{MID}.json").exists() and not (env.rec / f"upload_{MID}").exists()


def test_deadline_is_counted_from_claim_not_from_the_last_submit(env):
    diar = FakeDiarizer(SEGS, pending_fetches=99)
    _claim_then_submit(env, diar)
    env.clock.advance(SUBMIT_TIMEOUT_S + 1)
    assert _step(env, diar).event == "retry"             # 30분 초과: 다시 맡길 차례
    env.clock.advance(INTAKE_DEADLINE_S - SUBMIT_TIMEOUT_S)   # 다시 맡기기 전에 claim 부터 기한이 지났다
    assert _step(env, diar).event == "failed" and len(diar.submits) == 1


def test_exactly_at_the_deadline_is_not_yet_late(env, monkeypatch):
    """경계: claim 뒤 정확히 기한이면 아직 기한 안, 1초 넘으면 실패. 결과 대기 시간이 기한보다 길게 둬 대기 규칙과 섞이지 않게 한다."""
    monkeypatch.setattr("upload.intake.SUBMIT_TIMEOUT_S", INTAKE_DEADLINE_S * 10)
    diar = FakeDiarizer(SEGS, pending_fetches=99)
    _claim_then_submit(env, diar)
    env.clock.advance(INTAKE_DEADLINE_S)
    assert _step(env, diar).event == "waiting"
    env.clock.advance(1)
    assert _step(env, diar).event == "failed"


def test_deadline_is_two_and_a_half_hours():
    """#288 합의값. BE sweeper 의 3시간보다 30분 먼저 끝낸다."""
    assert INTAKE_DEADLINE_S == 9000


@pytest.mark.parametrize("claimed_at", [None, "x", "2026-11-03T03:00:00"])   # 없음, 깨짐, 시간대 없음
def test_a_record_without_a_usable_claim_time_starts_counting_now(env, claimed_at):
    diar = FakeDiarizer(SEGS, pending_fetches=99)
    _claim_then_submit(env, diar)
    s = _state(env)
    s["claimed_at"] = claimed_at
    (env.rec / ".uploads" / MID / "intake.json").write_text(json.dumps(s), encoding="utf-8")
    env.clock.advance(INTAKE_DEADLINE_S + 60)
    assert _step(env, diar).event == "retry"   # 처음 보는 바퀴에는 기한 실패가 아니라 기한을 지금부터 센다(여기선 30분 초과로 재시도)
    assert _state(env)["claimed_at"] == env.clock().isoformat()
    env.clock.advance(INTAKE_DEADLINE_S + 1)
    assert _step(env, diar).event == "failed"


def test_a_retry_is_never_scheduled_after_the_deadline(env, monkeypatch):
    """대기 간격이 길어도(설정으로 늘린 경우) 다음 시도는 기한을 넘기지 않는다. 기한에 깨어나 바로 실패로 보고한다."""
    monkeypatch.setattr("upload.intake.backoff_s", lambda n: 3600.0)
    diar = FakeDiarizer(SEGS, pending_fetches=99)
    _claim_then_submit(env, diar)
    env.clock.advance(INTAKE_DEADLINE_S - 60)
    assert _step(env, diar).event == "retry"   # 30분 초과로 다시 맡길 차례, 대기는 1시간이지만
    deadline = datetime(2026, 11, 3, 3, 0, tzinfo=timezone.utc) + timedelta(seconds=INTAKE_DEADLINE_S)
    wake = datetime.fromisoformat(_state(env)["next_at"])
    assert wake <= deadline + timedelta(seconds=1)
    env.clock.t = wake
    assert _step(env, diar).event == "failed" and len(diar.submits) == 1   # 깨어나서 다시 맡기지 않는다


def test_sweeper_already_failed_the_meeting_before_download(env):
    """BE 가 실패 처리하며 원본을 지웠다: 원본 404 → fail 은 409 ENDED(성공으로 본다) → 로컬은 기록만 남는다."""
    _step(env)   # claim
    env.be.meetings[MID]["status"] = "failed"
    env.be.meetings[MID]["failed_stage"] = "diarize"
    env.be.uploads[MID]["audio"] = None
    assert _drive(env)[-1] == "failed"
    assert env.be.meetings[MID]["failed_stage"] == "diarize"   # BE 가 정한 값을 덮지 않는다
    assert sorted(p.name for p in (env.rec / ".uploads" / MID).iterdir()) == ["intake.json"]
    assert _state(env)["state"] == "failed" and not _state(env).get("fail_pending")
    assert _step(env) is None


def test_sweeper_failed_the_meeting_while_we_wait_then_deadline_ends_it_quietly(env):
    diar = FakeDiarizer(SEGS, pending_fetches=99)
    _claim_then_submit(env, diar)
    env.be.meetings[MID]["status"] = "failed"
    env.be.meetings[MID]["failed_stage"] = "diarize"
    env.clock.advance(INTAKE_DEADLINE_S + 1)
    assert _step(env, diar).event == "failed"
    assert _state(env)["state"] == "failed" and not _state(env).get("fail_pending")
    assert not (env.rec / f"upload_{MID}").exists()


# --- #326 리뷰(Y-Jimin)와 같은 문제: 오류 봉투 없는 404 는 "회의·파일이 없음" 이 아니다 ---
# BE 는 없는 회의·파일에 늘 MEETING_NOT_FOUND 봉투를 준다(backend/app/api/uploads.py _not_found). 봉투 없는 404 는
# 잘못된 경로·프록시·BE 배포 중이라 일시 실패로 다시 해 본다. 그 회의를 건너뛰거나 실패로 보고하면 되돌릴 수 없다.

class Bare404(BeClient):
    def __init__(self, inner, *, on):
        self.__dict__.update(inner.__dict__)
        self.on = set(on)

    def _bare(self, what):
        if what in self.on:
            raise BeError("HTTP_404", "not found", status=404)

    def claim_upload(self, meeting_id):
        self._bare("claim")
        return super().claim_upload(meeting_id)

    def download_upload(self, meeting_id, dest):
        self._bare("file")
        return super().download_upload(meeting_id, dest)

    def fail_meeting(self, meeting_id, failed_stage):
        self._bare("fail")
        return super().fail_meeting(meeting_id, failed_stage)


def test_a_bare_404_on_claim_is_retried_not_skipped(env):
    client = Bare404(env.client, on={"claim"})
    assert _step(env, client=client).event == "retry"
    assert _state(env)["state"] == "claiming"   # 기록을 지우지 않는다(건너뛰면 다시 claim 하지 못한다)
    client.on.clear()
    env.clock.advance(backoff_s(1))
    assert _drive(env, client=client)[-1] == "done"


def test_a_bare_404_on_the_file_is_retried_not_a_permanent_failure(env):
    client = Bare404(env.client, on={"file"})
    events = _drive(env, client=client)
    assert events[-1] == "retry" and "failed" not in events
    assert env.be.meetings[MID]["status"] == "processing"   # 멀쩡한 회의를 실패로 보고하지 않는다
    client.on.clear()
    env.clock.advance(backoff_s(1))
    assert _drive(env, client=client)[-1] == "done"


def test_a_bare_404_on_the_fail_report_keeps_it_pending(env):
    env.be.uploads[MID]["item"]["started_at"] = "2026-11-03T10:00:00"   # 시간대 없음 → 바로 실패 보고
    client = Bare404(env.client, on={"fail"})
    assert _drive(env, client=client)[-1] == "fail_pending"
    assert _state(env)["fail_pending"]   # 끝난 것으로 보지 않는다
    client.on.clear()
    env.clock.advance(backoff_s(1))
    assert _step(env, client=client).event == "failed"
    assert env.be.meetings[MID]["status"] == "failed"


def test_waiting_for_a_result_lets_the_next_upload_be_claimed(env):
    """#289 리뷰: 분리 결과를 기다리는 건이 매 바퀴를 차지하면 다음 업로드가 claim 되지 않는다.
    기다릴 때는 잠깐 뒤(FETCH_POLL_S)를 다음 시각으로 적어 그 사이 다른 건을 처리한다."""
    env.be.add_upload("mtg-2", audio=env.audio, stored_filename="audio.wav", original_filename="둘째.wav")
    diar = FakeDiarizer(SEGS, pending_fetches=99)
    _claim_then_submit(env, diar)
    assert _step(env, diar).event == "waiting"
    assert _step(env, diar).event == "claimed" and _state(env, "mtg-2")["state"] == "claimed"
    env.clock.advance(FETCH_POLL_S)
    assert _step(env, diar).event == "waiting" and len(diar.fetches) == 2   # 때가 되면 첫 건을 다시 확인한다


def test_waiting_does_not_sleep_past_the_deadline(env, monkeypatch):
    """기다리는 다음 시각이 기한을 넘지 않는다. 기한 직후 바로 실패로 보고한다."""
    monkeypatch.setattr("upload.intake.SUBMIT_TIMEOUT_S", INTAKE_DEADLINE_S * 10)
    diar = FakeDiarizer(SEGS, pending_fetches=99)
    _claim_then_submit(env, diar)
    env.clock.advance(INTAKE_DEADLINE_S - FETCH_POLL_S / 2)
    assert _step(env, diar).event == "waiting"
    env.clock.advance(FETCH_POLL_S / 2 + 1)
    assert _step(env, diar).event == "failed"
