from stt.turns import TurnTracker


def test_same_speaker_within_gap_joins_turn():
    t = TurnTracker(gap_ms=3_000)
    a = t.assign("kim", 0, 1_000)
    b = t.assign("kim", 2_000, 3_000)
    assert a == b


def test_same_speaker_after_gap_starts_new_turn():
    t = TurnTracker(gap_ms=3_000)
    a = t.assign("kim", 0, 1_000)
    b = t.assign("kim", 10_000, 11_000)
    assert a != b


def test_other_speaker_post_breaks_turn():
    """B 가 말한 뒤 A 의 옛 메시지를 편집하면 화면 순서가 실제 순서와 어긋난다."""
    t = TurnTracker(gap_ms=3_000)
    a = t.assign("kim", 0, 1_000)
    t.note_post("yoo")
    b = t.assign("kim", 2_000, 3_000)
    assert a != b


def test_different_speakers_get_different_turns():
    t = TurnTracker(gap_ms=3_000)
    assert t.assign("kim", 0, 1_000) != t.assign("yoo", 0, 1_000)


def test_max_segment_split_stays_one_turn():
    """25초 상한에 강제로 끊긴 독백은 같은 턴이다."""
    t = TurnTracker(gap_ms=3_000)
    a = t.assign("kim", 0, 25_000)
    b = t.assign("kim", 25_000, 40_000)
    assert a == b
