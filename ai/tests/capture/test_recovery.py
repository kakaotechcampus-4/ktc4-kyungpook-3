"""자동 복구의 플랫폼 비종속 부분(capture/recorder.py). 선점, 실패 횟수와 백오프, 포기, 한 바퀴의 대상. 모델은 안 쓴다.

시계는 recorder.utcnow 를 바꿔 끼운다. 기다리지 않는다.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

from capture import recorder as R
from tests.capture.test_recorder import _session

T0 = datetime(2026, 9, 26, 3, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def clock(monkeypatch):
    now = {"t": T0}
    monkeypatch.setattr(R, "utcnow", lambda: now["t"])
    return now


def _saved(path):
    return json.loads(path.read_text(encoding="utf-8"))


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
