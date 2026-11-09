from app.services import password_reset_limit as limit
from app.services.password_reset_limit import allow


def _fill(ip="8.8.8.8", n=5, now=1000.0):
    return [allow(ip, now) for _ in range(n)]


def test_five_allowed_sixth_denied():
    assert _fill() == [True] * 5
    assert allow("8.8.8.8", 1000.0) is False


def test_other_ip_is_independent():
    _fill()
    assert allow("1.1.1.1", 1000.0) is True


def test_window_expiry_allows_again():
    _fill()
    assert allow("8.8.8.8", 1000.0 + limit.WINDOW_SECONDS - 1) is False
    assert allow("8.8.8.8", 1000.0 + limit.WINDOW_SECONDS) is True


def test_denied_calls_are_not_counted():
    _fill()
    for t in (1100.0, 2000.0, 3000.0):
        assert allow("8.8.8.8", t) is False
    # 창 시작(1000) 기준으로 풀린다. 거부 호출이 창을 늘리거나 세었다면 여기서 막힌다.
    assert allow("8.8.8.8", 1000.0 + limit.WINDOW_SECONDS) is True
    assert limit._entries["8.8.8.8"].count == 1


def test_none_key_always_allowed():
    assert all(allow(None, 1000.0) for _ in range(20))
    assert limit._entries == {}


def test_entries_are_evicted_over_max(monkeypatch):
    monkeypatch.setattr(limit, "MAX_ENTRIES", 10)
    for i in range(10):
        allow(f"ip{i}", 1000.0 + i)
    allow("new", 1020.0)
    assert len(limit._entries) <= 10
    assert "new" in limit._entries
    assert "ip0" not in limit._entries


def test_expired_entries_evicted_first(monkeypatch):
    monkeypatch.setattr(limit, "MAX_ENTRIES", 3)
    for i in range(3):
        allow(f"old{i}", 1000.0)
    allow("fresh", 1000.0 + limit.WINDOW_SECONDS + 1)
    assert list(limit._entries) == ["fresh"]
