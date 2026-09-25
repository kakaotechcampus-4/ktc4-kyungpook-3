"""자동 복구의 플랫폼 비종속 부분(capture/recorder.py). 선점, 실패 횟수와 백오프, 포기, 한 바퀴의 대상. 모델은 안 쓴다.

시계는 recorder.utcnow 를 바꿔 끼운다. 기다리지 않는다.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

from capture import handoff as H
from capture import recorder as R
from stt import batch as B
from tests.capture.fake_be import FakeBe
from tests.capture.test_recorder import DiesOnLong, _extractor, _run, _session

T0 = datetime(2026, 9, 26, 3, 0, 0, tzinfo=timezone.utc)


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


def test_a_claim_is_written_to_the_manifest_and_the_same_process_cannot_take_it_twice(tmp_path, clock):
    rec, path, _ = _session(tmp_path)
    claims = R.Claims(owner="host:1:a", ttl_s=0)          # 만료 0 초. 프로세스 안 배제는 만료와 무관해야 한다
    m = claims.acquire(path)
    assert m is not None and m["session"] == "77_500"
    saved = _saved(path)
    assert saved["claimed_by"] == "host:1:a" and saved["claimed_at"] == "2026-09-26T03:00:00+00:00"
    assert claims.acquire(path) is None                  # 루프가 잡은 회의를 같은 프로세스의 /recover 가 못 잡는다


def test_another_owners_claim_holds_until_it_expires(tmp_path, clock):
    rec, path, manifest = _session(tmp_path)
    manifest.update(claimed_by="other:9:b", claimed_at="2026-09-26T02:50:00+00:00")
    R.save_manifest(path, manifest)
    claims = R.Claims(owner="host:1:a", ttl_s=600)
    clock["t"] = T0 - timedelta(seconds=1)               # 02:59:59. 만료(03:00:00) 1초 전
    assert claims.acquire(path) is None
    assert claims.holder(_saved(path)) == {"claimed_by": "other:9:b", "expires_at": "2026-09-26T03:00:00+00:00",
                                           "expires_in_s": 1, "mine": False}
    clock["t"] = T0                                      # 만료. 죽은 선점은 풀린다
    assert claims.holder(_saved(path)) is None
    assert claims.acquire(path)["claimed_by"] == "host:1:a"
    assert _saved(path)["claimed_by"] == "host:1:a"


def test_release_clears_the_claim_so_another_owner_can_take_it_at_once(tmp_path, clock):
    rec, path, _ = _session(tmp_path)
    claims = R.Claims(owner="host:1:a", ttl_s=600)
    m = claims.acquire(path)
    claims.release(path, m)
    saved = _saved(path)
    assert "claimed_by" not in saved and "claimed_at" not in saved
    assert R.Claims(owner="other:9:b", ttl_s=600).acquire(path) is not None


def test_claimed_at_is_rewritten_whenever_a_stage_is_saved(tmp_path, clock):
    """긴 전사가 끝나 단계가 바뀌면 선점 시각을 새로 적는다. 다음 단계가 도는 동안 파일에서 보인다."""
    rec, path, _ = _session(tmp_path)
    m = R.Claims(owner="host:1:a", ttl_s=600).acquire(path)     # 03:00:00
    clock["t"] = T0 + timedelta(minutes=17)                      # 전사가 17분 걸렸다
    seen = {}

    def extractor(transcript, names, today):
        seen.update(_saved(path))
        return []

    _run(rec, m, tmp_path, extractor=extractor)
    assert seen["claimed_by"] == "host:1:a" and seen["claimed_at"] == "2026-09-26T03:17:00+00:00"


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
