"""워커 한 바퀴의 비용. 끝난 회의 매니페스트가 N개 쌓였을 때 바퀴마다 매니페스트를 다 읽는 데 드는 시간을 잰다.

    cd ai && .venv/bin/python -m stt.eval.capacity.scan --counts 100 1000 5000

임시 폴더에 handed_off 매니페스트를 만들고, 워커가 바퀴마다 부르는 대상 고르기(recovery_targets), 봇이 재시작
안내 때 부르는 확인(interrupted_meetings), 워커 한 바퀴(Worker.run_pass)를 각각 reps 번 돌려 중앙값을 낸다.
처리할 회의는 없어서 전사도 BE 호출도 하지 않는다. 결과는 결정 기록 0026 의 "주기와 비용" 표다.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import tempfile
import time
from pathlib import Path

from capture import recorder as R
from capture import worker as W

STAGES = ("stt", "sources", "extract", "handoff")


def make_finished(recordings_dir: Path, n: int) -> None:
    """화자 넷, 처리 기록 두 건이 든 handed_off 매니페스트 n 개. 운영 매니페스트와 크기가 비슷하다."""
    ops = {"wall_s": 240.0, "stages": {s: {"started_at": "x", "ended_at": "y", "s": 10.0} for s in STAGES},
           "meeting_s": 1800.0, "calls": 60, "peak_rss_bytes": 300_000_000, "status": "handed_off", "backend": "elice"}
    for i in range(n):
        mid = f"77_{1_790_000_000 + i}"
        m = {"session": mid, "status": "handed_off", "guild_id": "77", "text_channel_id": "900", "workspace_id": "ws-1",
             "started_at": "2026-10-01T00:00:00+00:00", "meeting_dir": mid, "timezone": "Asia/Seoul",
             "speakers": [{"user_id": str(u), "display_name": f"사람{u}", "file": f"{mid}/{u}_x.wav",
                           "duration_sec": 1800.0} for u in range(4)],
             "stages": {"transcribed": "x", "sourced": "x", "extracted": "x", "handed_off": "x"},
             "be": {"meeting_id": f"m{i}", "item_count": 5}, "transcript": f"{mid}/transcript.md", "ops": [ops, ops]}
        (recordings_dir / f"session_{mid}.json").write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")


def _no_stt():
    raise AssertionError("끝난 회의만 있어 전사할 일이 없다")


def _median_ms(fn, reps: int) -> float:
    times = []
    for _ in range(reps):
        t0 = time.perf_counter()
        fn()
        times.append(time.perf_counter() - t0)
    return round(statistics.median(times) * 1000, 1)


def measure(recordings_dir: Path, *, reps: int = 7) -> dict:
    paths = list(recordings_dir.glob("session_*.json"))
    worker = W.Worker(recordings_dir, transcripts_dir=recordings_dir / "transcripts", stt_factory=_no_stt,
                      gate_factory=lambda: None, extractor_factory=lambda: None, handoff_factory=lambda: None,
                      interval_s=3600.0, notifier=None, debug=False)
    processed = []
    return {
        "manifests": len(paths),
        "avg_kb": round(sum(p.stat().st_size for p in paths) / max(len(paths), 1) / 1024, 1),
        "targets_ms": _median_ms(lambda: R.recovery_targets(recordings_dir, claims=R.Claims(owner="scan")), reps),
        "notice_ms": _median_ms(lambda: R.interrupted_meetings(recordings_dir, since="2026-10-13T00:00:00+00:00"), reps),
        "worker_pass_ms": _median_ms(lambda: processed.extend(asyncio.run(worker.run_pass())[0]), reps),
        "processed": len(processed),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="워커 한 바퀴의 비용")
    ap.add_argument("--counts", type=int, nargs="+", default=[100, 1000, 5000])
    ap.add_argument("--reps", type=int, default=7)
    args = ap.parse_args(argv)
    print("| 쌓인 매니페스트 | 평균 크기 | 대상 고르기 | 재시작 안내 확인 | 워커 한 바퀴 |")
    print("|---|---|---|---|---|")
    for n in args.counts:
        with tempfile.TemporaryDirectory() as td:
            make_finished(Path(td), n)
            r = measure(Path(td), reps=args.reps)
        print(f"| {n:,} | {r['avg_kb']}KB | {r['targets_ms']}ms | {r['notice_ms']}ms | {r['worker_pass_ms']}ms |")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
