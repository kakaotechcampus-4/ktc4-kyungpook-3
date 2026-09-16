"""저장된 전사로 CER 만 다시 계산한다. STT 를 다시 돌리지 않는다.

golden.py score 가 남긴 score_*.json 에는 화자별 전사(hyp_by_speaker)가 들어 있다. 정답을 고쳤거나
정규화 규칙을 바꿨을 때 이 파일만 다시 채점하면 유료 호출도 모델 실행도 없다. 채점 함수는
stt/eval/eval.py 의 score 와 같은 것이라 다른 표와 값이 맞는다.

사용 (ai/ 안에서):
  .venv/bin/python -m stt.eval.rescore --session "<meeting-01-aligned>" --results "<결과 디렉토리>" [--note "정답 수정 사유"]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from stt.eval.eval import score as cer_score


def rescore(truth_by: dict[str, str], result: dict) -> dict:
    """result 의 hyp_by_speaker 로 cer, cer_by_speaker, insertion_rate 를 다시 계산한 사본."""
    per = {}
    for name, ref in truth_by.items():
        s = cer_score(ref, result.get("hyp_by_speaker", {}).get(name, ""))
        per[name] = (s["cer_nospace"], len(ref), s.get("ins", 0), s.get("ref_words", 0))
    tot = sum(v[1] for v in per.values())
    out = dict(result)
    out["cer"] = round(sum(v[0] * v[1] for v in per.values() if v[0] is not None) / tot, 4)
    out["cer_by_speaker"] = {k: round(v[0], 4) for k, v in per.items()}
    out["insertion_rate"] = round(sum(v[2] for v in per.values()) / max(1, sum(v[3] for v in per.values())), 4)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", type=Path, required=True, help="truth_by_speaker.json 이 있는 디렉토리")
    ap.add_argument("--results", type=Path, nargs="+", required=True, help="score_*.json 이 있는 디렉토리")
    ap.add_argument("--note", default="", help="왜 다시 채점했는지. 파일에 남는다")
    a = ap.parse_args(argv)
    truth_by = json.loads((a.session.expanduser() / "truth_by_speaker.json").read_text(encoding="utf-8"))
    for d in a.results:
        for f in sorted(d.expanduser().glob("score_*.json")):
            r = json.loads(f.read_text(encoding="utf-8"))
            new = rescore(truth_by, r)
            if a.note:
                new["rescore_note"] = a.note
            f.write_text(json.dumps(new, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"{f.name}: {r['cer'] * 100:.2f}% → {new['cer'] * 100:.2f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
