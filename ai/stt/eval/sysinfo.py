"""측정에 쓰는 시스템 값. OS 마다 단위가 다른 것을 한 곳에서 맞춘다."""

from __future__ import annotations

import resource
import sys


def peak_rss_bytes(ru=None, platform: str | None = None) -> int:
    """getrusage 의 최대 상주 메모리를 바이트로.

    macOS 는 ru_maxrss 가 바이트이고 Linux 는 KiB 다. 그대로 나누면 t3.medium 에서 메모리가
    1/1024 로 보고된다. golden.py 와 fleurs.py 가 이 함수를 쓴다.
    """
    ru = ru if ru is not None else resource.getrusage(resource.RUSAGE_SELF)
    platform = platform if platform is not None else sys.platform
    raw = int(ru.ru_maxrss)
    return raw if platform.startswith("darwin") else raw * 1024
