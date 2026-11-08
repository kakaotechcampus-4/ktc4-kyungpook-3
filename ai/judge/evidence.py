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
    # 날짜는 없는데 원문 표현이 있으면 마감을 뽑았다가 걸러진 것이다. 마감 없음(missing)과 구분해 inferred 로 둔다
    no_due = MISSING if due_date is None and not due_raw else INFERRED
    if not lines:
        return INFERRED, no_due
    questions = {"task": QUESTIONS["task"]}
    if due_date is not None:
        questions["due"] = QUESTIONS["due"]
    answers = client.decide(_state(lines, task, due_date, due_raw, today), questions)
    task_status = CERTAIN if _yes(answers, "task") else INFERRED
    if due_date is None:
        return task_status, no_due
    return task_status, CERTAIN if _yes(answers, "due") else INFERRED


def worse(a: str, b: str) -> str:
    return a if _RANK[a] <= _RANK[b] else b


# 답장의 상태 변경. 자동 반영이 여기에 달려 있어서 상태마다 무엇이 yes 인지 좁게 적는다
REPLY_STATUS_CRITERIA: dict[str, dict[str, str]] = {
    "done": {
        "yes": "이 태스크를 끝냈다, 완료했다, 다 했다고 직접 말했다",
        "no": "올렸다, 넘겼다, 붙였다처럼 한 일만 말했고 끝났다는 말은 없거나, 끝나지 않았다고 했다",
        "unclear": "거의, 일부, 예정, 조건부라서 끝났는지 정해지지 않았다",
    },
    "blocked": {
        "yes": "무엇이 오지 않았거나 막혀서 이 태스크를 더 진행하지 못한다고 직접 말했다",
        "no": "막혔다는 말이 없거나, 남의 검토나 확인을 기다릴 뿐이다",
        "unclear": "막힐 것 같다, 어렵다 정도라서 지금 멈췄는지 정해지지 않았다",
    },
    "in_progress": {
        "yes": "이 태스크를 시작했거나 지금 하고 있다고 직접 말했다",
        "no": "시작했다는 말이 없거나, 끝냈다거나 못 한다고 했다",
        "unclear": "할 예정이거나 조건부라서 시작했는지 정해지지 않았다",
    },
    "todo": {
        "yes": "이 태스크를 아직 시작하지 않았거나 처음으로 되돌렸다고 직접 말했다",
        "no": "그런 말이 없거나, 이미 하고 있다고 했다",
        "unclear": "시작했는지 알 수 없다",
    },
}
TARGET_CLEAR, TARGET_OTHER, TARGET_UNCLEAR = "clear", "other", "unclear"
REPLY_TARGET_QUESTION: dict[str, Any] = {
    "type": "choice",
    "instructions": "이번 답장에서 위 변경이 위 태스크에 대한 말인 것이 다른 후보 태스크와 구분되게 분명한가?",
    "criteria": {
        "yes": "답장의 말 가운데 이 태스크를 가리키는 부분이 위 변경을 말하거나, 앞선 PM 말이 이 태스크 하나만 물었다",
        "no": "위 변경은 다른 후보 태스크에 대한 말이다",
        "unclear": "'다 했어요'처럼 어느 후보를 말하는지 알 수 없다",
    },
}


def _status_question(status: str) -> dict[str, Any]:
    return {"type": "choice",
            "instructions": "이번 답장에서 이 태스크에 대한 부분만 본다. 팀원이 이 태스크가 제안 상태라고 원문으로 "
                            "명시했는가? 다른 태스크에 대한 말은 근거가 아니다.",
            "criteria": REPLY_STATUS_CRITERIA[status]}


def _reply_state(lines: list[dict[str, str]], task: str | None, status: str | None, change: str | None,
                 others: list[str], today: date) -> str:
    parts = [f"답장 날짜: {today.isoformat()} ({_weekday(today)}요일)", f"태스크: {task or '(제목 없음)'}"]
    if status is not None:
        parts.append(f"제안 상태: {status}")
    if change:
        parts.append(f"이 태스크에 붙이려는 변경: {change}")
    if others:
        parts += ["다른 후보 태스크:", *(f"- {title}" for title in others)]
    # 앞 답장은 넣지 않는다. 앞 답장에 있는 말을 이번 답장의 근거로 치면 안 된다
    pm_lines = [line for line in lines[:-1] if line["sender"] == "pm"]
    if pm_lines:
        parts += ["PM 이 한 말:", *(f'- "{line["text"]}"' for line in pm_lines)]
    parts += ["이번 답장:", f'- "{lines[-1]["text"]}"']
    return "\n".join(parts)


def _target(answers: dict[str, Any] | None) -> str:
    try:
        probabilities = answers["target"]["probabilities"]
        yes = float(probabilities["yes"])
        no = float(probabilities.get("no", 0))
    except (KeyError, TypeError, ValueError):
        return TARGET_UNCLEAR
    if yes >= YES_THRESHOLD:
        return TARGET_CLEAR
    return TARGET_OTHER if no >= YES_THRESHOLD else TARGET_UNCLEAR


def verify_reply(lines: list[dict[str, str]], task: str | None, *, status: str | None, change: str | None,
                 others: list[str], today: date, client: JevClient) -> tuple[str, str]:
    """(status 근거, 대상 판정). lines 는 시간순이고 마지막이 이번 답장, change 는 이 태스크에 붙이려는 변경의 요약,
    others 는 나머지 후보의 제목이다.

    status 가 없고 다른 후보도 없으면 물을 것이 없어 부르지 않는다. 호출이 실패하면 inferred 다. 다른 후보가 있으면
    대상도 unclear 다. 대상을 확인하지 못한 채 변경을 태스크에 붙이면 그 태스크의 시계가 닫히기 때문이다.
    """
    questions: dict[str, dict[str, Any]] = {}
    if status is not None:
        questions["status"] = _status_question(status)
    if others:
        questions["target"] = REPLY_TARGET_QUESTION
    if not questions:
        return INFERRED, TARGET_CLEAR
    answers = client.decide(_reply_state(lines, task, status, change, others, today), questions)
    target = _target(answers) if others else TARGET_CLEAR
    certain = _yes(answers, "status") and target == TARGET_CLEAR
    return (CERTAIN if certain else INFERRED), target
