"""upload.report: 가져온 업로드의 화자 라벨·샘플 구간을 BE 에 보고한다. 가짜 BE(엄격한 assign)·가짜 분리기·가짜 시계만 쓴다.
보고는 처음부터 끝까지 실제 report_one 으로 하고 FakeBe.mark_reported 는 쓰지 않는다."""
from __future__ import annotations

import io
import json
import math
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
import soundfile as sf

from capture.handoff import BeClient, BeError
from capture.recorder import manifest_path
from tests.capture.fake_be import FakeBe
from tests.conftest import SEGS, FakeDiarizer
from upload.assign import assign_one
from upload.intake import intake_one
from upload.report import build_speakers, report_one

MID = "mtg-1"


class Clock:
    def __init__(self):
        self.t = datetime(2026, 11, 4, 3, 0, tzinfo=timezone.utc)

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += timedelta(seconds=seconds)


class Wrapped:
    """진짜 BeClient 를 감싸고, 정해 둔 오류를 보고·fail 에서 먼저 낸다."""

    def __init__(self, inner):
        self.inner = inner
        self.report_error = None
        self.fail_error = None

    def report_speakers(self, mid, speakers):
        if self.report_error:
            raise self.report_error
        return self.inner.report_speakers(mid, speakers)

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
    diarizer = FakeDiarizer(SEGS)
    for _ in range(30):   # 가져오기로 diarized 매니페스트까지 간다. 보고는 아직 하지 않는다
        ev = intake_one(rec, client=client, diarizer=diarizer, now=clock, timezone="Asia/Seoul")
        if ev is None or ev.event == "done":
            break
    assert manifest_path(rec, f"upload_{MID}").exists()
    return type("Env", (), {"be": be, "client": client, "wrapped": Wrapped(client), "rec": rec, "clock": clock,
                            "diarizer": diarizer})


def _go(e, client=None):
    return report_one(e.rec, client=client or e.client, now=e.clock)


def _manifest(e):
    return json.loads(manifest_path(e.rec, f"upload_{MID}").read_text(encoding="utf-8"))


def _intake(e):
    return json.loads((e.rec / ".uploads" / MID / "intake.json").read_text(encoding="utf-8"))


def _posts(e):
    return [b for m, p, b in e.be.calls if m == "POST" and p.endswith("/speakers")]


def _fails(e):
    return [p for m, p, _ in e.be.calls if m == "PATCH" and p.endswith("/fail")]


def _local_gone(e):
    return (not manifest_path(e.rec, f"upload_{MID}").exists() and not (e.rec / f"upload_{MID}").exists()
            and not manifest_path(e.rec, f"upload_{MID}").with_suffix(".lock").exists())


EXPECTED = [
    {"label": "SPEAKER_00", "total_sec": 2.0, "samples": [{"start": 1.0, "end": 3.0}]},
    {"label": "SPEAKER_01", "total_sec": 3.0, "samples": [{"start": 6.0, "end": 9.0}]},
]


# ---- 한 건 보고 ----

def test_done_upload_is_reported_with_one_post(env):
    before = _intake(env)
    assert _go(env) == ("mtg-1", "reported")
    assert _posts(env) == [{"speakers": EXPECTED}]
    assert env.be.meetings[MID]["status"] == "awaiting_speakers"
    after = _intake(env)
    assert after["report"]["state"] == "reported" and after["report"]["speakers"] == EXPECTED
    assert after["report"]["reported_at"]
    assert {k: v for k, v in after.items() if k != "report"} == before   # 가져오기 상태는 그대로
    assert _manifest(env)["status"] == "diarized"
    assert _go(env) is None and len(_posts(env)) == 1


def test_nothing_to_report_returns_none(tmp_path):
    be = FakeBe()
    assert report_one(tmp_path, client=BeClient("http://be", session=be, service_token="svc-token"), now=Clock()) is None
    assert be.calls == []


def test_report_does_not_resubmit_to_the_diarizer_when_intake_runs_again(env):
    submits = len(env.diarizer.submits)
    _go(env)
    assert intake_one(env.rec, client=env.client, diarizer=env.diarizer, now=env.clock, timezone="Asia/Seoul") is None
    assert len(env.diarizer.submits) == submits


# ---- 응답 유실·재전송 ----

def test_lost_response_resends_the_stored_body_even_if_diarization_changed(env):
    env.be.speakers_lost = True
    assert _go(env) == (MID, "retry")
    assert _intake(env)["report"]["state"] == "reporting" and _intake(env)["report"]["attempts"] == 1
    assert env.be.meetings[MID]["status"] == "awaiting_speakers"   # BE 는 받았다
    dz = env.rec / f"upload_{MID}" / "diarization.json"
    dz.write_text(json.dumps({"duration_sec": 12, "segments": [{"start_s": 0, "end_s": 5, "label": "SPEAKER_00"}]}))
    env.be.speakers_lost = False
    assert _go(env) is None   # 아직 때가 아니다
    env.clock.advance(3600)
    assert _go(env) == (MID, "reported")
    posts = _posts(env)
    assert len(posts) == 2 and posts[0] == posts[1] == {"speakers": EXPECTED}
    assert _intake(env)["report"]["state"] == "reported"


