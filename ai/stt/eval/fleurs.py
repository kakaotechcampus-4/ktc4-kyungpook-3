"""FLEURS 한국어 120클립으로 모델을 비교한다. 공개 셋이라 모델 간 상대 순위가 목적이다.

클립은 낭독체 단일 화자 12초 안팎이라 회의 조건(자유발화·겹침·무음)은 못 잰다. 그래서
여기서는 CER·처리 시간·메모리만 보고, 회의 조건은 골든셋 정렬본(golden.py)이 맡는다.
클립 하나가 곧 발화 하나라 모드 구분이 없고, 말 필터가 거른 수만 따로 센다.

사용 (ai/ 안에서):
  .venv/bin/python -m stt.eval.fleurs --root "<fleurs_ko>" --backend local --model small
  .venv/bin/python -m stt.eval.fleurs --root "<fleurs_ko>" --backend elice --yes     # 약 150원
"""

from __future__ import annotations

import argparse
import json
import resource
import statistics
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from stt import batch as B
from stt.eval.eval import score as cer_score
from stt.speech_gate import SpeechGate


def load_clips(root: Path) -> list[dict]:
    items = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    out = []
    for it in items:
        audio, sr = sf.read(str(root / it["file"]), dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if sr != B.SR:
            raise ValueError(f"{it['file']}: {sr}Hz")
        out.append({"id": it["id"], "text": it["text"], "audio": audio})
    return out


def run(root: Path, backend_kind: str, model: str, *, beam: int = 5, gate_on: bool = True,
        workers: int | None = None, yes: bool = False, tag: str = "", out_dir: Path | None = None) -> dict | None:
    clips = load_clips(root)
    total_s = sum(len(c["audio"]) for c in clips) / B.SR
    if backend_kind == "elice" and not yes:
        from stt.elice import whisper_krw
        print(f"FLEURS {len(clips)}클립 {total_s / 60:.1f}분 · 약 {whisper_krw(total_s):.0f}원. --yes 로 승인.")
        return None
    backend = B.make_backend(backend_kind, model, "clip", beam=beam)
    gate = SpeechGate() if gate_on else None
    w = workers if workers is not None else B.default_workers(backend_kind)

    ru0 = resource.getrusage(resource.RUSAGE_SELF)
    t0 = time.monotonic()
    gated = 0
    todo = []
    for c in clips:
        if gate is not None and not gate.accepts(c["audio"], B.SR, tag=str(c["id"])):
            gated += 1
            c["hyp"] = ""
            continue
        todo.append(c)
    stats = B.BatchStats(mode="clip", backend=backend.name)
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=max(1, w)) as ex:
        results = list(ex.map(lambda c: B._call(backend, c["audio"], stats, "fleurs"), todo))
    for c, (r, _dt, err) in zip(todo, results):
        c["hyp"] = "" if err or r is None else r.text
    wall = time.monotonic() - t0
    ru1 = resource.getrusage(resource.RUSAGE_SELF)
    cpu_s = (ru1.ru_utime + ru1.ru_stime) - (ru0.ru_utime + ru0.ru_stime)

    per = []
    for c in clips:
        s = cer_score(c["text"], c["hyp"])
        per.append({"id": c["id"], "cer": s["cer_nospace"], "chars": len(c["text"]),
                    "ins": s.get("ins", 0), "ref_words": s.get("ref_words", 0), "hyp": c["hyp"]})
    tot = sum(p["chars"] for p in per)
    cer = sum(p["cer"] * p["chars"] for p in per if p["cer"] is not None) / tot
    from stt.elice import whisper_krw
    summ = stats.summary()
    out = {
        "set": "fleurs_ko", "clips": len(clips), "audio_s": round(total_s, 1), "backend": backend.name,
        "beam": beam, "gate": gate_on, "workers": w, "tag": tag,
        "cer": round(cer, 4), "cer_median_clip": round(statistics.median(p["cer"] for p in per), 4),
        "insertion_rate": round(sum(p["ins"] for p in per) / max(1, sum(p["ref_words"] for p in per)), 4),
        "gated": gated, "failed": stats.failed,
        "wall_s": round(wall, 1), "rtf_wall": round(wall / total_s, 3),
        "cpu_s": round(cpu_s, 1), "cpu_s_per_speech_s": round(cpu_s / total_s, 3),
        "peak_rss_gb": round(ru1.ru_maxrss / 1e9, 2),
        "krw": round(whisper_krw(stats.audio_sent_s), 1) if backend_kind == "elice" else 0.0,
        "transcribe_p50_s": summ["transcribe_p50_s"], "transcribe_p95_s": summ["transcribe_p95_s"],
        "transcribe_max_s": summ["transcribe_max_s"], "calls_over_20s": summ["calls_over_20s"],
        "rtf_p50": summ["rtf_p50"], "rtf_p95": summ["rtf_p95"],
    }
    stem = f"fleurs_{backend_kind}{'' if backend_kind == 'elice' else '-' + model}{'-' + tag if tag else ''}"
    path = (out_dir or root) / f"{stem}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({**out, "per_clip": per}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, required=True)
    ap.add_argument("--backend", choices=["local", "elice"], default="local")
    ap.add_argument("--model", default="large-v3-turbo")
    ap.add_argument("--beam", type=int, default=5)
    ap.add_argument("--no-gate", action="store_true")
    ap.add_argument("--workers", type=int)
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--tag", default="")
    ap.add_argument("--out-dir", type=Path)
    a = ap.parse_args(argv)
    run(a.root.expanduser(), a.backend, a.model, beam=a.beam, gate_on=not a.no_gate, workers=a.workers,
        yes=a.yes, tag=a.tag, out_dir=a.out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
