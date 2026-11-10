"""추출 항목의 승인 운명. 승인 코드가 실제로 쓴 값으로 final_items 와 waiting 을 읽는다(설계 1절 표)."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import literal, select

from app.main import app
from app.models import ApprovalRequest, Extraction, ExtractionItem, Meeting, MemberAlias, Source, Task
from app.services import item_fate
from tests.api.conftest import SERVICE_TOKEN

H = {"X-Service-Token": SERVICE_TOKEN}
T0 = datetime(2026, 11, 5, 5, 0, tzinfo=timezone.utc)


@pytest.fixture
def client(mdb):
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c


def _meeting(db, ws):
    meeting = Meeting(workspace_id=ws, source="discord", status="processing", started_at=T0, title="정기회의")
    db.add(meeting)
    db.flush()
    db.add(Source(meeting_id=meeting.meeting_id, seq=0, start_ms=0, end_ms=900, text="안녕하세요"))
    db.commit()
    return meeting


def _extract(client, db, seed, raw_item):
    meeting = _meeting(db, seed["ws"])
    r = client.post("/api/v1/extractions", json={
        "meeting_id": meeting.meeting_id, "workspace_id": seed["ws"], "items": [raw_item],
    }, headers=H)
    assert r.status_code == 201, r.text
    db.expire_all()
    return db.scalars(select(ExtractionItem).where(ExtractionItem.extraction_id == r.json()["data"]["extraction_id"])).one()


def _resolve(client, db, item, status, **body):
    db.expire_all()
    r = client.patch(f"/api/v1/approvals/{db.get(ExtractionItem, item.item_id).approval_id}",
                     json={"status": status, **body})
    assert r.status_code == 200, r.text


def _revert(client, item):
    r = client.post(f"/api/v1/extractions/{item.extraction_id}/items/{item.item_id}/revert")
    assert r.status_code == 200, r.text


def _auto(client, db, seed):
    db.add(MemberAlias(member_id=seed["alice"].member_id, workspace_id=seed["ws"], alias_text="앨리스님",
                       alias_type="nickname", source="manual", confidence=1.0, verified=True))
    db.commit()
    item = _extract(client, db, seed, {"task_title": "자동 태스크", "task_confidence": 0.99, "assignee_raw": "앨리스님",
                                       "assignee_type": "thirdname"})
    assert (item.gate, item.approval_id) == ("auto", None)
    return item


def _review(client, db, seed):
    return _extract(client, db, seed, {"task_title": "검토 태스크", "task_confidence": 0.6, "due_confidence": 0.0})


def _update(client, db, seed):
    return _extract(client, db, seed, {"action": "update", "target_task_id": seed["tasks"][0].task_id,
                                       "due_date": "2026-12-01"})


def auto_create(client, db, seed):
    return _auto(client, db, seed)


def approved_create(client, db, seed):
    item = _review(client, db, seed)
    _resolve(client, db, item, "approved")
    return item


def merged_item_from_another_meeting(client, db, seed):
    first = _review(client, db, seed)
    merged = _extract(client, db, seed, {"action": "merge", "target_approval_id": first.approval_id,
                                         "task_title": "검토 태스크", "category": "due", "due_date": "2026-12-03"})
    assert (merged.action, merged.approval_id) == ("merge", first.approval_id)
    _resolve(client, db, first, "approved")
    return merged


def approved_update_with_overrides(client, db, seed):
    item = _update(client, db, seed)
    _resolve(client, db, item, "approved", task_overrides={"due_date": "2026-12-05"})
    return item


def cardless_update(client, db, seed):
    item = _extract(client, db, seed, {"action": "update", "target_task_id": seed["tasks"][0].task_id})
    assert (item.approval_id, item.task_id) == (None, seed["tasks"][0].task_id)
    return item


def review(client, db, seed):
    return _review(client, db, seed)


def hold(client, db, seed):
    item = _extract(client, db, seed, {"task_title": "누가 할지 모름", "task_confidence": 0.99, "assignee_raw": "모르는사람"})
    assert item.gate == "hold"
    return item


def rejected_create(client, db, seed):
    item = _review(client, db, seed)
    _resolve(client, db, item, "rejected")
    return item


def rejected_update_keeping_task_id(client, db, seed):
    item = _update(client, db, seed)
    _resolve(client, db, item, "rejected")
    db.expire_all()
    assert db.get(ExtractionItem, item.item_id).task_id == seed["tasks"][0].task_id
    return item


def reverted_pending(client, db, seed):
    item = _auto(client, db, seed)
    _revert(client, item)
    return item


def reverted_then_approved(client, db, seed):
    item = _auto(client, db, seed)
    _revert(client, item)
    _resolve(client, db, item, "approved")
    return item


def deleted_task(client, db, seed):
    item = _auto(client, db, seed)
    db.get(Task, item.task_id).is_deleted = True
    db.commit()
    return item


@pytest.mark.parametrize("build,final,waiting", [
    (auto_create, True, False),
    (approved_create, True, False),
    (merged_item_from_another_meeting, True, False),
    (approved_update_with_overrides, True, False),
    (cardless_update, True, False),
    (review, False, True),
    (hold, False, True),
    (rejected_create, False, False),
    (rejected_update_keeping_task_id, False, False),
    (reverted_pending, False, True),
    (reverted_then_approved, True, False),
    (deleted_task, False, False),
], ids=lambda value: getattr(value, "__name__", None))
def test_item_fate_follows_the_approval_table(client, mdb, mseed, build, final, waiting):
    item = build(client, mdb, mseed)
    mdb.expire_all()

    final_ids = {row.item_id for row in mdb.execute(item_fate.final_items())}
    assert (item.item_id in final_ids) is final
    assert bool(mdb.scalar(select(item_fate.waiting(literal(item.extraction_id))))) is waiting


def test_a_pending_merged_card_holds_every_meeting_it_spans(client, mdb, mseed):
    first = _review(client, mdb, mseed)
    merged = _extract(client, mdb, mseed, {"action": "merge", "target_approval_id": first.approval_id,
                                           "task_title": "검토 태스크", "category": "due", "due_date": "2026-12-03"})

    waits = [bool(mdb.scalar(select(item_fate.waiting(literal(i.extraction_id))))) for i in (first, merged)]
    readiness = item_fate.readiness(mdb, mdb.get(Extraction, merged.extraction_id), "discord")

    assert waits == [True, True]
    assert (readiness.ready, readiness.waiting_cards) == (False, 1)
    assert mdb.scalar(select(ApprovalRequest.status).where(ApprovalRequest.approval_id == first.approval_id)) == "pending"
