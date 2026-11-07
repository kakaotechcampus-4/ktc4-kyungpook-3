"""전사 오인식 검사(judge/asr_check.py) 평가 — 오류를 넣은 문장은 잡고, 멀쩡한 문장은 놓아주는지 잰다.

LLM·API 를 부르지 않는다(형태소 분석기만). 그래도 대사가 많고 결과를 기록으로 남기는 평가라 pytest 와 따로 둔다.
대사: judge/golden_set_asr/ — cases.json 은 규칙을 맞출 때 본 세트, holdout.json 은 규칙을 정한 뒤 한 번만 잰
처음 보는 세트(다른 팀·다른 업무 단어, 검사 규칙을 모르는 상태로 만들었다). 수치는 holdout 을 기준으로 본다.
- injected: 업무 단어 하나를 발음이 비슷한 비단어로 바꾼 문장. 의심 단어가 있어야 한다(없으면 auto 로 샌다).
- normal: 멀쩡한 문장(팀 용어·영문·변형 표기 포함). 의심 단어가 없어야 한다(있으면 auto 가 괜히 줄어든다).
- realword: 오인식이 실제 낱말이 된 문장("배포"→"대표"). 이 검사로 못 잡는 한계를 확인하려고 둔다.

실행 (ai/ 디렉토리 안에서):
    .venv/bin/python -m judge.eval_asr_check [--set cases|holdout] [--out judge/eval_results/<날짜>-asr-check.json]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from judge.asr_check import Vocabulary, check_item

SET_DIR = Path(__file__).resolve().parent / "golden_set_asr"


def _hit(suspects: list[dict], wrong: str | None) -> dict | None:
    """오류 단어와 겹치는 의심 단어(조사가 붙거나 복합어로 잡힐 수 있어 포함 관계로 본다)."""
    if not wrong:
        return None
    return next((s for s in suspects if s["word"] and (wrong in s["word"] or s["word"] in wrong)), None)


def evaluate(data: dict) -> dict:
    team = data["team"]
    rows = []
    for c in data["cases"]:
        vocab = Vocabulary.build(members=team["members"], task_titles=team["task_titles"], other_lines=c["other_lines"])
        suspects = check_item(c["lines"], c["title"], vocab)
        hit = _hit(suspects, c.get("wrong"))
        rows.append({"name": c["name"], "group": c["group"], "expect": c["expect_suspect"], "wrong": c.get("wrong"),
                     "right": c.get("right"), "suspects": suspects, "flagged": bool(suspects),
                     "hit_wrong": hit is not None,
                     "right_in_top5": bool(hit and c.get("right") in hit["candidates"]),
                     "right_top1": bool(hit and hit["candidates"][:1] == [c.get("right")])})
    by = {g: [r for r in rows if r["group"] == g] for g in ("injected", "normal", "realword")}
    inj, nor, real = by["injected"], by["normal"], by["realword"]
    return {
        "cases": len(rows),
        "injected": {"n": len(inj), "flagged": sum(r["flagged"] for r in inj),
                     "leaked_to_auto": sum(not r["flagged"] for r in inj),
                     "flagged_the_wrong_word": sum(r["hit_wrong"] for r in inj),
                     "right_in_top5": sum(r["right_in_top5"] for r in inj),
                     "right_top1": sum(r["right_top1"] for r in inj)},
        "normal": {"n": len(nor), "flagged": sum(r["flagged"] for r in nor)},
        "realword": {"n": len(real), "flagged": sum(r["flagged"] for r in real)},
        "rows": rows,
    }


def report(s: dict) -> None:
    i, n, r = s["injected"], s["normal"], s["realword"]
    print(f"대사 {s['cases']}개")
    print(f"오류 주입 {i['n']}: 잡음 {i['flagged']} · auto 로 샘 {i['leaked_to_auto']} · 오류 단어를 짚음 "
          f"{i['flagged_the_wrong_word']} · 정답 후보 Top-5 {i['right_in_top5']} · Top-1 {i['right_top1']}")
    print(f"정상 {n['n']}: 괜히 막음 {n['flagged']} ({n['flagged'] / max(n['n'], 1) * 100:.1f}%)")
    print(f"실제 낱말 오류 {r['n']}: 잡음 {r['flagged']} (한계 확인용, 못 잡는 것이 정상)")
    print("\n샌 오류 주입:")
    for row in s["rows"]:
        if row["group"] == "injected" and not row["flagged"]:
            print(f"  {row['name']} (오류 {row['wrong']} → {row['right']})")
    print("\n괜히 막은 정상 문장:")
    for row in s["rows"]:
        if row["group"] == "normal" and row["flagged"]:
            print(f"  {row['name']}: {[x['word'] for x in row['suspects']]}")
    print("\n오류 단어 대신 다른 말을 짚은 오류 주입:")
    for row in s["rows"]:
        if row["group"] == "injected" and row["flagged"] and not row["hit_wrong"]:
            print(f"  {row['name']} (오류 {row['wrong']}): {[x['word'] for x in row['suspects']]}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="holdout", help="cases(규칙을 맞춘 세트) 또는 holdout(처음 보는 세트)")
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    s = evaluate(json.loads((SET_DIR / f"{args.set}.json").read_text(encoding="utf-8")))
    report(s)
    if args.out:
        Path(args.out).write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\n저장: {args.out}")


if __name__ == "__main__":
    main()
