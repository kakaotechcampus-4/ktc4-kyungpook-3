"""전사 오인식 검사(judge/asr_check.py). 형태소 분석기(kiwipiepy)는 로컬이라 실제로 돌린다. Jev 는 부르지 않는다."""

import pytest

from judge import asr_check as A


# ── 자모·거리 ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("text, want", [
    ("배포", "ㅂㅐㅍㅗ"), ("애포", "ㅇㅐㅍㅗ"), ("값", "ㄱㅏㅄ"), ("가", "ㄱㅏ"), ("API 연동", "API ㅇㅕㄴㄷㅗㅇ"), ("", ""),
])
def test_jamo_splits_syllables_and_keeps_other_characters(text, want):
    assert A.jamo(text) == want


@pytest.mark.parametrize("a, b, d", [("애포", "배포", 1), ("티자인", "디자인", 1), ("배포", "배포", 0), ("배포", "", 4)])
def test_jamo_distance(a, b, d):
    assert A.jamo_distance(a, b)[0] == d


def test_edit_distance_is_symmetric():
    assert A.edit_distance("ㄱㄴㄷ", "ㄱㄷ") == A.edit_distance("ㄱㄷ", "ㄱㄴㄷ") == 1


# ── 1단계: 목록에 없는 제목 명사 ─────────────────────────────────────────────


def test_nouns_are_hangul_common_and_proper_nouns_only():
    assert A.nouns("배포 문서를 API 로 금요일까지 정리해 주세요") >= {"배포", "문서", "금요일"}
    assert "API" not in A.nouns("API 연동") and "주세요" not in A.nouns("정리해 주세요")


def test_seed_nouns_follow_the_analyzer_frequency_order():
    # 분석기 형태소 번호가 대체로 빈도 순이라는 모델 동작에 기댄다. kiwipiepy 를 올리면 이 테스트가 먼저 알린다
    seed = A.seed_nouns(1000)
    assert {"시간", "대표"} <= seed and "시앙" not in seed
    assert seed <= A.seed_nouns(5000)


def test_base_vocab_has_the_terms_file_and_common_task_nouns():
    v = A.base_vocab()
    assert {"배포", "문서", "정리", "구현"} <= v


def test_suspects_are_title_nouns_off_the_list():
    v = A.base_vocab()
    assert A.suspects("애포 문서 정리", v) == ["애포"]
    assert A.suspects("배포 문서 정리", v) == []
    assert A.suspects(None, v) == []


def test_team_nouns_need_two_different_speakers():
    lines = [("a", "애포 일정 봐요"), ("a", "애포 다시 봐요"), ("b", "핀테크볼트 정산"), ("c", "핀테크볼트 정산")]
    team = A.team_nouns(lines + [(None, "콜린스 문서")])
    assert "핀테크볼트" in team and "애포" not in team and "콜린스" not in team


def test_candidates_are_close_list_words_and_at_most_five():
    assert A.candidates("애포", A.base_vocab()) == ["배포"]
    many = [f"배포{i}" for i in range(10)] + ["대포", "애표", "해포", "새포", "매포", "개포"]
    assert len(A.candidates("애포", many)) == A.MAX_CANDIDATES


# ── 2단계: Jev 답에서 asr_suspects ──────────────────────────────────────────


def _answers(*ps):
    return {f"asr{i}": {"probabilities": {"yes": p, "no": 1 - p, "unclear": 0.0}} for i, p in enumerate(ps)}


def test_questions_are_keyed_in_order_and_carry_the_candidates():
    qs = A.questions({"애포": ["배포"], "짐도": []})
    assert list(qs) == ["asr0", "asr1"]
    assert "'애포'" in qs["asr0"]["instructions"] and "배포" in qs["asr0"]["instructions"]
    assert set(qs["asr1"]["criteria"]) == {"yes", "no", "unclear"}


def test_verdict_keeps_words_below_the_threshold():
    words = {"애포": ["배포"], "짐도": ["진도"]}
    out = A.verdict(words, _answers(0.2, 0.95), threshold=0.8)
    assert out == [{"word": "애포", "source": "title", "candidates": ["배포"]}]
    assert A.verdict(words, _answers(0.8, 0.8), threshold=0.8) == []        # 기준값은 통과


def test_verdict_missing_answer_counts_as_not_confirmed():
    assert [s["word"] for s in A.verdict({"애포": []}, {})] == ["애포"]


def test_verdict_failed_call_blocks_and_no_words_is_clean():
    assert A.verdict({"애포": []}, None) == A.failed()
    assert A.verdict({}, None) == []


def test_verdict_cuts_long_words_for_the_be_limit():
    # BE 는 word 100자 넘으면 요청 전체를 400 으로 거절한다(#532 리뷰)
    [s] = A.verdict({"애포" * 60: []}, _answers(0.1))
    assert len(s["word"]) == A.MAX_WORD_LEN


def test_terms_file_loads_and_skips_comments():
    terms = A.load_terms()
    assert "배포" in terms and not any(t.startswith("#") for t in terms)
