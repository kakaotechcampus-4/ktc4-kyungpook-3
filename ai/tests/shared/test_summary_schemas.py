"""요약 재료와 저장 본문의 타입. 모양의 정본은 backend/app/schemas/project_map.py 다."""

import pytest

from shared.schemas import SummaryClaim, SummaryInput, TopicDraft


def test_summary_input_parses_nested_rows_and_ignores_keys_it_does_not_know():
    parsed = SummaryInput.from_dict({
        "extraction_id": "e1", "meeting_id": "m1", "workspace_id": "w1", "title": None,
        "started_at": "2026-11-05T05:00:00Z", "later_key": 1,
        "lines": [{"seq": 1, "at_ms": 0, "speaker": "민수", "text": "안녕"}],
        "items": [{"item_id": "i", "action": "create", "title": "t", "assignee": None, "due_date": None}],
        "topics": [{"topic_id": "t", "name": "n", "description": ""}],
        "decisions": [{"decision_id": "d", "text": "x", "topic": "n", "decided_on": "2026-10-20"}],
    })
    assert parsed.lines[0].speaker == "민수" and parsed.items[0].item_id == "i"
    assert parsed.topics[0].name == "n" and parsed.decisions[0].decided_on == "2026-10-20"


def test_claim_parses():
    assert SummaryClaim.from_dict({"extraction_id": "e", "meeting_id": "m", "workspace_id": "w", "attempt": 2}).attempt == 2


def test_a_topic_needs_an_id_or_a_name():
    with pytest.raises(ValueError):
        TopicDraft(topic_id=None, name=None, description="", item_ids=[], decisions=[])
