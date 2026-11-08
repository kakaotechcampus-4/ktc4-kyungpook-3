"""Jev 근거 평가 도구(judge/eval_evidence.py)와 대사 데이터(judge/golden_set_evidence/) 검사. 실제 Jev 는 부르지 않는다.

대사 라벨이 틀리면 평가 수치가 전부 틀린다. 날짜·요일·라벨 모양처럼 코드로 확인할 수 있는 것은 여기서 지킨다.
"""

import re
from datetime import date

import pytest

from jev import FakeJev
from judge import eval_evidence as E

TODAY, CASES = E.load_cases()
WEEKDAYS = "월화수목금토일"
CATEGORIES = {"기존", "A", "B", "C", "D", "E", "F", "G", "H"}


def _ans(task=None, due=None):
    out = {}
    if task is not None:
        out["task"] = {"choice": "yes" if task >= 0.5 else "no", "probabilities": {"yes": task}}
    if due is not None:
        out["due"] = {"choice": "yes" if due >= 0.5 else "no", "probabilities": {"yes": due}}
    return out


# ── 대사 데이터 ────────────────────────────────────────────────────────────


def test_both_sets_load_with_one_meeting_date():
    assert TODAY == date(2026, 11, 2) and TODAY.weekday() == 0
    sets = {c["set"] for c in CASES}
    assert sets == {"base", "extended"}
    assert len([c for c in CASES if c["set"] == "base"]) == 28
    assert len(CASES) >= 200   # #382 리뷰: 19개 대사로는 0.8 을 판단할 수 없었다


def test_names_and_sentences_are_unique():
    names = [(c["set"], c["name"]) for c in CASES]
    assert len(names) == len(set(names))
    first_lines = [" ".join(c["lines"]) + "|" + c["task"] + "|" + str(c["due_date"]) for c in CASES]
    assert len(first_lines) == len(set(first_lines))


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"{c['set']}:{c['name']}")
def test_case_shape(case):
    assert case["category"] in CATEGORIES
    assert case["lines"] and all(isinstance(x, str) and x.strip() for x in case["lines"])
    assert isinstance(case["task"], str) and case["task"].strip()
    assert isinstance(case["expect_task"], bool)
    # 마감을 묻지 않는 대사는 due 기대값이 없고, 묻는 대사는 반드시 있다
    if case["due_date"] is None and case["due_raw"] is None:
        assert case["expect_due"] is None
    else:
        assert isinstance(case["expect_due"], bool)
    if case["due_date"] is not None:
        d = date.fromisoformat(case["due_date"])
        assert d.year in (2026, 2027)


@pytest.mark.parametrize("case", [c for c in CASES if c["set"] == "extended" and not c["expect_task"]],
                         ids=lambda c: c["name"])
def test_extended_unconfirmed_tasks_do_not_ask_due(case):
    # 할 일이 확정이 아닌 대사에서 마감 라벨을 붙이면 무엇을 재는지 흐려진다. 확장 세트는 마감을 비워 둔다
    assert case["due_date"] is None and case["expect_due"] is None


def _named_weekday(raw: str) -> int | None:
    m = re.search(r"([월화수목금토일])(요일|욜)", raw)
    return WEEKDAYS.index(m.group(1)) if m else None


@pytest.mark.parametrize("case", [c for c in CASES if c["expect_due"] is True], ids=lambda c: f"{c['set']}:{c['name']}")
def test_certain_due_dates_match_the_named_weekday_and_are_not_past(case):
    d = date.fromisoformat(case["due_date"])
    assert d >= TODAY
    wd = _named_weekday(case["due_raw"] or "")
    if wd is not None:
        assert d.weekday() == wd, f"{case['due_raw']} 인데 {d} 는 {WEEKDAYS[d.weekday()]}요일"


def test_sets_have_enough_negatives():
    # 잘못된 certain(auto 로 새는 쪽)을 재려면 정답이 False 인 대사가 충분해야 한다
    task_neg = sum(1 for c in CASES if c["expect_task"] is False)
    due_neg = sum(1 for c in CASES if c["expect_due"] is False)
    assert task_neg >= 70 and due_neg >= 40


# ── 지표 ──────────────────────────────────────────────────────────────────


def test_wilson_upper_gives_a_ceiling_even_for_zero_errors():
    assert E.wilson_upper(0, 0) is None
    assert E.wilson_upper(0, 19) == pytest.approx(0.168, abs=0.002)   # 예전 표본: 0건이어도 최대 17%
    assert E.wilson_upper(0, 100) == pytest.approx(0.037, abs=0.002)
    assert E.wilson_upper(5, 100) > 0.05


def _row(want, p, field="task", case="c", category="A", run=0, set_="extended"):
    return {"set": set_, "case": case, "category": category, "field": field, "run": run, "want": want,
            "p_yes": p, "choice": None}


def test_score_counts_false_and_missed_certain_at_the_threshold():
    rows = [_row(True, 0.95), _row(True, 0.79), _row(False, 0.81), _row(False, 0.2), _row(False, None),
            _row(True, None)]
    m = E.score(rows, 0.8)["task"]
    assert (m["n"], m["positives"], m["negatives"]) == (6, 3, 3)
    assert m["false_certain"] == 1 and m["missed_certain"] == 2   # 응답 없음은 certain 이 아니다
    assert m["correct"] == 3
    assert m["precision"] == pytest.approx(0.5)
    assert m["recall"] == pytest.approx(1 / 3)
    assert E.score(rows, 0.9)["task"]["false_certain"] == 0


