"""답장 판단(judge/reply.py) 실제 API 평가. 합성 사례를 운영 입구 judge_reply 로 그대로 돌려 변경 줄을 정답과 견준다.

pytest 스위트엔 안 넣는다. Luna·Terra·Jev 를 실제로 불러 비용이 들고 응답이 실행마다 조금씩 다르다.
한 번 어긋났다고 바로 프롬프트나 질문 문구를 고치지 말고 --repeat 로 몇 번 더 돌려볼 것.

재는 값:
  나뉨 정확도        (태스크, 필드) 집합이 정답과 같은 사례 / 사례
  자동 반영 정밀도   정답도 auto 인 줄 / status + certain 줄
  잘못된 certain     정답이 auto 가 아닌 status + certain 줄. 분모는 나온 status 줄 전체

자동 반영의 나머지 조건(지금 값, 담당자)은 BE 게이트 몫이라 재지 않는다.

실행 (ai/ 디렉토리 안에서):
    .venv/bin/python -m judge.eval_reply --estimate         호출 수와 원 추정. 클라이언트를 만들지 않는다
    .venv/bin/python -m judge.eval_reply --dry              정답을 판단 결과로 되돌려 채점만 돌린다. API 를 부르지 않는다
    .venv/bin/python -m judge.eval_reply [--repeat N] [--out 경로]    실제 호출. TERRA·LUNA·JEV 키 필요, 비용 발생

원자료는 --out 으로 레포 밖 mm/eval-runs/ 에 쓴다. 없으면 runs/reply_eval.json (.gitignore 대상).
"""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from pathlib import Path
from typing import Any, Callable

from extract.llm import CERTAIN, INFERRED
from jev import NullJev, get_jev
from judge.reply import judge_reply
from llm import get_llm
from shared.config import AI_ROOT, RUNS_DIR

CASES_PATH = AI_ROOT / "judge" / "golden_set_reply" / "cases.json"
# 회당 원. 장부 실측(Terra 입력 약 800, 출력 약 90 토큰에 4원)과 같은 단가로 잡은 추정이다. Jev 단가는 장부에 없다
WON_PER_CALL = {"luna_stage1": 8, "terra": 4, "luna_draft": 4}


def load_cases(path: Path = CASES_PATH) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["_meta"], data["cases"]


def _is_auto(change: dict[str, Any]) -> bool:
    return change["field"] == "status" and change["evidence_status"] == CERTAIN


def score_case(expected: list[dict[str, Any]], changes: list[dict[str, Any]]) -> dict[str, Any]:
    want = {(e["task"], e["field"]): e for e in expected}
    got = {(c["task_id"], c["field"]): c for c in changes}
    autos = [c for c in changes if _is_auto(c)]
    right_autos = [c for c in autos if (e := want.get((c["task_id"], "status"))) and e["auto"]
                   and e["value"] == c["new_value"]]
    return {
        "split_ok": set(want) == set(got),
        "value_ok": all(got[k]["new_value"] == e["value"] for k, e in want.items() if k in got),
        "status_lines": sum(c["field"] == "status" for c in changes),
        "autos": len(autos),
        "right_autos": len(right_autos),
        "false_certain": len(autos) - len(right_autos),
        "want_autos": sum(e["auto"] for e in expected),
    }


def _rate(n: int, d: int) -> str:
    return f"{n}/{d} ({n / d:.1%})" if d else f"{n}/0"


def summarize(rows: list[dict[str, Any]]) -> list[str]:
    total = Counter()
    by_shape: dict[str, Counter] = {}
    for r in rows:
        counts = Counter({**{k: int(v) for k, v in r["score"].items()}, "cases": 1, "errors": int("error" in r)})
        total.update(counts)
        by_shape.setdefault(r["shape"], Counter()).update(counts)
    out = [f"나뉨 정확도: {_rate(total['split_ok'], total['cases'])}",
           f"값 일치: {_rate(total['value_ok'], total['cases'])}",
           f"자동 반영 정밀도: {_rate(total['right_autos'], total['autos'])}",
           f"잘못된 certain: {total['false_certain']}건 / status 줄 {total['status_lines']}건",
           f"놓친 자동 반영: {total['want_autos'] - total['right_autos']}건 / 정답 auto {total['want_autos']}건",
           f"판단 실패: {total['errors']}건", "", "모양별 (나뉨, 잘못된 certain):"]
    out += [f"  {shape}: {_rate(c['split_ok'], c['cases'])}, {c['false_certain']}건" for shape, c in by_shape.items()]
    misses = [r for r in rows if not r["score"]["split_ok"] or not r["score"]["value_ok"] or r["score"]["false_certain"]]
    if misses:
        out += ["", "틀린 것:"]
        out += [f"  {r['id']} [{r['shape']}] 정답 {_lines(r['expected'])} / 나옴 {_lines(r['changes'])}"
                + (f" / 실패 {r['error']}" if "error" in r else "") for r in misses]
    return out


def _lines(lines: list[dict[str, Any]]) -> list[str]:
    return [f"{line.get('task', line.get('task_id'))}:{line['field']}="
            f"{line.get('value', line.get('new_value'))}" + (f"({line['evidence_status']})" if line.get("evidence_status") else "")
            for line in lines]


