"""승인 카드 payload_version(#535): 응답에 싣고, PATCH 에 같은 값이 오면 지금 값과 비교해 다르면 409 APPROVAL_CHANGED.

카드를 본 뒤 다른 회의 항목이 합쳐져 payload 가 바뀌었는데 PM 이 옛 내용으로 승인·반려하는 일을 막는다.
"""
import json

from sqlalchemy import select, update

from app.api import approvals as approvals_api
from app.models import ApprovalRequest, Extraction, Task
from tests.api.test_approval_merged_card import (  # noqa: F401  (픽스처 재사용)
    _extract,
    _items_of,
    _merge_item,
    _merged_card,
    _patch,
    _pending_card,
    client,
    db,
    seed,
)

CHANGED_MESSAGE = "보신 뒤 승인 요청 내용이 바뀌었습니다. 새 내용을 확인한 뒤 다시 처리해 주세요."


def _detail(client, card_id: str) -> dict:  # noqa: F811
    r = client.get(f"/api/v1/approvals/{card_id}")
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _version(client, card_id: str):  # noqa: F811
    return _detail(client, card_id)["payload_version"]


def _item_statuses(client, db, seed) -> list[str]:  # noqa: F811
    """회의 1·2 의 추출 항목이 API 에 보이는 approval_status (카드를 따라간다)."""
    statuses = []
    for meeting in seed["meetings"][:2]:
        extraction_id = db.execute(
            select(Extraction.extraction_id).where(Extraction.meeting_id == meeting.meeting_id)
        ).scalar_one()
        [item] = client.get(f"/api/v1/extractions/{extraction_id}").json()["data"]["items"]
        statuses.append(item["approval_status"])
    return statuses


def _tasks(db, seed) -> list[Task]:  # noqa: F811
    db.expire_all()
    return list(db.execute(
        select(Task).where(Task.workspace_id == seed["ws"].workspace_id, Task.title == "결제 API 연동")
    ).scalars().all())


def _assert_untouched(db, seed, card_id: str) -> None:  # noqa: F811
    db.expire_all()
    card = db.get(ApprovalRequest, card_id)
    assert (card.status, card.resolved_by, card.resolved_at) == ("pending", None, None)
    assert _tasks(db, seed) == []
    assert all(i.task_id is None for i in _items_of(db, card_id))


def test_task_create_list_and_detail_expose_same_version(client, db, seed):  # noqa: F811
    card_id = _pending_card(client, db, seed)
    update_card = ApprovalRequest(
        workspace_id=seed["ws"].workspace_id, type="task_update", status="pending",
        related_task_id=db.execute(select(Task.task_id)).scalars().first(),
        payload=json.dumps({"status": "done"}),
    )
    db.add(update_card)
    db.commit()

    listed = client.get(f"/api/v1/approvals?workspace_id={seed['ws'].workspace_id}").json()["data"]["items"]
    by_id = {a["approval_id"]: a for a in listed}

    version = by_id[card_id]["payload_version"]
    assert isinstance(version, str) and len(version) == 16
    int(version, 16)
    assert _version(client, card_id) == version
    assert by_id[update_card.approval_id]["payload_version"] is None
    assert _version(client, update_card.approval_id) is None


def test_merge_changes_version_only_for_merged_card(client, db, seed):  # noqa: F811
    card_id = _pending_card(client, db, seed)
    other = ApprovalRequest(
        workspace_id=seed["ws"].workspace_id, type="task_create", status="pending",
        payload=json.dumps({"title": "다른 카드"}, ensure_ascii=False),
    )
    db.add(other)
    db.commit()
    before, other_before = _version(client, card_id), _version(client, other.approval_id)

    _extract(client, seed, 1, [_merge_item(card_id)])

    assert _version(client, card_id) != before
    assert _version(client, other.approval_id) == other_before


def test_approve_with_current_version_succeeds(client, db, seed):  # noqa: F811
    card_id = _merged_card(client, db, seed)

    r = _patch(client, card_id, {"status": "approved", "payload_version": _version(client, card_id)})

    assert r.status_code == 200, r.text
    assert r.json()["data"]["related_task_id"] is not None
    assert isinstance(r.json()["data"]["payload_version"], str)
    assert len(_tasks(db, seed)) == 1


