from shared.schemas import (
    DraftResult,
    DraftStructured,
    JudgeFinding,
    JudgeInput,
    NotionCandidate,
    Transcript,
    TranscriptSegment,
)


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
    assert f.evidence == []
    assert f.indices == []
    assert f.source == "meeting"
    assert f.seq == 0
    assert f.speaker is None
    assert f.reason == ""
    assert f.method == "rules"
    # 이후 단계가 채우는 칸 — 1단계에서는 "아직 판정 전"을 뜻하는 None 이어야 한다
    assert f.assignee_type is None
    assert f.evidence_status is None


def test_judge_finding_roundtrip():
    f = JudgeFinding(
        text="로그인 화면 마감을 다음 주 화요일로 연기하는 데 동의함",
        evidence=["로그인 화면 마감을 다음 주 화요일로 미루는 게 어때요?", "네, 알겠습니다."],
        indices=[4, 5],
        source="meeting",
        seq=12,
        speaker="mem_dongwoo",
        reason="일정 변경 합의",
        method="llm",
        assignee_type="first",
        evidence_status="certain",
    )
    assert JudgeFinding.from_dict(f.to_dict()) == f


def test_notion_candidate_defaults():
    c = NotionCandidate(notion_page_id="page_1")
    assert c.task_id is None
    assert c.title == ""
    assert c.similarity == 0.0


def test_notion_candidate_page_id_is_optional():
    # Notion 동기화 전인 Task 는 페이지가 없다 — 유사 검색 응답(#102)이 null 로 준다
    c = NotionCandidate.from_dict({"task_id": "task_1", "notion_page_id": None, "title": "로그인 화면 시안"})
    assert c.notion_page_id is None
    assert NotionCandidate(task_id="task_1").notion_page_id is None


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


def test_draft_structured_defaults_mean_no_change():
    # None 은 "바꾸지 않음" — update 에서 채우지 않은 필드가 승인 payload 에 들어가면 안 된다
    s = DraftStructured()
    assert s.task is None
    assert s.due_date is None


def test_draft_result_roundtrip():
    d = DraftResult(
        structured=DraftStructured(task="결제 환불 기능 구현", due_date="2026-10-05"),
        doc_text="결제 환불 기능을 지민님이 10/5까지 구현하기로 함",
    )
    assert d.method == "llm"
    assert d.to_dict()["structured"] == {"task": "결제 환불 기능 구현", "due_date": "2026-10-05"}
    assert DraftResult.from_dict(d.to_dict()) == d


def test_draft_result_from_dict_without_structured():
    # update 에서 바뀐 필드가 없어 structured 가 비어 와도 기본값(전부 None)으로 복원된다
    d = DraftResult.from_dict({"doc_text": "검색 성능 개선 작업 완료"})
    assert d.structured == DraftStructured()
    assert d.method == "llm"
