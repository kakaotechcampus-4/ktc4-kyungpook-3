"""진행률(progress)은 팀 합의로 쓰지 않는다. 요청의 progress는 무시하고 응답에는 없으며, 옛 이력은 되돌릴 수 없다."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import Member, Session as SessionModel, Task, TaskHistory, User, Workspace


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
    db.add(Member(workspace_id=ws.workspace_id, user_id=user.user_id, display_name="pm", role="pm"))
    db.commit()
    return {"ws": ws.workspace_id}


@pytest.fixture
def client(db):
    return TestClient(app, cookies={"session_token": "pm-token"})


def test_create_ignores_progress_and_response_has_none(seed, client):
    response = client.post(
        "/api/v1/tasks", json={"workspace_id": seed["ws"], "title": "설계", "progress": 40}
    )

    assert response.status_code == 201, response.text
    assert "progress" not in response.json()["data"]


def test_patch_ignores_progress_even_when_out_of_range(seed, client):
    task_id = client.post("/api/v1/tasks", json={"workspace_id": seed["ws"], "title": "설계"}).json()["data"]["task_id"]

    response = client.patch(f"/api/v1/tasks/{task_id}", json={"progress": 999, "blocker": "대기"})

    assert response.status_code == 200, response.text
    assert "progress" not in response.json()["data"]
    assert response.json()["data"]["blocker"] == "대기"


def test_rolling_back_old_progress_history_is_400_not_500(db, seed, client):
    task = Task(workspace_id=seed["ws"], title="설계")
    db.add(task)
    db.flush()
    old = TaskHistory(
        task_id=task.task_id, changed_field="progress", old_value="10", new_value="20", change_source="manual"
    )
    db.add(old)
    db.commit()

    response = client.post(f"/api/v1/tasks/{task.task_id}/history/{old.history_id}/rollback")

    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "INVALID_REQUEST"
    assert "되돌릴 수 없는 변경 항목" in response.json()["error"]["message"]
