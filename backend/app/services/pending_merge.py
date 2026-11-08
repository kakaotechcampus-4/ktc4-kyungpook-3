"""승인 대기 중인 task_create 카드에 같은 일의 새 추출 항목을 합치는 규칙.

DB 를 만지지 않는 순수 함수다. 카드 잠금·저장은 호출하는 쪽(extractions)이 맡는다.
"""

import json
from datetime import date, datetime

from app.models.models import ApprovalRequest, ApprovalStatus, ApprovalType

# merge_target_problem 이 돌려주는 이유. 로그 사유 merge_target_unavailable 에 그대로 싣는다
MISSING = "missing"
NOT_FOUND = "not_found"
OTHER_WORKSPACE = "other_workspace"
NOT_TASK_CREATE = "not_task_create"
NOT_PENDING = "not_pending"
BAD_PAYLOAD = "bad_payload"


def merge_target_problem(
    card: ApprovalRequest | None, target_approval_id: str | None, workspace_id: str
) -> str | None:
    """합칠 카드로 쓸 수 있으면 None, 아니면 이유. 잠금 쿼리로 읽은 카드를 받는다."""
    if not target_approval_id:
        return MISSING
    if card is None:
        return NOT_FOUND
    if card.workspace_id != workspace_id:
        return OTHER_WORKSPACE
    if card.type != str(ApprovalType.TASK_CREATE):
        return NOT_TASK_CREATE
    if card.status != str(ApprovalStatus.PENDING):
        return NOT_PENDING
    try:
        payload = json.loads(card.payload)
    except (TypeError, ValueError):
        return BAD_PAYLOAD
    if not isinstance(payload, dict):
        return BAD_PAYLOAD
    # 이미 있는 merged_items 가 리스트가 아니면 항목을 덧붙일 수 없다. 없거나 null 이면 새로 만들면 된다
    if payload.get("merged_items") is not None and not isinstance(payload["merged_items"], list):
        return BAD_PAYLOAD
    return None


def assignee_item_of(payload: dict) -> str | None:
    """카드의 담당자를 정한 항목. 합쳐서 담당자가 바뀐 카드만 assignee_item_id 가 있고, 없으면 만든 항목이다."""
    return payload.get("assignee_item_id") or payload.get("extraction_item_id")


def merge_into_pending(
    payload: dict,
    *,
    item_id: str,
    meeting_id: str,
    category: str | None,
    due_date: date | None,
    due_raw: str | None,
    status: str | None,
    assignee_member_id: str | None,
    assignee_raw: str | None,
    gate: str,
    doc_text: str | None,
    evidence: dict,
    now: datetime,
) -> dict:
    """카드 payload 에 항목 하나를 합친 새 dict 를 돌려준다. 입력은 바꾸지 않는다.

    제목·대표 근거·meeting_id·extraction_item_id·category 와 표시용 키는 그대로 둔다.
    같은 카드에 여러 번 합치면 처리 순서대로 덮는다.
    """
    merged = json.loads(json.dumps(payload, ensure_ascii=False))

    # 마감 지우기는 요청으로 표현할 수 없으므로 새 값이 있을 때만 덮는다
    if due_date is not None:
        merged["due_date"] = due_date.isoformat()
        merged["due_raw"] = due_raw
    if status:
        merged["status"] = status

    # 담당자는 이 항목이 담당자를 말한 항목일 때만 바꾼다. 다른 항목의 빈 값이 기존 담당자를 지우지 않게 한다
    if category == "assignee":
        # 담당자를 못 찾아 hold 인 카드(원문만 있음)에 담당자 표현이 없는 항목이 합쳐지면 그대로 둔다. 못 찾은 원문이
        # 지워지면서 hold 만 풀리는 것을 막는다(#533 리뷰). 담당자를 정한 항목이 없으므로 assignee_item_id 도 바꾸지 않는다
        keeps_unresolved = (
            merged.get("gate") == "hold"
            and merged.get("assignee_member_id") is None
            and bool(merged.get("assignee_raw"))
            and assignee_member_id is None
            and not assignee_raw
        )
        if not keeps_unresolved:
            # 찾아 둔 담당자를 이 항목이 지우면(담당자 표현이 없는 none·group 항목) 항목 gate 는 review 지만 카드는 hold 로
            # 올린다. review 로 두면 PM 화면에서 담당자가 지워졌다는 것이 드러나지 않는다(#533 리뷰)
            clears_assignee = merged.get("assignee_member_id") is not None and assignee_member_id is None
            merged["assignee_member_id"] = assignee_member_id
            merged["assignee_raw"] = assignee_raw
            merged["gate"] = "hold" if clears_assignee else gate
            merged["assignee_item_id"] = item_id

    new_doc = (doc_text or "").strip()
    if new_doc:
        old_doc = merged.get("doc_text")
        merged["doc_text"] = f"{old_doc} / {doc_text}" if old_doc else doc_text

    merged["merged_items"] = [
        *(merged.get("merged_items") or []),
        {
            "extraction_item_id": item_id,
            "meeting_id": meeting_id,
            "evidence_quote": evidence.get("evidence_quote"),
            "evidence_speaker": evidence.get("evidence_speaker"),
            "evidence_speaker_member_id": evidence.get("evidence_speaker_member_id"),
            "evidence_at_ms": evidence.get("evidence_at_ms"),
            "doc_text": doc_text,
            "merged_at": now.isoformat(),
        },
    ]
    return merged
