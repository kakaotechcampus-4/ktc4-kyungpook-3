import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.models import Meeting, Source


@pytest.fixture
def rollout_meeting(mdb, mseed):
    meeting = Meeting(workspace_id=mseed["ws"], source="discord", status="done")
    mdb.add(meeting)
    mdb.commit()
    client = TestClient(app)
    client.cookies.set("session_token", "pm-token")
    yield client, meeting
    client.close()


@pytest.mark.parametrize("value", [None, "false", "TRUE", "1", " true"])
def test_delete_is_disabled_by_default_without_mutation(
    mdb, rollout_meeting, monkeypatch, value
):
    client, meeting = rollout_meeting
    if value is None:
        monkeypatch.delenv("MEETING_DELETION_ENABLED", raising=False)
    else:
        monkeypatch.setenv("MEETING_DELETION_ENABLED", value)
    source = Source(meeting_id=meeting.meeting_id, seq=0, start_ms=0, end_ms=1, text="keep")
    mdb.add(source)
    mdb.commit()
    response = client.delete(f"/api/v1/meetings/{meeting.meeting_id}")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "MEETING_DELETION_UNAVAILABLE"
    assert mdb.get(Source, source.source_id).text == "keep"
    assert mdb.get(Meeting, meeting.meeting_id).deleted_at is None
    assert client.get(f"/api/v1/meetings/{meeting.meeting_id}").json()["data"]["deletion_available"] is False


def test_unverified_lineage_blocks_delete_and_detail(mdb, rollout_meeting, monkeypatch):
    monkeypatch.setenv("MEETING_DELETION_ENABLED", "true")
    client, meeting = rollout_meeting
    assert meeting.deletion_ready is False
    response = client.delete(f"/api/v1/meetings/{meeting.meeting_id}")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MEETING_LINEAGE_UNVERIFIED"
    assert client.get(f"/api/v1/meetings/{meeting.meeting_id}").json()["data"]["deletion_available"] is False
    meeting.deletion_ready = True
    meeting.status = "failed"
    child = Meeting(workspace_id=meeting.workspace_id, source="discord", status="done",
                    recording_root_id=meeting.meeting_id, replaces_meeting_id=meeting.meeting_id)
    mdb.add(child)
    mdb.commit()
    assert client.delete(f"/api/v1/meetings/{meeting.meeting_id}").json()["error"]["code"] == "MEETING_LINEAGE_UNVERIFIED"
    child.deletion_ready = True
    mdb.commit()
    assert client.get(f"/api/v1/meetings/{meeting.meeting_id}").json()["data"]["deletion_available"] is True
    assert client.delete(f"/api/v1/meetings/{meeting.meeting_id}").status_code == 202


def test_ready_active_lineage_still_blocks_delete(mdb, rollout_meeting, monkeypatch):
    monkeypatch.setenv("MEETING_DELETION_ENABLED", "true")
    client, meeting = rollout_meeting
    meeting.deletion_ready = True
    meeting.status = "processing"
    mdb.commit()
    response = client.delete(f"/api/v1/meetings/{meeting.meeting_id}")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MEETING_DELETE_BLOCKED"
    assert client.get(f"/api/v1/meetings/{meeting.meeting_id}").json()["data"]["deletion_available"] is False


def test_database_insert_defaults_readiness_to_false(mdb, mseed):
    import uuid
    mid = str(uuid.uuid4())
    mdb.execute(text(
        "INSERT INTO meeting (meeting_id, workspace_id, source, status, started_at) "
        "VALUES (:mid, :wid, 'discord', 'done', :at)"
    ), {"mid": mid, "wid": mseed["ws"], "at": datetime.now(timezone.utc)})
    mdb.commit()
    assert mdb.get(Meeting, mid).deletion_ready is False


def test_discord_creation_requires_version_after_enable(mdb, mseed, rollout_meeting, monkeypatch):
    monkeypatch.delenv("MEETING_DELETION_ENABLED", raising=False)
    client, _ = rollout_meeting
    headers = {"X-Service-Token": "test-service-token"}
    body = {"workspace_id": mseed["ws"], "source": "discord"}
    old = client.post("/api/v1/meetings", headers=headers, json=body)
    assert old.status_code == 201
    assert mdb.get(Meeting, old.json()["data"]["meeting_id"]).deletion_ready is False
    monkeypatch.setenv("MEETING_DELETION_ENABLED", "true")
    rejected = client.post("/api/v1/meetings", headers=headers, json=body)
    assert rejected.status_code == 409
    assert rejected.json()["error"]["code"] == "MEETING_CLIENT_UPDATE_REQUIRED"
    headers["X-Meeting-Lineage-Version"] = "1"
    created = client.post("/api/v1/meetings", headers=headers, json=body)
    assert created.status_code == 201
    mid = created.json()["data"]["meeting_id"]
    assert mdb.get(Meeting, mid).deletion_ready is True
    mdb.get(Meeting, mid).status = "failed"
    mdb.commit()
    body["replaces_meeting_id"] = mid
    first = client.post("/api/v1/meetings", headers=headers, json=body)
    second = client.post("/api/v1/meetings", headers=headers, json=body)
    assert first.status_code == second.status_code == 201
    assert first.json()["data"]["meeting_id"] == second.json()["data"]["meeting_id"]


def test_gate_off_keeps_existing_receipt_and_purge_working(mdb, rollout_meeting, monkeypatch):
    monkeypatch.setenv("MEETING_DELETION_ENABLED", "true")
    client, meeting = rollout_meeting
    meeting.deletion_ready = True
    mdb.commit()
    initial = client.delete(f"/api/v1/meetings/{meeting.meeting_id}")
    assert initial.status_code == 202
    monkeypatch.setenv("MEETING_DELETION_ENABLED", "false")
    assert client.get(f"/api/v1/meetings/{meeting.meeting_id}/deletion").status_code == 200
    headers = {"X-Service-Token": "test-service-token"}
    claim = client.post("/api/v1/bot/meeting-purges/claim", headers=headers).json()["data"]
    acknowledged = client.post(f"/api/v1/bot/meeting-purges/{meeting.meeting_id}/ack",
                               headers=headers, json={"claim_token": claim["claim_token"]})
    assert acknowledged.status_code == 200
    assert acknowledged.json()["data"]["cleanup_status"] == "complete"
