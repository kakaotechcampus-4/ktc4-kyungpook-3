"""상대 날짜 표현(자연어) → 실제 날짜.

기준일은 호출자가 넘기거나(재현/테스트용), 비우면 shared.config.today() 를 씀
— PM_AGENT_TODAY 로 고정할 수 있어 골든셋/테스트에서 "오늘"이 매번 안 바뀌게 함.
"""

from __future__ import annotations

import re
from datetime import date, timedelta

_WEEKDAYS = {"월": 0, "화": 1, "수": 2, "목": 3, "금": 4, "토": 5, "일": 6}

_WEEKDAY_RE = re.compile(r"(이번\s*주|다음\s*주)\s*([월화수목금토일])요일")


def parse_due_date(text: str, today: date) -> date | None:
    """문장에서 마감일을 뽑는다. 해석 불가(예: 요일 없는 "이번 주")면 None.

    "이번 주"만 있고 요일이 없는 경우처럼 애매한 표현은 일부러 None 으로 남긴다 —
    잘못된 날짜를 확정하는 것보다, 사람이 확인해야 함을 신뢰도 하락으로 드러내는 쪽이 안전하다.
    """
    if "모레" in text:
        return today + timedelta(days=2)
    if "내일" in text:
        return today + timedelta(days=1)
    if "오늘" in text:
        return today

    m = _WEEKDAY_RE.search(text)
    if m:
        week_word, day_char = m.group(1), m.group(2)
        monday = today - timedelta(days=today.weekday())
        if "다음" in week_word:
            monday += timedelta(days=7)
        return monday + timedelta(days=_WEEKDAYS[day_char])

    return None


# 실측(scratchpad 벤치, 기준일 2026-09-09): 위 규칙은 마감 표현 21개 중 10개(48%)만 맞췄고
# 같은 표현들을 LLM 이 직접 ISO 로 계산했을 땐 21/21(100%, 5회 연속 동일)이었다.
# 그래서 LLM 경로는 날짜 계산을 LLM 에 맡기고, 코드는 아래 sanity check 로 최악만 막는다.
# (규칙 파서는 LLM 을 못 쓸 때의 폴백으로 남긴다 — 못 잡는 표현은 None 이라 조용히 틀리진 않는다.)
MAX_FUTURE_DAYS = 365


def sanity_check_due_date(value: str | None, today: date) -> date | None:
    """LLM 이 준 마감일 문자열을 검증한다. 이상하면 None — 지어낸 날짜가 조용히 DB 에 박히는 걸 막는다.

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