# ---- 이미 보고됨 ----

def test_already_reported_with_the_same_labels_counts_as_reported(env):
    env.be.mark_reported(MID, ["SPEAKER_00", "SPEAKER_01"])   # 내용(샘플)은 다르지만 라벨은 같다
    assert _go(env) == (MID, "reported")
    assert _fails(env) == [] and not _local_gone(env)


def test_already_reported_with_other_labels_drops_local_and_fails(env):
    env.be.mark_reported(MID, ["A", "B"])
    assert _go(env) == (MID, "failed")
    assert _local_gone(env) and len(_fails(env)) == 1
    assert env.be.meetings[MID]["failed_stage"] == "diarize"
    assert _intake(env)["report"]["state"] == "failed"
    assert _go(env) is None


# ---- 끝난 회의·미claim·400 ----

@pytest.mark.parametrize("how", ["ended", "missing"])
def test_ended_or_missing_cleans_local_without_fail(env, how):
    if how == "ended":
        env.be.meetings[MID]["status"] = "failed"
    else:
        env.be.uploads.pop(MID)
    assert _go(env) == (MID, "ended")
    assert _local_gone(env) and _fails(env) == []
    assert _intake(env)["report"]["state"] == "ended"
    assert _go(env) is None


def test_not_claimed_drops_local_and_fails(env):
    env.be.uploads[MID]["claimed"] = False
    assert _go(env) == (MID, "failed")
    assert _local_gone(env) and len(_fails(env)) == 1


def test_bad_request_drops_local_and_fails(env):
    env.wrapped.report_error = BeError("INVALID_REQUEST", "잘못", status=400, details={"fields": []})
    assert _go(env, env.wrapped) == (MID, "failed")
    assert _local_gone(env) and len(_fails(env)) == 1


# ---- 일시 실패 ----

def test_transient_failures_never_give_up(env):
    env.be.down = True
    for n in range(1, 13):
        assert _go(env) == (MID, "retry")
        r = _intake(env)["report"]
        assert r["state"] == "reporting" and r["attempts"] == n and r["error"]
        assert _go(env) is None   # 때가 되기 전엔 건드리지 않는다
        env.clock.advance(3600 + 1)
    assert not _local_gone(env) and _fails(env) == []
    env.be.down = False
    assert _go(env) == (MID, "reported")


@pytest.mark.parametrize("err", [BeError("UNAUTHENTICATED", "x", status=401), BeError("HTTP_503", "x", status=503),
                                 BeError("BAD_RESPONSE", "x")])
def test_other_errors_retry(env, err):
    env.wrapped.report_error = err
    assert _go(env, env.wrapped) == (MID, "retry")
    assert not _local_gone(env) and _fails(env) == []


def test_failing_resends_fail_after_backoff(env):
    env.wrapped.report_error = BeError("INVALID_REQUEST", "x", status=400)
    env.wrapped.fail_error = BeError("NETWORK", "끊김")
    assert _go(env, env.wrapped) == (MID, "fail_pending")
    assert _local_gone(env) and _intake(env)["report"]["state"] == "failing"
    assert _go(env, env.wrapped) is None
    env.wrapped.fail_error = None
    env.clock.advance(3600)
    assert _go(env, env.wrapped) == (MID, "failed")
    assert len(_fails(env)) == 1 and _intake(env)["report"]["state"] == "failed"


def test_failing_treats_404_on_fail_as_finished(env):
    env.wrapped.report_error = BeError("INVALID_REQUEST", "x", status=400)
    env.wrapped.fail_error = BeError("MEETING_NOT_FOUND", "없음", status=404)
    assert _go(env, env.wrapped) == (MID, "failed")


# ---- 로컬 파일 문제 ----

def _break(e, how):
    mf = manifest_path(e.rec, f"upload_{MID}")
    dz = e.rec / f"upload_{MID}" / "diarization.json"
    if how == "no_manifest":
        mf.unlink()
    elif how == "bad_manifest":
        mf.write_text("{깨짐")
    elif how == "no_diarization":
        dz.unlink()
    elif how == "bad_diarization":
        dz.write_text("{깨짐")
    elif how == "label_mismatch":
        dz.write_text(json.dumps({"duration_sec": 12, "segments": [{"start_s": 1, "end_s": 3, "label": "SPEAKER_09"}]}))


