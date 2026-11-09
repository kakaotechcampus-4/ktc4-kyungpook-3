import json
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import Decision, Extraction, ExtractionItem, Meeting, Source, Task, Topic, TopicItem, TopicMeeting, Workspace
from app.schemas.project_map import SummaryWriteRequest
from app.services import embedding, lifecycle, meeting_deletion, summary
from tests.api.test_summary_queue import BODY, H, _claim, _meeting, client as summary_client

client = summary_client


@pytest.mark.parametrize("deleted", ["workspace", "meeting"])
def test_summary_claim_never_leases_deleted_content(client, mdb, mseed, deleted):
    meeting, extraction = _meeting(mdb, mseed["ws"])
    target = mdb.get(Workspace, meeting.workspace_id) if deleted == "workspace" else meeting
    target.deleted_at = datetime.now(timezone.utc)
    mdb.commit()

    assert _claim(client) is None
    mdb.refresh(extraction)
    assert extraction.summary_attempts == 0


@pytest.mark.parametrize("deleted", ["workspace", "meeting"])
def test_summary_input_rejects_deleted_content(client, mdb, mseed, deleted):
    meeting, extraction = _meeting(mdb, mseed["ws"])
    target = mdb.get(Workspace, meeting.workspace_id) if deleted == "workspace" else meeting
    target.deleted_at = datetime.now(timezone.utc)
    mdb.commit()

    response = client.get(f"/api/v1/extractions/{extraction.extraction_id}/summary-input", headers=H)

    assert response.status_code == (404 if deleted == "workspace" else 410)


def test_summary_put_with_old_roster_epoch_does_not_write(client, mdb, mseed):
    meeting, extraction = _meeting(mdb, mseed["ws"])
    first = _claim(client)
    workspace = mdb.get(Workspace, meeting.workspace_id)
    workspace.identity_epoch += 1
    mdb.commit()
    body = dict(BODY)
    if "claim_token" in first:
        body["claim_token"] = first["claim_token"]

    response = client.put(f"/api/v1/extractions/{extraction.extraction_id}/summary", json=body,
                          headers={**H, "X-Privacy-Epoch": "0"})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "PRIVACY_VERSION_CHANGED"
    mdb.refresh(extraction)
    assert extraction.summary is None


def _write(client, claim, **fields):
    return client.put(f"/api/v1/extractions/{claim['extraction_id']}/summary",
                      json={**BODY, **fields, "claim_token": claim["claim_token"]},
                      headers={**H, "X-Privacy-Epoch": str(claim["identity_epoch"])})


def test_force_after_expiry_rejects_old_token_even_when_attempt_is_one_again(client, mdb, mseed):
    meeting, extraction = _meeting(mdb, mseed["ws"])
    first = _claim(client)
    extraction.summary_claimed_at = datetime.now(timezone.utc) - summary.SUMMARY_LEASE * 2
    mdb.commit()
    response = client.post(f"/api/v1/workspaces/{meeting.workspace_id}/summary-requests",
                           json={"meeting_ids": [meeting.meeting_id], "force": True, "dry_run": False}, headers=H)
    assert response.status_code == 200
    second = _claim(client)
    assert first["attempt"] == second["attempt"] == 1
    assert first["claim_token"] != second["claim_token"]

    assert _write(client, first).json()["data"]["applied"] is False
    assert _write(client, second, overview="replacement").json()["data"]["applied"] is True
    mdb.refresh(extraction)
    assert json.loads(extraction.summary)["overview"] == "replacement"
    assert extraction.summary_claim_token_hash is None


def test_expired_lease_and_missing_token_never_write(client, mdb, mseed):
    _, extraction = _meeting(mdb, mseed["ws"])
    claim = _claim(client)
    extraction.summary_claimed_at = datetime.now(timezone.utc) - summary.SUMMARY_LEASE * 2
    mdb.commit()
    assert _write(client, claim).json()["data"]["applied"] is False
    body = {key: value for key, value in BODY.items() if key != "claim_token"}
    response = client.put(f"/api/v1/extractions/{extraction.extraction_id}/summary", json=body, headers=H)
    assert response.status_code == 400
    mdb.refresh(extraction)
    assert extraction.summary is None


