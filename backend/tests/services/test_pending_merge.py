"""승인 대기 task_create 카드에 항목을 합치는 규칙(순수 함수) 테스트."""

import json
from datetime import UTC, date, datetime

from app.models.models import ApprovalRequest, ApprovalStatus, ApprovalType
from app.services import pending_merge
from app.services.pending_merge import assignee_item_of, merge_into_pending, merge_target_problem

NOW = datetime(2026, 11, 7, 3, 0, tzinfo=UTC)
EVIDENCE = {
    "evidence_quote": "다음 주 금요일까지 하죠",
    "evidence_speaker": "1234",
    "evidence_speaker_member_id": "mem-2",
    "evidence_at_ms": 4200,
}


def _base_payload() -> dict:
    return {
        "task_title": "발표 자료 만들기",
        "assignee_member_id": "mem-1",
        "assignee_raw": "민수",
        "due_date": "2026-11-10",
        "due_raw": "월요일",
        "evidence_quote": "첫 회의 발화",
        "evidence_speaker": "1111",
        "evidence_speaker_member_id": "mem-1",
        "evidence_at_ms": 100,
        "extraction_item_id": "item-1",
        "meeting_id": "meet-1",
        "gate": "review",
        "doc_text": "기존 설명",
        "category": "assignee",
        "status": "todo",
        "created_at": "2026-11-06T00:00:00+00:00",
    }


def _merge(payload: dict | None = None, **overrides) -> dict:
    kwargs = {
        "item_id": "item-2",
        "meeting_id": "meet-2",
        "category": "due",
        "due_date": None,
        "due_raw": None,
        "status": None,
        "assignee_member_id": None,
        "assignee_raw": None,
        "gate": "review",
        "doc_text": None,
        "evidence": EVIDENCE,
        "now": NOW,
    }
    kwargs.update(overrides)
    return merge_into_pending(_base_payload() if payload is None else payload, **kwargs)


def _card(**overrides) -> ApprovalRequest:
    values = {
        "approval_id": "ap-1",
        "workspace_id": "ws-1",
        "type": str(ApprovalType.TASK_CREATE),
        "status": str(ApprovalStatus.PENDING),
        "payload": json.dumps(_base_payload(), ensure_ascii=False),
    }
    values.update(overrides)
    return ApprovalRequest(**values)


# --- 합치기 규칙 ---


def test_due_date_overwrites_with_raw_only_when_new_value_present():
    merged = _merge(due_date=date(2026, 11, 14), due_raw="다음 주 금요일")

    assert merged["due_date"] == "2026-11-14"
    assert merged["due_raw"] == "다음 주 금요일"


def test_due_kept_when_new_due_date_is_null():
    # 마감 지우기는 표현할 수 없다. due_raw 만 와도 기존 마감을 건드리지 않는다
    merged = _merge(due_date=None, due_raw="미정")

    assert merged["due_date"] == "2026-11-10"
    assert merged["due_raw"] == "월요일"


def test_status_overwritten_when_present_and_kept_when_absent():
    assert _merge(status="in_progress")["status"] == "in_progress"
    assert _merge(status=None)["status"] == "todo"


def test_non_assignee_category_keeps_assignee_gate_and_item_alias():
    payload = _base_payload()
    payload["assignee_item_id"] = "item-1"
    merged = _merge(
        payload,
        category="due",
        assignee_member_id="mem-9",
        assignee_raw="영희",
        gate="hold",
    )

    assert merged["assignee_member_id"] == "mem-1"
    assert merged["assignee_raw"] == "민수"
    assert merged["gate"] == "review"
    assert merged["assignee_item_id"] == "item-1"


def test_non_assignee_category_does_not_add_assignee_item_id():
    assert "assignee_item_id" not in _merge(category="due")


def test_assignee_category_overwrites_assignee_gate_and_item_id():
    merged = _merge(
        category="assignee",
        assignee_member_id="mem-9",
        assignee_raw="영희",
        gate="review",
    )

    assert merged["assignee_member_id"] == "mem-9"
    assert merged["assignee_raw"] == "영희"
    assert merged["gate"] == "review"
    assert merged["assignee_item_id"] == "item-2"


def test_assignee_category_not_found_clears_member_and_holds():
    merged = _merge(
        category="assignee",
        assignee_member_id=None,
        assignee_raw="모르는 사람",
        gate="hold",
    )

    assert merged["assignee_member_id"] is None
    assert merged["assignee_raw"] == "모르는 사람"
    assert merged["gate"] == "hold"
    assert merged["assignee_item_id"] == "item-2"


def test_doc_text_joined_with_slash_when_both_present():
    assert _merge(doc_text="새 설명")["doc_text"] == "기존 설명 / 새 설명"


def test_doc_text_is_new_value_when_no_existing():
    payload = _base_payload()
    payload["doc_text"] = None
    assert _merge(payload, doc_text="새 설명")["doc_text"] == "새 설명"
    del payload["doc_text"]
    assert _merge(payload, doc_text="새 설명")["doc_text"] == "새 설명"


def test_doc_text_kept_when_new_value_blank():
    assert _merge(doc_text=None)["doc_text"] == "기존 설명"
    assert _merge(doc_text="")["doc_text"] == "기존 설명"
    assert _merge(doc_text="   ")["doc_text"] == "기존 설명"


def test_doc_text_not_truncated():
    long_text = "가" * 5000
    assert _merge(doc_text=long_text)["doc_text"] == "기존 설명 / " + long_text


