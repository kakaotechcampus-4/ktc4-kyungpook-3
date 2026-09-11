from shared.schemas import Transcript, TranscriptSegment


def test_transcript_roundtrip_and_merge():
    t = Transcript.from_dict({"segments": [
        {"speaker": "2", "start": 3.0, "end": 4.0, "text": "둘째"},
        {"speaker": "1", "start": 0.0, "end": 1.0, "text": "첫째"},
    ]})
    assert t.merged_text() == "첫째 둘째"
    assert Transcript.from_dict(t.to_dict()) == t


def test_transcript_segment_unknown_keys_ignored():
    seg = TranscriptSegment.from_dict(
        {"speaker": None, "start": 0, "end": 1, "text": "x"}
    )
    assert isinstance(seg.speaker, type(None))
