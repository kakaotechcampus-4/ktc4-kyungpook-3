from shared.schemas import JudgeFinding, JudgeInput, NotionCandidate, Transcript, TranscriptSegment


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


def test_judge_finding_defaults():
    f = JudgeFinding(text="이번 주 금요일까지 끝낼게요")
    assert f.source == "meeting"
    assert f.seq == 0
    assert f.speaker is None
    assert f.reason == ""
    assert f.method == "rules"


def test_judge_finding_roundtrip():
    f = JudgeFinding(
        text="이번 주 금요일까지 끝낼게요",
        source="meeting",
        seq=12,
        speaker="mem_dongwoo",
        reason="실행 의지 종결 표현 매치",
        method="rules",
    )
    assert JudgeFinding.from_dict(f.to_dict()) == f


def test_notion_candidate_defaults():
    c = NotionCandidate(notion_page_id="page_1")
    assert c.task_id is None
    assert c.title == ""
    assert c.similarity == 0.0


def test_notion_candidate_roundtrip():
    c = NotionCandidate(
        notion_page_id="page_1",
        task_id="task_1",
        title="로그인 화면 시안",
        content_snippet="로그인 화면 시안 작업 중",
        assignee_member_id="mem_dongwoo",
        due_date="2026-09-11",
        status="in_progress",
        similarity=0.82,
        updated_at="2026-09-10T12:00:00+00:00",
    )
    assert NotionCandidate.from_dict(c.to_dict()) == c


def test_judge_input_defaults_to_empty_candidates():
    ji = JudgeInput(source="meeting", text="이번 주 금요일까지 끝낼게요")
    assert ji.candidates == []


def test_judge_input_roundtrip_with_candidates():
    ji = JudgeInput(
        source="meeting",
        text="이번 주 금요일까지 끝낼게요",
        candidates=[NotionCandidate(notion_page_id="page_1", similarity=0.7)],
    )
    restored = JudgeInput.from_dict(ji.to_dict())
    assert restored == ji
