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
# 1단계(semantic_judge)가 포함시키는 조건부 약속 표현은 모두 여기 있어야 한다
_SOFT = "까요 시간되면 가능하면 여유있으면 여유되면 필요하시면".split()
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


_DUE_TAILS = ("까지", "에", "는", "날")


def _quoted_whole(line: str, raw: str) -> bool:
    """원문 줄에 마감 표현이 말 그대로 나오는가. 표현 글자 사이의 공백·부호 차이는 허용한다.
    앞이 글자·숫자면 더 긴 표현의 일부다("1월 5일" ⊂ "11월 5일", "다음 주" ⊂ "다다음 주").
    뒤에 꼬리가 더 붙은 것("화요일쯤", "화요일이나 수요일")도 원문 표현이 아니다. 줄 사이는 잇지 않는다."""
    key = _squash(raw)
    if not key:
        return False
    pattern = r"(?<!\w)" + r"[\W_]*".join(map(re.escape, key))
    return any(
        key.endswith("까지") or (rest := _squash(line[m.end():])) == "" or rest.startswith(_DUE_TAILS)
        for m in re.finditer(pattern, line)
    )


def due_status(lines: list[str], due_raw: str | None, due_date: str | None, today: date) -> str:
    if due_date is None:
        return MISSING
    if not due_raw or not any(_quoted_whole(line, due_raw) for line in lines):
        return INFERRED
    try:
        expected = date.fromisoformat(due_date)
    except ValueError:
        return INFERRED
    return CERTAIN if resolve_due_raw(due_raw, today) == expected else INFERRED


def worse(a: str, b: str) -> str:
    return a if _RANK[a] <= _RANK[b] else b
