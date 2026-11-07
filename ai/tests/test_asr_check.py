"""전사 오인식 의심 단어 검사(judge/asr_check.py). 형태소 분석기(kiwipiepy)는 로컬이라 실제로 돌린다. API 는 없다."""

import pytest

from judge import asr_check as A
from judge.asr_check import Vocabulary, check_item, edit_distance, find_suspects, jamo, jamo_distance

MEMBERS = ["재환", "이자인", "지민", "하은"]
TITLES = ["로그인 화면 시안", "스토리북 정리", "Jev 연동", "결제 API 연동"]


@pytest.fixture(scope="module")
def vocab():
    return Vocabulary.build(members=MEMBERS, task_titles=TITLES, other_lines=["오늘은 배포 일정 얘기부터 할게요"])


def words(suspects):
    return [s["word"] for s in suspects]


# ── 자모·거리 ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("text, want", [
    ("배포", "ㅂㅐㅍㅗ"), ("애포", "ㅇㅐㅍㅗ"), ("값", "ㄱㅏㅄ"), ("닭", "ㄷㅏㄺ"), ("가", "ㄱㅏ"),
    ("API 연동", "API ㅇㅕㄴㄷㅗㅇ"), ("", ""),
])
def test_jamo_splits_syllables_and_keeps_other_characters(text, want):
    assert jamo(text) == want


@pytest.mark.parametrize("a, b, d", [("애포", "배포", 1), ("티자인", "디자인", 1), ("기획소", "기획서", 1),
                                     ("배포", "배포", 0), ("배포", "", 4), ("시안", "시앙", 1)])
def test_jamo_distance(a, b, d):
    assert jamo_distance(a, b)[0] == d


def test_normalized_distance_divides_by_the_longer_jamo_string():
    assert jamo_distance("애포", "배포") == (1, 0.25)


def test_edit_distance_is_symmetric():
    assert edit_distance("abc", "axbc") == edit_distance("axbc", "abc") == 1


# ── 의심 단어 ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("line, word, right", [
    ("애포문서 정리는 재환님이 맡아주세요", "애포", "배포"),       # 조사·복합어에 붙은 비단어
    ("티자인 시안 수정은 다음 주까지 할게요", "티자인", "디자인"),   # 아는 형태소로 잘못 쪼개짐
    ("기획소 초안 금요일까지 올릴게요", "기획소", "기획서"),
    ("테스뜨코드는 수요일부터 짤게요", "테스뜨", "테스트"),
    ("티자인시안 피드백 반영할게요", "티자인", "디자인"),
])
def test_injected_errors_are_flagged_with_the_right_candidate(vocab, line, word, right):
    suspects = check_item([line], None, vocab)
    hit = next(s for s in suspects if s["word"] == word)
    assert hit["source"] == "evidence"
    assert right in hit["candidates"]


@pytest.mark.parametrize("line", [
    "배포 문서 정리는 재환님이 맡아주세요",
    "디자인 시안 수정은 다음 주까지 할게요",
    "기획서 초안 금요일까지 올릴게요",
    "Jev 연동이랑 sweeper 수정 제가 할게요",           # 팀 용어·영문
    "회원가입 폼 밸리데이션 추가할게요",                 # 업무 용어 파일의 외래어
    "푸쉬 알림 테스트 해볼게요",                         # 흔한 변형 표기
    "스토리북 정리는 지민님이 맡는 걸로",                # 기존 태스크 제목의 말
    "다음주까지 마무리하고 금요일까지 공유할게요",       # 조사가 붙은 날짜("금요일까지")
    "이자인님이 디자인 시안 맡아주세요",                 # 팀원 이름
    "회의록 정리해서 노션에 올릴게요",
    "API 응답 형식 README 에 적어 둘게요 v2 기준으로",   # 영문·숫자는 보지 않는다
])
def test_clean_sentences_are_not_flagged(vocab, line):
    assert check_item([line], None, vocab) == []


def test_word_from_another_utterance_of_the_meeting_is_known():
    # "핀테크볼트"는 분석기가 모르는 말이지만, 같은 회의 다른 발화에 나왔으면 팀이 쓰는 말이다
    alone = Vocabulary.build()
    with_context = Vocabulary.build(other_lines=["핀테크볼트 연동 건은 다음에 봐요"])
    line = "핀테크볼트 대시보드 정리할게요"
    assert any(w.startswith("핀테크") for w in words(check_item([line], None, alone)))
    assert check_item([line], None, with_context) == []


def test_member_names_never_become_candidates():
    # "티자인"과 팀원 "이자인"은 "디자인"과 같은 거리지만 후보는 업무 단어만이다
    v = Vocabulary.build(members=["이자인"])
    [s] = check_item(["티자인 시안 수정"], None, v)
    assert "디자인" in s["candidates"] and "이자인" not in s["candidates"]


def test_error_only_in_evidence_is_caught_even_when_the_title_was_corrected(vocab):
    # 초안(Luna)이 제목에서 "배포"로 고쳐 써도 근거 원문의 "애포"는 남는다
    suspects = check_item(["금요일까지 애포 스크립트 정리해서 올릴게요"], "배포 스크립트 작성", vocab)
    assert words(suspects) == ["애포"] and suspects[0]["source"] == "evidence"


def test_error_in_title_only_is_tagged_title(vocab):
    suspects = check_item(["배포 스크립트 정리해서 올릴게요"], "애포 스크립트 작성", vocab)
    assert [(s["word"], s["source"]) for s in suspects] == [("애포", "title")]


def test_same_word_in_evidence_and_title_is_reported_once(vocab):
    assert words(check_item(["애포 스크립트 올릴게요"], "애포 스크립트 작성", vocab)) == ["애포"]


def test_one_letter_and_english_tokens_are_ignored(vocab):
    assert find_suspects("팝 API v2 QA", vocab, "evidence") == []


def test_real_word_errors_are_a_known_limit(vocab):
    # "배포"가 "대표"로 전사되면 실제 낱말이라 이 검사로는 잡지 못한다(평가의 realword 묶음)
    assert check_item(["대표 문서 정리는 재환님이 맡아주세요"], None, vocab) == []


def test_analyzer_failure_blocks_conservatively(vocab, monkeypatch, caplog):
    def boom(*a, **k):
        raise RuntimeError("분석기 오류")
    monkeypatch.setattr(A, "find_suspects", boom)
    with caplog.at_level("WARNING"):
        assert check_item(["배포 문서"], None, vocab) == A.failed()
    assert A.failed() == [{"word": "", "source": "check_failed", "candidates": []}]
    assert "auto 를 막는다" in caplog.text


def test_candidates_are_at_most_five_and_closest_first(vocab):
    [s] = check_item(["테스뜨 진행"], None, vocab)
    assert s["candidates"][0] == "테스트" and len(s["candidates"]) <= A.MAX_CANDIDATES


def test_terms_file_loads_and_skips_comments():
    terms = A.load_terms()
    assert {"배포", "디자인", "기획서", "밸리데이션"} <= terms
    assert not any(t.startswith("#") or not t.strip() for t in terms)
    assert "이자인" not in terms   # 팀원 이름은 파일에 두지 않는다
