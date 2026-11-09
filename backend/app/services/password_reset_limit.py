"""비밀번호 재설정 요청의 공인 IP 시간당 상한(#550). 서버가 단일 프로세스라는 전제라 메모리에 둔다."""

import threading
from dataclasses import dataclass

IP_HOURLY_LIMIT = 5
WINDOW_SECONDS = 3600
MAX_ENTRIES = 50_000


@dataclass
class _Entry:
    count: int
    window_started: float


_entries: dict[str, _Entry] = {}
_lock = threading.Lock()


def _expired(entry: _Entry, now: float) -> bool:
    return now >= entry.window_started + WINDOW_SECONDS


def _evict(now: float) -> None:
    if len(_entries) < MAX_ENTRIES:
        return
    for key in [k for k, e in _entries.items() if _expired(e, now)]:
        del _entries[key]
    if len(_entries) < MAX_ENTRIES:
        return
    oldest = sorted(_entries, key=lambda k: _entries[k].window_started)
    for key in oldest[: max(MAX_ENTRIES // 10, 1)]:
        del _entries[key]


def allow(ip_key: str | None, now: float) -> bool:
    """허용이면 셈하고 True. 상한이면 세지 않고 False. 키가 없으면(사설·해석 불가) 늘 True."""
    if ip_key is None:
        return True
    with _lock:
        entry = _entries.get(ip_key)
        if entry is not None and _expired(entry, now):
            del _entries[ip_key]
            entry = None
        if entry is None:
            _evict(now)
            entry = _Entry(count=0, window_started=now)
            _entries[ip_key] = entry
        if entry.count >= IP_HOURLY_LIMIT:
            return False
        entry.count += 1
        return True


def reset() -> None:
    with _lock:
        _entries.clear()
