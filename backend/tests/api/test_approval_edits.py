"""승인 요청의 출처(payload change_source)와 승인하면서 고친 값(edits)을 API로 확인한다(#303)."""
import json
import os
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import (
    ApprovalRequest,
    Meeting,
    Member,
    Session as SessionModel,
    Task,
    TaskHistory,
    User,
    Workspace,
)

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
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()

    pm_user = User(email="pm@example.com", name="pm")
    db.add(pm_user)
    db.flush()
    db.add(SessionModel(
        user_id=pm_user.user_id, session_token="pm-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    pm = Member(workspace_id=ws.workspace_id, user_id=pm_user.user_id, display_name="PM", role="pm")
    jimin = Member(workspace_id=ws.workspace_id, display_name="지민", role="member")
    minsu = Member(workspace_id=ws.workspace_id, display_name="민수", role="member")
    db.add_all([pm, jimin, minsu])
    db.flush()
    other_ws = Workspace(name="B")
    db.add(other_ws)
    db.flush()
    outsider = Member(workspace_id=other_ws.workspace_id, display_name="외부", role="member")
    db.add(outsider)

    login = Task(workspace_id=ws.workspace_id, title="로그인 화면 시안", status="in_progress",
                 due_date=date(2026, 10, 3))
    meeting = Meeting(workspace_id=ws.workspace_id, status="processing")
    db.add_all([login, meeting])
    db.commit()
    return {"ws": ws, "pm": pm, "jimin": jimin, "minsu": minsu, "outsider": outsider, "login": login, "meeting": meeting}


@pytest.fixture
def client(seed):
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c




def _request(client, seed, type, payload, *, related_task_id=None):
    r = client.post("/api/v1/approvals", json={
        "workspace_id": seed["ws"].workspace_id, "type": type, "payload": payload,
        "related_task_id": related_task_id,
    })
    return r


def _create_approval(client, seed, type, payload, *, related_task_id=None) -> str:
    r = _request(client, seed, type, payload, related_task_id=related_task_id)
    assert r.status_code == 201, r.text
    return r.json()["data"]["approval_id"]


def _resolve(client, approval_id, status="approved", **extra):
    return client.patch(f"/api/v1/approvals/{approval_id}", json={"status": status, **extra})


def _history(db, task_id) -> list[TaskHistory]:
    db.expire_all()
    return list(db.execute(
        select(TaskHistory).where(TaskHistory.task_id == task_id).order_by(TaskHistory.created_at)
    ).scalars())


# ---------- 출처(change_source) ----------


def test_task_update_without_change_source_is_recorded_as_meeting(client, db, seed):
    approval_id = _create_approval(
        client, seed, "task_update", {"status": "done"}, related_task_id=seed["login"].task_id
    )

    assert _resolve(client, approval_id).status_code == 200

    [row] = [h for h in _history(db, seed["login"].task_id) if h.changed_field == "status"]
    assert row.change_source == "meeting"


def test_task_update_uses_change_source_from_payload(client, db, seed):
    approval_id = _create_approval(
        client, seed, "task_update", {"status": "done", "change_source": "reminder_reply"},
        related_task_id=seed["login"].task_id,
    )

    assert _resolve(client, approval_id).status_code == 200

    [row] = [h for h in _history(db, seed["login"].task_id) if h.changed_field == "status"]
    assert row.change_source == "reminder_reply"


def test_create_approval_rejects_unknown_change_source(client, seed):
    r = _request(
        client, seed, "task_update", {"status": "done", "change_source": "telepathy"},
        related_task_id=seed["login"].task_id,
    )

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


def test_create_approval_rejects_non_string_change_source(client, seed):
    r = _request(client, seed, "task_update", {"status": "done", "change_source": ["meeting"]})

    assert r.status_code == 400
