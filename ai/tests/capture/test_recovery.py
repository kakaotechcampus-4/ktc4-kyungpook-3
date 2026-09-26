"""자동 복구의 플랫폼 비종속 부분(capture/recorder.py). 회의 잠금, 실패 횟수와 백오프, 포기, 한 바퀴의 대상. 모델은 안 쓴다.

시계는 recorder.utcnow 를 바꿔 끼운다. 기다리지 않는다. 다른 프로세스의 잠금은 하위 프로세스를 실제로 띄워 본다.
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from capture import handoff as H
from capture import recorder as R
from stt import batch as B
from tests.capture.fake_be import FakeBe
from tests.capture.test_recorder import DiesOnLong, EchoStt, _extractor, _run, _session

T0 = datetime(2026, 9, 26, 3, 0, 0, tzinfo=timezone.utc)
AI_DIR = Path(__file__).resolve().parents[2]


@pytest.fixture
def clock(monkeypatch):
    now = {"t": T0}
    monkeypatch.setattr(R, "utcnow", lambda: now["t"])
    return now


def _saved(path):
    return json.loads(path.read_text(encoding="utf-8"))


def _dying(transcript, names, today):
    raise RuntimeError("LLM 죽음")


def _handoff(fake):
    return H.Handoff(H.BeClient("http://be", session=fake), "ws-1")


def _fails(fake):
    return sum(1 for c in fake.calls if c[1].endswith("/fail"))


@pytest.fixture
def limits(monkeypatch):
    """기본값을 테스트 안에 적어 둔다. 환경 변수로 바뀌어도 테스트의 기대값은 그대로다."""
    monkeypatch.setattr(R, "RECOVERY_MAX_ATTEMPTS", 5)
    monkeypatch.setattr(R, "RECOVERY_BACKOFF_S", 60.0)
    monkeypatch.setattr(R, "PARTIAL_RETRY_MAX", 3)
    monkeypatch.setattr(B, "RETRY_WAIT_S", 0.0)


def test_a_claim_takes_the_meeting_lock_and_the_same_process_cannot_take_it_twice(tmp_path, clock):
    rec, path, _ = _session(tmp_path)
    claims = R.Claims(owner="host:1:a")
    m = claims.acquire(path)
    assert m is not None and m["session"] == "77_500"
    saved = _saved(path)
    assert saved["claimed_by"] == "host:1:a" and saved["claimed_at"] == "2026-09-26T03:00:00+00:00"   # 보여 주기용
    assert claims.acquire(path) is None                  # 루프가 잡은 회의를 같은 프로세스의 /recover 가 못 잡는다
    assert R.Claims(owner="host:1:c").acquire(path) is None


def test_probing_a_lock_does_not_let_it_go(tmp_path, clock):
    rec, path, _ = _session(tmp_path)
    claims = R.Claims(owner="host:1:a")
    claims.acquire(path)
    assert [R.is_locked(path) for _ in range(3)] == [True, True, True]
    assert R.Claims(owner="other:9:b").acquire(path) is None


def test_a_claim_left_in_the_manifest_without_a_lock_does_not_block(tmp_path, clock):
    """죽은 프로세스가 남긴 claimed_by·claimed_at 은 표시일 뿐이다. 잠금이 풀려 있으면 바로 잡는다."""
    rec, path, manifest = _session(tmp_path)
    manifest.update(claimed_by="dead:9:b", claimed_at="2026-09-26T02:59:00+00:00")
    R.save_manifest(path, manifest)
    claims = R.Claims(owner="host:1:a")
    assert claims.holder(path, _saved(path)) is None
    assert claims.acquire(path)["claimed_by"] == "host:1:a"


def _child_holding(path):
    """다른 프로세스가 이 회의 잠금을 쥔다. 잡을 때까지 기다렸다 돌려준다."""
    code = ("import sys, time\nfrom pathlib import Path\nfrom capture import recorder as R\n"
            "lock = None\nwhile lock is None:\n    lock = R.try_lock(Path(sys.argv[1]))\n    time.sleep(0.01)\n"
            "print('held', flush=True)\ntime.sleep(60)\n")
    child = subprocess.Popen([sys.executable, "-c", code, str(path)], cwd=AI_DIR, stdout=subprocess.PIPE, text=True)
    deadline = time.monotonic() + 30
    while child.poll() is None and time.monotonic() < deadline:
        if R.is_locked(path):
            return child
        time.sleep(0.05)
    child.kill()
    raise AssertionError("자식 프로세스가 잠금을 잡지 못했다")


def test_a_lock_held_by_another_process_blocks_until_that_process_is_killed(tmp_path, clock):
    rec, path, _ = _session(tmp_path)
    child = _child_holding(path)
    try:
        assert R.Claims(owner="host:1:a").acquire(path) is None
    finally:
        child.kill()
        child.wait(timeout=10)
    assert R.Claims(owner="host:1:a").acquire(path) is not None     # OS 가 죽은 프로세스의 잠금을 풀었다


def test_release_clears_the_claim_and_the_lock_so_another_owner_can_take_it_at_once(tmp_path, clock):
    rec, path, _ = _session(tmp_path)
    claims = R.Claims(owner="host:1:a")
    m = claims.acquire(path)
    claims.release(path, m)
    saved = _saved(path)
    assert "claimed_by" not in saved and "claimed_at" not in saved and R.is_locked(path) is False
    assert R.Claims(owner="other:9:b").acquire(path) is not None


def test_who_and_since_when_stay_in_the_manifest_while_the_meeting_is_processed(tmp_path, clock):
    """/recover 가 "누가 몇 분째" 를 보여 줄 수 있게 처리 중에도 표시가 남는다. 시각은 잡은 때 그대로다."""
    rec, path, _ = _session(tmp_path)
    m = R.Claims(owner="host:1:a").acquire(path)                 # 03:00:00
    clock["t"] = T0 + timedelta(minutes=17)                      # 전사가 17분 걸렸다
    seen = {}

    def extractor(transcript, names, today):
        seen.update(_saved(path))
        return []

    _run(rec, m, tmp_path, extractor=extractor)
    assert seen["claimed_by"] == "host:1:a" and seen["claimed_at"] == "2026-09-26T03:00:00+00:00"


def test_each_failed_run_waits_twice_as_long_before_the_next_try(tmp_path, clock, limits):
    rec, path, _ = _session(tmp_path)
    waits = []
    for n in (1, 2, 3):
        r = _run(rec, _saved(path), tmp_path, extractor=_dying)
        rec_state = _saved(path)["recovery"]
        assert r["status"] == "failed" and r["attempts"] == n and rec_state["attempts"] == n
        waits.append(datetime.fromisoformat(rec_state["next_at"]) - clock["t"])
        clock["t"] += timedelta(hours=1)
    assert waits == [timedelta(seconds=60), timedelta(seconds=120), timedelta(seconds=240)]


def test_the_wait_stops_growing_at_an_hour(monkeypatch):
    monkeypatch.setattr(R, "RECOVERY_BACKOFF_S", 1000.0)
    assert [R.backoff_s(n) for n in (1, 2, 3, 4)] == [1000.0, 2000.0, 3600.0, 3600.0]


def test_be_is_told_failed_only_when_the_retries_run_out(tmp_path, clock, limits, monkeypatch):
    monkeypatch.setattr(R, "RECOVERY_MAX_ATTEMPTS", 3)
    rec, path, _ = _session(tmp_path)
    fake = FakeBe()
    seen = []
    for _ in range(3):
        r = _run(rec, _saved(path), tmp_path, extractor=_dying, handoff=_handoff(fake))
        seen.append((r["gave_up"], fake.meetings["m1"]["status"], _fails(fake)))
        clock["t"] += timedelta(hours=1)
    # 재시도가 남은 동안 BE 회의는 processing 이다. 포기할 때 한 번만 fail 을 보낸다
    assert seen == [(False, "processing", 0), (False, "processing", 0), (True, "failed", 1)]
    assert fake.meetings["m1"]["failed_stage"] == "extract"
    state = _saved(path)["recovery"]
    assert state["gave_up_at"] == "2026-09-26T05:00:00+00:00" and "next_at" not in state
    assert state["failed_stage"] == "extract"


def test_a_stage_that_finishes_starts_the_count_again(tmp_path, clock, limits):
    rec, path, _ = _session(tmp_path)
    for _ in range(2):
        _run(rec, _saved(path), tmp_path, extractor=_dying)
    assert _saved(path)["recovery"]["attempts"] == 2
    fake = FakeBe()
    fake.down = True                                    # 추출은 살아났고 인계에서 BE 가 꺼져 있다
    r = _run(rec, _saved(path), tmp_path, extractor=_extractor({}), handoff=_handoff(fake))
    assert r["ran"] == ["extracted"] and r["failed_stage"] == "handoff"
    assert _saved(path)["recovery"]["attempts"] == 1 and r["attempts"] == 1


def test_a_partial_meeting_that_never_recovers_gives_up_and_tells_be(tmp_path, clock, limits):
    """한 줄도 못 살리는 partial 회의(#83 이 남긴 것). 실패로 세어 상한에서 포기하고 BE 에 stt 실패를 보낸다."""
    rec, path, _ = _session(tmp_path)
    fake = FakeBe()
    always = DiesOnLong(limit_s=1.0)                    # 클립 하나도 죽는다
    seen = []
    for _ in range(5):
        r = _run(rec, _saved(path), tmp_path, backend=always, extractor=_extractor({}), handoff=_handoff(fake))
        seen.append((r["status"], r["attempts"], r["gave_up"], _fails(fake)))
        clock["t"] += timedelta(hours=1)
    assert seen == [("partial", 1, False, 0), ("partial", 2, False, 0), ("partial", 3, False, 0),
                    ("partial", 4, False, 0), ("partial", 5, True, 1)]
    assert fake.meetings["m1"]["status"] == "failed" and fake.meetings["m1"]["failed_stage"] == "stt"
    assert "extracted" not in _saved(path)["stages"]


def test_a_partial_meeting_that_keeps_recovering_moves_on_before_the_cap(tmp_path, clock, limits):
    """재전사에서 일부가 살아나는 partial 은 partial 상한(3)에서 빠진 구간을 둔 채 넘어간다. 기본 상한 5 에 닿기 전이다.
    넘어가는 순간 전사 단계가 닫혀 실패 횟수가 0 으로 돌아간다. 이어지는 추출 실패는 1 부터 센다."""
    rec, path, _ = _session(tmp_path)
    fake = FakeBe()
    stt = DiesOnLong(limit_s=2.5)                       # 화자 1 의 클립은 재전사에서 살고 화자 2 의 클립은 계속 죽는다
    seen = []
    for extractor in (_extractor({}), _extractor({}), _extractor({}), _dying, _extractor({})):
        r = _run(rec, _saved(path), tmp_path, backend=stt, extractor=extractor, handoff=_handoff(fake))
        seen.append((r["status"], r["attempts"], r["gave_up"]))
        clock["t"] += timedelta(hours=1)
    assert seen == [("partial", 1, False), ("partial", 2, False), ("partial", 3, False),
                    ("failed", 1, False), ("handed_off", 0, False)]
    assert fake.meetings["m1"]["status"] == "done" and _fails(fake) == 0
    saved = _saved(path)
    assert saved["partial"] is True and "recovery" not in saved


def _failed(path, *, next_at=None, gave_up_at=None, be=None):
    """실패로 멈춘 회의를 손으로 만든다. 다음 시도 시각이나 포기 시각을 적는다."""
    m = _saved(path)
    m.update(status="failed", failed_stage="stt", error="RuntimeError: 죽음")
    state = {"attempts": 5 if gave_up_at else 1}
    if next_at:
        state["next_at"] = next_at
    if gave_up_at:
        state.update(gave_up_at=gave_up_at, failed_stage="stt")
    m["recovery"] = state
    if be is not None:
        m["be"] = be
    R.save_manifest(path, m)


def _names(pairs):
    return [m["session"] for _, m in pairs]


def test_the_loop_skips_meetings_waiting_for_their_next_try_and_given_up_ones(tmp_path, clock):
    rec, _, _ = _session(tmp_path, ts=500)                                     # 막 저장된 회의
    _, p600, _ = _session(tmp_path, ts=600)
    _failed(p600, next_at="2026-09-26T03:00:01+00:00")                         # 1초 뒤에 다시 한다
    _, p700, _ = _session(tmp_path, ts=700)
    _failed(p700, next_at="2026-09-26T03:00:00+00:00")                         # 지금이다
    _, p800, _ = _session(tmp_path, ts=800)
    _failed(p800, gave_up_at="2026-09-26T02:00:00+00:00", be={"meeting_id": "m9", "status": "failed"})
    claims = R.Claims(owner="host:1:a")
    loop, busy = R.recovery_targets(rec, claims=claims)
    assert _names(loop) == ["77_500", "77_700"] and busy == []
    hand, _ = R.recovery_targets(rec, claims=claims, manual=True)              # 사람은 기다리지 않고 포기한 것도 다시 돌린다
    assert _names(hand) == ["77_500", "77_600", "77_700", "77_800"]


def test_a_meeting_another_owner_holds_is_listed_as_busy_with_who_and_since_when(tmp_path, clock):
    rec, path, manifest = _session(tmp_path)
    manifest.update(claimed_by="other:9:b", claimed_at="2026-09-26T02:55:00+00:00")
    R.save_manifest(path, manifest)
    held = R.try_lock(path)                                                    # 다른 쪽이 잠금을 쥐고 있다
    due, busy = R.recovery_targets(rec, claims=R.Claims(owner="host:1:a"), manual=True)
    held.release()
    assert due == []
    assert busy == [{"session": "77_500", "busy": True, "claimed_by": "other:9:b",
                     "claimed_at": "2026-09-26T02:55:00+00:00", "since_s": 300, "mine": False}]


class NoStt:
    name = "none"

    def transcribe(self, samples, sample_rate):
        raise AssertionError("전사를 부르면 안 된다")


def test_recover_one_looks_again_after_claiming_and_leaves_a_meeting_that_moved_on(tmp_path, clock):
    """목록을 만든 뒤 세마포어를 기다리는 사이 다른 바퀴가 그 회의를 끝냈거나 다시 미뤘다."""
    rec, path, _ = _session(tmp_path)
    claims = R.Claims(owner="host:1:a")
    (target, _), = R.recovery_targets(rec, claims=claims)[0]
    _failed(path, next_at="2026-09-26T03:02:00+00:00")                        # 그 사이 실패해 2분 뒤로 미뤄졌다
    kw = dict(claims=claims, backend=NoStt(), model_name="echo", workers=1, transcripts_dir=tmp_path / "transcripts")
    assert R.recover_one(rec, target, **kw) is None
    m = _saved(path)
    m.update(status="handed_off", stages={"transcribed": "x", "extracted": "x", "handed_off": "x"})
    R.save_manifest(path, m)                                                   # 그 사이 끝났다
    assert R.recover_one(rec, target, manual=True, **kw) is None
    assert "claimed_by" not in _saved(path) and R.is_locked(path) is False     # 잡았던 잠금과 표시를 놓았다


def test_recover_one_reports_busy_when_the_claim_was_taken_after_listing(tmp_path, clock):
    rec, path, _ = _session(tmp_path)
    claims = R.Claims(owner="host:1:a")
    (target, _), = R.recovery_targets(rec, claims=claims)[0]
    R.Claims(owner="other:9:b").acquire(path)                                 # 다른 쪽이 먼저 잡았다
    r = R.recover_one(rec, target, claims=claims, backend=NoStt(), model_name="echo", workers=1,
                      transcripts_dir=tmp_path / "transcripts")
    assert r == {"session": "77_500", "busy": True, "claimed_by": "other:9:b",
                 "claimed_at": "2026-09-26T03:00:00+00:00", "since_s": 0, "mine": False}


def _give_up(rec, path, tmp_path, fake, clock, *, down_at_the_end=False):
    """상한 2 에서 추출이 두 번 죽어 포기한 회의. down_at_the_end 면 포기하는 순간 BE 가 꺼져 있다."""
    for n in (1, 2):
        fake.down = down_at_the_end and n == 2
        _run(rec, _saved(path), tmp_path, extractor=_dying, handoff=_handoff(fake))
        clock["t"] += timedelta(hours=1)
    fake.down = False


def test_the_loop_resends_only_the_fail_when_be_missed_it_at_give_up(tmp_path, clock, limits, monkeypatch):
    monkeypatch.setattr(R, "RECOVERY_MAX_ATTEMPTS", 2)
    rec, path, _ = _session(tmp_path)
    fake = FakeBe()
    _give_up(rec, path, tmp_path, fake, clock, down_at_the_end=True)
    assert _saved(path)["recovery"]["gave_up_at"] and fake.meetings["m1"]["status"] == "processing"
    claims = R.Claims(owner="host:1:a")
    (target, _), = R.recovery_targets(rec, claims=claims)[0]                  # BE 에 fail 이 안 닿아 루프가 집는다
    fake.calls.clear()
    r = R.recover_one(rec, target, claims=claims, backend=NoStt(), model_name="echo", workers=1,
                      transcripts_dir=tmp_path / "transcripts", extractor=_extractor({}), handoff=_handoff(fake))
    assert r is None and [(c[0], c[1]) for c in fake.calls] == [("PATCH", "/meetings/m1/fail")]
    assert fake.meetings["m1"]["status"] == "failed" and fake.meetings["m1"]["failed_stage"] == "extract"
    assert _saved(path)["status"] == "failed" and R.recovery_targets(rec, claims=claims)[0] == []


def test_hand_recovery_of_a_given_up_meeting_opens_a_new_be_meeting(tmp_path, clock, limits, monkeypatch):
    """BE 의 failed 는 끝 상태다. 사람이 /recover 로 다시 돌리면 handoff 의 우회(새 회의, 옛 ID 는 replaced)로 간다."""
    monkeypatch.setattr(R, "RECOVERY_MAX_ATTEMPTS", 2)
    rec, path, _ = _session(tmp_path)
    fake = FakeBe()
    _give_up(rec, path, tmp_path, fake, clock)
    assert fake.meetings["m1"]["status"] == "failed"
    results = R.recover(rec, backend=NoStt(), model_name="echo", workers=1, transcripts_dir=tmp_path / "transcripts",
                        extractor=_extractor({}), handoff=_handoff(fake))
    assert results[0]["ran"] == ["extracted", "handed_off"] and results[0]["gave_up"] is False
    saved = _saved(path)
    assert saved["be"]["meeting_id"] == "m2" and saved["be"]["replaced"] == ["m1"] and "recovery" not in saved
    assert fake.meetings["m2"]["status"] == "done"


def test_a_failed_hand_retry_of_a_given_up_meeting_closes_the_new_be_meeting_too(tmp_path, clock, limits, monkeypatch):
    """사람의 재시도는 한 번이다. 또 실패하면 곧바로 다시 포기하고, 그 사이 만든 BE 회의도 failed 로 닫는다.
    BE 에 processing 으로 남은 회의는 언제나 루프가 아직 돌리는 회의여야 한다."""
    monkeypatch.setattr(R, "RECOVERY_MAX_ATTEMPTS", 2)
    rec, path, _ = _session(tmp_path)
    fake = FakeBe()
    _give_up(rec, path, tmp_path, fake, clock)
    results = R.recover(rec, backend=NoStt(), model_name="echo", workers=1, transcripts_dir=tmp_path / "transcripts",
                        extractor=_dying, handoff=_handoff(fake))
    assert results[0]["status"] == "failed" and results[0]["gave_up"] is True
    assert {mid: m["status"] for mid, m in fake.meetings.items()} == {"m1": "failed", "m2": "failed"}
    assert _saved(path)["be"]["replaced"] == ["m1"]


def test_a_failure_from_before_the_loop_is_left_to_a_person(tmp_path, clock):
    """recovery 가 없는 failed 매니페스트는 이 루프가 생기기 전의 실패다. 그때 BE 에 바로 fail 을 보냈으니
    포기한 회의로 본다. 루프가 쓸어 가면 BE 에 새 회의가 줄줄이 생기고 원격 전사가 다시 과금된다."""
    rec, path, manifest = _session(tmp_path)
    manifest.update(status="failed", failed_stage="stt", error="RuntimeError: 죽음", be={"meeting_id": "m1", "status": "failed"})
    R.save_manifest(path, manifest)
    claims = R.Claims(owner="host:1:a")
    assert R.recovery_targets(rec, claims=claims)[0] == []
    assert _names(R.recovery_targets(rec, claims=claims, manual=True)[0]) == ["77_500"]


def test_the_queue_goes_by_start_time_across_servers(tmp_path):
    """파일 이름 순이면 서버 ID 가 작은 서버의 회의가 늘 먼저다. 먼저 시작한 회의가 먼저 처리된다."""
    rec, p88, _ = _session(tmp_path, ts=500, guild="88")
    _, p77, _ = _session(tmp_path, ts=600, guild="77")
    assert R.pending_sessions(rec) == [p88, p77]


def _left_by_dead_worker(path, who="dead:1:x", at="2026-09-26T02:00:00+00:00"):
    """잠금은 풀렸는데 표시가 남은 상태. 쥔 프로세스가 처리 도중 죽었다(메모리 상한, 종료 대기 시간 초과)."""
    m = _saved(path)
    m.update(claimed_by=who, claimed_at=at)
    R.save_manifest(path, m)


def test_a_run_that_died_mid_meeting_counts_as_a_failure_and_waits(tmp_path, clock, limits):
    """죽은 실행은 process_session 이 돌아오지 못해 스스로 세지 못한다. 안 세면 다시 뜬 워커가 같은 회의를
    다시 집고 또 죽는다. 그 회의가 줄 맨 앞이라 뒤 회의들도 멈춘다."""
    rec, path, _ = _session(tmp_path)
    _left_by_dead_worker(path)
    r = R.recover_one(rec, path, claims=R.Claims(owner="host:1:a"), backend=NoStt(), model_name="echo", workers=1,
                      transcripts_dir=tmp_path / "transcripts")
    saved = _saved(path)
    assert r is None and saved["status"] == "failed" and saved["failed_stage"] == "stt"
    assert saved["recovery"] == {"attempts": 1, "next_at": "2026-09-26T03:01:00+00:00"}
    assert "dead:1:x" in saved["error"] and "claimed_by" not in saved


def test_dead_runs_give_up_at_the_cap_and_tell_be_once(tmp_path, clock, limits, monkeypatch):
    monkeypatch.setattr(R, "RECOVERY_MAX_ATTEMPTS", 3)
    rec, path, _ = _session(tmp_path)
    fake = FakeBe()
    h = _handoff(fake)
    m = _saved(path)
    h.end(m, title="회의방")
    R.save_manifest(path, m)                                                   # BE 회의 m1 이 processing
    for _ in range(3):
        _left_by_dead_worker(path)
        R.recover_one(rec, path, claims=R.Claims(owner="host:1:a"), backend=NoStt(), model_name="echo", workers=1,
                      transcripts_dir=tmp_path / "transcripts", handoff=h)
        clock["t"] += timedelta(hours=1)
    saved = _saved(path)
    assert saved["recovery"]["attempts"] == 3 and saved["recovery"]["gave_up_at"] and _fails(fake) == 1
    assert fake.meetings["m1"]["status"] == "failed" and fake.meetings["m1"]["failed_stage"] == "stt"
    assert "transcribed" not in saved.get("stages", {})                        # 죽은 실행만 셌고 다시 돌리지 않았다


def test_a_meeting_without_a_leftover_claim_is_not_counted(tmp_path, clock, limits):
    rec, path, _ = _session(tmp_path)
    r = R.recover_one(rec, path, claims=R.Claims(owner="host:1:a"), backend=EchoStt(), model_name="echo", workers=1,
                      transcripts_dir=tmp_path / "transcripts")
    assert r["status"] == "transcribed" and "recovery" not in _saved(path)


def test_a_person_can_still_run_a_meeting_whose_last_run_died(tmp_path, clock, limits):
    rec, path, _ = _session(tmp_path)
    _left_by_dead_worker(path)
    r = R.recover_one(rec, path, claims=R.Claims(owner="host:1:a"), manual=True, backend=EchoStt(), model_name="echo",
                      workers=1, transcripts_dir=tmp_path / "transcripts")
    assert r["ran"] == ["transcribed"] and "recovery" not in _saved(path)


def test_capture_imports_where_there_is_no_fcntl():
    """윈도에는 fcntl 이 없다. 모듈 맨 위에서 import 하면 윈도로 AI 코드를 돌리는 동료의 테스트가 capture 부터 깨진다."""
    code = ("import sys\nsys.modules['fcntl'] = None\n"
            "import capture.recorder, capture.worker, capture.discord_adapter\nprint('ok')\n")
    out = subprocess.run([sys.executable, "-c", code], cwd=AI_DIR, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-1500:]
    assert out.stdout.strip() == "ok"


class FakeMsvcrt:
    """msvcrt.locking 의 약속만 흉내 낸다. 같은 파일의 같은 바이트를 다른 핸들이 쥐고 있으면 OSError 를 낸다."""
    LK_UNLCK, LK_LOCK, LK_NBLCK = 0, 1, 2

    def __init__(self):
        self.held = {}
        self.calls = []

    def locking(self, fd, mode, nbytes):
        at = os.lseek(fd, 0, os.SEEK_CUR)
        self.calls.append((mode, nbytes, at))
        key = (os.fstat(fd).st_ino, at)
        if mode == self.LK_NBLCK:
            if self.held.get(key, fd) != fd:
                raise OSError(36, "Resource deadlock avoided")
            self.held[key] = fd
        elif mode == self.LK_UNLCK:
            self.held.pop(key, None)


def test_the_windows_branch_means_the_same_as_flock(tmp_path, monkeypatch):
    """윈도 잠금은 여기서 실제로 돌릴 수 없다. msvcrt 의 약속대로 기다리지 않고(LK_NBLCK) 첫 1바이트를 잡는지,
    남이 쥐면 False 인지, 놓으면 다른 쪽이 잡는지만 본다."""
    fake = FakeMsvcrt()
    monkeypatch.setitem(sys.modules, "msvcrt", fake)
    grab, drop = R._lock_backend("nt")
    path = tmp_path / "session_77_500.lock"
    a = os.open(path, os.O_RDWR | os.O_CREAT)
    b = os.open(path, os.O_RDWR | os.O_CREAT)
    os.lseek(b, 5, os.SEEK_SET)                                              # 파일 위치가 어디든 같은 바이트를 잡아야 한다
    try:
        assert grab(a) is True and grab(b) is False
        drop(a)
        assert grab(b) is True
    finally:
        os.close(a)
        os.close(b)
    assert {(mode, n, at) for mode, n, at in fake.calls} == {(fake.LK_NBLCK, 1, 0), (fake.LK_UNLCK, 1, 0)}
