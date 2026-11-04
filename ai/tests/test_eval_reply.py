"""답장 판단 평가의 채점과 사례 묶음. 실제 API 는 부르지 않는다."""

import sys

import pytest

from judge import eval_reply as E
from llm import NullLLM
from shared.schemas import TASK_STATUSES

META, CASES = E.load_cases()
SHAPES = {"한 질문 한 답", "여러 질문 한 답", "완료 명시", "명시 안 된 완료", "일부 완료", "진행 중", "막힘", "마감 연기",
          "관계없는 말", "후보 둘에 다 했어요", "앞 답장 문맥", "마감 지움", "후보 밖 말"}
FIELDS = {"status", "due_date", "unknown", "due_clear"}


def _status(task="t", value="done", evidence="certain"):
    return {"task_id": task, "field": "status", "new_value": value, "evidence_status": evidence}


def _want(task="t", field="status", value="done", auto=True):
    return {"task": task, "field": field, "value": value, "auto": auto}


def test_the_cases_are_marked_synthetic_and_cover_every_shape():
    assert META["synthetic"] is True
    assert 24 <= len(CASES) <= 30
    assert {c["shape"] for c in CASES} == SHAPES
    assert len({c["id"] for c in CASES}) == len(CASES)


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["id"])
def test_a_case_is_a_claim_with_a_consistent_answer(case):
    claim, expected = case["claim"], case["expected"]
    assert claim["lines"][-1]["sender"] == "member" and len(claim["lines"]) <= 12
    assert claim["candidates"]
    ids = {c["task_id"] for c in claim["candidates"]}
    for line in expected:
        assert line["field"] in FIELDS
        assert (line["task"] in ids) == (line["field"] in ("status", "due_date"))
        assert not line["auto"] or line["field"] == "status"
        assert line["field"] != "status" or line["value"] in TASK_STATUSES


def test_no_case_names_the_platform():
    text = E.CASES_PATH.read_text(encoding="utf-8").lower()
    assert "디스코드" not in text and "discord" not in text


def test_unstated_finishes_are_never_expected_to_be_automatic():
    for case in CASES:
        if case["shape"] == "명시 안 된 완료":
            assert case["expected"] and not any(line["auto"] for line in case["expected"])


def test_replaying_the_answers_scores_perfectly():
    rows = E.run_cases(CASES, 2, E._replay)
    report = "\n".join(E.summarize(rows))
    n = len(CASES) * 2
    assert f"나뉨 정확도: {n}/{n} (100.0%)" in report
    assert "잘못된 certain: 0건" in report and "놓친 자동 반영: 0건" in report
    assert "틀린 것" not in report


def test_a_certain_on_an_unstated_finish_is_a_false_certain():
    score = E.score_case([_want(auto=False)], [_status()])
    assert (score["split_ok"], score["autos"], score["right_autos"], score["false_certain"]) == (True, 1, 0, 1)


def test_a_certain_with_the_wrong_value_is_not_a_right_auto():
    score = E.score_case([_want(value="blocked")], [_status()])
    assert (score["value_ok"], score["right_autos"], score["false_certain"]) == (False, 0, 1)


def test_an_inferred_line_is_a_missed_auto_but_keeps_the_split():
    score = E.score_case([_want()], [_status(evidence="inferred")])
    assert (score["split_ok"], score["autos"], score["want_autos"], score["status_lines"]) == (True, 0, 1, 1)


def test_an_extra_or_missing_line_breaks_the_split():
    assert not E.score_case([_want()], [_status(), _status("u")])["split_ok"]
    assert not E.score_case([_want()], [])["split_ok"]


def test_a_failure_is_counted_and_named_by_kind():
    def boom(case):
        raise RuntimeError("x")

    rows = E.run_cases(CASES[:1], 1, boom)
    assert rows[0]["error"] == "RuntimeError" and rows[0]["changes"] == []
    assert "판단 실패: 1건" in E.summarize(rows)


def test_the_estimate_follows_the_cost_formula():
    case = {"claim": {"candidates": [{}, {}]},
            "expected": [_want("a"), _want("b", "due_date", "2026-11-13", False)]}
    assert E.estimate_calls([case], 3) == {"luna_stage1": 3, "terra": 6, "luna_draft": 6, "jev": 6}

    silent = {"claim": {"candidates": [{}]}, "expected": []}
    assert E.estimate_calls([silent], 1) == {"luna_stage1": 1, "terra": 1, "luna_draft": 1}


def _forbid_clients(monkeypatch):
    def forbidden(*a, **k):
        pytest.fail("클라이언트를 만들면 안 된다")

    monkeypatch.setattr(E, "get_llm", forbidden)
    monkeypatch.setattr(E, "get_jev", forbidden)
    monkeypatch.setattr(E, "judge_reply", forbidden)


@pytest.mark.parametrize("flag", ["--estimate", "--dry"])
def test_estimate_and_dry_touch_no_client(monkeypatch, tmp_path, capsys, flag):
    _forbid_clients(monkeypatch)
    monkeypatch.setattr(sys, "argv", ["eval_reply", flag, "--out", str(tmp_path / "out.json")])
    E.main()
    assert "사례" in capsys.readouterr().out


def test_a_live_run_without_keys_stops_before_any_call(monkeypatch):
    monkeypatch.setattr(E, "get_llm", lambda which: NullLLM())
    monkeypatch.setattr(E, "judge_reply", lambda claim: pytest.fail("키 없이 판단을 부르면 안 된다"))
    monkeypatch.setattr(sys, "argv", ["eval_reply"])
    with pytest.raises(SystemExit, match="키가 없습니다"):
        E.main()
