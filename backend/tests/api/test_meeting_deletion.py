import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import Extraction, Meeting, Source, Task
from app.models import (
    ApprovalRequest,
    Evidence,
    ExtractionItem,
    MeetingPurge,
    EMBEDDING_DIMENSIONS,
)
from app.services import meeting_deletion, embedding, upload_storage


@pytest.fixture
def deleted_fixture(mdb, mseed, monkeypatch):
    monkeypatch.setenv("MEETING_DELETION_ENABLED", "true")
    meeting = Meeting(
        workspace_id=mseed["ws"],
        status="done",
        title="private-576",
        source="chat",
        deletion_ready=True,
        duration_ms=9000,
    )
    mdb.add(meeting)
    mdb.flush()
    mdb.add(
        Source(
            meeting_id=meeting.meeting_id,
            seq=0,
            start_ms=0,
            end_ms=9000,
            text="private-576",
        )
    )
    mdb.add(
        Extraction(
            meeting_id=meeting.meeting_id, summary=json.dumps({"text": "private-576"})
        )
    )
    task = Task(
        workspace_id=mseed["ws"],
        meeting_id=meeting.meeting_id,
        title="Keep this work",
        status="todo",
    )
    mdb.add(task)
    mdb.commit()
    client = TestClient(app)
    client.cookies.set("session_token", "pm-token")
    yield client, meeting.meeting_id, task.task_id
    client.close()


def test_delete_erases_content_and_retains_task(mdb, deleted_fixture):
    client, mid, tid = deleted_fixture
    response = client.delete(f"/api/v1/meetings/{mid}")
    assert response.status_code == 202
    assert response.json()["data"]["cleanup_status"] == "pending"
    mdb.expire_all()
    assert mdb.scalar(select(Source).where(Source.meeting_id == mid)) is None
    assert mdb.scalar(select(Extraction).where(Extraction.meeting_id == mid)) is None
    assert mdb.get(Meeting, mid).title is None
    task = mdb.get(Task, tid)
    assert task.title == "Keep this work" and task.meeting_id == mid
    assert client.get(f"/api/v1/tasks/{tid}").json()["data"]["meeting_deleted"] is True
    assert client.get(f"/api/v1/meetings/{mid}/minutes").status_code == 410


def test_repeat_delete_has_same_receipt(deleted_fixture):
    client, mid, _ = deleted_fixture
    first = client.delete(f"/api/v1/meetings/{mid}").json()["data"]
    assert first["deleted_at"].endswith(("Z", "+00:00"))
    assert client.delete(f"/api/v1/meetings/{mid}").json()["data"] == first
    assert client.get(f"/api/v1/meetings/{mid}/deletion").json()["data"] == first


@pytest.mark.parametrize("identity", ["alice", "outsider"])
def test_delete_requires_pm(deleted_fixture, identity):
    client, mid, _ = deleted_fixture
    client.cookies.set("session_token", f"{identity}-token")
    assert client.delete(f"/api/v1/meetings/{mid}").status_code == 403


@pytest.mark.parametrize("status", ["created", "processing", "awaiting_speakers"])
def test_active_delete_does_not_change_data(mdb, deleted_fixture, status):
    client, mid, _ = deleted_fixture
    mdb.get(Meeting, mid).status = status
    mdb.commit()
    response = client.delete(f"/api/v1/meetings/{mid}")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MEETING_DELETE_BLOCKED"
    assert (
        client.get(f"/api/v1/meetings/{mid}").json()["data"]["title"] == "private-576"
    )


def test_late_sources_do_not_restore_deleted_content(deleted_fixture):
    client, mid, _ = deleted_fixture
    assert client.delete(f"/api/v1/meetings/{mid}").status_code == 202
    response = client.post(
        f"/api/v1/meetings/{mid}/sources",
        headers={"X-Service-Token": "test-service-token"},
        json={
            "source": "meeting",
            "segments": [
                {
                    "seq": 1,
                    "start": 0,
                    "end": 1,
                    "text": "late-private",
                    "speaker": None,
                }
            ],
        },
    )
    assert response.status_code == 410
    assert response.json()["error"]["code"] == "MEETING_DELETED"


