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
