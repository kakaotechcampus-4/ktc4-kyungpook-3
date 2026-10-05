"""BE 응답 측정기. 전사 중에 BE 가 느려지거나 멈추는지 보려고 1초마다 /health 를 부르고 JSONL 로 남긴다."""

from __future__ import annotations

import argparse
import json
import signal
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def probe_once(url: str, opener=urllib.request.urlopen, timeout: float = 5) -> dict:
    """한 번 부른다. 본문을 다 읽을 때까지를 ms 로 잰다. 실패해도 ms 를 남긴다(제한 시간에 걸리면 약 5000).

    4xx·5xx 는 urllib 이 예외로 던지지만 BE 가 답한 것이라 error 가 아니라 status 로 적는다.
    """
    ts = time.time()
    t0 = time.monotonic()
    try:
        with opener(url, timeout=timeout) as r:
            r.read()
            got = {"status": r.status}
    except urllib.error.HTTPError as e:
        got = {"status": e.code}
    except Exception as e:
        got = {"error": f"{type(e).__name__}: {e}"}
    return {"ts": ts, "ms": (time.monotonic() - t0) * 1000, **got}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="BE 응답 측정기. SIGTERM 을 받으면 끝난다")
    ap.add_argument("--url", default="http://127.0.0.1:8000/health")
    ap.add_argument("--interval", type=float, default=1.0, help="측정 사이 초. 응답에 걸린 시간을 빼고 쉰다")
    ap.add_argument("--out", type=Path, required=True, help="JSONL. 있으면 뒤에 이어 쓴다")
    a = ap.parse_args(argv)

    stop = []
    old = signal.signal(signal.SIGTERM, lambda signum, frame: stop.append(signum))
    try:
        with open(a.out, "a", buffering=1, encoding="utf-8") as f:
            while not stop:
                t0 = time.monotonic()
                f.write(json.dumps(probe_once(a.url), ensure_ascii=False) + "\n")
                time.sleep(max(0.0, a.interval - (time.monotonic() - t0)))
    finally:
        signal.signal(signal.SIGTERM, old)
    return 0


if __name__ == "__main__":
    sys.exit(main())
