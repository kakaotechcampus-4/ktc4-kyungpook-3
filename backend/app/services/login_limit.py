"""로그인 시도 제한기. 서버가 단일 프로세스라는 전제(Dockerfile:28)라 메모리에 둔다."""

import ipaddress
import math
import threading
import time
from dataclasses import dataclass

EMAIL_LIMIT = 10
IP_LIMIT = 50
WINDOW_SECONDS = 900
BLOCK_SECONDS = 900
MAX_ENTRIES = 50_000

_EMAIL_PREFIX = "email:"
_IP_PREFIX = "ip:"


class LoginBlocked(Exception):
    def __init__(self, retry_after_seconds: int):
        super().__init__(f"login blocked for {retry_after_seconds}s")
        self.retry_after_seconds = retry_after_seconds


@dataclass(frozen=True)
class Reservation:
    email_key: str
    ip_key: str | None


@dataclass
class _Entry:
    count: int
    window_started: float
    blocked_until: float | None = None


_entries: dict[str, _Entry] = {}
_lock = threading.Lock()


def clock() -> float:
    return time.monotonic()


def client_ip_key(host: str | None) -> str | None:
    if not host:
        return None
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return None
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        addr = addr.ipv4_mapped
    if not addr.is_global:
        return None
    if isinstance(addr, ipaddress.IPv6Address):
        return str(ipaddress.ip_network(f"{addr}/64", strict=False))
    return str(addr)


def _fresh_view(key: str, now: float) -> _Entry | None:
    """`now` 기준으로 유효한 항목을 돌려준다. 만료됐으면 None."""
    entry = _entries.get(key)
    if entry is None:
        return None
    if entry.blocked_until is not None:
        if now >= entry.blocked_until:
            return None
        return entry
    if now >= entry.window_started + WINDOW_SECONDS:
        return None
    return entry


def _evict(now: float) -> None:
    if len(_entries) < MAX_ENTRIES:
        return
    for key in [k for k in _entries if _fresh_view(k, now) is None]:
        del _entries[key]
    if len(_entries) < MAX_ENTRIES:
        return
    oldest = sorted(_entries, key=lambda k: _entries[k].window_started)
    for key in oldest[: max(MAX_ENTRIES // 10, 1)]:
        del _entries[key]


def _bump(key: str, limit: int, now: float) -> None:
    entry = _fresh_view(key, now)
    if entry is None:
        _entries.pop(key, None)
        _evict(now)
        entry = _Entry(count=0, window_started=now)
        _entries[key] = entry
    entry.count += 1
    if entry.count == limit:
        entry.blocked_until = now + BLOCK_SECONDS


def _undo(key: str | None, limit: int) -> None:
    if key is None:
        return
    entry = _entries.get(key)
    if entry is None:
        return
    entry.count = max(entry.count - 1, 0)
    if entry.count < limit:
        entry.blocked_until = None


def _remaining(key: str | None, now: float) -> float:
    """막힌 키면 남은 초, 아니면 0."""
    if key is None:
        return 0.0
    entry = _fresh_view(key, now)
    if entry is None:
        return 0.0
    if entry.blocked_until is not None:
        return entry.blocked_until - now
    return 0.0


def reserve(email: str, ip_key: str | None, *, now: float) -> Reservation:
    email_key = _EMAIL_PREFIX + email
    ip_full = None if ip_key is None else _IP_PREFIX + ip_key
    with _lock:
        waits = [_remaining(email_key, now), _remaining(ip_full, now)]
        wait = max(waits)
        if wait > 0:
            raise LoginBlocked(max(math.ceil(wait), 1))
        _bump(email_key, EMAIL_LIMIT, now)
        if ip_full is not None:
            _bump(ip_full, IP_LIMIT, now)
        return Reservation(email_key=email_key, ip_key=ip_full)


def succeed(reservation: Reservation) -> None:
    with _lock:
        _entries.pop(reservation.email_key, None)
        _undo(reservation.ip_key, IP_LIMIT)


def cancel(reservation: Reservation) -> None:
    with _lock:
        _undo(reservation.email_key, EMAIL_LIMIT)
        _undo(reservation.ip_key, IP_LIMIT)


def email_blocked(email: str, *, now: float) -> bool:
    """이 이메일의 로그인이 지금 막혀 있는지. 세지 않고 보기만 한다."""
    with _lock:
        return _remaining(_EMAIL_PREFIX + email, now) > 0


def clear_email(email: str) -> None:
    with _lock:
        _entries.pop(_EMAIL_PREFIX + email, None)


def reset() -> None:
    with _lock:
        _entries.clear()
