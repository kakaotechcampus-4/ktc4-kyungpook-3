import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import (
    ApprovalRequest,
    Extraction,
    Meeting,
    Member,
    MemberAlias,
    Session as SessionModel,
    Task,
    User,
    Workspace,
)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
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


def _user_with_session(db, email: str, token: str) -> User:
    user = User(email=email, name=email.split("@")[0])
    db.add(user)
    db.flush()
    db.add(
        SessionModel(
            user_id=user.user_id,
            session_token=token,
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
    )
    return user


@pytest.fixture
def seed(db):
    """워크스페이스 A(소유자 alice)와 A에 속하지 않은 사용자 bob."""
    alice = _user_with_session(db, "alice@example.com", "alice-token")
    _user_with_session(db, "bob@example.com", "bob-token")

    ws = Workspace(name="A")
    db.add(ws)
    db.flush()

    member = Member(workspace_id=ws.workspace_id, user_id=alice.user_id, display_name="alice", role="pm")
    db.add(member)
    db.flush()

    alias = MemberAlias(
        member_id=member.member_id,
        workspace_id=ws.workspace_id,
        alias_text="앨리스",
        alias_type="nickname",
        source="manual",
    )
    task = Task(workspace_id=ws.workspace_id, title="설계", status="todo")
    approval = ApprovalRequest(
        workspace_id=ws.workspace_id,
        type="task_create",
        payload=json.dumps({"task_title": "승인 대기"}),
    )
    meeting = Meeting(workspace_id=ws.workspace_id, status="done")
    db.add_all([alias, task, approval, meeting])
    db.flush()

    extraction = Extraction(meeting_id=meeting.meeting_id)
    processing = Meeting(workspace_id=ws.workspace_id, status="processing")
    db.add_all([extraction, processing])
    db.commit()

    return {
        "ws": ws.workspace_id,
        "member": member.member_id,
        "alias": alias.alias_id,
        "task": task.task_id,
        "approval": approval.approval_id,
        "extraction": extraction.extraction_id,
        "processing_meeting": processing.meeting_id,
    }


def _requests(ids: dict) -> list[tuple[str, str, dict | None]]:
    ws = ids["ws"]
    return [
        ("GET", f"/api/v1/tasks?workspace_id={ws}", None),
        ("POST", "/api/v1/tasks", {"workspace_id": ws, "title": "새 태스크"}),
        ("GET", f"/api/v1/tasks/{ids['task']}", None),
        ("PATCH", f"/api/v1/tasks/{ids['task']}", {"title": "바꾼 제목"}),
        ("GET", f"/api/v1/tasks/{ids['task']}/history", None),
        ("GET", f"/api/v1/approvals?workspace_id={ws}", None),
        ("POST", "/api/v1/approvals", {"workspace_id": ws, "type": "task_create", "payload": {}}),
        ("GET", f"/api/v1/approvals/{ids['approval']}", None),
        ("PATCH", f"/api/v1/approvals/{ids['approval']}", {"status": "rejected", "resolved_by": ids["member"]}),
        ("GET", f"/api/v1/extractions/{ids['extraction']}", None),
        ("GET", f"/api/v1/members?workspace_id={ws}", None),
        ("POST", "/api/v1/members", {"workspace_id": ws, "display_name": "새 팀원"}),
        ("GET", f"/api/v1/members/aliases?workspace_id={ws}", None),
        ("GET", f"/api/v1/members/unresolved-aliases?workspace_id={ws}", None),
        ("GET", f"/api/v1/members/{ids['member']}", None),
        ("PATCH", f"/api/v1/members/{ids['member']}", {"display_name": "바꾼 이름"}),
        ("POST", f"/api/v1/members/{ids['member']}/aliases",
         {"alias_text": "앨", "alias_type": "nickname", "source": "manual"}),
        ("DELETE", f"/api/v1/members/aliases/{ids['alias']}", None),
        ("GET", f"/api/v1/workspaces/{ws}", None),
    ]


def _call(client: TestClient, method: str, url: str, body: dict | None):
    return client.request(method, url, json=body) if body is not None else client.request(method, url)


def test_unauthenticated_requests_are_rejected(seed):
    client = TestClient(app)
    for method, url, body in _requests(seed):
        response = _call(client, method, url, body)
        assert response.status_code == 401, (method, url, response.text)
        assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_non_member_requests_are_forbidden(seed):
    client = TestClient(app, cookies={"session_token": "bob-token"})
    for method, url, body in _requests(seed):
        response = _call(client, method, url, body)
        assert response.status_code == 403, (method, url, response.text)
        assert response.json()["error"]["code"] == "FORBIDDEN"


def _task_id_routes(task_id: str) -> list[tuple[str, str]]:
    """앱에 등록된 /tasks/{task_id}... 경로 전부. 새 경로가 추가돼도 자동으로 검사 대상에 들어간다."""
    routes = []
    for path, operations in app.openapi()["paths"].items():
        if path.startswith("/api/v1/tasks/{task_id}"):
            url = path.replace("{task_id}", task_id).replace("{history_id}", "any-history")
            routes += [(method.upper(), url) for method in operations]
    return routes


def test_every_task_id_route_requires_membership(seed):
    routes = _task_id_routes(seed["task"])
    assert routes

    anonymous = TestClient(app)
    outsider = TestClient(app, cookies={"session_token": "bob-token"})
    for method, url in routes:
        assert anonymous.request(method, url, json={}).status_code == 401, (method, url)
        assert outsider.request(method, url, json={}).status_code == 403, (method, url)


def test_non_member_cannot_change_resources(db, seed):
    client = TestClient(app, cookies={"session_token": "bob-token"})
    client.patch(f"/api/v1/approvals/{seed['approval']}", json={"status": "approved", "resolved_by": seed["member"]})
    client.patch(f"/api/v1/tasks/{seed['task']}", json={"title": "탈취"})

    db.expire_all()
    assert db.get(ApprovalRequest, seed["approval"]).status == "pending"
    assert db.get(Task, seed["task"]).title == "설계"


def test_member_can_read_workspace_resources(seed):
    client = TestClient(app, cookies={"session_token": "alice-token"})
    for method, url, body in _requests(seed):
        if method != "GET":
            continue
        response = _call(client, method, url, body)
        assert response.status_code == 200, (url, response.text)


def test_expired_session_is_rejected(db, seed):
    session = db.query(SessionModel).filter_by(session_token="alice-token").one()
    session.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()

    client = TestClient(app, cookies={"session_token": "alice-token"})
    assert client.get(f"/api/v1/tasks?workspace_id={seed['ws']}").status_code == 401


def test_bot_can_still_post_extraction_without_session(seed):
    response = TestClient(app).post(
        "/api/v1/extractions",
        json={"meeting_id": seed["processing_meeting"], "workspace_id": seed["ws"], "items": []},
    )
    assert response.status_code == 201, response.text