def test_merged_items_entry_records_item_evidence_and_utc_time():
    merged = _merge(doc_text="새 설명")

    assert merged["merged_items"] == [
        {
            "extraction_item_id": "item-2",
            "meeting_id": "meet-2",
            **EVIDENCE,
            "doc_text": "새 설명",
            "merged_at": "2026-11-07T03:00:00+00:00",
        }
    ]


def test_merged_items_accumulate_in_order():
    first = _merge(item_id="item-2", meeting_id="meet-2")
    second = _merge(first, item_id="item-3", meeting_id="meet-3")

    assert [m["extraction_item_id"] for m in second["merged_items"]] == ["item-2", "item-3"]


def test_merging_twice_overwrites_in_processing_order():
    first = _merge(due_date=date(2026, 11, 12), status="in_progress")
    second = _merge(first, due_date=date(2026, 11, 20), status="done")

    assert second["due_date"] == "2026-11-20"
    assert second["status"] == "done"


def test_keys_not_to_change_stay_as_they_were():
    original = _base_payload()
    merged = _merge(
        original,
        category="assignee",
        due_date=date(2026, 11, 14),
        status="done",
        assignee_member_id="mem-9",
        doc_text="새 설명",
    )

    for key in (
        "task_title",
        "evidence_quote",
        "evidence_speaker",
        "evidence_speaker_member_id",
        "evidence_at_ms",
        "meeting_id",
        "extraction_item_id",
        "category",
        "created_at",
    ):
        assert merged[key] == original[key], key


def test_unknown_keys_are_preserved():
    payload = _base_payload()
    payload["reverted_task_id"] = "task-9"
    payload["change_source"] = "ai"

    merged = _merge(payload)

    assert merged["reverted_task_id"] == "task-9"
    assert merged["change_source"] == "ai"


def test_input_payload_is_not_mutated():
    payload = _base_payload()
    snapshot = json.loads(json.dumps(payload))

    _merge(payload, category="assignee", due_date=date(2026, 11, 14), doc_text="새 설명")

    assert payload == snapshot


def test_title_key_card_is_not_given_task_title():
    # 팀원이 만든 카드는 title 키를 쓸 수 있다. 제목 키를 새로 만들거나 바꾸지 않는다
    payload = {"title": "직접 만든 카드", "gate": "review"}

    merged = _merge(payload)

    assert merged["title"] == "직접 만든 카드"
    assert "task_title" not in merged


# --- 대상 카드 확인 ---


def test_target_usable_returns_none():
    assert merge_target_problem(_card(), "ap-1", "ws-1") is None


def test_target_problem_missing_when_no_id():
    assert merge_target_problem(None, None, "ws-1") == "missing"
    assert merge_target_problem(None, "", "ws-1") == "missing"


def test_target_problem_not_found_when_card_absent():
    assert merge_target_problem(None, "ap-1", "ws-1") == "not_found"


def test_target_problem_other_workspace():
    assert merge_target_problem(_card(workspace_id="ws-2"), "ap-1", "ws-1") == "other_workspace"


def test_target_problem_not_task_create():
    card = _card(type=str(ApprovalType.TASK_UPDATE))
    assert merge_target_problem(card, "ap-1", "ws-1") == "not_task_create"


def test_target_problem_not_pending():
    card = _card(status=str(ApprovalStatus.APPROVED))
    assert merge_target_problem(card, "ap-1", "ws-1") == "not_pending"


def test_target_problem_bad_payload():
    assert merge_target_problem(_card(payload="[1, 2]"), "ap-1", "ws-1") == "bad_payload"
    assert merge_target_problem(_card(payload="not json"), "ap-1", "ws-1") == "bad_payload"
    assert merge_target_problem(_card(payload=None), "ap-1", "ws-1") == "bad_payload"


def test_target_problem_bad_payload_when_merged_items_is_not_a_list():
    # 리스트가 아닌 merged_items 에 항목을 덧붙이면 TypeError 가 나므로 합칠 수 없는 카드로 본다
    payload = {**_base_payload(), "merged_items": {"extraction_item_id": "item-9"}}
    card = _card(payload=json.dumps(payload, ensure_ascii=False))

    assert merge_target_problem(card, "ap-1", "ws-1") == "bad_payload"


def test_target_problem_reasons_are_distinct_strings():
    reasons = {
        pending_merge.MISSING,
        pending_merge.NOT_FOUND,
        pending_merge.OTHER_WORKSPACE,
        pending_merge.NOT_TASK_CREATE,
        pending_merge.NOT_PENDING,
        pending_merge.BAD_PAYLOAD,
    }
    assert reasons == {"missing", "not_found", "other_workspace", "not_task_create", "not_pending", "bad_payload"}


# --- 담당 항목 ---


def test_assignee_item_of_prefers_assignee_item_id():
    assert assignee_item_of({"assignee_item_id": "a", "extraction_item_id": "b"}) == "a"


def test_assignee_item_of_falls_back_to_extraction_item_id():
    assert assignee_item_of({"extraction_item_id": "b"}) == "b"
    assert assignee_item_of({"assignee_item_id": None, "extraction_item_id": "b"}) == "b"
    assert assignee_item_of({"assignee_item_id": "", "extraction_item_id": "b"}) == "b"


def test_assignee_item_of_none_when_neither():
    assert assignee_item_of({}) is None
