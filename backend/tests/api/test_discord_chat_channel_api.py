"""채팅 수집 채널 설정 API(#428) — 채널 목록.

Discord 호출은 가짜로 바꾼다. TEST_DATABASE_URL이 있으면 PostgreSQL에서도 돈다.
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
from app.services import discord

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
SERVICE_TOKEN = "test-service-token"
GUILD = "900000000000000001"


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


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)


def _user(db, email: str, token: str) -> User:
    user = User(email=email, name=email.split("@")[0])
    db.add(user)
    db.flush()
    db.add(SessionModel(user_id=user.user_id, session_token=token, expires_at=datetime.now(timezone.utc) + timedelta(days=1)))
    return user


@pytest.fixture
def seed(db):
    """워크스페이스 A의 PM alice와 일반 팀원 bob. 워크스페이스 B는 PM carol."""
    alice = _user(db, "alice@example.com", "alice-token")
    bob = _user(db, "bob@example.com", "bob-token")
    carol = _user(db, "carol@example.com", "carol-token")
    ws, other = Workspace(name="A"), Workspace(name="B")
    db.add_all([ws, other])
    db.flush()
    db.add_all([
        Member(workspace_id=ws.workspace_id, user_id=alice.user_id, display_name="alice", role="pm"),
        Member(workspace_id=ws.workspace_id, user_id=bob.user_id, display_name="bob", role="member"),
        Member(workspace_id=other.workspace_id, user_id=carol.user_id, display_name="carol", role="pm"),
    ])
    db.commit()
    return {
        "workspace_id": ws.workspace_id, "other_workspace_id": other.workspace_id,
        "alice": alice.user_id, "bob": bob.user_id, "carol": carol.user_id,
    }


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def fake_discord(monkeypatch):
    """채널 목록·읽기 확인·메시지 보내기를 가짜로. calls 에 호출을 적고, state 로 돌려줄 값이나 예외를 정한다."""
    calls: list[tuple] = []
    state: dict = {"channels": [], "read_error": None, "post_error": None, "post_errors": {}}

    def list_channels(bot_token, guild_id, *, transport=None):
        calls.append(("list", guild_id))
        if isinstance(state["channels"], Exception):
            raise state["channels"]
        return state["channels"]

    def read_one(bot_token, channel_id, *, transport=None):
        calls.append(("read", channel_id))
        if state["read_error"] is not None:
            raise state["read_error"]

    def post(bot_token, channel_id, content, *, transport=None):
        calls.append(("post", channel_id, content))
        error = state["post_errors"].get(channel_id) or state["post_error"]
        if error is not None:
            raise error

    monkeypatch.setattr(discord, "list_text_channels", list_channels)
    monkeypatch.setattr(discord, "read_one_message", read_one)
    monkeypatch.setattr(discord, "post_channel_message", post)
    return calls, state


def _cookie(session: str) -> dict[str, str]:
    return {"Cookie": f"session_token={session}"}


def _connect(db, workspace_id, guild_id=GUILD) -> None:
    db.add(Integration(workspace_id=workspace_id, provider="discord", provider_channel_id=guild_id))
    db.commit()


def _channels(client, workspace_id, session="alice-token"):
    return client.get(f"/api/v1/workspaces/{workspace_id}/discord/channels", headers=_cookie(session))


def test_channel_list_for_pm(client, seed, db, fake_discord):
    calls, state = fake_discord
    _connect(db, seed["workspace_id"])
    state["channels"] = [
        {"channel_id": "111", "name": "general"},
        {"channel_id": "222", "name": "dev"},
    ]

    response = _channels(client, seed["workspace_id"])

    assert response.status_code == 200
    assert response.json()["data"] == {
        "items": [{"channel_id": "111", "name": "general"}, {"channel_id": "222", "name": "dev"}],
        "total": 2,
    }
    assert calls == [("list", GUILD)]


def test_channel_list_is_pm_only(client, seed, db, fake_discord):
    calls, _ = fake_discord
    _connect(db, seed["workspace_id"])

    for session in ("bob-token", "carol-token"):
        response = _channels(client, seed["workspace_id"], session)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "FORBIDDEN"
    assert calls == []


def test_channel_list_without_connection_is_409(client, seed, db, fake_discord):
    calls, _ = fake_discord

    # 연결 행이 없다
    response = _channels(client, seed["workspace_id"])
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INTEGRATION_NOT_CONNECTED"

    # 행은 있지만 서버 ID 가 비었다
    _connect(db, seed["workspace_id"], guild_id=None)
    response = _channels(client, seed["workspace_id"])
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INTEGRATION_NOT_CONNECTED"
    assert calls == []


def test_channel_list_without_bot_token_is_502(client, seed, db, fake_discord, monkeypatch):
    calls, _ = fake_discord
    _connect(db, seed["workspace_id"])
    monkeypatch.delenv("DISCORD_BOT_TOKEN")

    response = _channels(client, seed["workspace_id"])

    assert response.status_code == 502
    error = response.json()["error"]
    assert error["code"] == "DISCORD_API_FAILED"
    assert error["details"] == {"status": None, "reason": "bot_token_missing"}
    assert calls == []


def test_channel_list_discord_failure_is_502(client, seed, db, fake_discord):
    _, state = fake_discord
    _connect(db, seed["workspace_id"])
    state["channels"] = discord.DiscordApiError("HTTP 500", status_code=500)

    response = _channels(client, seed["workspace_id"])

    assert response.status_code == 502
    error = response.json()["error"]
    assert error["code"] == "DISCORD_API_FAILED"
    assert error["details"] == {"status": 500, "reason": "HTTP 500"}
    assert "bot-token" not in response.text
