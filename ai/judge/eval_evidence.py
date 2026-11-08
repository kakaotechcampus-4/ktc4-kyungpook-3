"""근거 검증(judge/evidence.py) 실제 Jev 평가 — 정답을 붙인 대사로 certain 판정이 맞는지 잰다.

pytest 스위트엔 안 넣는다 — Jev 를 실제로 호출해서 비용이 들고 응답이 실행마다 조금씩 다르다.
한 번 어긋났다고 바로 질문 문구나 기준값을 고치지 말고 몇 번 더 돌려볼 것.

기대값은 "certain 이어야 하는가"다. True 는 원문에 명시됐다는 뜻, False 는 조건부·질문·부정·근사 표현·
다른 업무의 날짜·번복·계산 오류처럼 PM 확인 없이 자동 생성되면 안 되는 경우다. 마감이 없으면 due 는 None.
대사는 judge/golden_set_evidence/*.json 에 있다(base 28개, extended 189개, 회의 날짜 2026-11-02 월요일).

무엇을 보나 (#382 멘토 리뷰: 0.8 은 정답률이 아니라 원문 명시 판정값이고 표본이 작았다)
- 잘못된 certain: 정답이 False 인데 certain 이 된 것. auto 로 새는 쪽이라 가장 중요하다. 비율과 95% 신뢰 상한(Wilson)을 낸다.
- 놓친 certain: 정답이 True 인데 inferred 가 된 것. PM 확인이 늘 뿐이다.
- 기준값별 결과(0.5~0.95): 0.8 을 다른 값으로 바꾸면 무엇이 달라지는지.
- 유형별 결과: 어떤 말에서 틀리는지.
- 흔들림: --repeat 로 여러 번 돌렸을 때 같은 대사의 판정이 바뀐 것.

실행 (ai/ 디렉토리 안에서 — JEV_API_KEY 필요):
    .venv/bin/python -m judge.eval_evidence [--repeat N] [--sets base,extended] [--out 파일]

결과는 runs/evidence_eval.json 에 남고(.gitignore), --out 을 주면 그 경로에도 요약을 쓴다.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from datetime import date
from pathlib import Path

from jev import NullJev, get_jev
from judge.evidence import QUESTIONS, YES_THRESHOLD, _state
from shared.config import RUNS_DIR

SET_DIR = Path(__file__).resolve().parent / "golden_set_evidence"
THRESHOLDS = (0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95)


def load_cases(names: list[str] | None = None) -> tuple[date, list[dict]]:
    """golden_set_evidence/<이름>.json 의 대사. 이름을 주지 않으면 전부. 회의 날짜는 모두 같아야 한다."""
    paths = sorted(SET_DIR.glob("*.json")) if not names else [SET_DIR / f"{n}.json" for n in names]
    cases, today = [], None
    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        day = date.fromisoformat(data["meeting_date"])
        if today is not None and day != today:
            raise ValueError(f"회의 날짜가 다르다: {path.name}")
        today = day
        cases += [{**c, "set": path.stem} for c in data["cases"]]
    if today is None:
        raise ValueError("대사 파일이 없다")
    return today, cases


def wilson_upper(k: int, n: int, z: float = 1.96) -> float | None:
    """k/n 비율의 95% 신뢰구간 위쪽 끝(Wilson). 0건이어도 "이 표본으로는 최대 몇 %까지일 수 있다"를 보여 준다."""
    if n == 0:
        return None
    p = k / n
    denom = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (centre + margin) / denom


def _yes_prob(ans: dict, key: str) -> float | None:
    try:
        return float(ans[key]["probabilities"]["yes"])
    except (KeyError, TypeError, ValueError):
        return None


def score(rows: list[dict], threshold: float) -> dict[str, dict]:
    """field(task·due)마다 기준값 threshold 로 정했을 때의 결과. 응답이 없으면(p_yes None) certain 이 아니다."""
    out = {}
    for field in ("task", "due"):
        rs = [r for r in rows if r["field"] == field]
        neg = [r for r in rs if not r["want"]]
        pos = [r for r in rs if r["want"]]
        certain = [r for r in rs if r["p_yes"] is not None and r["p_yes"] >= threshold]
        false_certain = sum(1 for r in certain if not r["want"])
        missed = sum(1 for r in pos if r["p_yes"] is None or r["p_yes"] < threshold)
        out[field] = {
            "n": len(rs), "negatives": len(neg), "positives": len(pos),
            "correct": len(rs) - false_certain - missed,
            "false_certain": false_certain,
            "false_certain_rate": false_certain / len(neg) if neg else None,
            "false_certain_rate_upper95": wilson_upper(false_certain, len(neg)),
            "missed_certain": missed,
            "recall": (len(pos) - missed) / len(pos) if pos else None,
            "precision": (len(certain) - false_certain) / len(certain) if certain else None,
        }
    return out


def score_by_sentence(rows: list[dict], threshold: float) -> dict[str, dict]:
    """대사 단위 결과. 같은 대사를 여러 번 돌린 것은 독립 표본이 아니라서 오답률·신뢰 상한은 대사로 센다(#382 재리뷰).

    한 번이라도 잘못 certain 이 된 대사를 잘못된 certain 으로, 한 번이라도 놓친 대사를 놓친 certain 으로 센다(보수적).
    """
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        groups[(r["set"], r["case"], r["field"])].append(r)
    out = {}
    for field in ("task", "due"):
        gs = [g for (_, _, f), g in groups.items() if f == field]
        neg = [g for g in gs if not g[0]["want"]]
        pos = [g for g in gs if g[0]["want"]]
        fc = sum(1 for g in neg if any(r["p_yes"] is not None and r["p_yes"] >= threshold for r in g))
        missed = sum(1 for g in pos if any(r["p_yes"] is None or r["p_yes"] < threshold for r in g))
        out[field] = {
            "sentences": len(gs), "negatives": len(neg), "positives": len(pos),
            "false_certain": fc, "false_certain_rate": fc / len(neg) if neg else None,
            "false_certain_rate_upper95": wilson_upper(fc, len(neg)),
            "missed_certain": missed, "recall": (len(pos) - missed) / len(pos) if pos else None,
        }
    return out


def by_category(rows: list[dict], threshold: float) -> dict[str, dict]:
    """유형별 결과. 오답률은 정답이 False 인 고유 대사(부정)만 분모로, 놓침은 정답 True 대사(긍정)로 센다.

    대사는 (파일, 이름, field) 하나다. 반복 중 한 번이라도 틀리면 틀린 대사(score_by_sentence 와 같다).
    `runs`·`*_runs` 는 반복을 푼 실행 단위 값이고 분모로 쓰지 않는다.
    """
    cats: dict[str, dict[tuple, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for r in rows:
        cats[r["category"]][(r["set"], r["case"], r["field"])].append(r)

    def sure(r: dict) -> bool:
        return r["p_yes"] is not None and r["p_yes"] >= threshold

    result = {}
    for cat, groups in sorted(cats.items()):
        gs = list(groups.values())
        neg = [g for g in gs if not g[0]["want"]]
        pos = [g for g in gs if g[0]["want"]]
        fc = sum(1 for g in neg if any(sure(r) for r in g))
        flat = [r for g in gs for r in g]
        result[cat] = {
            "negatives": len(neg), "false_certain": fc,
            "false_certain_rate_upper95": wilson_upper(fc, len(neg)),
            "positives": len(pos), "missed_certain": sum(1 for g in pos if any(not sure(r) for r in g)),
            "runs": len(flat),
            "false_certain_runs": sum(1 for r in flat if not r["want"] and sure(r)),
            "missed_certain_runs": sum(1 for r in flat if r["want"] and not sure(r)),
        }
    return result


def unstable(rows: list[dict], threshold: float) -> list[dict]:
    """같은 대사·field 를 여러 번 돌렸을 때 기준값 기준 판정이 바뀐 것."""
    seen: dict[tuple, list[float | None]] = defaultdict(list)
    for r in rows:
        seen[(r["set"], r["case"], r["field"])].append(r["p_yes"])
    out = []
    for (set_, case, field), ps in seen.items():
        verdicts = {p is not None and p >= threshold for p in ps}
        if len(verdicts) > 1:
            out.append({"set": set_, "case": case, "field": field, "p_yes": ps})
    return out


def run(cases: list[dict], today: date, repeat: int, client) -> list[dict]:
    rows = []
    for c in cases:
        questions = {"task": QUESTIONS["task"]} | ({"due": QUESTIONS["due"]} if c["due_date"] else {})
        for i in range(repeat):
            ans = client.decide(_state(c["lines"], c["task"], c["due_date"], c["due_raw"], today), questions) or {}
            for field, want in (("task", c["expect_task"]), ("due", c["expect_due"])):
                if want is None:
                    continue
                rows.append({"set": c["set"], "case": c["name"], "category": c["category"], "field": field,
                             "run": i, "want": want, "p_yes": _yes_prob(ans, field),
                             "choice": (ans.get(field) or {}).get("choice")})
    return rows


def summarize(rows: list[dict], cases: list[dict], repeat: int) -> dict:
    return {
        "threshold_in_use": YES_THRESHOLD,
        "cases": len(cases), "repeat": repeat,
        "calls": len(cases) * repeat,
        "no_answer": sum(1 for r in rows if r["p_yes"] is None),
        "by_sentence": score_by_sentence(rows, YES_THRESHOLD),
        "at_threshold": score(rows, YES_THRESHOLD),
        "sweep": {str(t): score(rows, t) for t in THRESHOLDS},
        "by_category": by_category(rows, YES_THRESHOLD),
        "unstable": unstable(rows, YES_THRESHOLD),
        "errors": [r for r in rows if (r["p_yes"] is not None and r["p_yes"] >= YES_THRESHOLD) != r["want"]],
    }


def _pct(x: float | None) -> str:
    return "-" if x is None else f"{x * 100:.1f}%"


def report(s: dict) -> None:
    print(f"기준값 {s['threshold_in_use']} · 대사 {s['cases']}개 × {s['repeat']}회 · Jev 호출 {s['calls']}회 · "
          f"응답 없음 {s['no_answer']}\n")
    print("대사 단위 (오답률·신뢰 상한은 이것으로 본다. 반복 중 한 번이라도 틀리면 틀린 대사):")
    for field, m in s["by_sentence"].items():
        print(f"  {field:4}: 잘못된 certain {m['false_certain']}/{m['negatives']} ({_pct(m['false_certain_rate'])}, "
              f"95% 상한 {_pct(m['false_certain_rate_upper95'])}) · 놓친 certain {m['missed_certain']}/{m['positives']} "
              f"(재현율 {_pct(m['recall'])})")
    print("\n실행 단위 (반복은 흔들림을 보는 데만 쓴다. 독립 표본이 아니다):")
    for field, m in s["at_threshold"].items():
        print(f"{field:4}: 정답 {m['correct']}/{m['n']} · 잘못된 certain {m['false_certain']}/{m['negatives']} "
              f"({_pct(m['false_certain_rate'])}, 95% 상한 {_pct(m['false_certain_rate_upper95'])}) · "
              f"놓친 certain {m['missed_certain']}/{m['positives']} (재현율 {_pct(m['recall'])})")
    print("\n기준값별 (잘못된 certain / 놓친 certain):")
    for t, by_field in s["sweep"].items():
        cells = "  ".join(f"{f} {m['false_certain']}/{m['missed_certain']}" for f, m in by_field.items())
        print(f"  {t:>5}: {cells}")
    print("\n유형별 대사 단위 (잘못된 certain/부정 대사 · 95% 상한 · 놓친 certain/긍정 대사):")
    for cat, m in s["by_category"].items():
        print(f"  {cat}: {m['false_certain']}/{m['negatives']} ({_pct(m['false_certain_rate_upper95'])}) · "
              f"{m['missed_certain']}/{m['positives']}")
    print(f"\n반복 사이 판정이 바뀐 것 {len(s['unstable'])}건")
    for u in s["unstable"]:
        print(f"  [{u['field']}] {u['case']}: yes {u['p_yes']}")
    print("\n틀린 것:")
    for r in s["errors"]:
        print(f"  [{r['field']}] {r['case']} (실행 {r['run']}): 기대 {'certain' if r['want'] else 'inferred'} · "
              f"yes {r['p_yes']} · choice {r['choice']}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--sets", default="", help="쉼표로 구분한 대사 파일 이름(base,extended). 비우면 전부")
    ap.add_argument("--out", default="", help="요약을 쓸 경로(예: judge/eval_results/<날짜>-evidence.json)")
    ap.add_argument("--from-runs", default="", help="Jev 를 부르지 않고 저장된 실행 원자료(runs/evidence_eval.json)로 다시 요약")
    args = ap.parse_args()
    if args.from_runs:
        today, cases = load_cases([n for n in args.sets.split(",") if n] or None)
        rows = json.loads(Path(args.from_runs).read_text(encoding="utf-8"))
        s = summarize(rows, cases, max(r["run"] for r in rows) + 1)
        report(s)
        if args.out:
            Path(args.out).write_text(json.dumps({"meeting_date": today.isoformat(), **s}, ensure_ascii=False,
                                                 indent=1), encoding="utf-8")
        return
    client = get_jev()
    if isinstance(client, NullJev):
        raise SystemExit("JEV_API_KEY 가 없습니다.")
    today, cases = load_cases([n for n in args.sets.split(",") if n] or None)
    rows = run(cases, today, args.repeat, client)
    s = summarize(rows, cases, args.repeat)
    report(s)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    (RUNS_DIR / "evidence_eval.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    if args.out:
        Path(args.out).write_text(json.dumps({"meeting_date": today.isoformat(), **s}, ensure_ascii=False, indent=1),
                                  encoding="utf-8")
        print(f"\n요약 저장: {args.out}")


if __name__ == "__main__":
    main()
