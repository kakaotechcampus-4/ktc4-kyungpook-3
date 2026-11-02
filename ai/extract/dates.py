"""LLM 이 계산한 마감일을 검증한다.

날짜 "해석"은 LLM 이 한다 — 마감 표현 25개 벤치(기준일 2026-09-09)에서 정규식 파서는 21개 중
10개(48%)만 맞춘 반면 LLM 은 21/21(100%, 5회 연속 동일)이었다. "월요일까지"(주 접두어 없는 요일),
"17일까지", "월말까지", "2주 뒤", "담주 월요일" 같은 흔한 표현을 정규식이 못 따라간다.

대신 결과는 코드가 검증한다 — 지어낸 날짜가 조용히 DB 에 박히는 것만은 막아야 한다.
"""

from __future__ import annotations

import re
from datetime import date, timedelta

MAX_FUTURE_DAYS = 365


def sanity_check_due_date(value: str | None, today: date) -> date | None:
    """LLM 이 준 마감일 문자열을 검증한다. 이상하면 None.

    거르는 것: 형식 오류, 기준일보다 과거, 1년 넘게 먼 미래.
    """
    if not value:
        return None
    try:
        parsed = date.fromisoformat(value.strip())
    except (ValueError, AttributeError):
        return None
    if parsed < today:
        return None
    if (parsed - today).days > MAX_FUTURE_DAYS:
        return None
    return parsed


_WEEKDAYS = "월화수목금토일"
_DAY = r"([월화수목금토일])요일"
_TRAILING = re.compile(r"까지는?$")
_REL_DAYS = {"오늘": 0, "내일": 1, "모레": 2}
_BARE_WEEKDAY = re.compile(_DAY)
_THIS_WEEK = re.compile(rf"이번\s*주\s*{_DAY}")
_NEXT_WEEK = re.compile(rf"(?:다음\s*주|담주)\s*{_DAY}")
_MONTH_DAY = re.compile(r"(\d{1,2})\s*월\s*(\d{1,2})\s*일|(\d{1,2})/(\d{1,2})")


def resolve_due_raw(raw: str | None, today: date) -> date | None:
    """마감 원문 표현이 날짜 하나로 정해지면 그 날짜, 아니면 None.

    # ponytail: 화이트리스트 밖 표현은 None(=inferred). 운영에서 필요해지면 그때 늘린다.
    """
    if not raw:
        return None
    text = _TRAILING.sub("", raw.strip()).strip()
    if text in _REL_DAYS:
        return today + timedelta(days=_REL_DAYS[text])
    if m := _BARE_WEEKDAY.fullmatch(text):
        ahead = (_WEEKDAYS.index(m[1]) - today.weekday() - 1) % 7 + 1
        return today + timedelta(days=ahead)
    monday = today - timedelta(days=today.weekday())
    if m := _THIS_WEEK.fullmatch(text):
        return monday + timedelta(days=_WEEKDAYS.index(m[1]))
    if m := _NEXT_WEEK.fullmatch(text):
        return monday + timedelta(days=7 + _WEEKDAYS.index(m[1]))
    if m := _MONTH_DAY.fullmatch(text):
        month, day = int(m[1] or m[3]), int(m[2] or m[4])
        try:
            result = date(today.year, month, day)
            return result if result >= today else date(today.year + 1, month, day)
        except ValueError:
            return None
    return None