def test_purge_claim_is_required_for_ack(deleted_fixture):
    client, mid, _ = deleted_fixture
    client.delete(f"/api/v1/meetings/{mid}")
    headers = {"X-Service-Token": "test-service-token"}
    claim = client.post(
        "/api/v1/bot/meeting-purges/claim", headers=headers, json={}
    ).json()["data"]
    assert claim["meeting_id"] == mid
    assert (
        client.post(
            f"/api/v1/bot/meeting-purges/{mid}/ack",
            headers=headers,
            json={"claim_token": "wrong"},
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/v1/bot/meeting-purges/{mid}/ack",
            headers=headers,
            json={"claim_token": claim["claim_token"]},
        ).status_code
        == 200
    )


def test_backend_files_are_removed(deleted_fixture, monkeypatch, tmp_path):
    client, mid, _ = deleted_fixture
    root = tmp_path / "upload-root"
    monkeypatch.setenv("UPLOAD_DIR", str(root))
    folder = root / mid
    folder.mkdir(parents=True)
    (folder / "audio.wav").write_bytes(b"private-576")
    assert client.delete(f"/api/v1/meetings/{mid}").status_code == 202
    assert not folder.exists()
    assert Path(root).exists()


def test_business_history_jobs_and_chat_cursor_are_preserved(
    mdb, mseed, deleted_fixture
):
    from app.models import NotionSyncJob, TaskHistory

    client, mid, tid = deleted_fixture
    task = mdb.get(Task, tid)
    task.version = 7
    task.notion_page_id = "existing-notion-page"
    task.notion_sync_status = "pending"
    history = TaskHistory(
        task_id=tid,
        changed_field="status",
        old_value="todo",
        new_value="in_progress",
        change_source="meeting",
    )
    job = NotionSyncJob(task_id=tid, task_version=7, status="pending", attempts=2)
    mdb.add_all([history, job])
    mdb.commit()
    history_id, job_id = history.history_id, job.job_id
    headers = {"X-Service-Token": "test-service-token"}
    cursor_path = f"/api/v1/workspaces/{mseed['ws']}/chat-cursor"
    cursor = client.get(cursor_path, headers=headers).json()["data"]
    before = client.get(f"/api/v1/tasks/{tid}").json()["data"]
    assert client.delete(f"/api/v1/meetings/{mid}").status_code == 202
    after = client.get(f"/api/v1/tasks/{tid}").json()["data"]
    assert after == {**before, "meeting_deleted": True}
    assert client.get(cursor_path, headers=headers).json()["data"] == cursor
    assert mdb.get(TaskHistory, history_id).new_value == "in_progress"
    assert mdb.get(NotionSyncJob, job_id).attempts == 2
    assert mid not in [
        m["meeting_id"]
        for m in client.get(f"/api/v1/workspaces/{mseed['ws']}/meetings").json()[
            "data"
        ]["items"]
    ]


def test_raw_database_copies_are_removed_in_one_delete(mdb, mseed, deleted_fixture):
    from app.models import AliasResolutionLog, AliasReview, MeetingUpload, Notification

    client, mid, tid = deleted_fixture
    source = mdb.scalar(select(Source).where(Source.meeting_id == mid))
    extraction = mdb.scalar(select(Extraction).where(Extraction.meeting_id == mid))
    item = ExtractionItem(
        extraction_id=extraction.extraction_id,
        task_title="private-576",
        doc_text="private-576",
    )
    log = AliasResolutionLog(
        workspace_id=mseed["ws"],
        meeting_id=mid,
        source_id=source.source_id,
        alias_text="private-576",
        result="not_found",
    )
    mdb.add_all([item, log])
    mdb.flush()
    evidence = Evidence(
        item_id=item.item_id, task_id=tid, source_id=source.source_id, type="task"
    )
    review = AliasReview(
        log_id=log.log_id, decision="rejected", reviewed_by=mseed["pm"].member_id
    )
    upload = MeetingUpload(
        meeting_id=mid,
        original_filename="private-576.wav",
        stored_filename="audio.wav",
        content_type="audio/wav",
        size_bytes=7,
        attendees="private-576",
        speakers="private-576",
    )
    notification = Notification(
        workspace_id=mseed["ws"],
        member_id=mseed["pm"].member_id,
        kind="meeting_done",
        text="private-576",
        link_type="meeting",
        link_id=mid,
    )
    mdb.add_all([evidence, review, upload, notification])
    mdb.commit()
    ids = [
        (ExtractionItem, item.item_id),
        (Evidence, evidence.evidence_id),
        (AliasResolutionLog, log.log_id),
        (AliasReview, review.review_id),
        (MeetingUpload, mid),
        (Notification, notification.notification_id),
    ]
    assert client.delete(f"/api/v1/meetings/{mid}").status_code == 202
    mdb.expire_all()
    for model, row_id in ids:
        assert mdb.get(model, row_id) is None


