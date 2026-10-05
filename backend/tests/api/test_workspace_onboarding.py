"""워크스페이스 온보딩 단계 상태 저장 — 생성 직후 상태, PATCH 반영, 완료 판정, 검증, 권한, 재요청.

PATCH가 워크스페이스 행을 FOR UPDATE로 잠그므로, TEST_DATABASE_URL이 있으면 PostgreSQL에서도 돈다.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import Member, Session as SessionModel, User, Workspace, WorkspaceOnboardingStepState

STEPS = ["create_workspace", "connect_discord", "connect_notion", "connect_members"]
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
def pm(db) -> User:
    user = _user_with_session(db, "pm@example.com", "pm-token")
    _user_with_session(db, "member@example.com", "member-token")
    db.commit()
    return user


@pytest.fixture
def client(pm):
    c = TestClient(app)
    c.cookies.set("session_token", "pm-token")
    return c


@pytest.fixture
def workspace_id(client) -> str:
    r = client.post("/api/v1/workspaces", json={"name": "A"})
    assert r.status_code == 201
    return r.json()["data"]["workspace_id"]


def _onboarding(client, workspace_id: str) -> dict:
    r = client.get(f"/api/v1/workspaces/{workspace_id}")
    assert r.status_code == 200
    return r.json()["data"]["onboarding"]


def _statuses(onboarding: dict) -> dict[str, str]:
    return {s["step"]: s["status"] for s in onboarding["steps"]}


def _patch(client, workspace_id: str, step: str, action: str):
    return client.patch(
        f"/api/v1/workspaces/{workspace_id}/onboarding", json={"step": step, "action": action}
    )


def test_new_workspace_starts_with_only_create_workspace_completed(client, workspace_id):
    onboarding = _onboarding(client, workspace_id)

    assert [s["step"] for s in onboarding["steps"]] == STEPS
    assert _statuses(onboarding) == {
        "create_workspace": "completed",
        "connect_discord": "pending",
        "connect_notion": "pending",
        "connect_members": "pending",
    }
    assert onboarding["completed"] is False
    assert onboarding["current_step"] == "connect_discord"


def test_patch_saves_each_step_and_moves_current_step(client, workspace_id):
    assert _patch(client, workspace_id, "connect_discord", "complete").json() == {"data": {}, "error": None}
    onboarding = _onboarding(client, workspace_id)
    assert _statuses(onboarding)["connect_discord"] == "completed"
    assert onboarding["current_step"] == "connect_notion"

    _patch(client, workspace_id, "connect_notion", "skip")
    onboarding = _onboarding(client, workspace_id)
    assert _statuses(onboarding)["connect_notion"] == "skipped"
    assert onboarding["current_step"] == "connect_members"
    assert onboarding["completed"] is False


def test_all_steps_done_completes_onboarding(client, db, workspace_id):
    _patch(client, workspace_id, "connect_discord", "skip")
    _patch(client, workspace_id, "connect_notion", "complete")
    _patch(client, workspace_id, "connect_members", "skip")

    onboarding = _onboarding(client, workspace_id)
    assert onboarding["completed"] is True
    assert onboarding["current_step"] == ""
    db.expire_all()
    assert db.get(Workspace, workspace_id).onboarding_completed is True


def test_list_returns_saved_onboarding(client, workspace_id):
    _patch(client, workspace_id, "connect_discord", "complete")

    r = client.get("/api/v1/workspaces")
    [item] = r.json()["data"]["items"]
    assert _statuses(item["onboarding"])["connect_discord"] == "completed"
    assert item["onboarding"]["current_step"] == "connect_notion"


def test_repeated_request_is_ok_and_skip_does_not_undo_complete(client, db, workspace_id):
    assert _patch(client, workspace_id, "connect_discord", "complete").status_code == 200
    assert _patch(client, workspace_id, "connect_discord", "complete").status_code == 200
    assert _patch(client, workspace_id, "connect_discord", "skip").status_code == 200
    # FE가 이미 끝난 create_workspace를 다시 완료로 보내도 된다
    assert _patch(client, workspace_id, "create_workspace", "complete").status_code == 200

    assert _statuses(_onboarding(client, workspace_id))["connect_discord"] == "completed"
    rows = db.execute(
        select(WorkspaceOnboardingStepState).where(WorkspaceOnboardingStepState.workspace_id == workspace_id)
    ).scalars().all()
    assert sorted(r.step for r in rows) == ["connect_discord", "create_workspace"]


def test_skipped_step_can_be_completed_later(client, workspace_id):
    _patch(client, workspace_id, "connect_notion", "skip")
    _patch(client, workspace_id, "connect_notion", "complete")

    assert _statuses(_onboarding(client, workspace_id))["connect_notion"] == "completed"


@pytest.mark.parametrize(
    "step, action",
    [
        ("create_workspace", "skip"),
        ("unknown_step", "complete"),
        ("connect_discord", "finish"),
    ],
)
def test_invalid_request_is_400(client, workspace_id, step, action):
    r = _patch(client, workspace_id, step, action)

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    assert _statuses(_onboarding(client, workspace_id))["create_workspace"] == "completed"


def test_non_pm_member_cannot_update(client, db, workspace_id):
    other = db.execute(select(User).where(User.email == "member@example.com")).scalar_one()
    db.add(Member(workspace_id=workspace_id, user_id=other.user_id, display_name="m", role="member"))
    db.commit()
    client.cookies.set("session_token", "member-token")

    r = _patch(client, workspace_id, "connect_discord", "complete")

    assert r.status_code == 403
    assert _statuses(_onboarding(client, workspace_id))["connect_discord"] == "pending"


def test_workspace_without_rows_reads_defaults(client, db, pm):
    # 마이그레이션 전에 만들어진 공간처럼 단계 행이 없으면 기본값으로 읽는다
    ws = Workspace(name="B")
    db.add(ws)
    db.flush()
    db.add(Member(workspace_id=ws.workspace_id, user_id=pm.user_id, display_name="pm", role="pm"))
    db.commit()

    onboarding = _onboarding(client, ws.workspace_id)
    assert onboarding["current_step"] == "connect_discord"
    assert _statuses(onboarding)["create_workspace"] == "completed"