def test_summary_input_rejects_old_epoch_and_preview_returns_current_epoch(client, mdb, mseed):
    meeting, extraction = _meeting(mdb, mseed["ws"])
    mdb.get(Workspace, meeting.workspace_id).identity_epoch = 1
    mdb.commit()
    url = f"/api/v1/extractions/{extraction.extraction_id}/summary-input"
    assert client.get(url, headers={**H, "X-Privacy-Epoch": "0"}).status_code == 409
    assert client.get(url, headers=H).json()["data"]["identity_epoch"] == 1
    claim = _claim(client)
    assert claim["identity_epoch"] == 1
    assert _write(client, claim).json()["data"]["applied"] is True


@pytest.mark.parametrize("deleted", ["workspace", "meeting"])
def test_late_summary_put_rejects_tombstone_before_writing_topics(client, mdb, mseed, deleted):
    meeting, extraction = _meeting(mdb, mseed["ws"])
    claim = _claim(client)
    target = mdb.get(Workspace, meeting.workspace_id) if deleted == "workspace" else meeting
    target.deleted_at = datetime.now(timezone.utc)
    mdb.commit()
    response = _write(client, claim, topics=[{"name": "must-not-exist"}])
    assert response.status_code == (404 if deleted == "workspace" else 410)
    assert not mdb.scalars(select(Topic)).all()
    mdb.refresh(extraction)
    assert extraction.summary is None


@pytest.mark.parametrize("delete_later", [False, True])
def test_delete_removes_decisions_links_copies_and_preserves_tasks(client, mdb, mseed, monkeypatch, delete_later):
    monkeypatch.setenv("MEETING_DELETION_ENABLED", "true")
    monkeypatch.setattr(embedding, "related_task_pairs", lambda *a, **k: [])
    client.cookies.set("session_token", "pm-token")
    first, extraction = _meeting(mdb, mseed["ws"])
    first.deletion_ready = True
    task = Task(workspace_id=mseed["ws"], meeting_id=first.meeting_id, title="Keep this work", status="todo")
    mdb.add(task)
    mdb.flush()
    item = ExtractionItem(extraction_id=extraction.extraction_id, task_title=task.title, task_id=task.task_id)
    mdb.add(item)
    mdb.commit()
    item_id = item.item_id
    first_claim = _claim(client)
    assert _write(client, first_claim, overview="deleted-source-560", topics=[
        {"name": "shared-topic", "item_ids": [item.item_id], "decisions": [{"text": "deleted-decision-560"}]},
        {"name": "only-first-topic"},
    ]).json()["data"]["applied"] is True
    old_decision = mdb.scalar(select(Decision).where(Decision.meeting_id == first.meeting_id))
    later, later_extraction = _meeting(mdb, mseed["ws"], started_at=first.started_at + timedelta(days=1))
    later.deletion_ready = True
    mdb.commit()
    assert _write(client, _claim(client), overview="retained overview", topics=[
        {"name": "shared-topic", "decisions": [{"text": "replacement-decision", "replaces": [old_decision.decision_id]}]},
    ]).json()["data"]["applied"] is True
    deleted = later if delete_later else first
    retained = first if delete_later else later

    response = client.delete(f"/api/v1/meetings/{deleted.meeting_id}")
    assert response.status_code == 202, response.text
    mdb.expire_all()
    assert mdb.get(Task, task.task_id).title == "Keep this work"
    assert not mdb.scalars(select(Decision).where(Decision.meeting_id == deleted.meeting_id)).all()
    assert not mdb.scalars(select(TopicMeeting).where(TopicMeeting.meeting_id == deleted.meeting_id)).all()
    assert client.get(f"/api/v1/meetings/{deleted.meeting_id}/summary.md").status_code == 410
    graph = client.get(f"/api/v1/workspaces/{mseed['ws']}/project-map").json()["data"]
    assert deleted.meeting_id not in {ref["meeting_id"] for ref in graph["meetings"]}
    assert all(deleted.meeting_id not in node.get("meeting_ids", []) for node in graph["nodes"])
    bundle = client.get(f"/api/v1/workspaces/{mseed['ws']}/project-bundle.md")
    assert bundle.status_code == 200
    if delete_later:
        assert mdb.scalar(select(Decision).where(Decision.meeting_id == first.meeting_id)).replaced_by is None
        assert "replacement-decision" not in bundle.text
    else:
        assert not mdb.scalars(select(TopicItem).where(TopicItem.item_id == item_id)).all()
        assert "only-first-topic" not in {topic.name for topic in mdb.scalars(select(Topic))}
        assert json.loads(mdb.get(Extraction, later_extraction.extraction_id).summary)["decision_details"][0]["replaces"] == []
        assert "deleted-source-560" not in bundle.text and "deleted-decision-560" not in bundle.text
        assert "replacement-decision" in bundle.text
    assert client.get(f"/api/v1/meetings/{retained.meeting_id}/summary.md").status_code == 200


