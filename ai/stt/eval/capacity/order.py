"""회의록 줄의 시간축 순서를 잰다. 단어 시각 없이 여러 턴을 한 줄로 묶으면 줄이 다른 화자의 말을 건너뛴다.

  lines                빈 줄을 뺀 줄 수
  jumps                다른 화자가 말을 시작한 자리를 사이에 둔 줄 수. 정답이 있으면 정답 발화의 시작으로,
                       없으면 다른 화자 줄의 시작으로 본다
  speaker_turns        줄을 시작 시각으로 세운 화자열(같은 화자가 이어지면 하나)의 길이
  speaker_seq_edits    정답 화자열과의 편집 거리. 정답이 있을 때만
  sentence_inversions  판단 1단계(judge.semantic_judge._flatten)가 매긴 문장 순서에서, 뒤 문장의 줄이 덮는 정답
                       발화가 앞 문장의 줄이 덮는 정답 발화보다 먼저인 인접 쌍의 수. 정답이 있을 때만

줄 파일은 runner --save-lines 모양({"segments": [{speaker, start, end, text, seq}]})이고, 정답은 정렬본이나
stt.eval.capacity.interleave 가 쓴 truth_aligned.json 이다. 결과에는 숫자만 쓴다.

사용 (ai/ 안에서):
  python -m stt.eval.capacity.order --lines 묶음=<파일> --lines 순서=<파일> [--truth <truth_aligned.json>] --out <json>
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from stt.eval.golden import _edits, _speaker_turns

TOLERANCE_S = 0.5   # 줄과 정답 발화가 겹치는지 볼 때의 여유. VAD 시각과 정답 시각이 조금 다르다


def _covers(line: dict, truth: list[dict]) -> list[int]:
    return [i for i, t in enumerate(truth) if t["speaker"] == line["speaker"]
            and t["start"] < line["end"] + TOLERANCE_S and t["end"] > line["start"] - TOLERANCE_S]


def measure(segments: list[dict], truth: list[dict] | None) -> dict:
    from judge.semantic_judge import _flatten
    from shared.schemas import Transcript, TranscriptSegment

    lines = sorted((s for s in segments if s.get("text")), key=lambda s: (s["start"], s["speaker"]))
    starts = ([(t["start"], t["speaker"]) for t in truth] if truth is not None
              else [(s["start"], s["speaker"]) for s in lines])
    jumps = sum(1 for ln in lines
                if any(spk != ln["speaker"] and ln["start"] + 1e-6 < st < ln["end"] - 1e-6 for st, spk in starts))
    hyp_turns = _speaker_turns([ln["speaker"] for ln in lines])
    out = {"lines": len(lines), "jumps": jumps, "speaker_turns": len(hyp_turns),
           "speaker_seq_edits": None, "sentence_inversions": None}
    if truth is None:
        return out
    out["speaker_seq_edits"] = _edits(_speaker_turns([t["speaker"] for t in truth]), hyp_turns)
    by_seq = {ln["seq"]: ln for ln in lines}
    transcript = Transcript(segments=[TranscriptSegment(speaker=ln["speaker"], start=ln["start"], end=ln["end"],
                                                        text=ln["text"], seq=ln["seq"]) for ln in lines])
    _sentences, seqs, _speakers = _flatten(transcript)
    inversions = 0
    for a, b in zip(seqs, seqs[1:]):
        if a == b:
            continue
        ca, cb = _covers(by_seq[a], truth), _covers(by_seq[b], truth)
        if ca and cb and min(cb) < max(ca):
            inversions += 1
    out["sentence_inversions"] = inversions
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lines", action="append", required=True, help="이름=줄 파일")
    ap.add_argument("--truth", type=Path, default=None, help="truth_aligned.json. 없으면 정답에 견주는 지표를 비운다")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    truth = None
    if args.truth is not None:
        truth = [t for t in json.loads(args.truth.read_text(encoding="utf-8")) if t.get("start") is not None]
    result = {}
    for item in args.lines:
        name, _, path = item.partition("=")
        segments = json.loads(Path(path).read_text(encoding="utf-8"))["segments"]
        result[name] = measure(segments, truth)
        print(f"[order] {name}: {result[name]}")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
