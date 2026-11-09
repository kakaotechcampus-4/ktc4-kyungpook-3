"""평가 도구(extract/eval_golden_set.py)의 이름 비교·1인칭 오분류 집계 검사. 실제 LLM 은 부르지 않는다.

test_name_candidates_match_backend 의 표는 backend/tests/services/test_matching_alias.py 의
test_name_candidates 표와 같다. 바꾸면 둘 다 바꾼다.
"""

from collections import Counter
from datetime import date

import pytest

from extract.eval_golden_set import (
    GoldCase,
    GoldSentence,
    _name_candidates,
    _names_match,
    load_speaker_cases,
    run,
    tally_first_person,
)
from shared.schemas import ExtractedTask, Transcript, TranscriptSegment


@pytest.mark.parametrize(
    "text, expected",
    [
        ("하은이가", ["하은이가", "하은이", "하은"]),
        ("지민님이", ["지민님이", "지민님", "지민"]),
        ("하은님", ["하은님", "하은", "하"]),
        ("환은", ["환은", "환"]),
        ("  동우 ", ["동우"]),
        ("", []),
        (None, []),
        ("님", ["님"]),
        # 띄어 쓴 님: 떼고 남은 공백을 지운다(#463 리뷰). "환 님이"는 AI 프롬프트 예시다
        ("환 님이", ["환 님이", "환 님", "환"]),
        ("지민 님", ["지민 님", "지민"]),
        # 띄어 쓴 호칭도 붙여 쓴 "하은님"과 같은 후보를 만든다(뗀 뒤 끝 공백이 남아 조사 "은"에 안 걸리던 것을 맞춘다)
        ("  하은  님 ", ["하은 님", "하은", "하"]),
        ("BE  리더가", ["BE 리더가", "BE 리더"]),
        # 조사를 떼고 "이"로 끝나면 "이"를 한 번 더 뗀 것도 후보다(#463 리뷰). "이가"만 한 덩어리 조사라 되던 것을 넓힌다
        ("하은이는", ["하은이는", "하은이", "하은"]),
        ("하은이를", ["하은이를", "하은이", "하은"]),
        ("하은이한테", ["하은이한테", "하은이", "하은"]),
        ("하은이에게", ["하은이에게", "하은이", "하은"]),
        ("하은이께서", ["하은이께서", "하은이", "하은"]),
        ("세이가", ["세이가", "세이", "세"]),
        ("지민이", ["지민이", "지민"]),
        # "씨"도 "님"과 같은 호칭이다(#463 리뷰). 띄어 쓰든 붙이든, 조사가 붙든 떼든 이름까지 닿는다
        ("민수 씨", ["민수 씨", "민수"]),
        ("민수씨", ["민수씨", "민수"]),
        ("민수씨가", ["민수씨가", "민수씨", "민수"]),
        ("민수 씨는", ["민수 씨는", "민수 씨", "민수"]),
        ("김씨", ["김씨", "김"]),
        ("씨", ["씨"]),
        # 호칭(님·씨)을 뗀 뒤에도 "이"를 한 번 더 뗀다. 띄어 쓴 호칭은 뗀 뒤 끝 공백을 지운다(#463 리뷰)
        ("하은이님이", ["하은이님이", "하은이님", "하은이", "하은"]),
        ("하은이 씨는", ["하은이 씨는", "하은이 씨", "하은이", "하은"]),
        ("하은이 님", ["하은이 님", "하은이", "하은"]),
        ("하은이님", ["하은이님", "하은이", "하은"]),
        ("하은이 님께서", ["하은이 님께서", "하은이 님", "하은이", "하은"]),
    ],
)
def test_name_candidates_match_backend(text, expected):
    assert _name_candidates(text) == set(expected)


def test_names_match_spaced_honorific():
    assert _names_match("환 님이", "환")


def _gold(sentences: list[GoldSentence], case_id: str = "g/c1") -> GoldCase:
    segs = [TranscriptSegment(speaker="지민", start=float(i), end=float(i) + 0.9, text=s.text)
            for i, s in enumerate(sentences)]
    return GoldCase(
        case_id=case_id, scenario="s", description="d", reference_date=date(2026, 11, 9),
        speaker_names={"지민": "지민"}, transcript=Transcript(segments=segs, source="meeting"),
        sentences=sentences,
    )


def _pred(sentence: str, assignee_type: str = "first", mention: str | None = None) -> ExtractedTask:
    return ExtractedTask(task="t", assignee_member_id=None, due_date=None, source_sentence=sentence,
                         assignee_type=assignee_type, assignee_mention=mention)