def merged_card(mdb, workspace, deleted_mid):
    old_extraction = mdb.scalar(
        select(Extraction).where(Extraction.meeting_id == deleted_mid)
    )
    old = ExtractionItem(
        extraction_id=old_extraction.extraction_id,
        task_title="private-576",
        gate="review",
        doc_text="private-576",
    )
    other = Meeting(workspace_id=workspace, status="done", source="chat", deletion_ready=True)
    mdb.add_all([old, other])
    mdb.flush()
    extraction = Extraction(meeting_id=other.meeting_id)
    mdb.add(extraction)
    mdb.flush()
    survivor = ExtractionItem(
        extraction_id=extraction.extraction_id,
        task_title="Surviving title",
        gate="review",
        doc_text="Surviving explanation",
        category="scope",
    )
    mdb.add(survivor)
    mdb.flush()
    for seq, kind, text in [
        (1, "task", "first"),
        (2, "task", "final surviving quote"),
        (3, "due", "wrong quote"),
    ]:
        src = Source(
            meeting_id=other.meeting_id,
            seq=seq,
            start_ms=seq,
            end_ms=seq + 1,
            text=text,
        )
        mdb.add(src)
        mdb.flush()
        mdb.add(Evidence(item_id=survivor.item_id, source_id=src.source_id, type=kind))
    payload = {
        "meeting_id": deleted_mid,
        "task_title": "private-576",
        "doc_text": "private-576 / Surviving explanation",
        "extraction_item_id": old.item_id,
        "due_date": "2026-11-30",
        "merged_items": [
            {
                "meeting_id": other.meeting_id,
                "extraction_item_id": survivor.item_id,
                "doc_text": "Surviving explanation",
                "evidence_quote": "final surviving quote",
            }
        ],
    }
    card = ApprovalRequest(
        workspace_id=workspace,
        type="task_create",
        status="pending",
        payload=json.dumps(payload),
        embedding=[0.1] * EMBEDDING_DIMENSIONS,
    )
    mdb.add(card)
    mdb.flush()
    old.approval_id = survivor.approval_id = card.approval_id
    mdb.commit()
    return card, survivor


