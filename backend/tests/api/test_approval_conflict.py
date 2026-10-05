"""task_update 승인 충돌 — 제안 뒤에 PM이 같은 필드를 직접 고쳤으면 승인이 그 값을 덮지 않는다(#135).

추출 등록(제안 생성) → PM의 task 직접 수정 → 승인 순서를 API로 그대로 밟는다.
승인이 task 행을 FOR UPDATE로 잠그므로, TEST_DATABASE_URL이 있으면 PostgreSQL에서도 돈다.
"""
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
    db.add(MemberAlias(
        member_id=jimin.member_id, workspace_id=ws.workspace_id, alias_text="지민님",
        alias_type="nickname", source="manual", confidence=1.0, verified=True,
    ))

    login = Task(workspace_id=ws.workspace_id, title="로그인 화면 시안", status="in_progress",
                 due_date=date(2026, 10, 3))
    meeting = Meeting(workspace_id=ws.workspace_id, status="processing")
    db.add_all([login, meeting])
    db.commit()
    return {"ws": ws, "pm": pm, "jimin": jimin, "minsu": minsu, "login": login, "meeting": meeting}


@pytest.fixture
def client(seed):
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c


def _propose(client, db, seed, **fields) -> ApprovalRequest:
    """회의 추출로 login task 수정 제안을 만든다."""
    r = client.post("/api/v1/extractions", json={
        "meeting_id": seed["meeting"].meeting_id,
        "workspace_id": seed["ws"].workspace_id,
        "items": [{"action": "update", "target_task_id": seed["login"].task_id, **fields}],
    })
    assert r.status_code == 201, r.text
    return _approval(db)


def _approval(db) -> ApprovalRequest:
    db.expire_all()
    return db.execute(select(ApprovalRequest).where(ApprovalRequest.type == "task_update")).scalar_one()


def _edit_task(client, task: Task, **fields):
    r = client.patch(f"/api/v1/tasks/{task.task_id}", json=fields)
    assert r.status_code == 200, r.text


def _approve(client, approval: ApprovalRequest, **extra):
    return client.patch(f"/api/v1/approvals/{approval.approval_id}", json={"status": "approved", **extra})


def _login(db, seed) -> Task:
    db.expire_all()
    return db.get(Task, seed["login"].task_id)


def test_proposal_keeps_base_values_of_changed_fields(client, db, seed):
    approval = _propose(client, db, seed, due_date="2026-10-06", status="done")

    payload = json.loads(approval.payload)
    assert payload["base_values"] == {"due_date": "2026-10-03", "status": "in_progress"}
    assert payload["base_task_version"] == 1


def test_approve_without_change_in_between_applies(client, db, seed):
    approval = _propose(client, db, seed, due_date="2026-10-06")

    r = _approve(client, approval)

    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "approved"
    assert _login(db, seed).due_date == date(2026, 10, 6)


def test_pm_edit_of_same_field_is_409_and_approval_stays_pending(client, db, seed):
    approval = _propose(client, db, seed, due_date="2026-10-06")
    _edit_task(client, seed["login"], due_date="2026-10-10")

    r = _approve(client, approval)

    assert r.status_code == 409
    error = r.json()["error"]
    assert error["code"] == "APPROVAL_CONFLICT"
    assert error["details"]["task_id"] == seed["login"].task_id
    assert error["details"]["conflicts"] == [
        {"field": "due_date", "base": "2026-10-03", "current": "2026-10-10", "proposed": "2026-10-06"}
    ]
    # PM이 고친 값이 남고, 승인 요청은 다시 처리할 수 있게 pending이다
    assert _login(db, seed).due_date == date(2026, 10, 10)
    assert _approval(db).status == "pending"
    assert _approval(db).resolved_by is None


def test_confirm_with_seen_version_applies_after_conflict(client, db, seed):
    approval = _propose(client, db, seed, due_date="2026-10-06")
    _edit_task(client, seed["login"], due_date="2026-10-10")
    conflict = _approve(client, approval).json()["error"]["details"]
    assert conflict["task_version"] == 2

    r = _approve(client, approval, confirm_task_version=conflict["task_version"])

    assert r.status_code == 200, r.text
    assert _login(db, seed).due_date == date(2026, 10, 6)
    assert _approval(db).status == "approved"