def test_threshold_sweep_moves_errors_in_opposite_directions():
    rows = [_row(True, p) for p in (0.72, 0.83, 0.97)] + [_row(False, p) for p in (0.78, 0.86)]
    low, high = E.score(rows, 0.7)["task"], E.score(rows, 0.9)["task"]
    assert low["false_certain"] > high["false_certain"]
    assert low["missed_certain"] < high["missed_certain"]


def test_unstable_lists_cases_whose_verdict_flips_between_runs():
    rows = [_row(True, 0.82, case="흔들림", run=0), _row(True, 0.78, case="흔들림", run=1),
            _row(True, 0.95, case="안정", run=0), _row(True, 0.91, case="안정", run=1)]
    assert [u["case"] for u in E.unstable(rows, 0.8)] == ["흔들림"]


def test_by_category_counts_sentences_not_runs():
    # C: 부정 대사 2개(하나는 3회 중 1회 certain, 하나는 안전) + 정답 True 대사 1개는 부정 분모에 섞이면 안 된다
    rows = [_row(False, 0.9 if i == 0 else 0.1, case="새는것", category="C", run=i) for i in range(3)]
    rows += [_row(False, 0.1, case="안전", category="C", run=i) for i in range(3)]
    rows += [_row(True, 0.1, case="놓침", category="C", run=i) for i in range(3)]
    rows += [_row(True, 0.9, case="맞음", category="A")]
    cats = E.by_category(rows, 0.8)
    c = cats["C"]
    assert (c["negatives"], c["false_certain"], c["positives"], c["missed_certain"]) == (2, 1, 1, 1)
    assert (c["runs"], c["false_certain_runs"], c["missed_certain_runs"]) == (9, 1, 3)
    assert c["false_certain_rate_upper95"] == E.wilson_upper(1, 2)
    assert cats["A"]["negatives"] == 0 and cats["A"]["false_certain_rate_upper95"] is None
    assert cats["A"]["positives"] == 1 and cats["A"]["missed_certain"] == 0


def test_by_category_keeps_task_and_due_sentences_apart():
    # 같은 대사의 task·due 는 서로 다른 판정이라 따로 센다
    rows = [_row(True, 0.9, field="task", case="x", category="D"), _row(False, 0.1, field="due", case="x", category="D")]
    d = E.by_category(rows, 0.8)["D"]
    assert (d["negatives"], d["positives"]) == (1, 1)


# ── 실행 ──────────────────────────────────────────────────────────────────


def test_run_asks_due_only_when_a_due_date_is_given_and_repeats():
    cases = [
        {"set": "s", "name": "마감 있음", "category": "A", "lines": ["금요일까지 할게요"], "task": "일",
         "due_date": "2026-11-06", "due_raw": "금요일까지", "expect_task": True, "expect_due": True},
        {"set": "s", "name": "마감 없음", "category": "B", "lines": ["제가 할게요"], "task": "일",
         "due_date": None, "due_raw": None, "expect_task": True, "expect_due": None},
    ]
    jev = FakeJev([_ans(0.9, 0.9), _ans(0.8, 0.7), _ans(0.95), None])
    rows = E.run(cases, TODAY, 2, jev)
    assert [set(q) for _, q in jev.calls] == [{"task", "due"}, {"task", "due"}, {"task"}, {"task"}]
    assert len(rows) == 2 * 2 + 2 * 1
    assert rows[-1]["p_yes"] is None   # 응답이 없으면 확률 없음
    s = E.summarize(rows, cases, 2)
    assert s["calls"] == 4 and s["no_answer"] == 1
    assert [u["field"] for u in s["unstable"]] == ["due", "task"]   # 0.9→0.7, 0.95→None


def test_sentence_level_counts_each_sentence_once_and_widens_the_ceiling():
    # 같은 대사가 3회 모두 틀려도 잘못된 대사는 1개다. 실행 단위(3/249)보다 신뢰 상한이 넓다(#382 재리뷰)
    rows = [_row(False, 0.97, case="틀림", run=i) for i in range(3)]
    rows += [_row(False, 0.1, case=f"맞음{j}", run=i) for j in range(82) for i in range(3)]
    by_run, by_sentence = E.score(rows, 0.8)["task"], E.score_by_sentence(rows, 0.8)["task"]
    assert (by_run["false_certain"], by_run["negatives"]) == (3, 249)
    assert (by_sentence["false_certain"], by_sentence["negatives"]) == (1, 83)
    assert by_sentence["false_certain_rate_upper95"] > by_run["false_certain_rate_upper95"]
    assert by_sentence["false_certain_rate_upper95"] == pytest.approx(0.065, abs=0.003)


def test_sentence_counts_as_wrong_if_any_run_is_wrong():
    rows = [_row(False, 0.79, case="흔들림", run=0), _row(False, 0.81, case="흔들림", run=1),
            _row(True, 0.85, case="맞음", run=0), _row(True, 0.78, case="맞음", run=1)]
    m = E.score_by_sentence(rows, 0.8)["task"]
    assert (m["false_certain"], m["missed_certain"]) == (1, 1)

