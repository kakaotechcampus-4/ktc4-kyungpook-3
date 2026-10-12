"""GET /integrations/discord/guilds/{guild_id}/workspace — 녹음 봇이 서버로 워크스페이스를 찾는다(#180).

TEST_DATABASE_URL이 있으면 PostgreSQL에서도 돈다.
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
from app.models import Integration, Member, Session as SessionModel, User, Workspace

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
TOKEN = "test-service-token"
HEADERS = {"X-Service-Token": TOKEN}
GUILD = "900000000000000001"
OTHER_GUILD = "900000000000000002"


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
def db(request, monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", TOKEN)
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
    """GUILD를 연결한 워크스페이스 A, 디스코드 없이 Notion만 연결한 워크스페이스 B, A의 PM 세션."""
    user = User(email="pm@example.com", name="pm")
    a = Workspace(name="A")
    b = Workspace(name="B")
    db.add_all([user, a, b])
    db.flush()
    db.add_all([
        SessionModel(
            user_id=user.user_id, session_token="pm-token",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        ),
        Member(workspace_id=a.workspace_id, user_id=user.user_id, display_name="pm", role="pm"),
        Integration(workspace_id=a.workspace_id, provider="discord", provider_channel_id=GUILD),
        # 다른 연동의 provider_channel_id가 우연히 같은 값이어도 디스코드 연결로 보지 않는다.
        Integration(workspace_id=b.workspace_id, provider="notion", provider_channel_id=OTHER_GUILD),
    ])
    db.commit()
    return {"a": a.workspace_id, "b": b.workspace_id}


def _url(guild_id: str) -> str:
    return f"/api/v1/integrations/discord/guilds/{guild_id}/workspace"


def test_returns_the_workspace_connected_to_the_guild(seed):
    r = TestClient(app).get(_url(GUILD), headers=HEADERS)

    assert r.status_code == 200, r.text
    assert r.json() == {"data": {"guild_id": GUILD, "workspace_id": seed["a"]}, "error": None}


@pytest.mark.parametrize("guild_id", [OTHER_GUILD, "unknown"], ids=["other-provider", "never-connected"])
def test_unconnected_guild_is_integration_not_connected(seed, guild_id):
    r = TestClient(app).get(_url(guild_id), headers=HEADERS)

    assert r.status_code == 409, r.text
    error = r.json()["error"]
    assert error["code"] == "INTEGRATION_NOT_CONNECTED"
    assert error["details"] == {"provider": "discord", "guild_id": guild_id}


def test_disconnected_guild_is_no_longer_found(db, seed):
    pm = TestClient(app, cookies={"session_token": "pm-token"})
    assert pm.delete(f"/api/v1/workspaces/{seed['a']}/integrations/discord").status_code == 204

    r = TestClient(app).get(_url(GUILD), headers=HEADERS)
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "INTEGRATION_NOT_CONNECTED"


def test_reconnecting_to_another_guild_moves_the_lookup(db, seed):
    """같은 워크스페이스가 다른 서버로 다시 연결하면 callback이 서버 ID를 바꾼다. 옛 서버는 더 이상 찾지 못한다."""
    integration = db.query(Integration).filter_by(workspace_id=seed["a"], provider="discord").one()
    integration.provider_channel_id = "900000000000000003"
    db.commit()

    client = TestClient(app, headers=HEADERS)
    assert client.get(_url(GUILD)).status_code == 409
    moved = client.get(_url("900000000000000003"))
    assert moved.status_code == 200, moved.text
    assert moved.json()["data"]["workspace_id"] == seed["a"]


@pytest.mark.parametrize(
    "client_kwargs",
    [
        {},
        {"headers": {"X-Service-Token": "wrong"}},
        # 연결한 워크스페이스의 PM 세션이어도 서비스 토큰을 대신하지 못한다.
        {"cookies": {"session_token": "pm-token"}},
    ],
    ids=["missing-token", "wrong-token", "member-session-only"],
)
def test_rejects_requests_without_valid_service_token(seed, client_kwargs):
    r = TestClient(app, **client_kwargs).get(_url(GUILD))

    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "UNAUTHENTICATED"


def test_rejects_all_requests_when_server_has_no_service_token(seed, monkeypatch):
    monkeypatch.delenv("SERVICE_TOKEN")

    assert TestClient(app).get(_url(GUILD), headers=HEADERS).status_code == 401
