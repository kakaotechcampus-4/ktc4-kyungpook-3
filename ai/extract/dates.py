"""LLM 이 계산한 마감일을 검증한다.

날짜 "해석"은 LLM 이 한다 — 마감 표현 25개 벤치(기준일 2026-09-09)에서 정규식 파서는 21개 중
10개(48%)만 맞춘 반면 LLM 은 21/21(100%, 5회 연속 동일)이었다. "월요일까지"(주 접두어 없는 요일),
"17일까지", "월말까지", "2주 뒤", "담주 월요일" 같은 흔한 표현을 정규식이 못 따라간다.

대신 결과는 코드가 검증한다 — 지어낸 날짜가 조용히 DB 에 박히는 것만은 막아야 한다.
"""

from __future__ import annotations

from datetime import date

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
