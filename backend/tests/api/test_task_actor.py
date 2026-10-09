"""task 변경 이력과 승인 처리의 변경자는 요청 값이 아니라 로그인한 멤버로 기록한다."""
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import (
    ApprovalRequest,
    Member,
    Session as SessionModel,
    TaskHistory,
    User,
    Workspace,
)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
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


@pytest.fixture
def seed(db):
    """워크스페이스에 로그인한 PM(alice)과 다른 멤버(carol)가 있다."""
    alice = User(email="alice@example.com", name="alice")
    db.add(alice)
    db.flush()
    db.add(SessionModel(
        user_id=alice.user_id,
        session_token="alice-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))

    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    pm = Member(workspace_id=ws.workspace_id, user_id=alice.user_id, display_name="alice", role="pm")
    other = Member(workspace_id=ws.workspace_id, display_name="carol", role="member")
    db.add_all([pm, other])
    db.commit()
    return {"ws": ws.workspace_id, "pm": pm.member_id, "other": other.member_id}


@pytest.fixture
def client(db):
    return TestClient(app, cookies={"session_token": "alice-token"})


def _histories(db, task_id: str) -> list[TaskHistory]:
    db.expire_all()
    return db.execute(select(TaskHistory).where(TaskHistory.task_id == task_id)).scalars().all()


def test_create_records_logged_in_member_ignoring_created_by(db, seed, client):
    response = client.post(
        "/api/v1/tasks",
        json={"workspace_id": seed["ws"], "title": "설계", "created_by": seed["other"]},
    )

    assert response.status_code == 201, response.text
    histories = _histories(db, response.json()["data"]["task_id"])
    assert histories and all(h.changed_by == seed["pm"] for h in histories)


def test_update_records_logged_in_member_ignoring_changed_by(db, seed, client):
    task_id = client.post("/api/v1/tasks", json={"workspace_id": seed["ws"], "title": "설계"}).json()["data"]["task_id"]

    response = client.patch(f"/api/v1/tasks/{task_id}", json={"title": "상세 설계", "changed_by": seed["other"]})

    assert response.status_code == 200, response.text
    title_changes = [h for h in _histories(db, task_id) if h.new_value == "상세 설계"]
    assert [h.changed_by for h in title_changes] == [seed["pm"]]


def test_update_without_changed_by_still_records_member(db, seed, client):
    task_id = client.post("/api/v1/tasks", json={"workspace_id": seed["ws"], "title": "설계"}).json()["data"]["task_id"]

    client.patch(f"/api/v1/tasks/{task_id}", json={"title": "상세 설계"})

    assert all(h.changed_by == seed["pm"] for h in _histories(db, task_id))


def test_rollback_records_logged_in_member_ignoring_query(db, seed, client):
    task_id = client.post("/api/v1/tasks", json={"workspace_id": seed["ws"], "title": "설계"}).json()["data"]["task_id"]
    client.patch(f"/api/v1/tasks/{task_id}", json={"title": "상세 설계"})
    title_change = next(h for h in _histories(db, task_id) if h.new_value == "상세 설계")

    response = client.post(
        f"/api/v1/tasks/{task_id}/history/{title_change.history_id}/rollback",
        params={"changed_by": seed["other"]},
    )

    assert response.status_code == 200, response.text
    assert all(h.changed_by == seed["pm"] for h in _histories(db, task_id))


def test_resolve_without_resolved_by_records_logged_in_member(db, seed, client):
    approval = ApprovalRequest(
        workspace_id=seed["ws"], type="task_create", payload=json.dumps({"task_title": "승인 대기"})
    )
    db.add(approval)
    db.commit()

    response = client.patch(f"/api/v1/approvals/{approval.approval_id}", json={"status": "approved"})

    assert response.status_code == 200, response.text
    assert response.json()["data"]["resolved_by"] == seed["pm"]
    task_id = response.json()["data"]["related_task_id"]
    assert all(h.changed_by == seed["pm"] for h in _histories(db, task_id))


def test_resolve_ignores_resolved_by_in_body(db, seed, client):
    approval = ApprovalRequest(
        workspace_id=seed["ws"], type="task_create", payload=json.dumps({"task_title": "승인 대기"})
    )
    db.add(approval)
    db.commit()

    response = client.patch(
        f"/api/v1/approvals/{approval.approval_id}",
        json={"status": "rejected", "resolved_by": seed["other"]},
    )

    assert response.status_code == 200, response.text
    assert response.json()["data"]["resolved_by"] == seed["pm"]
