from __future__ import annotations

from datetime import date

import pytest

from extract.dates import resolve_due_raw

TODAY = date(2026, 3, 2)  # 월요일


@pytest.mark.parametrize("raw, expected", [
    ("오늘", date(2026, 3, 2)), ("내일까지", date(2026, 3, 3)), ("모레", date(2026, 3, 4)),
    ("금요일까지", date(2026, 3, 6)), ("월요일", date(2026, 3, 9)),
    ("이번 주 금요일까지", date(2026, 3, 6)), ("이번주 금요일", date(2026, 3, 6)),
    ("다음 주 화요일", date(2026, 3, 10)), ("담주 화요일까지", date(2026, 3, 10)),
    ("3월 16일까지", date(2026, 3, 16)), ("3/16", date(2026, 3, 16)), ("1월 5일", date(2027, 1, 5)),
    ("  금요일 까지 ", date(2026, 3, 6)),
])
def test_resolves_single_date_expressions(raw, expected):
    assert resolve_due_raw(raw, TODAY) == expected


@pytest.mark.parametrize("raw", [
    None, "", "다음 주쯤", "이번 주 안에", "이번 주 안으로", "다음 주까지", "월말까지",
    "금요일쯤", "다음 주 금요일쯤", "2주 뒤", "17일까지", "2월 30일", "금요일까지 할게요",
])
def test_unknown_or_period_expressions_are_none(raw):
    assert resolve_due_raw(raw, TODAY) is None