def test_partial_card_is_rebuilt_without_deleted_top_level_values(
    mdb, mseed, deleted_fixture
):
    client, mid, _ = deleted_fixture
    card, survivor = merged_card(mdb, mseed["ws"], mid)
    prior = client.get(f"/api/v1/approvals/{card.approval_id}").json()["data"][
        "payload_version"
    ]
    assert client.delete(f"/api/v1/meetings/{mid}").status_code == 202
    mdb.refresh(card)
    rebuilt = json.loads(card.payload)
    assert card.status == "pending"
    assert rebuilt["task_title"] == "Surviving title"
    assert rebuilt["doc_text"] == "Surviving explanation"
    assert rebuilt["evidence_quote"] == "final surviving quote"
    assert rebuilt["due_date"] is None
    assert rebuilt["extraction_item_id"] == survivor.item_id
    assert "private-576" not in card.payload
    assert card.embedding is None
    response = client.patch(
        f"/api/v1/approvals/{card.approval_id}",
        json={"status": "approved", "payload_version": prior},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "APPROVAL_CHANGED"


@pytest.mark.parametrize("forgery", ["foreign_workspace", "wrong_meeting", "other_approval"])
def test_manual_card_cannot_rehydrate_another_items_private_evidence(
    mdb, mseed, deleted_fixture, forgery
):
    from app.models import Workspace

    client, mid, _ = deleted_fixture
    legitimate, survivor = merged_card(mdb, mseed["ws"], mid)
    claimed_mid = json.loads(legitimate.payload)["merged_items"][0]["meeting_id"]
    if forgery == "other_approval":
        item = survivor
        secret = "final surviving quote"
        private_source = mdb.scalar(
            select(Source).join(Evidence, Evidence.source_id == Source.source_id)
            .where(Evidence.item_id == survivor.item_id, Source.seq == 2)
        )
    else:
        workspace = mseed["ws"]
        if forgery == "foreign_workspace":
            other = Workspace(name="private workspace")
            mdb.add(other)
            mdb.flush()
            workspace = other.workspace_id
        private_meeting = Meeting(workspace_id=workspace, status="done", source="chat", deletion_ready=True)
        mdb.add(private_meeting)
        mdb.flush()
        extraction = Extraction(meeting_id=private_meeting.meeting_id)
        mdb.add(extraction)
        mdb.flush()
        item = ExtractionItem(extraction_id=extraction.extraction_id, task_title="private task", gate="review")
        private_source = Source(meeting_id=private_meeting.meeting_id, seq=0, start_ms=0, end_ms=1,
                                text="PRIVATE_OTHER_MEETING_QUOTE")
        mdb.add_all([item, private_source])
        mdb.flush()
        mdb.add(Evidence(item_id=item.item_id, source_id=private_source.source_id, type="task"))
        secret = private_source.text
    mdb.commit()
    response = client.post("/api/v1/approvals", json={
        "workspace_id": mseed["ws"], "type": "task_create",
        "payload": {"meeting_id": mid, "task_title": "manual review", "merged_items": [
            {"meeting_id": claimed_mid, "extraction_item_id": item.item_id},
        ]},
    })
    assert response.status_code == 201
    card_id = response.json()["data"]["approval_id"]
    assert client.delete(f"/api/v1/meetings/{mid}").status_code == 202
    result = client.get(f"/api/v1/approvals/{card_id}").json()["data"]
    assert secret not in json.dumps(result["payload"])
    assert result["status"] == "rejected"
    assert mdb.get(Source, private_source.source_id).text == secret


@pytest.mark.parametrize("source_is_deleted", [False, True])
def test_partial_card_never_uses_source_from_another_meeting(
    mdb, mseed, deleted_fixture, source_is_deleted
):
    client, mid, _ = deleted_fixture
    card, survivor = merged_card(mdb, mseed["ws"], mid)
    other = Meeting(workspace_id=mseed["ws"], status="done", source="chat", deletion_ready=True)
    mdb.add(other)
    mdb.flush()
    source = Source(meeting_id=mid if source_is_deleted else other.meeting_id,
                    seq=100, start_ms=100, end_ms=101,
                    text="WRONG_MEETING_SOURCE")
    mdb.add(source)
    mdb.flush()
    mdb.add(Evidence(item_id=survivor.item_id, source_id=source.source_id, type="task"))
    mdb.commit()
    assert client.delete(f"/api/v1/meetings/{mid}").status_code == 202
    mdb.refresh(card)
    assert card.status == "pending"
    assert json.loads(card.payload)["evidence_quote"] == "final surviving quote"
    assert "WRONG_MEETING_SOURCE" not in card.payload


@pytest.mark.parametrize("delete_primary", [True, False])
def test_partial_card_preserves_only_surviving_fallback_evidence(
    mdb, mseed, deleted_fixture, delete_primary
):
    client, mid, _ = deleted_fixture
    card, survivor = merged_card(mdb, mseed["ws"], mid)
    mdb.query(Evidence).filter(Evidence.item_id == survivor.item_id).delete()
    payload = json.loads(card.payload)
    primary_evidence = {
        "evidence_quote": "primary fallback quote",
        "evidence_speaker": "primary-speaker",
        "evidence_speaker_member_id": mseed["pm"].member_id,
        "evidence_at_ms": 1234,
    }
    merged_evidence = {
        "evidence_quote": "merged fallback quote",
        "evidence_speaker": "merged-speaker",
        "evidence_speaker_member_id": None,
        "evidence_at_ms": 5678,
    }
    payload.update(primary_evidence)
    payload["merged_items"][0].update(merged_evidence)
    card.payload = json.dumps(payload)
    mdb.commit()
    merged_mid = payload["merged_items"][0]["meeting_id"]
    removed_mid = mid if delete_primary else merged_mid
    expected = merged_evidence if delete_primary else primary_evidence
    removed = primary_evidence if delete_primary else merged_evidence
    assert client.delete(f"/api/v1/meetings/{removed_mid}").status_code == 202
    mdb.refresh(card)
    rebuilt = json.loads(card.payload)
    assert card.status == "pending"
    assert {key: rebuilt[key] for key in expected} == expected
    assert removed["evidence_quote"] not in card.payload
    assert removed["evidence_speaker"] not in card.payload


def test_partial_card_prefers_last_task_source_over_payload_fallback(
    mdb, mseed, deleted_fixture
):
    client, mid, _ = deleted_fixture
    card, _ = merged_card(mdb, mseed["ws"], mid)
    payload = json.loads(card.payload)
    payload["merged_items"][0].update(
        {
            "evidence_quote": "stale fallback quote",
            "evidence_speaker": "stale-speaker",
            "evidence_at_ms": 9999,
        }
    )
    card.payload = json.dumps(payload)
    mdb.commit()
    assert client.delete(f"/api/v1/meetings/{mid}").status_code == 202
    mdb.refresh(card)
    rebuilt = json.loads(card.payload)
    assert rebuilt["evidence_quote"] == "final surviving quote"
    assert rebuilt["evidence_speaker"] is None
    assert rebuilt["evidence_at_ms"] == 2
    assert "stale fallback" not in card.payload


def test_partial_card_does_not_borrow_fallback_from_different_meeting(
    mdb, mseed, deleted_fixture
):
    client, mid, _ = deleted_fixture
    card, survivor = merged_card(mdb, mseed["ws"], mid)
    mdb.query(Evidence).filter(Evidence.item_id == survivor.item_id).delete()
    payload = json.loads(card.payload)
    payload["merged_items"][0].update(
        {"meeting_id": mid, "evidence_quote": "deleted origin quote"}
    )
    card.payload = json.dumps(payload)
    mdb.commit()
    assert client.delete(f"/api/v1/meetings/{mid}").status_code == 202
    mdb.refresh(card)
    rebuilt = json.loads(card.payload)
    assert card.status == "rejected"
    assert rebuilt == {"meeting_id": mid, "source_deleted": True}
    assert "deleted origin quote" not in card.payload


def test_invalid_duplicate_item_does_not_hide_its_valid_contribution(
    mdb, mseed, deleted_fixture
):
    client, mid, _ = deleted_fixture
    card, survivor = merged_card(mdb, mseed["ws"], mid)
    payload = json.loads(card.payload)
    payload["merged_items"].insert(0, {
        "meeting_id": mid, "extraction_item_id": survivor.item_id,
        "evidence_quote": "forged duplicate",
    })
    card.payload = json.dumps(payload)
    mdb.commit()
    assert client.delete(f"/api/v1/meetings/{mid}").status_code == 202
    mdb.refresh(card)
    assert card.status == "pending"
    assert json.loads(card.payload)["evidence_quote"] == "final surviving quote"
    assert "forged duplicate" not in card.payload


@pytest.mark.parametrize("bad_id", [42, [], {}, True, ""])
@pytest.mark.parametrize("merged", [False, True])
def test_manual_approval_rejects_malformed_meeting_ids(
    mseed, deleted_fixture, bad_id, merged
):
    client, _, _ = deleted_fixture
    origin = {"meeting_id": bad_id}
    payload = {"merged_items": [origin]} if merged else origin
    response = client.post(
        "/api/v1/approvals",
        json={"workspace_id": mseed["ws"], "type": "task_create", "payload": payload},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


@pytest.mark.parametrize("merged_items", [{}, "invalid", [None], [42]])
def test_manual_approval_rejects_malformed_merged_contributions(
    mseed, deleted_fixture, merged_items
):
    client, _, _ = deleted_fixture
    response = client.post(
        "/api/v1/approvals",
        json={
            "workspace_id": mseed["ws"],
            "type": "task_create",
            "payload": {"merged_items": merged_items},
        },
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_manual_approval_accepts_reverse_lineage_order_then_deletes_safely(
    mdb, mseed, deleted_fixture
):
    client, mid, _ = deleted_fixture
    mdb.get(Meeting, mid).status = "failed"
    child = Meeting(
        workspace_id=mseed["ws"],
        status="done",
        source="chat",
        recording_root_id=mid,
        deletion_ready=True,
        replaces_meeting_id=mid,
    )
    mdb.add(child)
    mdb.commit()
    response = client.post(
        "/api/v1/approvals",
        json={
            "workspace_id": mseed["ws"],
            "type": "task_create",
            "payload": {
                "meeting_id": child.meeting_id,
                "task_title": "linked review",
                "merged_items": [{"meeting_id": mid}],
            },
        },
    )
    assert response.status_code == 201
    card_id = response.json()["data"]["approval_id"]
    assert client.delete(f"/api/v1/meetings/{mid}").status_code == 202
    card = client.get(f"/api/v1/approvals/{card_id}").json()["data"]
    assert card["status"] == "rejected"
    assert card["payload"]["source_deleted"] is True
    assert "linked review" not in json.dumps(card["payload"])


def test_late_embedding_from_deleted_contribution_is_not_written(
    mdb, mseed, deleted_fixture, monkeypatch
):
    client, mid, _ = deleted_fixture
    card, _ = merged_card(mdb, mseed["ws"], mid)
    card.embedding = None
    mdb.commit()

    def delayed_response(texts, **kwargs):
        assert texts == ["private-576"]
        assert client.delete(f"/api/v1/meetings/{mid}").status_code == 202
        return [[0.8] * EMBEDDING_DIMENSIONS]

    monkeypatch.setattr(embedding, "embed_texts", delayed_response)
    assert embedding.process_missing_approval_embeddings(mdb) == 0
    mdb.refresh(card)
    assert card.status == "pending" and card.embedding is None


def test_no_surviving_card_is_scrubbed_and_terminal(mdb, mseed, deleted_fixture):
    client, mid, _ = deleted_fixture
    card = ApprovalRequest(
        workspace_id=mseed["ws"],
        type="task_create",
        status="pending",
        payload=json.dumps({"meeting_id": mid, "task_title": "private-576"}),
    )
    mdb.add(card)
    mdb.commit()
    assert client.delete(f"/api/v1/meetings/{mid}").status_code == 202
    mdb.refresh(card)
    assert card.status == "rejected" and card.resolved_at is not None
    assert "private-576" not in card.payload


def test_new_task_cannot_link_to_tombstone(mseed, deleted_fixture):
    client, mid, _ = deleted_fixture
    client.delete(f"/api/v1/meetings/{mid}")
    response = client.post(
        "/api/v1/tasks",
        json={"workspace_id": mseed["ws"], "meeting_id": mid, "title": "late"},
    )
    assert response.status_code == 410


def test_deleted_boundary_sweep_rejects_late_requests(mseed, deleted_fixture):
    client, mid, _ = deleted_fixture
    client.delete(f"/api/v1/meetings/{mid}")
    headers = {"X-Service-Token": "test-service-token"}
    calls = [
        ("get", f"/api/v1/meetings/{mid}", {}),
        ("get", f"/api/v1/meetings/{mid}/audio", {}),
        ("get", f"/api/v1/meetings/{mid}/speakers", {}),
        ("patch", f"/api/v1/meetings/{mid}/end", {}),
        ("patch", f"/api/v1/meetings/{mid}/stage", {"json": {"stage": "stt"}}),
        ("patch", f"/api/v1/meetings/{mid}/fail", {"json": {"failed_stage": "stt"}}),
        ("patch", f"/api/v1/uploads/{mid}/claim", {}),
        ("patch", f"/api/v1/uploads/{mid}/resume", {}),
        ("get", f"/api/v1/uploads/{mid}/file", {}),
        (
            "post",
            "/api/v1/extractions",
            {"json": {"meeting_id": mid, "workspace_id": mseed["ws"], "items": []}},
        ),
        (
            "post",
            "/api/v1/approvals",
            {
                "json": {
                    "workspace_id": mseed["ws"],
                    "type": "task_create",
                    "payload": {"meeting_id": mid, "task_title": "late"},
                }
            },
        ),
    ]
    for method, path, kwargs in calls:
        response = client.request(method, path, headers=headers, **kwargs)
        assert response.status_code == 410, (method, path, response.text)
        assert response.json()["error"]["code"] == "MEETING_DELETED"


def test_storage_failure_remains_pending_until_real_retry(
    mdb, deleted_fixture, monkeypatch, tmp_path
):
    client, mid, _ = deleted_fixture
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    folder = tmp_path / mid
    folder.mkdir()
    (folder / "source.wav").write_bytes(b"private")
    original = upload_storage.shutil.rmtree

    def fail(path):
        raise PermissionError("busy")

    monkeypatch.setattr(upload_storage.shutil, "rmtree", fail)
    assert (
        client.delete(f"/api/v1/meetings/{mid}").json()["data"]["cleanup_status"]
        == "pending"
    )
    assert folder.exists()
    row = mdb.get(MeetingPurge, mid)
    assert row.backend_done_at is None
    claim = meeting_deletion.claim_purge(mdb)
    assert (
        meeting_deletion.ack_purge(mdb, mid, claim["claim_token"]).cleanup_status
        == "pending"
    )
    monkeypatch.setattr(upload_storage.shutil, "rmtree", original)
    meeting_deletion.purge_backend_files(mdb)
    assert not folder.exists()
    assert (
        client.get(f"/api/v1/meetings/{mid}/deletion").json()["data"]["cleanup_status"]
        == "complete"
    )


def test_expired_and_replaced_claim_cannot_ack(mdb, deleted_fixture):
    from datetime import datetime, timedelta, timezone

    client, mid, _ = deleted_fixture
    client.delete(f"/api/v1/meetings/{mid}")
    old = meeting_deletion.claim_purge(mdb)
    row = mdb.get(MeetingPurge, mid)
    assert old["claim_token"] not in row.claim_token_hash
    row.lease_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    mdb.commit()
    headers = {"X-Service-Token": "test-service-token"}
    assert (
        client.post(
            f"/api/v1/bot/meeting-purges/{mid}/ack",
            headers=headers,
            json={"claim_token": old["claim_token"]},
        ).status_code
        == 409
    )
    new = meeting_deletion.claim_purge(mdb)
    assert new["claim_token"] != old["claim_token"]
    assert (
        client.post(
            f"/api/v1/bot/meeting-purges/{mid}/ack",
            headers=headers,
            json={"claim_token": old["claim_token"]},
        ).status_code
        == 409
    )
    result = meeting_deletion.ack_purge(mdb, mid, new["claim_token"])
    assert result.cleanup_status == "complete"
    assert meeting_deletion.ack_purge(mdb, mid, new["claim_token"]) == result


def test_replacement_lineage_is_deleted_together_and_receipt_aggregates(
    mdb, mseed, deleted_fixture
):
    client, mid, _ = deleted_fixture
    mdb.get(Meeting, mid).status = "failed"
    mdb.commit()
    headers = {"X-Service-Token": "test-service-token"}
    data = {"workspace_id": mseed["ws"], "source": "chat", "replaces_meeting_id": mid}
    created = client.post("/api/v1/meetings", headers=headers, json=data)
    assert created.status_code == 201
    next_id = created.json()["data"]["meeting_id"]
    assert (
        client.post("/api/v1/meetings", headers=headers, json=data).json()["data"][
            "meeting_id"
        ]
        == next_id
    )
    assert client.delete(f"/api/v1/meetings/{mid}").status_code == 409
    mdb.get(Meeting, next_id).status = "done"
    mdb.add(
        Source(
            meeting_id=next_id, seq=1, start_ms=0, end_ms=1, text="descendant private"
        )
    )
    mdb.commit()
    receipt = client.delete(f"/api/v1/meetings/{mid}").json()["data"]
    assert receipt["deleted_meeting_ids"] == sorted([mid, next_id])
    assert (
        mdb.scalar(select(Source).where(Source.meeting_id.in_([mid, next_id]))) is None
    )
    first_claim = meeting_deletion.claim_purge(mdb)
    assert (
        meeting_deletion.ack_purge(
            mdb, first_claim["meeting_id"], first_claim["claim_token"]
        ).cleanup_status
        == "pending"
    )
    second = meeting_deletion.claim_purge(mdb)
    assert (
        meeting_deletion.ack_purge(
            mdb, second["meeting_id"], second["claim_token"]
        ).cleanup_status
        == "complete"
    )
    assert (
        client.post("/api/v1/meetings", headers=headers, json=data).status_code == 410
    )
    repeated = client.delete(f"/api/v1/meetings/{next_id}").json()["data"]
    assert repeated["deleted_at"] == receipt["deleted_at"]
    assert repeated["deleted_meeting_ids"] == receipt["deleted_meeting_ids"]


@pytest.mark.parametrize("winner", ["delete", "replace"])
def test_postgresql_replacement_and_delete_share_recording_root_lock(
    mdb, mseed, deleted_fixture, winner
):
    if mdb.bind.dialect.name != "postgresql":
        pytest.skip("PostgreSQL row-lock barrier requires TEST_DATABASE_URL")
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from sqlalchemy import event
    from sqlalchemy.orm import Session
    from app.api.meetings import create_meeting
    from app.core.errors import AppError
    from app.schemas.meeting import MeetingCreateRequest

    _, mid, _ = deleted_fixture
    mdb.get(Meeting, mid).status = "failed"
    mdb.commit()
    mdb.scalar(select(Meeting).where(Meeting.meeting_id == mid).with_for_update())
    attempted = Event()
    held_connection = mdb.connection()

    def observe(conn, cursor, statement, parameters, context, many):
        if "FOR UPDATE" in statement and conn is not held_connection:
            attempted.set()

    event.listen(mdb.bind, "before_cursor_execute", observe)
    payload = MeetingCreateRequest(
        workspace_id=mseed["ws"], source="chat", replaces_meeting_id=mid
    )

    def losing_operation():
        with Session(mdb.bind, autoflush=False) as other:
            try:
                if winner == "delete":
                    create_meeting(payload, other)
                else:
                    meeting_deletion.delete_meeting(other, mid)
            except AppError as error:
                return str(error.code)
            return "unexpected success"

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(losing_operation)
            try:
                assert attempted.wait(5), "losing operation reached root-lock SQL"
                assert not future.done()
                if winner == "delete":
                    meeting_deletion.delete_meeting(mdb, mid)
                    assert future.result(5) == "MEETING_DELETED"
                else:
                    child = create_meeting(payload, mdb)["data"]["meeting_id"]
                    assert future.result(5) == "MEETING_DELETE_BLOCKED"
                    assert mdb.get(Meeting, mid).deleted_at is None
                    assert mdb.get(Meeting, child).deleted_at is None
            finally:
                mdb.rollback()
    finally:
        event.remove(mdb.bind, "before_cursor_execute", observe)


def test_postgresql_manual_card_waits_for_root_before_locking_replacement(
    mdb, mseed, deleted_fixture
):
    if mdb.bind.dialect.name != "postgresql":
        pytest.skip("PostgreSQL independent-session lock ordering requires TEST_DATABASE_URL")
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from sqlalchemy import event, text
    from sqlalchemy.orm import Session

    from app.api.approvals import create_approval
    from app.core.errors import AppError
    from app.models import User
    from app.schemas.approval import ApprovalCreateRequest

    _, mid, _ = deleted_fixture
    mdb.get(Meeting, mid).status = "failed"
    child = Meeting(
        workspace_id=mseed["ws"],
        status="done",
        source="chat",
        recording_root_id=mid,
        deletion_ready=True,
        replaces_meeting_id=mid,
    )
    mdb.add(child)
    mdb.commit()
    user = mdb.get(User, mseed["pm"].user_id)
    payload = ApprovalCreateRequest(
        workspace_id=mseed["ws"],
        type="task_create",
        payload={
            "meeting_id": child.meeting_id,
            "task_title": "late card",
            "merged_items": [{"meeting_id": mid}],
        },
    )
    mdb.execute(text("SET LOCAL lock_timeout = '3s'"))
    mdb.scalar(select(Meeting).where(Meeting.meeting_id == mid).with_for_update())
    held_connection = mdb.connection()
    attempted = Event()

    def observe(conn, cursor, statement, parameters, context, many):
        values = parameters.values() if isinstance(parameters, dict) else parameters
        if conn is not held_connection and "FOR UPDATE" in statement and mid in values:
            attempted.set()

    def create_card():
        with Session(mdb.bind, autoflush=False) as other:
            other.execute(text("SET LOCAL lock_timeout = '3s'"))
            try:
                create_approval(payload, user, other)
            except AppError as error:
                return str(error.code)
            return "unexpected success"

    event.listen(mdb.bind, "before_cursor_execute", observe)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(create_card)
            try:
                assert attempted.wait(5), "manual card reached canonical root lock"
                assert not future.done()
                meeting_deletion.delete_meeting(mdb, mid)
                assert future.result(5) == "MEETING_DELETED"
            finally:
                mdb.rollback()
    finally:
        event.remove(mdb.bind, "before_cursor_execute", observe)


def test_postgresql_delayed_embedding_cannot_cross_partial_card_delete(
    mdb, mseed, deleted_fixture, monkeypatch
):
    if mdb.bind.dialect.name != "postgresql":
        pytest.skip(
            "PostgreSQL independent-session embedding barrier requires TEST_DATABASE_URL"
        )
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from sqlalchemy.orm import Session

    _, mid, _ = deleted_fixture
    card, _ = merged_card(mdb, mseed["ws"], mid)
    card.embedding = None
    mdb.commit()
    requested, finish = Event(), Event()

    def response(texts, **kwargs):
        assert texts == ["private-576"]
        requested.set()
        assert finish.wait(5)
        return [[0.9] * EMBEDDING_DIMENSIONS]

    monkeypatch.setattr(embedding, "embed_texts", response)

    def calculate():
        with Session(mdb.bind, autoflush=False) as other:
            return embedding.process_missing_approval_embeddings(other)

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(calculate)
        try:
            assert requested.wait(5)
            meeting_deletion.delete_meeting(mdb, mid)
        finally:
            finish.set()
        assert future.result(5) == 0
    mdb.refresh(card)
    assert card.status == "pending" and card.embedding is None
