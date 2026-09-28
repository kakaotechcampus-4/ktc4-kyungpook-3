"""배치 전사가 준비한 묶음 pcm 을 얼마나 붙잡는지 잰다. 합성 입력과 가짜 백엔드라 모델·API 를 부르지 않는다.

6인 회의를 흉내 낸다. 회의를 5초 칸으로 나눠 칸 번호 % 6 == i 인 칸에서만 화자 i 가 말한다(220Hz 톤).
그래서 화자마다 회의 길이의 1/6 을 말하고, 여섯 트랙의 발화 합이 회의 길이와 같다.

두 가지를 잰다.
  retained_mb  트랙을 읽는 순간 아직 살아 있는 묶음 pcm 의 합(트랙마다 재서 최댓값). 약한 참조로 센다
  peak_mb      tracemalloc 최대치. 읽는 중인 트랙 배열(float32, 분당 3.84MB)이 같이 들어간다

실행 (ai/ 안에서):
  .venv/bin/python -m stt.eval.pcm_retention --minutes 10 30 --work /tmp/pcm [--delay-ms 5000 --workers 6]
"""

from __future__ import annotations

import argparse
import gc
import json
import time
import tracemalloc
import weakref
from pathlib import Path

import numpy as np
import soundfile as sf

from stt import batch as B
from stt.backend import SttResult, Word

SR = 16_000
SLOT_S = 5
SPEAKERS = 6


class EchoStt:
    name = "echo"

    def __init__(self, delay_s: float = 0.0):
        self.delay_s = delay_s

    def transcribe(self, samples, sample_rate):
        if self.delay_s:
            time.sleep(self.delay_s)
        dur = len(samples) / sample_rate
        ws, t = [], 0.25
        while t < dur:
            ws.append(Word(text="w", start_s=t - 0.05, end_s=t + 0.05))
            t += 0.5
        return SttResult(text="x", words=ws)


def make_tracks(work: Path, minutes: int) -> Path:
    d = work / f"m{minutes}"
    if d.exists():
        return d
    d.mkdir(parents=True)
    n = int(minutes * 60 * SR)
    t = np.arange(SLOT_S * SR) / SR
    tone = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    for i in range(SPEAKERS):
        a = np.zeros(n, dtype=np.float32)
        for slot in range(i, n // (SLOT_S * SR), SPEAKERS):
            a[slot * SLOT_S * SR:(slot + 1) * SLOT_S * SR] = tone
        sf.write(str(d / f"{i + 1}_100.wav"), a, SR, subtype="PCM_16")
    return d


def measure(track_dir: Path, delay_s: float, workers: int) -> dict:
    refs: list[list] = []
    retained = []
    real_build, real_load = B.build_chunks, B.load_track

    def build(utts, **kw):
        chunks = real_build(utts, **kw)
        refs.append([weakref.ref(c.pcm) for c in chunks])
        return chunks

    def load(path):
        gc.collect()
        alive = sum(r().nbytes for rs in refs for r in rs if r() is not None)
        retained.append(alive)
        return real_load(path)

    B.build_chunks, B.load_track = build, load
    try:
        tracemalloc.start()
        lines, stats = B.run(B.discover(track_dir), EchoStt(delay_s), mode="chunk", gate=None, workers=workers)
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
    finally:
        B.build_chunks, B.load_track = real_build, real_load
    mb = 1024 * 1024
    return {
        "tracks": stats.tracks,
        "speech_s": round(stats.speech_s, 1),
        "lines": len(lines),
        "retained_mb_by_track": [round(x / mb, 1) for x in retained],
        "retained_mb_max": round(max(retained) / mb, 1),
        "peak_mb": round(peak / mb, 1),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=int, nargs="+", default=[10, 30])
    ap.add_argument("--work", type=Path, required=True)
    ap.add_argument("--delay-ms", type=int, default=0, help="가짜 호출 한 번에 걸리는 시간")
    ap.add_argument("--workers", type=int, default=1, help="로컬 1, 원격 6")
    args = ap.parse_args()
    for m in args.minutes:
        d = make_tracks(args.work, m)
        print(json.dumps({"minutes": m, "delay_ms": args.delay_ms, "workers": args.workers,
                          **measure(d, args.delay_ms / 1000, args.workers)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
