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
        "meeting": meeting.meeting_id,
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
        ("GET", f"/api/v1/meetings/{ids['meeting']}", None),
        ("GET", f"/api/v1/meetings/{ids['meeting']}/minutes", None),
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


SERVICE_TOKEN = "test-service-token"


def _bot_requests(ids: dict) -> list[tuple[str, str, dict]]:
    """디스코드 봇이 사용자 세션 없이 부르는 회의 쓰기 경로(#179). 서비스 토큰으로만 막는다."""
    return [
        ("POST", "/api/v1/meetings", {"workspace_id": ids["ws"], "source": "discord"}),
        ("PATCH", f"/api/v1/meetings/{ids['created_meeting']}/end", {}),
        ("PATCH", f"/api/v1/meetings/{ids['failing_meeting']}/fail", {"failed_stage": "stt"}),
        ("POST", "/api/v1/extractions",
         {"meeting_id": ids["processing_meeting"], "workspace_id": ids["ws"], "items": []}),
    ]


@pytest.fixture
def bot_seed(db, seed, monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
    created = Meeting(workspace_id=seed["ws"], status="created")
    failing = Meeting(workspace_id=seed["ws"], status="processing")
    db.add_all([created, failing])
    db.commit()
    return {**seed, "created_meeting": created.meeting_id, "failing_meeting": failing.meeting_id}


@pytest.mark.parametrize(
    "client_kwargs",
    [
        {},
        {"headers": {"X-Service-Token": "wrong"}},
        # ASCII가 아닌 값도 500이 아니라 401이다. secrets.compare_digest는 비ASCII 문자열에 TypeError를 던진다.
        {"headers": {"X-Service-Token": "é".encode()}},
        # 워크스페이스 멤버의 세션이 있어도 서비스 토큰을 대신하지 못한다.
        {"cookies": {"session_token": "alice-token"}},
    ],
    ids=["missing-token", "wrong-token", "non-ascii-token", "member-session-only"],
)
def test_bot_routes_reject_requests_without_valid_service_token(db, bot_seed, client_kwargs):
    meetings_before = db.query(Meeting).count()
    extractions_before = db.query(Extraction).count()
    client = TestClient(app, **client_kwargs)
    for method, url, body in _bot_requests(bot_seed):
        response = client.request(method, url, json=body)
        assert response.status_code == 401, (method, url, response.text)
        assert response.json()["error"]["code"] == "UNAUTHENTICATED"

    db.expire_all()
    assert db.query(Meeting).count() == meetings_before
    assert db.get(Meeting, bot_seed["created_meeting"]).status == "created"
    assert db.get(Meeting, bot_seed["failing_meeting"]).status == "processing"
    assert db.get(Meeting, bot_seed["processing_meeting"]).status == "processing"
    assert db.query(Extraction).count() == extractions_before


def test_bot_routes_accept_service_token_without_session(bot_seed):
    client = TestClient(app, headers={"X-Service-Token": SERVICE_TOKEN})
    expected = [201, 202, 200, 201]
    for (method, url, body), status in zip(_bot_requests(bot_seed), expected):
        response = client.request(method, url, json=body)
        assert response.status_code == status, (method, url, response.text)


def test_bot_routes_reject_all_requests_when_server_has_no_service_token(bot_seed, monkeypatch):
    monkeypatch.delenv("SERVICE_TOKEN")
    client = TestClient(app, headers={"X-Service-Token": SERVICE_TOKEN})
    for method, url, body in _bot_requests(bot_seed):
        assert client.request(method, url, json=body).status_code == 401, (method, url)