@pytest.mark.parametrize("how", ["no_manifest", "bad_manifest", "no_diarization", "bad_diarization", "label_mismatch"])
def test_unusable_local_files_drop_local_and_fail_without_posting(env, how):
    _break(env, how)
    assert _go(env) == (MID, "failed")
    assert _posts(env) == [] and len(_fails(env)) == 1 and _local_gone(env)


# ---- 처음부터 끝까지 ----

def test_end_to_end_intake_report_assign_mapped(env):
    assert _go(env) == (MID, "reported")
    env.be.assign(MID, {"SPEAKER_00": "u1", "SPEAKER_01": None})   # 엄격한 지정: 보고한 라벨과 같아야 한다
    assert assign_one(env.rec, client=env.client, now=env.clock) == (MID, "mapped")
    m = _manifest(env)
    assert m["status"] == "mapped"
    assert {s["user_id"]: s["member_id"] for s in m["speakers"]} == {"SPEAKER00": "u1", "SPEAKER01": None}


def test_not_reported_means_be_refuses_assign(env):
    with pytest.raises(AssertionError):
        env.be.assign(MID, {"SPEAKER_00": "u1", "SPEAKER_01": None})


# ---- 지정 받기가 먼저 끝난 reporting (#286) ----

def _reporting_then_mapped(e):
    """보고 응답을 잃어 reporting 으로 남았는데 BE 는 이미 받았고, PM 이 지정을 끝내 지정 받기가 mapped 로 바꿨다(resume 키가 생겼다)."""
    e.be.speakers_lost = True
    assert _go(e) == (MID, "retry")
    e.be.speakers_lost = False
    e.be.assign(MID, {"SPEAKER_00": "u1", "SPEAKER_01": None})
    assert assign_one(e.rec, client=e.client, now=e.clock) == (MID, "mapped")
    assert _intake(e)["report"]["state"] == "reporting" and "resume" in _intake(e)
    e.clock.advance(3600)


def test_a_reporting_record_with_a_resume_key_closes_as_reported_without_calling_be(env):
    _reporting_then_mapped(env)
    calls = len(env.be.calls)
    assert _go(env) == (MID, "reported")
    assert len(env.be.calls) == calls                              # BE 를 부르지 않는다
    assert _intake(env)["report"]["state"] == "reported" and _go(env) is None
    assert _manifest(env)["status"] == "mapped" and not _local_gone(env)


@pytest.mark.parametrize("err", [
    BeError("MEETING_ALREADY_ENDED", "끝남", status=409, details={}),
    BeError("MEETING_NOT_FOUND", "없음", status=404, details={}),
    BeError("INVALID_REQUEST", "잘못", status=400, details={"fields": []}),
    BeError("SPEAKERS_ALREADY_REPORTED", "이미", status=409, details={"labels": ["A", "B"]}),
], ids=["ended", "missing", "bad_request", "other_labels"])
def test_no_report_error_path_deletes_a_mapped_manifest(env, err):
    """지정 받기가 이미 mapped 로 바꾼 회의는 보고가 어떻게 끝나도 매니페스트·트랙·잠금을 지우지 않는다."""
    _reporting_then_mapped(env)
    env.wrapped.report_error = err
    assert _go(env, env.wrapped) == (MID, "reported")
    assert _manifest(env)["status"] == "mapped" and not _local_gone(env) and _fails(env) == []


# ---- build_speakers ----

def _dz(segs, duration=100.0):
    return {"source": "x", "duration_sec": duration,
            "segments": [{"start_s": a, "end_s": b, "label": l} for a, b, l in segs]}


def _by(res):
    return {s["label"]: s for s in res}


def test_total_sec_sums_all_segments_including_overlap_and_rounds():
    res = _by(build_speakers(_dz([(0, 1.23456, "A"), (1, 2.0004, "A"), (1.5, 3, "B")]), ["A", "B"]))
    assert res["A"]["total_sec"] == round(1.23456 + 1.0004, 3)
    assert res["B"]["total_sec"] == 1.5


def test_samples_exclude_the_part_overlapping_other_labels():
    res = _by(build_speakers(_dz([(0, 10, "A"), (4, 6, "B")]), ["A", "B"]))
    assert res["A"]["samples"] == [{"start": 0.0, "end": 4.0}, {"start": 6.0, "end": 10.0}]
    assert res["B"]["samples"] == [{"start": 4.0, "end": 6.0}]


def test_samples_are_at_most_three_longest_cut_to_ten_seconds_sorted_by_start():
    segs = [(0, 3, "A"), (10, 30, "A"), (40, 44, "A"), (50, 53.5, "A"), (60, 62, "A")]
    s = build_speakers(_dz(segs), ["A"])[0]["samples"]
    # 길이 순: (10,30)=20 → 10초로, (40,44)=4, (50,53.5)=3.5. 시작 순으로 돌려준다
    assert s == [{"start": 10.0, "end": 20.0}, {"start": 40.0, "end": 44.0}, {"start": 50.0, "end": 53.5}]