def test_approve_with_stale_version_returns_409_and_keeps_pending(client, db, seed):  # noqa: F811
    card_id = _pending_card(client, db, seed)
    stale = _version(client, card_id)
    _extract(client, seed, 1, [_merge_item(card_id)])
    current = _version(client, card_id)

    r = _patch(client, card_id, {"status": "approved", "payload_version": stale})

    assert r.status_code == 409, r.text
    error = r.json()["error"]
    assert error["code"] == "APPROVAL_CHANGED"
    assert error["message"] == CHANGED_MESSAGE
    assert error["details"] == {"approval_id": card_id, "payload_version": current}
    _assert_untouched(db, seed, card_id)


def test_retry_with_new_version_after_409_succeeds(client, db, seed):  # noqa: F811
    card_id = _pending_card(client, db, seed)
    stale = _version(client, card_id)
    _extract(client, seed, 1, [_merge_item(card_id)])
    first = _patch(client, card_id, {"status": "approved", "payload_version": stale})
    assert first.status_code == 409

    r = _patch(client, card_id, {
        "status": "approved", "payload_version": first.json()["error"]["details"]["payload_version"],
    })

    assert r.status_code == 200, r.text
    assert len(_tasks(db, seed)) == 1


def test_approve_without_version_after_merge_still_succeeds(client, db, seed):  # noqa: F811
    card_id = _merged_card(client, db, seed)

    r = _patch(client, card_id, {"status": "approved"})

    assert r.status_code == 200, r.text


def test_reject_with_stale_version_returns_409_and_keeps_items(client, db, seed):  # noqa: F811
    card_id = _pending_card(client, db, seed)
    stale = _version(client, card_id)
    _extract(client, seed, 1, [_merge_item(card_id)])
    statuses_before = _item_statuses(client, db, seed)
    assert set(statuses_before) == {"pending"}

    r = _patch(client, card_id, {"status": "rejected", "payload_version": stale})

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "APPROVAL_CHANGED"
    db.expire_all()
    assert db.get(ApprovalRequest, card_id).status == "pending"
    assert _item_statuses(client, db, seed) == statuses_before


def test_task_update_ignores_payload_version(client, db, seed):  # noqa: F811
    task_id = db.execute(select(Task.task_id)).scalars().first()
    card = ApprovalRequest(
        workspace_id=seed["ws"].workspace_id, type="task_update", status="pending",
        related_task_id=task_id, payload=json.dumps({"status": "done"}),
    )
    db.add(card)
    db.commit()

    r = _patch(client, card.approval_id, {"status": "approved", "payload_version": "아무거나"})

    assert r.status_code == 200, r.text
    assert r.json()["data"]["payload_version"] is None


def test_resolved_card_reports_already_resolved_before_version(client, db, seed):  # noqa: F811
    card_id = _merged_card(client, db, seed)
    version = _version(client, card_id)
    assert _patch(client, card_id, {"status": "approved"}).status_code == 200

    r = _patch(client, card_id, {"status": "approved", "payload_version": version})

    assert r.status_code == 409
    assert r.json()["error"]["code"] == "APPROVAL_ALREADY_RESOLVED"


def test_payload_change_between_check_and_update_uses_refreshed_payload(client, db, seed, monkeypatch):  # noqa: F811
    card_id = _pending_card(client, db, seed)
    seen = _version(client, card_id)
    original = approvals_api._normalize_overrides

    def normalize_then_merge_elsewhere(db_, approval, status, overrides):
        result = original(db_, approval, status, overrides)
        payload = json.loads(approval.payload)
        payload["due_date"] = "2026-12-24"
        db_.execute(
            update(ApprovalRequest.__table__)
            .where(ApprovalRequest.__table__.c.approval_id == card_id)
            .values(payload=json.dumps(payload, ensure_ascii=False))
        )
        return result

    monkeypatch.setattr(approvals_api, "_normalize_overrides", normalize_then_merge_elsewhere)

    r = _patch(client, card_id, {"status": "approved", "payload_version": seen})

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "APPROVAL_CHANGED"
    _assert_untouched(db, seed, card_id)


def test_payload_version_too_long_is_400(client, db, seed):  # noqa: F811
    card_id = _pending_card(client, db, seed)

    r = _patch(client, card_id, {"status": "approved", "payload_version": "a" * 65})

    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