def test_postgresql_same_workspace_claims_lease_only_the_first_meeting(mdb, mseed):
    if mdb.bind.dialect.name != "postgresql":
        pytest.skip("PostgreSQL worker gate and row locks")
    first, _ = _meeting(mdb, mseed["ws"])
    _meeting(mdb, mseed["ws"], started_at=first.started_at + timedelta(days=1))
    barrier = threading.Barrier(4)

    def claim():
        with Session(mdb.bind, autoflush=False) as db:
            barrier.wait(10)
            job = summary.claim_next(db)
            db.commit()
            return job

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(claim) for _ in range(4)]
        results = [future.result(20) for future in futures]
    assert [job.meeting_id for job in results if job] == [first.meeting_id]


@pytest.mark.parametrize("winner", ["delete", "save"])
def test_postgresql_delete_and_summary_put_share_workspace_lock(mdb, mseed, monkeypatch, winner):
    if mdb.bind.dialect.name != "postgresql":
        pytest.skip("PostgreSQL independent-session lock ordering")
    monkeypatch.setenv("MEETING_DELETION_ENABLED", "true")
    meeting, extraction = _meeting(mdb, mseed["ws"])
    meeting.deletion_ready = True
    mdb.commit()
    claim = summary.claim_next(mdb)
    mdb.commit()
    meeting_id, extraction_id = meeting.meeting_id, extraction.extraction_id
    payload = SummaryWriteRequest(**{**BODY, "claim_token": claim.claim_token}, topics=[{"name": "race-topic"}])
    lifecycle.workspace(mdb, mseed["ws"])
    held = mdb.connection()
    attempted = threading.Event()

    def observe(conn, cursor, statement, parameters, context, many):
        if "FOR UPDATE" in statement and conn is not held:
            attempted.set()

    def delete(db):
        lifecycle.workspace(db, mseed["ws"])
        meeting_deletion.delete_meeting(db, meeting_id)

    def save(db):
        result = summary.save_summary(db, extraction_id, payload)
        db.commit()
        return result.applied

    def losing_operation():
        with Session(mdb.bind, autoflush=False) as db:
            try:
                return save(db) if winner == "delete" else delete(db)
            except AppError as error:
                return str(error.code)

    event.listen(mdb.bind, "before_cursor_execute", observe)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(losing_operation)
            try:
                assert attempted.wait(10)
                assert not future.done()
                if winner == "delete":
                    delete(mdb)
                    assert future.result(10) in ("EXTRACTION_NOT_FOUND", "MEETING_DELETED")
                else:
                    assert save(mdb) is True
                    assert future.result(10) is None
            finally:
                mdb.rollback()
    finally:
        event.remove(mdb.bind, "before_cursor_execute", observe)
    mdb.expire_all()
    assert mdb.get(Meeting, meeting_id).deleted_at is not None
    assert not mdb.scalars(select(Extraction).where(Extraction.meeting_id == meeting_id)).all()
    assert not mdb.scalars(select(Topic)).all()


