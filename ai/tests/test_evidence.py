from datetime import date

import pytest

from jev import FakeJev
from judge.evidence import QUESTIONS, REPLY_STATUS_CRITERIA, YES_THRESHOLD, verify, verify_reply, worse
from shared.schemas import TASK_STATUSES

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


def test_rejected_due_date_with_quote_is_inferred_not_missing():
    # 원문에 마감 표현이 있었는데 날짜가 걸러졌다. BE 가 due_not_certain 으로 막도록 missing 이 아니어야 한다
    jev = FakeJev([_ans(0.95), _ans(0.95)])
    assert verify(LINES, "x", None, "이번 주 금요일까지", TODAY, jev) == ("certain", "inferred")
    assert verify([], "x", None, "이번 주 금요일까지", TODAY, jev) == ("inferred", "inferred")


# ── 답장 상태 변경 (verify_reply) ─────────────────────────────────────────

LINES_REPLY = [{"sender": "pm", "text": "API 명세서 어떻게 됐어요?"},
               {"sender": "member", "text": "앞에서 말한 로그인은 금요일까지요"},
               {"sender": "pm", "text": "로그인 시안은요?"},
               {"sender": "member", "text": "API 명세서는 다 했어요"}]


def _reply_ans(status_yes=None, target_yes=None):
    out = {}
    for key, p in (("status", status_yes), ("target", target_yes)):
        if p is not None:
            out[key] = {"type": "choice", "choice": "yes" if p >= 0.5 else "no",
                        "probabilities": {"yes": p, "no": 1 - p, "unclear": 0.0}, "confidence": p}
    return out


def _verify_reply(jev, status="done", others=()):
    return verify_reply(LINES_REPLY, "API 명세서 작성", status=status, change=None, others=list(others), today=TODAY, client=jev)


@pytest.mark.parametrize("status_yes, expected", [
    (0.95, "certain"), (YES_THRESHOLD, "certain"), (0.79, "inferred"),
])
def test_reply_status_needs_the_same_threshold(status_yes, expected):
    assert _verify_reply(FakeJev([_reply_ans(status_yes)])) == (expected, "clear")


def test_one_candidate_asks_only_the_status_question():
    jev = FakeJev([_reply_ans(0.9)])
    _verify_reply(jev)
    (_, questions), = jev.calls
    assert set(questions) == {"status"}


def test_other_candidates_add_the_target_question_to_the_same_call():
    jev = FakeJev([_reply_ans(0.9, 0.9)])
    assert _verify_reply(jev, others=["로그인 시안"]) == ("certain", "clear")
    (state, questions), = jev.calls
    assert set(questions) == {"status", "target"}
    assert "로그인 시안" in state


@pytest.mark.parametrize("target_yes, expected", [(0.79, "unclear"), (0.1, "other")])
def test_a_target_that_is_not_clear_is_told_apart_by_the_no_probability(target_yes, expected):
    assert _verify_reply(FakeJev([_reply_ans(0.9, target_yes)]), others=["로그인 시안"])[1] == expected


def test_jev_sees_the_change_to_attach_to_this_task():
    jev = FakeJev([_reply_ans(0.9, 0.9)])
    verify_reply(LINES_REPLY, "API 명세서 작성", status="done", change="API 명세서 작성을 완료로 변경",
                 others=["로그인 시안"], today=TODAY, client=jev)
    (state, _), = jev.calls
    assert "API 명세서 작성을 완료로 변경" in state


def test_no_status_and_one_candidate_does_not_call_jev():
    jev = FakeJev()
    assert _verify_reply(jev, status=None) == ("inferred", "clear")
    assert jev.calls == []


def test_no_status_with_other_candidates_asks_only_the_target():
    jev = FakeJev([_reply_ans(target_yes=0.2)])
    assert _verify_reply(jev, status=None, others=["로그인 시안"]) == ("inferred", "other")
    (_, questions), = jev.calls
    assert set(questions) == {"target"}


def test_jev_sees_pm_lines_and_this_reply_but_not_the_earlier_reply():
    jev = FakeJev([_reply_ans(0.9)])
    _verify_reply(jev)
    (state, questions), = jev.calls
    assert "API 명세서 어떻게 됐어요?" in state and "로그인 시안은요?" in state
    assert "API 명세서는 다 했어요" in state
    assert "금요일까지요" not in state
    assert "태스크: API 명세서 작성" in state
    assert "제안 상태: done" in state
    assert "이 태스크에 대한 부분만" in questions["status"]["instructions"]


def test_done_is_yes_only_when_finishing_is_stated():
    done = REPLY_STATUS_CRITERIA["done"]
    assert all(word in done["yes"] for word in ("끝냈다", "완료했다", "다 했다"))
    assert all(word in done["no"] for word in ("올렸다", "넘겼다", "붙였다"))
    assert all(word in done["unclear"] for word in ("거의", "일부", "예정"))


def test_every_task_status_has_criteria():
    assert set(REPLY_STATUS_CRITERIA) == set(TASK_STATUSES)


@pytest.mark.parametrize("answers", [
    None,
    {},
    {"status": {"choice": "yes"}, "target": {"probabilities": {}}},
    {"status": {"probabilities": {"yes": "높음"}}, "target": {"probabilities": {"yes": "높음"}}},
])
def test_a_failed_reply_call_with_other_candidates_leaves_the_target_unclear(answers):
    assert _verify_reply(FakeJev([answers]), others=["로그인 시안"]) == ("inferred", "unclear")


def test_a_failed_reply_call_with_one_candidate_keeps_the_task():
    assert _verify_reply(FakeJev([None])) == ("inferred", "clear")


def test_a_status_yes_without_a_readable_target_is_not_certain():
    # 후보가 둘인데 대상을 확인하지 못했다. status 만 yes 라고 자동 반영으로 가면 안 된다
    answers = {**_reply_ans(0.95), "target": {"probabilities": {}}}
    assert _verify_reply(FakeJev([answers]), others=["로그인 시안"]) == ("inferred", "unclear")
