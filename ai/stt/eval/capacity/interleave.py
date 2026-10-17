"""정렬본 회의를 화자끼리 번갈아 말하는 대화로 다시 놓는다. 회의록 시간축과 문장 순서를 재는 데 쓴다.

정렬본(m01·m02)은 한 사람씩 길게 이어 말해서, 화자가 번갈아 말할 때 회의록 순서가 지켜지는지 볼 수 없다.
화자마다 운영과 같은 VAD(stt.batch.cut)로 클립을 자르고, 화자를 정답 순서대로 돌아가며 클립을 per_turn 개씩
놓는다. 화자 사이는 gap_s 초(3초 아래라 대화처럼 바로 이어진다), 같은 화자 클립 사이는 원래 쉼을 inner_gap_s
초까지만 둔다. 화자별 클립 순서는 원래대로라 화자별 정답(truth_by_speaker.json)을 그대로 쓴다. 놓은 자리는
truth_aligned.json 에 남겨 순서 지표(stt.eval.golden 의 순서 편집, stt.eval.capacity.order)의 정답으로 쓴다.
목소리는 원본이고 시간축은 합성이라, 순서·시각 지표는 이 합성 순서 대비다. 클립 단위 정답 문장은 없다.

실행 (ai/ 안에서):
  .venv/bin/python -m stt.eval.capacity.interleave --source <정렬본 폴더> --out <폴더> [--per-turn 1 --gap 0.8]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf

from stt import batch as B

SR = B.SR


def build_interleaved(source: Path, out: Path, *, per_turn: int = 1, gap_s: float = 0.8,
                      inner_gap_s: float = 1.0, lead_s: float = 1.0) -> dict:
    source, out = Path(source), Path(out)
    truth_by = json.loads((source / "truth_by_speaker.json").read_text(encoding="utf-8"))
    aligned = json.loads((source / "truth_aligned.json").read_text(encoding="utf-8"))
    order: list[str] = []
    for t in aligned:
        if t["speaker"] in truth_by and t["speaker"] not in order:
            order.append(t["speaker"])
    order += [s for s in truth_by if s not in order]

    queues: dict[str, list] = {}
    for spk in order:
        audio = B.load_track(source / f"{spk}.wav")
        queues[spk] = [(np.array(u.pcm, copy=True), u.start_ms, u.end_ms) for u in B.cut(audio, spk)]
        del audio

    gap_n, inner_n, t = round(gap_s * SR), round(inner_gap_s * SR), round(lead_s * SR)
    placed: list[dict] = []
    while any(queues.values()):
        for spk in order:
            take, queues[spk] = queues[spk][:per_turn], queues[spk][per_turn:]
            if not take:
                continue
            prev_end = None
            for pcm, src_start, src_end in take:
                if prev_end is not None:
                    t += min(inner_n, max(0, round((src_start - prev_end) * SR / 1000)))
                placed.append({"speaker": spk, "start_n": t, "end_n": t + len(pcm), "pcm": pcm,
                               "src_start": src_start / 1000, "src_end": src_end / 1000})
                t += len(pcm)
                prev_end = src_end
            t += gap_n
    total = t + round(lead_s * SR)

    out.mkdir(parents=True, exist_ok=True)
    for spk in order:
        track = np.zeros(total, dtype=np.float32)
        for p in placed:
            if p["speaker"] == spk:
                track[p["start_n"]:p["end_n"]] = p["pcm"]
        sf.write(str(out / f"{spk}.wav"), track, SR, subtype="PCM_16")
    truth = [{"seq": i, "speaker": p["speaker"], "text": "", "start": round(p["start_n"] / SR, 3),
              "end": round(p["end_n"] / SR, 3), "src_start": p["src_start"], "src_end": p["src_end"]}
             for i, p in enumerate(placed)]
    (out / "truth_aligned.json").write_text(json.dumps(truth, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "truth_by_speaker.json").write_text(json.dumps(truth_by, ensure_ascii=False, indent=2), encoding="utf-8")
    meta = {"name": f"{source.name}-interleaved", "derived_from": source.name, "per_turn": per_turn, "gap_s": gap_s,
            "inner_gap_s": inner_gap_s, "placements": len(placed), "speakers": order, "track_s": round(total / SR, 1),
            "timeline": "합성. 화자마다 VAD 클립을 원래 순서대로 두고 화자를 돌아가며 놓음. 순서·시각 지표는 이 합성 순서 대비다",
            "known_issues": ["클립 단위 정답 문장이 없다. CER 은 화자별 전체 정답으로 잰다"]}
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return meta


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, required=True, help="정렬본 회의 폴더(화자.wav, truth_*.json)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--per-turn", type=int, default=1, help="화자가 한 번에 말하는 클립 수")
    ap.add_argument("--gap", type=float, default=0.8, help="화자 사이 침묵(초)")
    args = ap.parse_args(argv)
    meta = build_interleaved(args.source, args.out, per_turn=args.per_turn, gap_s=args.gap)
    print(f"[interleave] {meta['name']}: 클립 {meta['placements']}개, {meta['track_s']}초 → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