def test_actual_shared_withdrawal_rejects_old_summary_and_preserves_same_named_member(client, mdb, mseed):
    from tests.api.test_account_withdrawal import _withdraw

    meeting, extraction = _meeting(mdb, mseed["ws"])
    alice, bob = mseed["alice"], mseed["bob"]
    bob.display_name = alice.display_name
    mdb.add_all([
        Source(meeting_id=meeting.meeting_id, seq=1, start_ms=1, end_ms=2, member_id=alice.member_id,
               speaker_name=alice.display_name, text="retained shared statement"),
        Source(meeting_id=meeting.meeting_id, seq=2, start_ms=2, end_ms=3, member_id=bob.member_id,
               speaker_name=bob.display_name, text="other shared statement"),
        ExtractionItem(extraction_id=extraction.extraction_id, task_title="Keep work", assignee_member_id=alice.member_id),
    ])
    mdb.commit()
    claim = _claim(client)
    old_input = client.get(f"/api/v1/extractions/{extraction.extraction_id}/summary-input", headers=H).json()["data"]
    assert old_input["lines"][1]["speaker"] == old_input["lines"][2]["speaker"]

    assert _withdraw(mseed).status_code == 202

    assert _write(client, claim).status_code == 409
    current = client.get(f"/api/v1/extractions/{extraction.extraction_id}/summary-input", headers=H).json()["data"]
    assert current["identity_epoch"] == 1
    assert current["lines"][1]["speaker"] == "탈퇴한 사용자"
    assert current["lines"][2]["speaker"] == old_input["lines"][2]["speaker"]
    assert current["lines"][1]["text"] == "retained shared statement"
    assert current["items"][0]["assignee"] == "탈퇴한 사용자"
    mdb.refresh(extraction)
    assert extraction.summary is None


def test_withdrawal_revokes_summary_receipt_even_with_current_epoch(client, mdb, mseed):
    from tests.api.test_account_withdrawal import _withdraw

    _, extraction = _meeting(mdb, mseed["ws"])
    original = _claim(client)

    assert _withdraw(mseed).status_code == 202
    assert _write(client, original).status_code == 409
    current_epoch = original["identity_epoch"] + 1
    refreshed = {**original, "identity_epoch": current_epoch}
    rejected = _write(client, refreshed, overview="stale before withdrawal")

    assert rejected.status_code == 200
    assert rejected.json()["data"]["applied"] is False
    mdb.refresh(extraction)
    assert extraction.summary is None

    extraction.summary_claimed_at = datetime.now(timezone.utc) - summary.SUMMARY_LEASE * 2
    mdb.commit()
    current = _claim(client)
    assert current["identity_epoch"] == current_epoch
    assert current["claim_token"] != original["claim_token"]
    assert _write(client, current, overview="fresh after withdrawal").json()["data"]["applied"] is True
    mdb.refresh(extraction)
    assert json.loads(extraction.summary)["overview"] == "fresh after withdrawal"


def test_expired_summary_attempt_cannot_beat_the_replacement(client, mdb, mseed):
    _, extraction = _meeting(mdb, mseed["ws"])
    first = _claim(client)
    extraction.summary_claimed_at = datetime.now(timezone.utc) - summary.SUMMARY_LEASE * 2
    mdb.commit()
    second = _claim(client)
    assert second["attempt"] == 2
    body = dict(BODY)
    if "claim_token" in first:
        body["claim_token"] = first["claim_token"]

    response = client.put(f"/api/v1/extractions/{extraction.extraction_id}/summary", json=body, headers=H)

    assert response.status_code == 200
    assert response.json()["data"]["applied"] is False
    mdb.refresh(extraction)
    assert extraction.summary is None