def estimate_calls(cases: list[dict[str, Any]], repeat: int) -> Counter:
    """정답에서 호출 수를 어림한다. finding 은 태스크마다 하나, unknown·due_clear 줄마다 하나, 없으면 하나로 본다.

    바뀌는 것이 없는 finding 은 초안을 부르지 않는데 위로 어림한다. 후보 밖 말은 새 항목이라 run 안에서 Jev 를 한 번 쓴다.
    후보가 둘 이상이면 정답에 없는 후보마다 보충 판단(Terra·Luna 초안·Jev 각 1)을 더한다. run 이 태스크를 놓쳐도 그 태스크의
    finding 몫이 보충으로 옮겨 갈 뿐이라 합은 같다. 초안과 Jev 는 Terra 가 바꿀 것을 찾았을 때만 불러 이것도 위로 어림이다.
    """
    calls = Counter()
    for case in cases:
        expected, many = case["expected"], len(case["claim"]["candidates"]) > 1
        groups = {e["task"] for e in expected if e["task"]} | {i for i, e in enumerate(expected) if not e["task"]}
        calls.update({"luna_stage1": 1, "terra": max(1, len(groups)), "luna_draft": max(1, len(groups))})
        for e in expected:
            if e["field"] in ("status", "unknown") or many:
                calls["jev"] += 1
        if many:
            spare = len(case["claim"]["candidates"]) - len({e["task"] for e in expected if e["task"]})
            calls.update({"terra": spare, "luna_draft": spare, "jev": spare})
    return Counter({k: v * repeat for k, v in calls.items()})


def _print_estimate(cases: list[dict[str, Any]], repeat: int) -> None:
    calls = estimate_calls(cases, repeat)
    won = sum(WON_PER_CALL[k] * calls[k] for k in WON_PER_CALL)
    print(f"사례 {len(cases)}건 × {repeat}회. 답장 1건은 Luna 1단계 1 + finding 당 (Terra 1 + Luna 초안 1) + Jev "
          "+ 후보가 둘 이상이면 고르지 않은 후보 당 (Terra 1 + Luna 초안 1 + Jev 1)")
    print(f"호출 추정: Luna 1단계 {calls['luna_stage1']}, Terra {calls['terra']}, Luna 초안 {calls['luna_draft']}, "
          f"Jev {calls['jev']}")
    print(f"원 추정: 약 {won}원 + Jev {calls['jev']}회 (Jev 단가는 장부에 없다. 재시도는 뺐다)")


def _replay(case: dict[str, Any]) -> dict[str, Any]:
    """--dry 의 판단기. 정답을 판단 결과처럼 돌려준다."""
    changes = [{"task_id": e["task"], "field": e["field"], "new_value": e["value"],
                "evidence_status": (CERTAIN if e["auto"] else INFERRED) if e["field"] == "status" else None}
               for e in case["expected"]]
    return {"changes": changes}


def _live(case: dict[str, Any]) -> dict[str, Any]:
    return judge_reply(case["claim"])


def run_cases(cases: list[dict[str, Any]], repeat: int, judge: Callable[[dict[str, Any]], dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for n in range(repeat):
        for case in cases:
            row = {"id": case["id"], "shape": case["shape"], "run": n, "expected": case["expected"]}
            started = time.monotonic()
            try:
                row["changes"] = judge(case)["changes"]
            except Exception as e:  # noqa: BLE001 - 판단 실패도 결과다. 운영에서는 PM 알림으로 간다
                row["changes"] = []
                row["error"] = type(e).__name__
            row["seconds"] = round(time.monotonic() - started, 2)
            row["score"] = score_case(case["expected"], row["changes"])
            rows.append(row)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--estimate", action="store_true", help="호출 수와 원만 찍는다")
    ap.add_argument("--dry", action="store_true", help="정답을 되돌려 채점만 돌린다. API 를 부르지 않는다")
    ap.add_argument("--out", type=Path, default=RUNS_DIR / "reply_eval.json")
    args = ap.parse_args()
    meta, cases = load_cases()

    if args.estimate:
        _print_estimate(cases, args.repeat)
        return
    if args.dry:
        judge = _replay
    else:
        if get_llm("terra").name == "off" or get_llm("luna").name == "off":
            raise SystemExit("TERRA·LUNA 키가 없습니다.")
        if isinstance(get_jev(), NullJev):  # 없으면 전부 inferred 라 정밀도를 재지 못한다
            raise SystemExit("JEV_API_KEY 가 없습니다.")
        judge = _live

    rows = run_cases(cases, args.repeat, judge)
    print(f"{'합성 ' if meta['synthetic'] else ''}사례 {len(cases)}건 × {args.repeat}회{' (dry)' if args.dry else ''}\n")
    print("\n".join(summarize(rows)))
    seconds = sorted(row["seconds"] for row in rows)
    print(f"\n답장 1건 시간: 평균 {sum(seconds) / len(seconds):.1f}초, 중앙값 {seconds[len(seconds) // 2]:.1f}초, 최대 {seconds[-1]:.1f}초")
    if not args.dry:
        print(f"\n호출: Terra {get_llm('terra').calls}, Luna {get_llm('luna').calls}, Jev {get_jev().calls}")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n저장: {args.out}")


if __name__ == "__main__":
    main()