def test_confirm_is_rejected_if_task_changed_again_after_conflict(client, db, seed):
    approval = _propose(client, db, seed, due_date="2026-10-06")
    _edit_task(client, seed["login"], due_date="2026-10-10")
    seen = _approve(client, approval).json()["error"]["details"]["task_version"]
    # PM이 충돌을 보는 사이 누군가 또 고쳤다. PM은 10/12를 본 적이 없다
    _edit_task(client, seed["login"], due_date="2026-10-12")

    r = _approve(client, approval, confirm_task_version=seen)

    assert r.status_code == 409
    details = r.json()["error"]["details"]
    assert details["task_version"] == 3
    assert details["conflicts"][0]["current"] == "2026-10-12"
    assert _login(db, seed).due_date == date(2026, 10, 12)
    assert _approval(db).status == "pending"


def test_confirm_version_without_conflict_is_ignored(client, db, seed):
    approval = _propose(client, db, seed, due_date="2026-10-06")

    r = _approve(client, approval, confirm_task_version=99)

    assert r.status_code == 200, r.text
    assert _login(db, seed).due_date == date(2026, 10, 6)


def test_pm_edit_of_other_field_does_not_block(client, db, seed):
    approval = _propose(client, db, seed, due_date="2026-10-06")
    # version은 오르지만 제안한 필드(due_date)는 그대로다
    _edit_task(client, seed["login"], title="로그인 화면 시안 v2")

    r = _approve(client, approval)

    assert r.status_code == 200, r.text
    task = _login(db, seed)
    assert task.due_date == date(2026, 10, 6)
    assert task.title == "로그인 화면 시안 v2"


def test_pm_already_made_the_same_change_is_not_a_conflict(client, db, seed):
    approval = _propose(client, db, seed, due_date="2026-10-06")
    _edit_task(client, seed["login"], due_date="2026-10-06")

    r = _approve(client, approval)

    assert r.status_code == 200, r.text
    assert _login(db, seed).due_date == date(2026, 10, 6)


def test_conflict_on_status_and_assignee(client, db, seed):
    approval = _propose(client, db, seed, status="done", assignee_raw="지민님", assignee_type="thirdname")
    _edit_task(client, seed["login"], status="blocked", assignee_member_id=seed["minsu"].member_id)

    r = _approve(client, approval)

    assert r.status_code == 409
    fields = {c["field"]: c for c in r.json()["error"]["details"]["conflicts"]}
    assert fields["status"] == {"field": "status", "base": "in_progress", "current": "blocked", "proposed": "done"}
    assert fields["assignee_member_id"] == {
        "field": "assignee_member_id", "base": None,
        "current": seed["minsu"].member_id, "proposed": seed["jimin"].member_id,
    }
    task = _login(db, seed)
    assert task.status == "blocked"
    assert task.assignee_member_id == seed["minsu"].member_id


def test_conflict_writes_no_history(client, db, seed):
    approval = _propose(client, db, seed, due_date="2026-10-06")
    _edit_task(client, seed["login"], due_date="2026-10-10")
    db.expire_all()
    before = db.execute(select(TaskHistory)).scalars().all()

    assert _approve(client, approval).status_code == 409

    db.expire_all()
    assert len(db.execute(select(TaskHistory)).scalars().all()) == len(before)
    assert _login(db, seed).version == 2


def test_reject_ignores_conflict(client, db, seed):
    approval = _propose(client, db, seed, due_date="2026-10-06")
    _edit_task(client, seed["login"], due_date="2026-10-10")

    r = client.patch(f"/api/v1/approvals/{approval.approval_id}", json={"status": "rejected"})

    assert r.status_code == 200, r.text
    assert _login(db, seed).due_date == date(2026, 10, 10)


def test_request_without_base_values_keeps_old_behavior(client, db, seed):
    """이 기능 전에 만들어진 pending 요청이나 수동 생성 요청은 비교할 기준이 없어 그대로 반영한다."""
    login = seed["login"]
    approval = ApprovalRequest(
        workspace_id=seed["ws"].workspace_id, type="task_update",
        payload=json.dumps({"due_date": "2026-10-06", "task_title": login.title}),
        related_task_id=login.task_id,
    )
    db.add(approval)
    db.commit()
    _edit_task(client, login, due_date="2026-10-10")

    r = _approve(client, approval)

    assert r.status_code == 200, r.text
    assert _login(db, seed).due_date == date(2026, 10, 6)
