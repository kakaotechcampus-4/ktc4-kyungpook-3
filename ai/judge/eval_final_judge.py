"""Terra 2단계(judge/final_judge.py) 실제 API 검증 스크립트.

pytest 스위트엔 안 넣는다 — 실제 Terra 호출이라 비용이 들고, LLM 응답이라 비결정적이다
(golden_set_stage2/README.md 참고 — 한 번 실패해도 몇 번 더 돌려보고 판단할 것).

명확한 케이스(새 항목/기존 수정/이미 반영됨)는 채점하고, `observe_only` 케이스는 정답 없이
실제 판단만 관찰한다.

실행 (ai/ 디렉토리 안에서 — TERRA_API_KEY 필요):
    .venv/bin/python -m judge.eval_final_judge

결과는 runs/final_judge_eval.csv 에도 남는다 (.gitignore 대상 — 커밋 안 됨).
"""

from __future__ import annotations

import csv
import json

from judge.final_judge import JudgeUnavailableError, judge
from shared.config import AI_ROOT, RUNS_DIR
from shared.schemas import JudgeInput

CASES_PATH = AI_ROOT / "judge" / "golden_set_stage2" / "cases.json"


def _load_cases() -> list[dict]:
    return json.loads(CASES_PATH.read_text(encoding="utf-8"))


def main() -> None:
    cases = _load_cases()
    correct = graded = 0
    rows = []

    for case in cases:
        desc = case["description"]
        judge_input = JudgeInput.from_dict(case["judge_input"])
        observe_only = case.get("observe_only", False)
        expected = case.get("expected", {})

        try:
            result = judge(judge_input)
        except JudgeUnavailableError as e:
            print(f"[!] {desc}\n    Terra 호출 실패: {e}\n")
            rows.append({"description": desc, "status": "ERROR", "detail": str(e)})
            continue

        if observe_only:
            status = "OBSERVE"
        else:
            graded += 1
            checks = {
                "is_meaningful": result.is_meaningful == expected["is_meaningful"],
            }
            if expected["is_meaningful"]:
                checks["is_new"] = result.is_new == expected["is_new"]
                checks["matched_task_id"] = result.matched_task_id == expected.get("matched_task_id")
            if "category" in expected:
                checks["category"] = result.category == expected["category"]
            if "status" in expected:
                checks["status"] = result.status == expected["status"]

            passed = all(checks.values())
            correct += passed
            status = "PASS" if passed else "FAIL"

        mark = {"PASS": "✓", "FAIL": "✗", "OBSERVE": "?"}[status]
        print(f"[{mark}] {desc}")
        print(f"    쿼리: {judge_input.text!r}")
        print(
            f"    실제: is_meaningful={result.is_meaningful}, is_new={result.is_new}, "
            f"matched_task_id={result.matched_task_id}, category={result.category}, "
            f"status={result.status}"
        )
        if not observe_only:
            print(f"    기대: {expected}")
        print(f"    근거: {result.evidence}")
        print()

        rows.append({
            "description": desc,
            "status": status,
            "text": judge_input.text,
            "is_meaningful": result.is_meaningful,
            "is_new": result.is_new,
            "matched_task_id": result.matched_task_id,
            "category": result.category,
            "status_field": result.status,
            "evidence": result.evidence,
        })

    print("=" * 60)
    print(f"채점 대상 {correct}/{graded} 통과 (관찰용/에러 {len(cases) - graded}개 제외, 전체 {len(cases)}개)")

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = RUNS_DIR / "final_judge_eval.csv"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"CSV 저장: {csv_path}")


if __name__ == "__main__":
    main()
