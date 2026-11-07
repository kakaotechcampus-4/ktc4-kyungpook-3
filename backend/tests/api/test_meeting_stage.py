"""AI 가 알리는 처리 단계(PATCH /meetings/{id}/stage)의 저장·무시 규칙과 progress 판정을 확인한다.

핵심인 조건부 UPDATE(`meeting_stage.report_stage`)가 DB 마다 다르게 동작할 수 있어서, TEST_DATABASE_URL 이 있으면 PostgreSQL 에서도 돈다.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import Meeting, Member, Session as SessionModel, Source, User, Workspace
from app.services.sessions import hash_session_token

SERVICE_TOKEN = "test-service-token"
SERVICE_HEADERS = {"X-Service-Token": SERVICE_TOKEN}


TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")


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
def db(request):
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
        user_id=user.user_id, session_token=hash_session_token("pm-token"),
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    db.add(Member(workspace_id=ws.workspace_id, user_id=user.user_id, display_name="pm", role="pm"))
    meeting = Meeting(workspace_id=ws.workspace_id, status="processing")
    db.add(meeting)
    db.commit()
    return {"ws": ws.workspace_id, "meeting": meeting.meeting_id}


@pytest.fixture
def client(db, monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c


def _stage(client, meeting_id, stage, headers=SERVICE_HEADERS):
    return client.patch(
        f"/api/v1/meetings/{meeting_id}/stage", json={"stage": stage}, headers=headers
    )


def _meeting(db, meeting_id) -> Meeting:
    db.expire_all()
    return db.get(Meeting, meeting_id)


def test_stage_requires_service_token(client, seed):
    r = client.patch(f"/api/v1/meetings/{seed['meeting']}/stage", json={"stage": "stt"})
    assert r.status_code == 401


def test_stage_unknown_meeting_404(client):
    r = _stage(client, "no-such-meeting", "stt")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "MEETING_NOT_FOUND"


def test_stage_invalid_value_400(client, seed):
    r = _stage(client, seed["meeting"], "merge")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


def test_stage_applies_on_processing(client, db, seed):
    r = _stage(client, seed["meeting"], "stt")
    assert r.status_code == 200
    assert r.json()["data"] == {
        "meeting_id": seed["meeting"],
        "status": "processing",
        "processing_stage": "stt",
        "applied": True,
    }
    assert _meeting(db, seed["meeting"]).processing_stage_at is not None


def test_same_stage_is_ignored(client, db, seed):
    _stage(client, seed["meeting"], "stt")
    first_at = _meeting(db, seed["meeting"]).processing_stage_at

    r = _stage(client, seed["meeting"], "stt")

    assert r.json()["data"]["applied"] is False
    assert _meeting(db, seed["meeting"]).processing_stage_at == first_at


def test_backward_stage_is_ignored(client, db, seed):
    _stage(client, seed["meeting"], "extract")

    r = _stage(client, seed["meeting"], "stt")

    assert r.json()["data"]["applied"] is False
    assert r.json()["data"]["processing_stage"] == "extract"
    assert _meeting(db, seed["meeting"]).processing_stage == "extract"


def test_skipping_forward_is_applied(client, seed):
    r = _stage(client, seed["meeting"], "extract")
    assert r.json()["data"]["applied"] is True


@pytest.mark.parametrize("status", ["created", "awaiting_speakers", "done", "failed"])
def test_non_processing_meetings_ignored(client, db, seed, status):
    meeting = _meeting(db, seed["meeting"])
    meeting.status = status
    db.commit()

    r = _stage(client, seed["meeting"], "stt")

    assert r.status_code == 200
    assert r.json()["data"]["applied"] is False
    assert r.json()["data"]["status"] == status
    assert _meeting(db, seed["meeting"]).processing_stage is None


@pytest.mark.parametrize(
    "stage, expected",
    [
        (None, (False, False, False)),
        ("stt", (True, False, False)),
        ("sources", (True, True, False)),
        ("extract", (True, True, False)),
        ("handoff", (True, True, True)),
    ],
)
def test_progress_follows_stage(client, db, seed, stage, expected):
    if stage is not None:
        meeting = _meeting(db, seed["meeting"])
        meeting.processing_stage = stage
        db.commit()

    r = client.get(f"/api/v1/meetings/{seed['meeting']}")

    p = r.json()["data"]["progress"]
    assert (p["audio_merged"], p["transcribed"], p["extracted"]) == expected


def test_source_backs_transcribed_when_stage_stuck_at_stt(client, db, seed):
    _stage(client, seed["meeting"], "stt")
    db.add(Source(meeting_id=seed["meeting"], seq=0, start_ms=0, end_ms=900, text="발화 0"))
    db.commit()

    r = client.get(f"/api/v1/meetings/{seed['meeting']}")

    assert r.json()["data"]["progress"]["transcribed"] is True


def test_fail_response_progress_uses_stage(client, seed):
    _stage(client, seed["meeting"], "sources")

    r = client.patch(
        f"/api/v1/meetings/{seed['meeting']}/fail",
        json={"failed_stage": "LLM"},
        headers=SERVICE_HEADERS,
    )

    assert r.status_code == 200
    assert r.json()["data"]["progress"]["transcribed"] is True


def test_late_stt_after_handoff_keeps_progress(client, seed):
    assert _stage(client, seed["meeting"], "handoff").json()["data"]["applied"] is True

    late = _stage(client, seed["meeting"], "stt")

    assert late.json()["data"]["applied"] is False
    p = client.get(f"/api/v1/meetings/{seed['meeting']}").json()["data"]["progress"]
    assert (p["audio_merged"], p["transcribed"], p["extracted"]) == (True, True, True)