def _first_person_case() -> tuple[GoldCase, list[ExtractedTask]]:
    case = _gold([
        GoldSentence("문서는 제가 정리할게요.", True, "first"),
        GoldSentence("배포는 제가 할게요.", True, "first"),
        GoldSentence("테스트는 제가 돌릴게요.", True, "first"),  # 예측 없음(놓침)
        GoldSentence("로그인은 하은이 맡아요.", True, "thirdname"),
    ])
    preds = [
        _pred("문서는 제가 정리할게요.", "first"),
        _pred("배포는 제가 할게요.", "thirdname", "제가"),
        _pred("로그인은 하은이 맡아요.", "first"),  # 정답이 first 가 아니면 세지 않는다
    ]
    return case, preds


def test_load_speaker_cases_reads_both_sets():
    # judge 세트에 케이스를 더해도 깨지지 않게 건수는 고정하지 않는다(#607 리뷰)
    cases = load_speaker_cases()
    assert {c.case_id.split("/")[0] for c in cases} == {"speaker_dev", "speaker_test"}
    types = Counter(s.assignee_type for c in cases for s in c.sentences if s.assignee_type)
    assert types["first"] > 0
    assert cases[0].case_id.startswith("speaker_dev/")


def test_tally_counts_first_person_misclassified_as_thirdname():
    case, preds = _first_person_case()
    t = tally_first_person(case, preds)
    assert t.total == 2  # 놓친 문장은 분모에 넣지 않는다
    assert t.by_type == {"first": 1, "thirdname": 1}
    assert len(t.mistakes) == 1 and "'제가'" in t.mistakes[0]


def test_run_returns_first_person_summary_without_llm():
    case, preds = _first_person_case()
    bad = _gold([GoldSentence("x는 제가 할게요.", True, "first")], case_id="g/c2")

    def extract_fn(c: GoldCase) -> list[ExtractedTask]:
        if c is bad:
            raise RuntimeError("api down")
        return preds

    result = run("stub", extract_fn, cases=[case, bad])
    assert result["errors"] == 1
    assert result["first_person"]["total"] == 2
    assert result["first_person"]["by_type"] == {"first": 1, "thirdname": 1}
    assert len(result["first_person"]["mistakes"]) == 1
    assert result["overall"]["tp"] == 3 and result["overall"]["fn"] == 1
    assert set(result["overall"]) == {"tp", "fp", "fn", "tn", "type_correct", "type_total"}


def test_run_without_errors_reports_zero_errors():
    case, preds = _first_person_case()
    assert run("stub", lambda c: preds, cases=[case])["errors"] == 0


def test_speaker_set_case_feeds_only_first_person_tally():
    """speaker 세트 케이스는 1인칭 집계에만 들어가고 P/R·타입·담당자·마감 합계에는 들어가지 않는다."""
    legacy = _gold([GoldSentence("문서는 제가 정리할게요.", True, "first")], case_id="g/c1")
    speaker = _gold([
        GoldSentence("배포는 제가 할게요.", True, "first"),
        GoldSentence("점심 뭐 먹을까요?", False),
    ], case_id="speaker_dev/c1")
    speaker.from_speaker_set = True

    def extract_fn(c: GoldCase) -> list[ExtractedTask]:
        if c is legacy:
            return [_pred("문서는 제가 정리할게요.", "first")]
        return [_pred("배포는 제가 할게요.", "thirdname", "제가"), _pred("점심 뭐 먹을까요?", "first")]

    result = run("stub", extract_fn, cases=[legacy, speaker])
    # 합계에는 legacy 케이스(tp 1)만 들어간다. speaker 의 tp 1·fp 1 은 더하지 않는다
    assert result["overall"] == {"tp": 1, "fp": 0, "fn": 0, "tn": 0, "type_correct": 1, "type_total": 1}
    # 1인칭 집계에는 두 세트 모두 들어간다
    assert result["first_person"]["total"] == 2
    assert result["first_person"]["by_type"] == {"first": 1, "thirdname": 1}


def test_load_speaker_cases_marks_speaker_set():
    cases = load_speaker_cases()
    assert cases and all(c.from_speaker_set for c in cases)


def test_speaker_set_case_prints_no_per_case_scores_or_mismatches(capsys):
    """speaker 세트는 담당자 언급·마감 정답이 없어 케이스별 P/R 과 -v 불일치가 가짜다. 1인칭 줄만 남긴다(#607 리뷰)."""
    speaker = _gold([GoldSentence("배포는 제가 할게요.", True, "first")], case_id="speaker_dev/c1")
    speaker.from_speaker_set = True

    run("stub", lambda c: [_pred("배포는 제가 할게요.", "thirdname", "제가")], cases=[speaker], verbose=True)

    out = capsys.readouterr().out
    assert "speaker_dev/c1" not in out.split("-- 1인칭")[0]  # 케이스별 줄·불일치 출력이 없다
    assert "[필드]" not in out
    assert "'제가'" in out  # 1인칭 오분류 목록에는 나온다
