"""sweeper 가 정리한 업로드 회의를 AI·PM·웹이 어떻게 보는지(#266). 정리 뒤 모든 경로가 끝난 회의로 답해야 한다.

TEST_DATABASE_URL 이 있으면 PostgreSQL 에서도 돈다.
"""
import json
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import Meeting, MeetingUpload, Member, Session as SessionModel, User, Workspace
from app.services import upload_storage, upload_sweeper

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
TOKEN = "test-service-token"
HEADERS = {"X-Service-Token": TOKEN}
AUDIO = b"OggS" + bytes(range(256)) * 4
WAV = b"RIFF\x24\x00\x00\x00WAVE" + bytes(range(256)) * 10
LABELS = [{"label": "SPEAKER_00", "total_sec": 30.0, "samples": [{"start": 1.0, "end": 6.5}]}]


def _sqlite_engine():
    return create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )


def _pg_engine():
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.drop_all(engine)
    return engine


@pytest.fixture(
    params=[
        "sqlite",
        pytest.param(
            "postgresql",
            marks=pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없습니다."),
        ),
    ]
)
def db(request, monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", TOKEN)
    engine = _pg_engine() if request.param == "postgresql" else _sqlite_engine()
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()

    def override_get_db():
        yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield session
    finally:
        app.dependency_overrides.pop(get_db, None)
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture
def seed(db):
    user = User(email="pm@example.com", name="pm")
    db.add(user)
    db.flush()
    db.add(SessionModel(
        user_id=user.user_id, session_token="pm-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    pm = Member(workspace_id=ws.workspace_id, user_id=user.user_id, display_name="PM", role="pm")
    jimin = Member(workspace_id=ws.workspace_id, display_name="지민", role="member")
    db.add_all([pm, jimin])
    db.commit()
    return {"ws": ws, "pm": pm, "jimin": jimin}


def _client(token=None):
    c = TestClient(app, base_url="https://testserver")
    if token:
        c.cookies.set("session_token", token)
    return c


def _stuck_upload(db, seed, *, status, **times) -> Meeting:
    meeting = Meeting(
        workspace_id=seed["ws"].workspace_id, title="주간 회의", source="manual_upload", status=status
    )
    db.add(meeting)
    db.flush()
    db.add(MeetingUpload(
        meeting_id=meeting.meeting_id, stored_filename="audio.ogg", original_filename="회의.ogg",
        size_bytes=len(AUDIO), content_type="audio/ogg",
        attendees=json.dumps([{"member_id": seed["jimin"].member_id, "display_name": "지민"}]),
        **times,
    ))
    db.commit()
    folder = upload_storage.meeting_dir(meeting.meeting_id)
    folder.mkdir(parents=True)
    (folder / "audio.ogg").write_bytes(AUDIO)
    return meeting


def _swept_processing(db, seed):
    meeting = _stuck_upload(
        db, seed, status="processing", claimed_at=datetime.now(timezone.utc) - timedelta(hours=4)
    )
    assert upload_sweeper.sweep_stalled_uploads(db) == [(meeting.meeting_id, "diarize")]
    return meeting


def _swept_awaiting(db, seed):
    long_ago = datetime.now(timezone.utc) - timedelta(days=8)
    meeting = _stuck_upload(
        db, seed, status="awaiting_speakers", claimed_at=long_ago,
        speakers=json.dumps(LABELS), speakers_reported_at=long_ago,
    )
    assert upload_sweeper.sweep_stalled_uploads(db) == [(meeting.meeting_id, "speaker_assignment_expired")]
    return meeting


def test_ai_fail_report_after_sweep_gets_409_already_ended(db, seed):
    meeting = _swept_processing(db, seed)

    r = _client().patch(
        f"/api/v1/meetings/{meeting.meeting_id}/fail", headers=HEADERS, json={"failed_stage": "STT"}
    )

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "MEETING_ALREADY_ENDED"
    assert r.json()["error"]["details"]["status"] == "failed"


def test_ai_label_report_after_sweep_gets_409_already_ended(db, seed):
    meeting = _swept_processing(db, seed)

    r = _client().post(
        f"/api/v1/uploads/{meeting.meeting_id}/speakers", headers=HEADERS, json={"speakers": LABELS}
    )

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "MEETING_ALREADY_ENDED"


def test_pm_assignment_after_expiry_gets_409_not_awaiting(db, seed):
    meeting = _swept_awaiting(db, seed)

    r = _client("pm-token").put(
        f"/api/v1/meetings/{meeting.meeting_id}/speakers", json={"mapping": {"SPEAKER_00": None}}
    )

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "MEETING_NOT_AWAITING_SPEAKERS"


def test_audio_file_after_sweep_gets_404(db, seed):
    meeting = _swept_processing(db, seed)

    r = _client().get(f"/api/v1/uploads/{meeting.meeting_id}/file", headers=HEADERS)

    assert r.status_code == 404, r.text


def test_same_workspace_can_upload_again_after_sweep(db, seed):
    """멈춘 업로드가 정리되면 워크스페이스의 업로드 409 가 풀린다."""
    stuck = _stuck_upload(
        db, seed, status="processing", claimed_at=datetime.now(timezone.utc) - timedelta(hours=4)
    )
    pm = _client("pm-token")

    def upload():
        return pm.post(
            f"/api/v1/workspaces/{seed['ws'].workspace_id}/meetings/upload",
            data={
                "title": "새 회의",
                "started_at": "2026-10-13T10:00:00+09:00",
                "attendee_member_ids": [seed["jimin"].member_id],
            },
            files={"file": ("회의.wav", WAV, "audio/wav")},
        )

    assert upload().status_code == 409

    assert upload_sweeper.sweep_stalled_uploads(db) == [(stuck.meeting_id, "diarize")]

    r = upload()
    assert r.status_code == 202, r.text
