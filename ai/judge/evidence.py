"""근거 원문 대조로 할 일·마감의 근거 상태(certain/inferred/missing)를 정한다.

A안(이슈 #232): certain 은 원문으로 확인됐다는 뜻이지 정답 확률이 아니다.
다른 업무 날짜·번복은 못 잡는다.
"""
import re
from datetime import date

from extract.dates import resolve_due_raw
from extract.llm import CERTAIN, INFERRED, MISSING

_EXPLICIT = ("하겠습니다 할게요 해볼게요 해드릴게요 맡을게요 하기로했 하기로하 해주세요 "
             "부탁드립니다 진행하죠 했습니다 완료했 끝냈 올렸습니다").split()
_SOFT = "까요 시간되면 가능하면 여유있으면".split()
_RANK = {MISSING: 0, INFERRED: 1, CERTAIN: 2}


def _squash(s: str) -> str:
    return re.sub(r"[\s\W_]", "", s)


def task_status(lines: list[str]) -> str:
    for line in lines:
        s = _squash(line)
        if "?" in line or any(w in s for w in _SOFT):
            continue
        if any(w in s for w in _EXPLICIT):
            return CERTAIN
    return INFERRED


def due_status(lines: list[str], due_raw: str | None, due_date: str | None, today: date) -> str:
    if due_date is None:
        return MISSING
    if not due_raw or _squash(due_raw) not in _squash("".join(lines)):
        return INFERRED
    try:
        expected = date.fromisoformat(due_date)
    except ValueError:
        return INFERRED
    return CERTAIN if resolve_due_raw(due_raw, today) == expected else INFERRED


def worse(a: str, b: str) -> str:
    return a if _RANK[a] <= _RANK[b] else b
