"""전사 지표(stt/eval/textmetrics.py). 글자 정렬 위에서 세는 순수 함수라 모델이 필요 없다."""

from stt.eval import textmetrics as T


# ─────────────────────────────────────────── 절대 오류
def test_char_errors_counts_edits_after_the_same_normalization_as_cer():
    e = T.char_errors("안녕하세요, 반갑습니다.", "안녕하세여 반갑 습니다")
    assert (e["errors"], e["sub"], e["del"], e["ins"], e["ref_chars"]) == (1, 1, 0, 0, 10)


def test_char_errors_handles_empty_sides():
    assert T.char_errors("네 맞아요", "")["errors"] == 4
    assert T.char_errors("", "감사합니다")["errors"] == 5


# ─────────────────────────────────────────── 문장 끝
def test_sentence_ends_are_counted_in_normalized_character_positions():
    # "가나." 뒤가 2, "다라?" 뒤가 4. 숫자 사이 점과 이어진 부호는 하나로 본다
    assert T.sentence_ends("가나. 다라?! 3.5 마") == [2, 4]
    assert T.sentence_ends("어... 그러니까") == [1]


def test_punctuation_counts_kept_and_invented_sentence_ends():
    p = T.punctuation("오늘 회의 합니다. 저부터 할게요. 끝.", "오늘 회의 합니다 저부터 할게요. 끝. 네.")
    assert (p["ref_ends"], p["hyp_ends"], p["matched"]) == (3, 3, 2)
    assert p["recall"] == 2 / 3 and p["precision"] == 2 / 3


def test_punctuation_at_clip_joins_separates_needed_and_unneeded_ends():
    """클립 셋을 이은 전사. 첫 이음은 정답에 마침표가 있고 둘째 이음은 문장 한가운데다."""
    ref = "오늘 회의 합니다. 저부터 말씀드리면 테스트를 돌렸습니다."
    segs = ["오늘 회의 합니다", "저부터 말씀드리면.", "테스트를 돌렸습니다."]
    p = T.punctuation(ref, " ".join(segs), segments=segs)
    assert p["joins"] == 2
    assert p["joins_needing_end"] == 1 and p["joins_needing_end_kept"] == 0
    assert p["joins_without_end"] == 1 and p["joins_invented_end"] == 1


# ─────────────────────────────────────────── 클립 가장자리
def test_edge_errors_split_errors_near_clip_edges_from_the_rest():
    ref = "가나다라마바사아자차카타파하"
    segs = ["가나다라마바사", "자차카타파하"]           # 둘째 클립 첫 글자 "아" 가 잘렸다
    e = T.edge_errors(ref, segs, window=1)
    assert e["edge_errors"] == 1 and e["inner_errors"] == 0
    assert e["edges"] == 4


# ─────────────────────────────────────────── 환각과 누설
def test_phrase_excess_counts_only_what_the_reference_does_not_have():
    got = T.phrase_excess("네 다들 감사합니다", "네 다들 감사합니다. 시청해 주셔서 감사합니다.",
                          ("감사합니다", "시청해주셔서"))
    assert got == {"감사합니다": 1, "시청해주셔서": 1, "total": 2}


def test_term_recall_is_case_and_space_insensitive():
    r = T.term_recall("large-v3-turbo 로 GPU 서버에서", "라지 v3 터보로 gpu 서버에서", ("large-v3-turbo", "GPU", "Notion"))
    assert (r["ref_terms"], r["hit"]) == (2, 1)


# ─────────────────────────────────────────── 발화 경계
def test_utterance_errors_catch_words_that_moved_into_the_neighbouring_utterance():
    """화자별로 이어 붙이면 순서가 같아 오류 0 이지만, 발화 단위로 보면 "라" 가 앞 발화로 옮겨 갔다."""
    truth = [{"speaker": "A", "text": "가나다.", "start": 0.0, "end": 1.0},
             {"speaker": "B", "text": "네.", "start": 1.1, "end": 1.4},
             {"speaker": "A", "text": "라마바.", "start": 1.6, "end": 2.6}]
    lines = [("A", 0, 1000, "가나다 라"), ("B", 1100, 1400, "네"), ("A", 1600, 2600, "마바")]
    got = T.utterance_errors(truth, lines)
    assert got == {"utt_err": 2, "unassigned_chars": 0}


def test_utterance_errors_count_lines_with_no_matching_utterance_as_insertions():
    truth = [{"speaker": "A", "text": "가나다.", "start": 0.0, "end": 1.0}]
    got = T.utterance_errors(truth, [("A", 0, 1000, "가나다"), ("A", 9000, 9500, "감사합니다")])
    assert got == {"utt_err": 5, "unassigned_chars": 5}