def test_segments_shorter_than_two_seconds_are_not_samples_when_better_exist():
    s = build_speakers(_dz([(0, 1.9, "A"), (5, 8, "A")]), ["A"])[0]["samples"]
    assert s == [{"start": 5.0, "end": 8.0}]


def test_fallback_longest_clean_segment_when_none_reaches_two_seconds():
    s = build_speakers(_dz([(0, 1.5, "A"), (5, 6.9, "A")]), ["A"])[0]["samples"]
    assert s == [{"start": 5.0, "end": 6.9}]   # 1.9초가 1.5초보다 길다


def test_fallback_longest_original_segment_when_nothing_is_clean():
    segs = [(0, 3, "A"), (10, 20, "A"), (0, 3, "B"), (10, 20, "B")]
    res = _by(build_speakers(_dz(segs), ["A", "B"]))
    assert res["A"]["samples"] == [{"start": 10.0, "end": 20.0}]
    assert res["B"]["samples"] == [{"start": 10.0, "end": 20.0}]
    long = _by(build_speakers(_dz([(0, 30, "A"), (0, 30, "B")]), ["A", "B"]))
    assert long["A"]["samples"] == [{"start": 0.0, "end": 10.0}]   # 원래 구간도 10초로 자른다


def test_deterministic_ties_and_input_order_independence():
    segs = [(0, 3, "A"), (10, 13, "A"), (20, 23, "A"), (30, 33, "A"), (5, 8, "B")]
    a = build_speakers(_dz(segs), ["A", "B"])
    b = build_speakers(_dz(list(reversed(segs))), ["A", "B"])
    assert a == b and a[0]["samples"] == [{"start": 0.0, "end": 3.0}, {"start": 10.0, "end": 13.0},
                                          {"start": 20.0, "end": 23.0}]


def test_every_label_exactly_once_in_given_order():
    res = build_speakers(_dz([(0, 3, "B"), (4, 8, "A")]), ["A", "B"])
    assert [s["label"] for s in res] == ["A", "B"]


def test_label_without_segments_is_an_error():
    with pytest.raises(ValueError):
        build_speakers(_dz([(0, 3, "A")]), ["A", "B"])


def test_values_are_finite_rounded_and_inside_the_recording():
    segs = [(0.0004, 2.00049, "A"), (3.1234567, 99.99999, "A"), (50, 50.0004, "B")]
    for dur in (100.0, 99.9996):
        for s in build_speakers(_dz(segs, dur), ["A", "B"]):
            assert math.isfinite(s["total_sec"]) and s["total_sec"] >= 0 and s["samples"]
            for p in s["samples"]:
                assert 0 <= p["start"] < p["end"] <= dur
                assert all(math.isfinite(v) and round(v, 3) == v for v in p.values())


def test_segments_outside_or_invalid_are_clamped_or_ignored():
    segs = [(-5, 3, "A"), (90, 130, "A"), (7, 7, "A"), (math.nan, 4, "A")]
    s = build_speakers(_dz(segs, 100.0), ["A"])[0]
    assert s["total_sec"] == 3.0 + 10.0
    assert all(0 <= p["start"] < p["end"] <= 100.0 for p in s["samples"])


def test_tiny_clean_sliver_falls_through_to_the_original_segment():
    # A 의 깨끗한 구간은 5.0 뒤 1e-13 초뿐이라 샘플이 안 된다. 그래도 원래 구간으로 보고한다
    res = _by(build_speakers(_dz([(0, 5.0000000000001, "A"), (0, 5.0, "B")], 5.0000000000001), ["A", "B"]))
    assert res["A"]["samples"] == [{"start": 0.0, "end": 5.0}]


def test_clean_pieces_under_half_a_second_lose_to_a_longer_overlapped_segment():
    segs = [(0, 10, "A"), (0.2, 9.8, "B"), (20, 20.3, "A")]   # A 의 깨끗한 조각: 0.2·0.2·0.3초, 겹친 긴 구간: 10초
    res = _by(build_speakers(_dz(segs, 30.0), ["A", "B"]))
    assert res["A"]["samples"] == [{"start": 0.0, "end": 10.0}]


def test_label_with_no_possible_sample_is_an_error():
    # 길이 0.4ms 구간은 소수 셋째 자리로 맞추면 끝이 녹음 길이 밖이라 샘플이 될 수 없다
    with pytest.raises(ValueError):
        build_speakers(_dz([(99.9992, 99.9996, "A")], 99.9996), ["A"])
