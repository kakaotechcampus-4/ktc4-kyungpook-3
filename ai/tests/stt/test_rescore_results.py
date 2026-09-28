"""저장된 채점 결과 회귀. 레포에 넣은 정렬본 정답으로 score_*.json 을 다시 채점해 저장값과 같은지 본다.

모델도 API 도 부르지 않는다. 채점 기준(stt/eval/eval.py 의 정규화와 score, rescore 의 합산, 정답 fixture)이
모르고 바뀌면 여기서 걸린다. 기준을 일부러 바꿀 때는 eval.SCORING_VERSION 을 올린다. 그러면 옛 기준으로
채점한 결과는 실패 대신 건너뜀으로 보이고, 필요할 때 rescore 로 다시 채점해 git diff 로 수치 변화를 비교한다.
"""

import json
from pathlib import Path

import pytest

from stt.eval.eval import SCORING_VERSION
from stt.eval.rescore import mismatches, rescore, stale_reason

EVAL = Path(__file__).resolve().parents[2] / "stt" / "eval"
FIXTURES = EVAL / "fixtures"
RESULTS = EVAL / "results" / "2026-09-16-batch"
MEETINGS = ("meeting-01-aligned", "meeting-02-aligned")

TRUTH = {"가": "회의를 시작하겠습니다", "나": "네 좋습니다"}


def _saved(**extra):
    base = {"cer": 0.0, "cer_by_speaker": {"가": 0.0, "나": 0.0}, "insertion_rate": 0.0,
            "hyp_by_speaker": dict(TRUTH)}
    return {**base, **extra}


def test_rescore_writes_the_current_scoring_version():
    assert rescore(TRUTH, _saved())["scoring_version"] == SCORING_VERSION


def test_a_result_without_a_version_counts_as_the_first_version():
    reason = stale_reason(_saved())
    assert (reason is None) == (SCORING_VERSION == 1)


def test_a_result_scored_under_another_version_is_stale_with_both_versions_named():
    reason = stale_reason(_saved(scoring_version=SCORING_VERSION + 1))
    assert reason is not None
    assert str(SCORING_VERSION + 1) in reason and str(SCORING_VERSION) in reason


def test_a_same_version_result_that_no_longer_reproduces_lists_the_fields():
    wrong = _saved(scoring_version=SCORING_VERSION, cer=0.5)
    assert mismatches(TRUTH, wrong) == ["cer"]
    assert mismatches(TRUTH, _saved(scoring_version=SCORING_VERSION)) == []


def _score_files(meeting):
    return sorted((RESULTS / meeting).glob("score_*.json"))


def test_every_meeting_has_truth_and_saved_scores():
    for meeting in MEETINGS:
        assert (FIXTURES / meeting / "truth_by_speaker.json").is_file(), meeting
        assert _score_files(meeting), meeting        # 경로가 틀려 아무것도 안 돌고 통과하는 것을 막는다


@pytest.mark.parametrize("meeting,path", [
    pytest.param(m, p, id=f"{m}/{p.name}") for m in MEETINGS for p in _score_files(m)
])
def test_saved_score_matches_rescore_with_repo_truth(meeting, path):
    saved = json.loads(path.read_text(encoding="utf-8"))
    reason = stale_reason(saved)
    if reason:
        pytest.skip(reason)
    truth = json.loads((FIXTURES / meeting / "truth_by_speaker.json").read_text(encoding="utf-8"))
    assert mismatches(truth, saved) == []
