from shared.schemas import Member, Transcript, TranscriptSegment


def test_transcript_roundtrip_and_merge():
    t = Transcript.from_dict({"segments": [
        {"speaker": "2", "start": 3.0, "end": 4.0, "text": "둘째"},
        {"speaker": "1", "start": 0.0, "end": 1.0, "text": "첫째"},
    ]})
    assert t.merged_text() == "첫째 둘째"
    assert Transcript.from_dict(t.to_dict()) == t


def test_member_platform_id_alias_and_unknown_keys_ignored():
    m = Member.from_dict({"member_id": "m1", "display_name": "민수", "discord_user_id": "111", "extra": 1})
    assert m.platform_user_id == "111"
    assert m.role == "member"
    assert isinstance(TranscriptSegment.from_dict({"speaker": None, "start": 0, "end": 1, "text": "x"}).speaker, type(None))


def test_transcript_segment_has_seq():
    from shared.schemas import TranscriptSegment

    s = TranscriptSegment(speaker="123", start=1.0, end=2.5, text="네", seq=7)
    assert s.seq == 7
    assert s.to_dict()["seq"] == 7


def test_transcript_segment_seq_defaults_to_zero():
    from shared.schemas import TranscriptSegment

    s = TranscriptSegment(speaker="123", start=1.0, end=2.5, text="네")
    assert s.seq == 0


def test_transcript_segment_from_dict_without_seq():
    from shared.schemas import TranscriptSegment

    s = TranscriptSegment.from_dict({"speaker": "1", "start": 0.0, "end": 1.0, "text": "x"})
    assert s.seq == 0
