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
from tests.usernames import username_for

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
    user = User(username=username_for("pm@example.com"), email="pm@example.com", name="pm")
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
        "stt": None,
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


# ---- 전사 진행(stt) ----


def _stt(client, meeting_id, done, total, stage="stt"):
    return client.patch(
        f"/api/v1/meetings/{meeting_id}/stage",
        json={"stage": stage, "stt": {"done": done, "total": total}},
        headers=SERVICE_HEADERS,
    )


def _processing(client, meeting_id):
    return client.get(f"/api/v1/meetings/{meeting_id}").json()["data"]["processing"]


def test_stt_progress_is_stored_and_exposed(client, seed):
    r = _stt(client, seed["meeting"], 0, 5)

    assert r.status_code == 200
    assert r.json()["data"]["applied"] is True
    assert r.json()["data"]["stt"] == {"done": 0, "total": 5}
    p = _processing(client, seed["meeting"])
    assert p["stage"] == "stt"
    assert p["stage_at"] is not None
    assert p["stt"] == {"done": 0, "total": 5}


def test_stt_progress_update_keeps_stage_at(client, db, seed):
    _stt(client, seed["meeting"], 0, 5)
    first_at = _meeting(db, seed["meeting"]).processing_stage_at

    r = _stt(client, seed["meeting"], 2, 5)

    assert r.json()["data"]["applied"] is True
    assert r.json()["data"]["stt"] == {"done": 2, "total": 5}
    assert _meeting(db, seed["meeting"]).processing_stage_at == first_at
    assert _processing(client, seed["meeting"])["stt"] == {"done": 2, "total": 5}


def test_first_stt_progress_after_bare_stt_stage(client, db, seed):
    """봇은 stt 단계를 진행 없이 먼저 알리고, 첫 진행은 그 뒤 같은 단계로 온다."""
    _stage(client, seed["meeting"], "stt")
    first_at = _meeting(db, seed["meeting"]).processing_stage_at

    r = _stt(client, seed["meeting"], 0, 5)

    assert r.json()["data"]["applied"] is True
    assert r.json()["data"]["stt"] == {"done": 0, "total": 5}
    assert _meeting(db, seed["meeting"]).processing_stage_at == first_at


def test_same_stt_progress_is_ignored(client, seed):
    _stt(client, seed["meeting"], 2, 5)

    r = _stt(client, seed["meeting"], 2, 5)

    assert r.json()["data"]["applied"] is False


def test_stt_resend_without_progress_keeps_progress(client, seed):
    _stt(client, seed["meeting"], 2, 5)

    r = _stage(client, seed["meeting"], "stt")

    assert r.json()["data"]["applied"] is False
    assert r.json()["data"]["stt"] == {"done": 2, "total": 5}
    assert _processing(client, seed["meeting"])["stt"] == {"done": 2, "total": 5}


def test_stt_progress_decrease_overwrites(client, seed):
    _stt(client, seed["meeting"], 4, 5)

    r = _stt(client, seed["meeting"], 1, 5)

    assert r.json()["data"]["applied"] is True
    assert _processing(client, seed["meeting"])["stt"] == {"done": 1, "total": 5}


def test_moving_past_stt_clears_progress(client, seed):
    _stt(client, seed["meeting"], 5, 5)

    r = _stage(client, seed["meeting"], "sources")

    assert r.json()["data"]["applied"] is True
    assert r.json()["data"]["stt"] is None
    p = _processing(client, seed["meeting"])
    assert p["stage"] == "sources"
    assert p["stt"] is None


def test_late_stt_progress_after_handoff_is_ignored(client, seed):
    _stage(client, seed["meeting"], "handoff")

    r = _stt(client, seed["meeting"], 3, 5)

    assert r.json()["data"]["applied"] is False
    assert r.json()["data"]["stt"] is None
    p = _processing(client, seed["meeting"])
    assert p["stage"] == "handoff"
    assert p["stt"] is None


def test_late_stt_progress_does_not_change_stored_value_after_handoff(client, db, seed):
    meeting = _meeting(db, seed["meeting"])
    meeting.processing_stage = "handoff"
    meeting.processing_stt_done = 5
    meeting.processing_stt_total = 5
    db.commit()

    r = _stt(client, seed["meeting"], 1, 5)

    assert r.json()["data"]["applied"] is False
    m = _meeting(db, seed["meeting"])
    assert (m.processing_stt_done, m.processing_stt_total) == (5, 5)


@pytest.mark.parametrize(
    "stage, stt",
    [
        ("stt", {"done": 6, "total": 5}),
        ("stt", {"done": 0, "total": 0}),
        ("stt", {"done": -1, "total": 5}),
        ("stt", {"done": "1", "total": 5}),
        ("stt", {"done": 1, "total": "5"}),
        ("stt", {"done": True, "total": 5}),
        ("stt", {"done": 1, "total": True}),
        ("stt", {"done": 0, "total": 2_147_483_648}),
        ("sources", {"done": 1, "total": 5}),
    ],
)
def test_stt_progress_invalid_400(client, db, seed, stage, stt):
    r = client.patch(
        f"/api/v1/meetings/{seed['meeting']}/stage",
        json={"stage": stage, "stt": stt},
        headers=SERVICE_HEADERS,
    )

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    assert _meeting(db, seed["meeting"]).processing_stage is None


@pytest.mark.parametrize("status", ["created", "awaiting_speakers", "done", "failed"])
def test_stt_progress_ignored_on_non_processing(client, db, seed, status):
    meeting = _meeting(db, seed["meeting"])
    meeting.status = status
    db.commit()

    r = _stt(client, seed["meeting"], 1, 5)

    assert r.status_code == 200
    assert r.json()["data"]["applied"] is False
    assert r.json()["data"]["stt"] is None
    m = _meeting(db, seed["meeting"])
    assert m.processing_stt_done is None
    assert m.processing_stt_total is None
    assert _processing(client, seed["meeting"]) is None


def test_processing_without_report_has_empty_fields(client, seed):
    assert _processing(client, seed["meeting"]) == {"stage": None, "stage_at": None, "stt": None}


def test_fail_response_processing_is_null(client, seed):
    _stt(client, seed["meeting"], 1, 5)

    r = client.patch(
        f"/api/v1/meetings/{seed['meeting']}/fail",
        json={"failed_stage": "STT"},
        headers=SERVICE_HEADERS,
    )

    assert r.status_code == 200
    assert r.json()["data"]["processing"] is None
