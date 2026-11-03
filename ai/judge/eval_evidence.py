"""근거 검증(judge/evidence.py) 실제 Jev 평가 — 정답을 붙인 대사로 certain 판정이 맞는지 잰다.

pytest 스위트엔 안 넣는다 — Jev 를 실제로 호출해서 비용이 들고 응답이 실행마다 조금씩 다르다.
한 번 어긋났다고 바로 질문 문구나 기준값을 고치지 말고 몇 번 더 돌려볼 것.

기대값은 "certain 이어야 하는가"다. True 는 원문에 명시됐다는 뜻, False 는 조건부·질문·부정·근사 표현·
다른 업무의 날짜·번복·계산 오류처럼 PM 확인 없이 자동 생성되면 안 되는 경우다. 마감이 없으면 due 는 None.
판정 기준 두 가지를 같이 본다: yes 확률 ≥ 기준값(지금 쓰는 것), choice=yes 이고 confidence ≥ 기준값.

실행 (ai/ 디렉토리 안에서 — JEV_API_KEY 필요):
    .venv/bin/python -m judge.eval_evidence [--repeat N]

결과는 runs/evidence_eval.json 에도 남는다 (.gitignore 대상 — 커밋 안 됨).
"""

from __future__ import annotations

import argparse
import json
from datetime import date

from jev import NullJev, get_jev
from judge.evidence import QUESTIONS, YES_THRESHOLD, _state
from shared.config import RUNS_DIR

TODAY = date(2026, 11, 2)  # 월요일

# (이름, 근거 줄, 할 일 제목, 마감 날짜, 마감 원문 표현, task certain 기대, due certain 기대)
CASES: list[tuple[str, list[str], str, str | None, str | None, bool, bool | None]] = [
    # ── 명시: 둘 다 certain
    ("약속+이번 주 요일", ["그건 제가 이번 주 금요일까지 할게요."], "API 에러 코드 목록 정리",
     "2026-11-06", "이번 주 금요일까지", True, True),
    ("지시+일만 있는 날짜", ["로그인 화면 시안은 지민님이 14일까지 맡아주세요."], "로그인 화면 시안",
     "2026-11-14", "14일까지", True, True),
    ("지시+내일", ["배포 스크립트는 내일까지 올려 주세요."], "배포 스크립트 작성", "2026-11-03", "내일까지", True, True),
    ("결정+다음 주 요일", ["회원가입 API 는 다음 주 수요일까지 하기로 했습니다."], "회원가입 API 구현",
     "2026-11-11", "다음 주 수요일까지", True, True),
    ("약속+M월 D일", ["결제 모듈 테스트는 11월 20일까지 제가 맡을게요."], "결제 모듈 테스트",
     "2026-11-20", "11월 20일까지", True, True),
    ("두 줄에 걸친 지시", ["API 명세서 작성 담당이 필요합니다.", "이건 지민님이 다음 주 월요일까지 맡아주세요."],
     "API 명세서 작성", "2026-11-09", "다음 주 월요일까지", True, True),
    ("약속+마감 없음", ["알림 설정 페이지는 제가 할게요."], "알림 설정 페이지 개발", None, None, True, None),
    # ── 할 일이 확정이 아님
    ("조건부: 시간 되면", ["시간 되면 접근성 점검도 해볼게요."], "접근성 점검", None, None, False, None),
    ("조건부: 여유 되면", ["여유 되면 문서도 정리해둘게요."], "문서 정리", None, None, False, None),
    ("질문", ["지민님이 API 문서 정리해 주실 수 있을까요?"], "API 문서 정리", None, None, False, None),
    ("제안", ["캐시를 적용하면 좋을 것 같아요."], "캐시 적용", None, None, False, None),
    ("부정", ["다크모드는 이번엔 안 하기로 했습니다."], "다크모드 구현", None, None, False, None),
    ("지난 얘기", ["로그 수집 얘기는 지난 회의에서 했었죠."], "로그 수집 개선", None, None, False, None),
    # ── 할 일은 명시, 마감이 확정이 아님
    ("근사: 쯤", ["API 문서는 제가 다음 주쯤 정리할게요."], "API 문서 정리", "2026-11-13", "다음 주쯤", True, False),
    ("기간: 안에", ["디자인 시안은 이번 주 안에 드릴게요."], "디자인 시안", "2026-11-08", "이번 주 안에", True, False),
    ("다른 업무의 날짜", ["로그인은 금요일까지, 회원가입은 다음 주 화요일까지 할게요."], "회원가입 구현",
     "2026-11-06", "금요일까지", True, False),
    ("번복된 날짜", ["배포는 목요일까지 하기로 했다가 다음 주 월요일로 미뤘어요."], "배포",
     "2026-11-05", "목요일까지", True, False),
    ("다다음 주", ["제가 다다음 주 화요일까지 할게요."], "환불 기능 구현", "2026-11-10", "다음 주 화요일", True, False),
    ("계산 오류", ["리뷰는 제가 금요일까지 할게요."], "코드 리뷰", "2026-11-07", "금요일까지", True, False),
]


def _yes_prob(ans: dict, key: str) -> float | None:
    try:
        return float(ans[key]["probabilities"]["yes"])
    except (KeyError, TypeError, ValueError):
        return None


def _by_conf(ans: dict, key: str) -> bool:
    try:
        return ans[key]["choice"] == "yes" and float(ans[key]["confidence"]) >= YES_THRESHOLD
    except (KeyError, TypeError, ValueError):
        return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeat", type=int, default=1)
    args = ap.parse_args()
    client = get_jev()
    if isinstance(client, NullJev):
        raise SystemExit("JEV_API_KEY 가 없습니다.")

    rows = []
    for name, lines, task, due, raw, want_task, want_due in CASES:
        questions = {"task": QUESTIONS["task"]} | ({"due": QUESTIONS["due"]} if due else {})
        for _ in range(args.repeat):
            ans = client.decide(_state(lines, task, due, raw, TODAY), questions) or {}
            for key, want in (("task", want_task), ("due", want_due)):
                if want is None:
                    continue
                p = _yes_prob(ans, key)
                rows.append({"case": name, "field": key, "want": want, "p_yes": p,
                             "by_prob": p is not None and p >= YES_THRESHOLD, "by_conf": _by_conf(ans, key),
                             "choice": (ans.get(key) or {}).get("choice"), "confidence": (ans.get(key) or {}).get("confidence")})

    print(f"기준값 {YES_THRESHOLD} · 대사 {len(CASES)}개 × {args.repeat}회 · Jev 호출 {len(CASES) * args.repeat}회\n")
    for rule in ("by_prob", "by_conf"):
        for key in ("task", "due"):
            rs = [r for r in rows if r["field"] == key]
            ok = sum(r[rule] == r["want"] for r in rs)
            false_certain = sum(r[rule] and not r["want"] for r in rs)
            missed = sum(not r[rule] and r["want"] for r in rs)
            print(f"{rule:8} {key:4}: 정답 {ok}/{len(rs)}  잘못된 certain {false_certain}  놓친 certain {missed}")
    print("\n틀린 것 (yes 확률 기준):")
    for r in rows:
        if r["by_prob"] != r["want"]:
            print(f"  [{r['field']}] {r['case']}: 기대 {'certain' if r['want'] else 'inferred'} · "
                  f"yes {r['p_yes']} · choice {r['choice']} · confidence {r['confidence']}")

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    out = RUNS_DIR / "evidence_eval.json"
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n저장: {out}")


if __name__ == "__main__":
    main()
