"""judge 새 항목의 근거 상태(certain/inferred/missing)를 Jev 에게 따로 물어 정한다(이슈 #232 B안).

LLM 이 자기가 만든 값을 스스로 평가하면 거의 다 certain 이 된다. 그래서 값을 만든 뒤 근거 원문과
함께 Jev 에게 "원문에 명시돼 있나"를 다시 묻는다. Jev 는 선택지(yes/no/unclear)마다 확률을 돌려주고,
yes 의 확률이 YES_THRESHOLD 이상일 때만 certain 이다.

certain 은 "원문으로 확인됐다고 Jev 가 판단했다"는 뜻이지 정답일 확률이 아니다. 실제로 얼마나 맞는지는
judge/eval_evidence.py 로 잰다. 호출이 실패하면 확인하지 못한 것이므로 inferred 다.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from extract.llm import CERTAIN, INFERRED, MISSING
from jev import JevClient

YES_THRESHOLD = 0.8  # BE 의 담당자 확정 기준(0.8)과 맞췄다. eval_evidence 결과로 조정한다

QUESTIONS: dict[str, dict[str, Any]] = {
    "task": {
        "type": "choice",
        "instructions": "근거 원문에서 누군가 이 할 일을 하겠다고 약속했거나, 하기로 결정·지시했다고 명시했는가?",
        "criteria": {
            "yes": "하겠다는 약속·결정·지시가 원문에 명시돼 있다",
            "no": "명시돼 있지 않거나, 부정·번복됐다",
            "unclear": "조건부(시간 되면 등)·질문·제안이라 확정이 아니다",
        },
    },
    "due": {
        "type": "choice",
        "instructions": "근거 원문에 이 할 일의 마감으로 주어진 표현이 명시돼 있고, 회의 날짜 기준으로 계산하면 "
                        "정확히 위의 마감 날짜가 되는가?",
        "criteria": {
            "yes": "원문의 마감 표현이 이 일의 마감이고, 계산하면 이 날짜 하나로 정해진다",
            "no": "원문에 없거나, 다른 일의 날짜거나, 계산한 날짜가 다르다",
            "unclear": "'~쯤', '이번 주 안에'처럼 날짜 하나로 정해지지 않는다",
        },
    },
}

_RANK = {MISSING: 0, INFERRED: 1, CERTAIN: 2}


def _weekday(d: date) -> str:
    return "월화수목금토일"[d.weekday()]


def _due_weekday(due_date: str) -> str:
    try:
        return f" ({_weekday(date.fromisoformat(due_date))}요일)"
    except ValueError:
        return ""


def _state(lines: list[str], task: str | None, due_date: str | None, due_raw: str | None, today: date) -> str:
    parts = [f"회의 날짜: {today.isoformat()} ({_weekday(today)}요일)", f"할 일: {task or '(제목 없음)'}"]
    if due_date:
        # 요일을 같이 준다 — Jev 는 달력 계산이 약해 "금요일까지"인데 토요일 날짜인 것을 통과시켰다(eval_evidence)
        parts.append(f"마감 날짜: {due_date}{_due_weekday(due_date)}" + (f' (원문 표현: "{due_raw}")' if due_raw else ""))
    parts.append("근거 원문:")
    parts += [f'- "{line}"' for line in lines]
    return "\n".join(parts)


def _yes(answers: dict[str, Any] | None, key: str) -> bool:
    try:
        return float(answers[key]["probabilities"]["yes"]) >= YES_THRESHOLD
    except (KeyError, TypeError, ValueError):
        return False


def verify(lines: list[str], task: str | None, due_date: str | None, due_raw: str | None,
           today: date, client: JevClient) -> tuple[str, str]:
    """(task_status, due_status). 마감이 없으면 마감은 묻지 않고 missing. 근거 줄이 없으면 묻지 않고 inferred."""
    no_due = MISSING if due_date is None else INFERRED
    if not lines:
        return INFERRED, no_due
    questions = {"task": QUESTIONS["task"]}
    if due_date is not None:
        questions["due"] = QUESTIONS["due"]
    answers = client.decide(_state(lines, task, due_date, due_raw, today), questions)
    task_status = CERTAIN if _yes(answers, "task") else INFERRED
    if due_date is None:
        return task_status, MISSING
    return task_status, CERTAIN if _yes(answers, "due") else INFERRED


def worse(a: str, b: str) -> str:
    return a if _RANK[a] <= _RANK[b] else b
