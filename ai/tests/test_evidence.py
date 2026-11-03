from datetime import date

import pytest

from jev import FakeJev
from judge.evidence import QUESTIONS, YES_THRESHOLD, verify, worse

TODAY = date(2026, 3, 2)  # 월
LINES = ["API 에러 코드 목록 정리가 필요할 것 같아요.", "그건 제가 이번 주 금요일까지 할게요."]


def _ans(task_yes=None, due_yes=None):
    out = {}
    for key, p in (("task", task_yes), ("due", due_yes)):
        if p is not None:
            out[key] = {"type": "choice", "choice": "yes" if p >= 0.5 else "no",
                        "probabilities": {"yes": p, "no": 1 - p, "unclear": 0.0}, "confidence": p}
    return out


@pytest.mark.parametrize("task_yes, due_yes, expected", [
    (0.95, 0.9, ("certain", "certain")),
    (YES_THRESHOLD, YES_THRESHOLD, ("certain", "certain")),   # 경계값은 certain
    (0.79, 0.95, ("inferred", "certain")),
    (0.95, 0.3, ("certain", "inferred")),
])
def test_yes_probability_decides_status(task_yes, due_yes, expected):
    jev = FakeJev([_ans(task_yes, due_yes)])
    assert verify(LINES, "API 에러 코드 목록 정리", "2026-03-06", "이번 주 금요일까지", TODAY, jev) == expected


def test_no_due_is_missing_and_not_asked():
    jev = FakeJev([_ans(0.95)])
    assert verify(LINES, "API 에러 코드 목록 정리", None, None, TODAY, jev) == ("certain", "missing")
    (_, questions), = jev.calls
    assert set(questions) == {"task"}


def test_asks_both_in_one_call_with_due():
    jev = FakeJev([_ans(0.9, 0.9)])
    verify(LINES, "API 에러 코드 목록 정리", "2026-03-06", "이번 주 금요일까지", TODAY, jev)
    (state, questions), = jev.calls
    assert questions == {"task": QUESTIONS["task"], "due": QUESTIONS["due"]}
    assert "회의 날짜: 2026-03-02 (월요일)" in state
    assert "할 일: API 에러 코드 목록 정리" in state
    assert '마감 날짜: 2026-03-06 (금요일) (원문 표현: "이번 주 금요일까지")' in state
    assert '- "그건 제가 이번 주 금요일까지 할게요."' in state


@pytest.mark.parametrize("answers", [
    None,                                                     # 호출 실패
    {},                                                       # 답 없음
    {"task": {"choice": "yes"}, "due": {"probabilities": {}}},  # 확률 없음
    {"task": {"probabilities": {"yes": "높음"}}},              # 숫자가 아님
])
def test_failure_or_odd_answer_is_inferred(answers):
    jev = FakeJev([answers])
    assert verify(LINES, "x", "2026-03-06", None, TODAY, jev) == ("inferred", "inferred")


def test_failure_without_due_keeps_missing():
    assert verify(LINES, "x", None, None, TODAY, FakeJev([None])) == ("inferred", "missing")


def test_no_evidence_is_inferred_without_asking():
    jev = FakeJev([_ans(1.0, 1.0)])
    assert verify([], "x", "2026-03-06", None, TODAY, jev) == ("inferred", "inferred")
    assert verify([], "x", None, None, TODAY, jev) == ("inferred", "missing")
    assert jev.calls == []


def test_worse():
    assert worse("certain", "inferred") == "inferred"
    assert worse("missing", "certain") == "missing"
    assert worse("certain", "certain") == "certain"
