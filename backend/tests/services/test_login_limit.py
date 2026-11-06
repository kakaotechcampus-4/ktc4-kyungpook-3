import threading

import pytest

from app.services import login_limit
from app.services.login_limit import LoginBlocked, reserve


def _fill(email="a@example.com", ip=None, n=10, now=1000.0):
    return [reserve(email, ip, now=now) for _ in range(n)]


def test_tenth_attempt_allowed_eleventh_blocked():
    _fill()
    with pytest.raises(LoginBlocked) as exc:
        reserve("a@example.com", None, now=1000.0)
    assert exc.value.retry_after_seconds == 900


def test_block_expires_and_starts_fresh():
    _fill()
    _fill(now=1900.0)


def test_blocked_attempts_do_not_extend_block():
    _fill()
    with pytest.raises(LoginBlocked) as exc:
        reserve("a@example.com", None, now=1100.0)
    assert exc.value.retry_after_seconds == 800


def test_window_expiry_resets_count():
    _fill(n=9)
    _fill(now=1900.0)


def test_retry_after_is_ceiled_and_at_least_one():
    _fill()
    with pytest.raises(LoginBlocked) as exc:
        reserve("a@example.com", None, now=1899.5)
    assert exc.value.retry_after_seconds == 1


def test_blocked_email_does_not_count_ip():
    _fill(ip="8.8.8.8")
    for _ in range(5):
        with pytest.raises(LoginBlocked):
            reserve("a@example.com", "8.8.8.8", now=1000.0)
    # IP 횟수는 10 에서 멈췄으므로 다른 이메일로 40번 더 통과한다.
    for i in range(40):
        reserve(f"u{i}@example.com", "8.8.8.8", now=1000.0)
    with pytest.raises(LoginBlocked):
        reserve("z@example.com", "8.8.8.8", now=1000.0)


def test_ip_limit_blocks_across_emails():
    for i in range(50):
        reserve(f"u{i}@example.com", "8.8.8.8", now=1000.0)
    with pytest.raises(LoginBlocked):
        reserve("new@example.com", "8.8.8.8", now=1000.0)


def test_cancel_undoes_reservation_and_block():
    res = _fill(ip="8.8.8.8")
    login_limit.cancel(res[-1])
    login_limit.reserve("a@example.com", "8.8.8.8", now=1000.0)


def test_succeed_clears_email_and_keeps_other_ip_attempts():
    ip = "8.8.8.8"
    for _ in range(3):  # 실패한 시도: 예약만 남는다
        reserve("a@example.com", ip, now=1000.0)
    ok = reserve("a@example.com", ip, now=1000.0)
    login_limit.succeed(ok)
    _fill(ip=None)  # 이메일 기록이 지워져 처음부터 10번 통과한다
    for i in range(47):  # IP 횟수는 3 이 남았으므로 3 + 47 = 50
        reserve(f"u{i}@example.com", ip, now=1000.0)
    with pytest.raises(LoginBlocked):
        reserve("last@example.com", ip, now=1000.0)


def test_clear_email_unblocks():
    _fill()
    login_limit.clear_email("a@example.com")
    reserve("a@example.com", None, now=1000.0)


def test_concurrent_reservations_never_exceed_limit():
    passed = []
    barrier = threading.Barrier(50)

    def work():
        barrier.wait()
        try:
            reserve("a@example.com", None, now=1000.0)
            passed.append(1)
        except LoginBlocked:
            pass

    threads = [threading.Thread(target=work) for _ in range(50)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(passed) == 10


def test_entries_stay_under_cap(monkeypatch):
    monkeypatch.setattr(login_limit, "MAX_ENTRIES", 100)
    for i in range(1000):
        reserve(f"u{i}@example.com", None, now=1000.0 + i * 0.001)
    assert len(login_limit._entries) <= 100


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("8.8.8.8", "8.8.8.8"),
        ("::ffff:8.8.8.8", "8.8.8.8"),
        ("2001:4860:4860::8888", "2001:4860:4860::/64"),
        ("10.0.0.1", None),
        ("172.18.0.1", None),
        ("127.0.0.1", None),
        ("::1", None),
        ("testclient", None),
        (None, None),
    ],
)
def test_client_ip_key(host, expected):
    assert login_limit.client_ip_key(host) == expected
