"""쓰기 API의 PM 권한(#163). 할일·팀원·연동을 바꾸는 작업은 PM만 하고, 일반 팀원은 승인 요청으로 변경을 요청한다.

PM 역할 변경은 마지막 PM을 내리지 못하게 막는다. TEST_DATABASE_URL이 있으면 PostgreSQL에서도 돈다.
"""
import json
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import (
    ApprovalRequest,
    Integration,
    Member,
    MemberAlias,
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


def _user(db, name: str, token: str) -> User:
    user = User(email=f"{name}@example.com", name=name)
    db.add(user)
    db.flush()
    db.add(SessionModel(
        user_id=user.user_id, session_token=token,
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    return user


@pytest.fixture
def seed(db):
    """워크스페이스 A: PM(pm-token), 로그인 계정이 있는 일반 팀원(member-token), 계정 없는 팀원(디스코드 명단).
    outsider-token 은 A에 속하지 않은 사용자다."""
    pm_user = _user(db, "pm", "pm-token")
    member_user = _user(db, "member", "member-token")
    _user(db, "outsider", "outsider-token")

    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    pm = Member(workspace_id=ws.workspace_id, user_id=pm_user.user_id, display_name="PM", role="pm")
    member = Member(workspace_id=ws.workspace_id, user_id=member_user.user_id, display_name="지민", role="member")
    roster = Member(workspace_id=ws.workspace_id, display_name="민수", role="member", discord_user_id="disc_minsu")
    db.add_all([pm, member, roster])
    db.flush()

    task = Task(workspace_id=ws.workspace_id, title="로그인 화면", status="todo")
    db.add(task)
    db.flush()
    history = TaskHistory(
        task_id=task.task_id, changed_field="title", old_value="로그인", new_value="로그인 화면",
        change_source="manual", changed_by=pm.member_id,
    )
    alias = MemberAlias(
        member_id=roster.member_id, workspace_id=ws.workspace_id, alias_text="민수님",
        alias_type="nickname", source="manual",
    )
    approval = ApprovalRequest(
        workspace_id=ws.workspace_id, type="task_update", related_task_id=task.task_id,
        payload=json.dumps({"status": "done", "task_title": task.title}),
    )
    integration = Integration(workspace_id=ws.workspace_id, provider="discord")
    db.add_all([history, alias, approval, integration])
    db.commit()
    return {
        "ws": ws, "pm": pm, "member": member, "roster": roster, "task": task,
        "history": history, "alias": alias, "approval": approval,
    }


def _client(token: str) -> TestClient:
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", token)
    return c


def _call(token: str, name: str, seed):
    """이름으로 고른 PM 전용 쓰기 요청을 보낸다."""
    c = _client(token)
    ws_id = seed["ws"].workspace_id
    task_id = seed["task"].task_id
    calls = {
        "approval_resolve": lambda: c.patch(
            f"/api/v1/approvals/{seed['approval'].approval_id}", json={"status": "rejected"}),
        "task_create": lambda: c.post("/api/v1/tasks", json={"workspace_id": ws_id, "title": "새 할일"}),
        "task_update": lambda: c.patch(f"/api/v1/tasks/{task_id}", json={"status": "in_progress"}),
        "task_rollback": lambda: c.post(
            f"/api/v1/tasks/{task_id}/history/{seed['history'].history_id}/rollback"),
        "notion_retry": lambda: c.post(f"/api/v1/tasks/{task_id}/notion-sync/retry"),
        "member_create": lambda: c.post("/api/v1/members", json={"workspace_id": ws_id, "display_name": "새 팀원"}),
        "member_update": lambda: c.patch(
            f"/api/v1/members/{seed['roster'].member_id}", json={"display_name": "민수2"}),
        "alias_create": lambda: c.post(
            f"/api/v1/members/{seed['roster'].member_id}/aliases", json={"alias_text": "민수씨"}),
        "alias_delete": lambda: c.delete(f"/api/v1/members/aliases/{seed['alias'].alias_id}"),
        "integration_delete": lambda: c.delete(f"/api/v1/workspaces/{ws_id}/integrations/discord"),
        "meeting_upload": lambda: c.post(
            f"/api/v1/workspaces/{ws_id}/meetings/upload",
            data={"title": "회의", "attendee_member_ids": seed["pm"].member_id},
            files={"file": ("a.wav", b"RIFF", "audio/wav")},
        ),
    }
    return calls[name]()


PM_ONLY = [
    "approval_resolve", "task_create", "task_update", "task_rollback", "notion_retry",
    "member_create", "member_update", "alias_create", "alias_delete", "integration_delete", "meeting_upload",
]


@pytest.mark.parametrize("name", PM_ONLY)
def test_member_gets_403_on_pm_only_write(db, seed, name):
    r = _call("member-token", name, seed)

    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "FORBIDDEN"


@pytest.mark.parametrize("name", PM_ONLY)
def test_outsider_gets_403_on_pm_only_write(db, seed, name):
    assert _call("outsider-token", name, seed).status_code == 403


@pytest.mark.parametrize("name", PM_ONLY)
def test_pm_passes_the_permission_check(db, seed, name):
    # 권한을 넘으면 각 API의 업무 규칙대로 응답한다(예: Notion 미연결 재시도는 409). 403만 아니면 된다
    r = _call("pm-token", name, seed)

    assert r.status_code != 403, r.text


def test_member_cannot_change_anything_with_a_rejected_write(db, seed):
    _call("member-token", "approval_resolve", seed)
    _call("member-token", "task_update", seed)
    _call("member-token", "alias_delete", seed)

    db.expire_all()
    assert db.get(ApprovalRequest, seed["approval"].approval_id).status == "pending"
    assert db.get(Task, seed["task"].task_id).status == "todo"
    assert db.get(MemberAlias, seed["alias"].alias_id) is not None


# ── 일반 팀원의 변경 요청 경로 ──

def test_member_can_request_a_change_and_pm_approves_it(db, seed):
    r = _client("member-token").post("/api/v1/approvals", json={
        "workspace_id": seed["ws"].workspace_id, "type": "task_update",
        "related_task_id": seed["task"].task_id, "payload": {"status": "done"},
    })
    assert r.status_code == 201, r.text
    approval_id = r.json()["data"]["approval_id"]

    r = _client("pm-token").patch(f"/api/v1/approvals/{approval_id}", json={"status": "approved"})

    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Task, seed["task"].task_id).status == "done"


def test_requester_is_the_logged_in_member_not_the_body_value(db, seed):
    r = _client("member-token").post("/api/v1/approvals", json={
        "workspace_id": seed["ws"].workspace_id, "type": "task_update",
        "related_task_id": seed["task"].task_id, "payload": {"status": "done"},
        "requested_by": seed["pm"].member_id,
    })

    assert r.status_code == 201, r.text
    assert r.json()["data"]["requested_by"] == seed["member"].member_id


def test_outsider_cannot_request_a_change(db, seed):
    r = _client("outsider-token").post("/api/v1/approvals", json={
        "workspace_id": seed["ws"].workspace_id, "type": "task_update",
        "related_task_id": seed["task"].task_id, "payload": {"status": "done"},
    })

    assert r.status_code == 403


# ── PM 역할 변경 ──

def _set_role(token: str, member: Member, role: str):
    return _client(token).patch(f"/api/v1/members/{member.member_id}", json={"role": role})


def _role(db, member: Member) -> str:
    db.expire_all()
    return db.get(Member, member.member_id).role


def test_member_cannot_promote_self_to_pm(db, seed):
    r = _set_role("member-token", seed["member"], "pm")

    assert r.status_code == 403
    assert _role(db, seed["member"]) == "member"


def test_last_pm_cannot_demote_self(db, seed):
    r = _set_role("pm-token", seed["pm"], "member")

    assert r.status_code == 409
    assert r.json()["error"]["code"] == "LAST_PM_REQUIRED"
    assert _role(db, seed["pm"]) == "pm"


def test_pm_hands_over_by_promoting_another_member_first(db, seed):
    assert _set_role("pm-token", seed["member"], "pm").status_code == 200

    r = _set_role("pm-token", seed["pm"], "member")

    assert r.status_code == 200, r.text
    assert _role(db, seed["pm"]) == "member"
    assert _role(db, seed["member"]) == "pm"
    # 넘긴 뒤에는 옛 PM이 PM 전용 작업을 못 하고, 새 PM은 할 수 있다
    assert _call("pm-token", "task_update", seed).status_code == 403
    assert _call("member-token", "task_update", seed).status_code == 200


def test_member_without_login_account_does_not_count_as_remaining_pm(db, seed):
    """디스코드 명단 팀원은 PM이어도 웹에 들어올 수 없어, 그 사람만 남기고 내려가면 PM이 없는 것과 같다."""
    assert _set_role("pm-token", seed["roster"], "pm").status_code == 200

    r = _set_role("pm-token", seed["pm"], "member")

    assert r.status_code == 409
    assert _role(db, seed["pm"]) == "pm"


def test_pm_can_demote_another_pm_when_one_remains(db, seed):
    assert _set_role("pm-token", seed["member"], "pm").status_code == 200

    r = _set_role("pm-token", seed["member"], "member")

    assert r.status_code == 200, r.text
    assert _role(db, seed["member"]) == "member"


def test_other_member_fields_still_update_for_pm(db, seed):
    r = _client("pm-token").patch(
        f"/api/v1/members/{seed['roster'].member_id}", json={"display_name": "민수2", "role": "member"})

    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Member, seed["roster"].member_id).display_name == "민수2"


def test_pm_can_still_read_and_member_can_still_read(db, seed):
    ws_id = seed["ws"].workspace_id
    for token in ("pm-token", "member-token"):
        c = _client(token)
        assert c.get(f"/api/v1/tasks?workspace_id={ws_id}").status_code == 200
        assert c.get(f"/api/v1/approvals?workspace_id={ws_id}").status_code == 200
        assert c.get(f"/api/v1/members?workspace_id={ws_id}").status_code == 200


def test_roster_member_is_unchanged_by_rejected_role_change(db, seed):
    _set_role("member-token", seed["roster"], "pm")

    assert db.execute(select(Member.role).where(Member.member_id == seed["roster"].member_id)).scalar_one() == "member"


def test_change_request_for_a_task_of_another_workspace_is_rejected(db, seed):
    other = Workspace(name="B")
    db.add(other)
    db.flush()
    foreign = Task(workspace_id=other.workspace_id, title="남의 할일", status="todo")
    db.add(foreign)
    db.commit()

    r = _client("member-token").post("/api/v1/approvals", json={
        "workspace_id": seed["ws"].workspace_id, "type": "task_update",
        "related_task_id": foreign.task_id, "payload": {"status": "done"},
    })

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "WORKSPACE_MISMATCH"
    db.expire_all()
    assert db.execute(select(ApprovalRequest).where(ApprovalRequest.related_task_id == foreign.task_id)).first() is None


def test_change_request_for_a_missing_task_is_404(db, seed):
    r = _client("member-token").post("/api/v1/approvals", json={
        "workspace_id": seed["ws"].workspace_id, "type": "task_update",
        "related_task_id": "no-such-task", "payload": {"status": "done"},
    })

    assert r.status_code == 404
