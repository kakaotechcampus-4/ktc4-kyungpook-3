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
from app.services import chat_channel, discord
from app.services.sessions import hash_session_token
from tests.usernames import username_for

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
    user = User(username=username_for(email), email=email, name=email.split("@")[0])
    db.add(user)
    db.flush()
    db.add(SessionModel(user_id=user.user_id, session_token=hash_session_token(token), expires_at=datetime.now(timezone.utc) + timedelta(days=1)))
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


# ---------- 저장·해제(Task 3) ----------

CHANNELS = [
    {"channel_id": "31", "name": "회의"},
    {"channel_id": "36", "name": "잡담"},
]


def _put(client, workspace_id, channel_id, session="alice-token"):
    return client.put(
        f"/api/v1/workspaces/{workspace_id}/integrations/discord/chat-channel",
        json={"channel_id": channel_id},
        headers=_cookie(session),
    )


def _clear(client, workspace_id, session="alice-token"):
    return client.delete(
        f"/api/v1/workspaces/{workspace_id}/integrations/discord/chat-channel",
        headers=_cookie(session),
    )


def _row(db, workspace_id) -> Integration:
    db.expire_all()
    return db.query(Integration).filter(
        Integration.workspace_id == workspace_id, Integration.provider == "discord"
    ).one()


def _ready(db, seed, fake_discord):
    calls, state = fake_discord
    _connect(db, seed["workspace_id"])
    state["channels"] = CHANNELS
    return calls, state


def _assert_untouched(db, seed):
    row = _row(db, seed["workspace_id"])
    assert row.chat_channel_id is None
    assert row.chat_channel_name is None


def test_put_saves_after_check_read_and_on_notice(client, seed, db, fake_discord):
    calls, _ = _ready(db, seed, fake_discord)

    response = _put(client, seed["workspace_id"], "31")

    assert response.status_code == 200
    assert response.json()["data"] == {"channel_id": "31", "name": "회의"}
    row = _row(db, seed["workspace_id"])
    assert (row.chat_channel_id, row.chat_channel_name) == ("31", "회의")
    assert calls == [("list", GUILD), ("read", "31"), ("post", "31", chat_channel.ON_NOTICE)]


def test_put_unknown_or_non_text_channel_is_404(client, seed, db, fake_discord):
    calls, _ = _ready(db, seed, fake_discord)

    response = _put(client, seed["workspace_id"], "99")

    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "DISCORD_CHANNEL_NOT_FOUND"
    assert error["details"] == {"channel_id": "99"}
    assert calls == [("list", GUILD)]
    _assert_untouched(db, seed)


def test_put_unreadable_channel_is_409_read(client, seed, db, fake_discord):
    calls, state = _ready(db, seed, fake_discord)
    state["read_error"] = discord.DiscordApiError("HTTP 403", status_code=403, discord_code=50001)

    response = _put(client, seed["workspace_id"], "31")

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "DISCORD_CHANNEL_NOT_ACCESSIBLE"
    assert error["details"] == {"channel_id": "31", "need": "read", "discord_code": 50001}
    assert not any(call[0] == "post" for call in calls)
    _assert_untouched(db, seed)


def test_put_read_404_is_not_found(client, seed, db, fake_discord):
    _, state = _ready(db, seed, fake_discord)
    state["read_error"] = discord.DiscordApiError("HTTP 404", status_code=404)

    response = _put(client, seed["workspace_id"], "31")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "DISCORD_CHANNEL_NOT_FOUND"
    _assert_untouched(db, seed)


def test_put_on_notice_forbidden_is_409_send(client, seed, db, fake_discord):
    _, state = _ready(db, seed, fake_discord)
    state["post_error"] = discord.DiscordApiError("HTTP 403", status_code=403, discord_code=50013)

    response = _put(client, seed["workspace_id"], "31")

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "DISCORD_CHANNEL_NOT_ACCESSIBLE"
    assert error["details"]["need"] == "send"
    _assert_untouched(db, seed)


def test_put_on_notice_server_error_is_502(client, seed, db, fake_discord):
    _, state = _ready(db, seed, fake_discord)
    state["post_error"] = discord.DiscordApiError("HTTP 500", status_code=500)

    response = _put(client, seed["workspace_id"], "31")

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "DISCORD_API_FAILED"
    _assert_untouched(db, seed)


def test_put_same_channel_again_calls_nothing(client, seed, db, fake_discord):
    calls, _ = _ready(db, seed, fake_discord)
    assert _put(client, seed["workspace_id"], "31").status_code == 200
    calls.clear()

    response = _put(client, seed["workspace_id"], "31")

    assert response.status_code == 200
    assert response.json()["data"] == {"channel_id": "31", "name": "회의"}
    assert calls == []


def test_put_other_channel_sends_off_notice_to_old_one(client, seed, db, fake_discord):
    calls, state = _ready(db, seed, fake_discord)
    assert _put(client, seed["workspace_id"], "31").status_code == 200

    response = _put(client, seed["workspace_id"], "36")

    assert response.status_code == 200
    assert _row(db, seed["workspace_id"]).chat_channel_id == "36"
    assert calls[-1] == ("post", "31", chat_channel.OFF_NOTICE)

    # 옛 채널에 끄는 공지를 못 보내도 저장은 성공한다
    state["post_errors"]["36"] = discord.DiscordApiError("HTTP 500", status_code=500)
    response = _put(client, seed["workspace_id"], "31")
    assert response.status_code == 200
    assert _row(db, seed["workspace_id"]).chat_channel_id == "31"


@pytest.mark.parametrize("bad", ["abc", "1" * 21, "   ", ""])
def test_put_invalid_channel_id_is_400(client, seed, db, fake_discord, bad):
    calls, _ = _ready(db, seed, fake_discord)

    response = _put(client, seed["workspace_id"], bad)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_REQUEST"
    assert calls == []


def test_put_strips_surrounding_spaces(client, seed, db, fake_discord):
    _ready(db, seed, fake_discord)

    response = _put(client, seed["workspace_id"], " 31 ")

    assert response.status_code == 200
    assert _row(db, seed["workspace_id"]).chat_channel_id == "31"


def test_put_is_pm_only(client, seed, db, fake_discord):
    calls, _ = _ready(db, seed, fake_discord)

    for session in ("bob-token", "carol-token"):
        response = _put(client, seed["workspace_id"], "31", session)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "FORBIDDEN"
    assert calls == []


def test_put_without_connection_is_409(client, seed, db, fake_discord):
    calls, _ = fake_discord

    response = _put(client, seed["workspace_id"], "31")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INTEGRATION_NOT_CONNECTED"
    assert calls == []


def test_put_without_bot_token_is_502_and_saves_nothing(client, seed, db, fake_discord, monkeypatch):
    calls, _ = _ready(db, seed, fake_discord)
    monkeypatch.delenv("DISCORD_BOT_TOKEN")

    response = _put(client, seed["workspace_id"], "31")

    assert response.status_code == 502
    assert response.json()["error"]["details"] == {"status": None, "reason": "bot_token_missing"}
    assert calls == []
    _assert_untouched(db, seed)


def _spy_rollback(db, monkeypatch) -> list[int]:
    """db.rollback 호출을 센다. 공유 세션은 expire_all 로 읽으므로 행 상태만으로는 rollback 유무를 알 수 없다."""
    rollbacks: list[int] = []
    original = db.rollback

    def spy():
        rollbacks.append(1)
        return original()

    monkeypatch.setattr(db, "rollback", spy)
    return rollbacks


def test_put_uses_the_guild_read_after_lock(client, seed, db, fake_discord, monkeypatch):
    calls, state = fake_discord
    _connect(db, seed["workspace_id"], guild_id="A")
    state["channels"] = CHANNELS
    original = chat_channel.connected_discord

    def swap_guild_after_lock(session, workspace_id, *, lock=False):
        assert lock is True  # 행을 잠근 채 서버 ID 를 읽는다
        integration = original(session, workspace_id, lock=lock)
        integration.provider_channel_id = "B"
        return integration

    monkeypatch.setattr(chat_channel, "connected_discord", swap_guild_after_lock)

    response = _put(client, seed["workspace_id"], "31")

    assert response.status_code == 200
    assert calls[0] == ("list", "B")


def test_put_channel_list_failure_is_502_and_saves_nothing(client, seed, db, fake_discord, monkeypatch):
    calls, state = _ready(db, seed, fake_discord)
    state["channels"] = discord.DiscordApiError("HTTP 500", status_code=500)
    rollbacks = _spy_rollback(db, monkeypatch)

    response = _put(client, seed["workspace_id"], "31")

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "DISCORD_API_FAILED"
    assert [c[0] for c in calls] == ["list"]
    assert rollbacks
    _assert_untouched(db, seed)


def test_commit_failure_after_on_notice_is_logged_as_error(seed, db, fake_discord, monkeypatch, caplog):
    calls, _ = _ready(db, seed, fake_discord)

    def failing_commit():
        raise RuntimeError("commit 실패")

    rollbacks = _spy_rollback(db, monkeypatch)
    monkeypatch.setattr(db, "commit", failing_commit)
    safe_client = TestClient(app, raise_server_exceptions=False)

    with caplog.at_level("ERROR"):
        response = _put(safe_client, seed["workspace_id"], "31")

    assert response.status_code == 500
    assert rollbacks, "commit 실패 뒤 rollback 이 호출돼야 한다"
    assert ("post", "31", chat_channel.ON_NOTICE) in calls
    assert any(r.levelname == "ERROR" and "저장 실패" in r.getMessage() for r in caplog.records)
    monkeypatch.undo()
    _assert_untouched(db, seed)


def test_clear_removes_and_sends_off_notice(client, seed, db, fake_discord):
    calls, _ = _ready(db, seed, fake_discord)
    assert _put(client, seed["workspace_id"], "31").status_code == 200

    response = _clear(client, seed["workspace_id"])

    assert response.status_code == 200
    assert response.json()["data"] == {"off_notice_sent": True}
    _assert_untouched(db, seed)
    assert calls[-1] == ("post", "31", chat_channel.OFF_NOTICE)


@pytest.mark.parametrize("cause", ["post_fails", "no_bot_token"])
def test_clear_succeeds_when_off_notice_fails(client, seed, db, fake_discord, monkeypatch, cause):
    _, state = _ready(db, seed, fake_discord)
    assert _put(client, seed["workspace_id"], "31").status_code == 200
    if cause == "post_fails":
        state["post_error"] = discord.DiscordApiError("HTTP 500", status_code=500)
    else:
        monkeypatch.delenv("DISCORD_BOT_TOKEN")

    response = _clear(client, seed["workspace_id"])

    assert response.status_code == 200
    assert response.json()["data"] == {"off_notice_sent": False}
    _assert_untouched(db, seed)


@pytest.mark.parametrize("connected", [True, False])
def test_clear_when_already_off_is_200_false(client, seed, db, fake_discord, connected):
    calls, _ = fake_discord
    if connected:
        _connect(db, seed["workspace_id"])

    response = _clear(client, seed["workspace_id"])

    assert response.status_code == 200
    assert response.json()["data"] == {"off_notice_sent": False}
    assert calls == []


def test_clear_is_pm_only(client, seed, db, fake_discord):
    calls, _ = _ready(db, seed, fake_discord)
    assert _put(client, seed["workspace_id"], "31").status_code == 200
    calls.clear()

    for session in ("bob-token", "carol-token"):
        assert _clear(client, seed["workspace_id"], session).status_code == 403
    assert calls == []
    assert _row(db, seed["workspace_id"]).chat_channel_id == "31"


def _integrations(client, workspace_id, session="alice-token"):
    return client.get(f"/api/v1/workspaces/{workspace_id}/integrations", headers=_cookie(session))


def test_integrations_shows_chat_channel(client, seed, db, fake_discord):
    ws = seed["workspace_id"]
    assert _integrations(client, ws).json()["data"]["discord"]["chat_channel"] is None

    _ready(db, seed, fake_discord)
    assert _integrations(client, ws).json()["data"]["discord"]["chat_channel"] is None

    assert _put(client, ws, "31").status_code == 200
    for session in ("alice-token", "bob-token"):
        data = _integrations(client, ws, session).json()["data"]
        assert data["discord"]["chat_channel"] == {"channel_id": "31", "name": "회의"}

    assert _clear(client, ws).status_code == 200
    assert _integrations(client, ws).json()["data"]["discord"]["chat_channel"] is None


def test_delete_integration_route_still_matches_provider(client, seed, db, fake_discord):
    _ready(db, seed, fake_discord)

    response = client.delete(
        f"/api/v1/workspaces/{seed['workspace_id']}/integrations/discord", headers=_cookie("alice-token")
    )

    assert response.status_code == 204


def test_delete_integration_reads_the_row_with_lock(client, seed, db, fake_discord, monkeypatch):
    """겹친 PUT 이 끝난 뒤의 채널을 읽어야 끔 공지가 새 채널로 간다. sqlite 는 FOR UPDATE 를 무시하므로 호출 여부를 본다."""
    from sqlalchemy.orm import Query

    calls, _ = _ready(db, seed, fake_discord)
    assert _put(client, seed["workspace_id"], "31").status_code == 200
    locked: list[bool] = []
    original = Query.with_for_update

    def spy(self, *args, **kwargs):
        locked.append(True)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Query, "with_for_update", spy)

    response = client.delete(
        f"/api/v1/workspaces/{seed['workspace_id']}/integrations/discord", headers=_cookie("alice-token")
    )

    assert response.status_code == 204
    assert locked
    assert calls[-1] == ("post", "31", chat_channel.OFF_NOTICE)


# ---------- 봇용 목록 ----------

def _bot_list(client, headers=None):
    return client.get("/api/v1/bot/chat-channels", headers=headers or {"X-Service-Token": SERVICE_TOKEN})


@pytest.mark.parametrize("headers", [{}, {"X-Service-Token": "wrong"}])
def test_bot_chat_channels_needs_service_token(client, seed, db, headers):
    response = client.get("/api/v1/bot/chat-channels", headers=headers)

    assert response.status_code == 401


def test_bot_chat_channels_lists_enabled_only(client, seed, db):
    db.add(Workspace(workspace_id="ws-zzz", name="C"))
    db.flush()
    first, second = sorted([seed["workspace_id"], seed["other_workspace_id"]])
    db.add_all([
        Integration(workspace_id="ws-zzz", provider="discord", provider_channel_id="g3", chat_channel_id="c3"),
        Integration(workspace_id=first, provider="discord", provider_channel_id="g1", chat_channel_id="c1"),
        Integration(workspace_id=second, provider="discord", provider_channel_id="g2"),  # 연결만
        Integration(workspace_id=second, provider="notion", provider_channel_id="n1", chat_channel_id="x"),
    ])
    db.commit()

    response = _bot_list(client)

    assert response.status_code == 200
    assert response.json()["data"] == {"items": [
        {"workspace_id": first, "guild_id": "g1", "channel_id": "c1", "identity_epoch": 0},
        {"workspace_id": "ws-zzz", "guild_id": "g3", "channel_id": "c3", "identity_epoch": 0},
    ]}


def test_bot_chat_channels_empty(client, seed, db):
    response = _bot_list(client)

    assert response.status_code == 200
    assert response.json()["data"] == {"items": []}


def test_bot_chat_channels_response_model_in_openapi():
    operation = app.openapi()["paths"]["/api/v1/bot/chat-channels"]["get"]

    assert "BotChatChannelListResponse" in str(operation["responses"]["200"])


# ---------- 연결 해제 ----------

def _disconnect(client, workspace_id, session="alice-token"):
    return client.delete(f"/api/v1/workspaces/{workspace_id}/integrations/discord", headers=_cookie(session))


def test_disconnect_drops_chat_channel_and_sends_off_notice(client, seed, db, fake_discord):
    calls, _ = _ready(db, seed, fake_discord)
    assert _put(client, seed["workspace_id"], "31").status_code == 200
    assert _bot_list(client).json()["data"]["items"] != []

    response = _disconnect(client, seed["workspace_id"])

    assert response.status_code == 204
    assert _bot_list(client).json()["data"] == {"items": []}
    assert calls[-1] == ("post", "31", chat_channel.OFF_NOTICE)


def test_disconnect_succeeds_when_off_notice_fails(client, seed, db, fake_discord):
    _, state = _ready(db, seed, fake_discord)
    assert _put(client, seed["workspace_id"], "31").status_code == 200
    state["post_error"] = discord.DiscordApiError("HTTP 500", status_code=500)

    response = _disconnect(client, seed["workspace_id"])

    assert response.status_code == 204
    assert _bot_list(client).json()["data"] == {"items": []}


def test_disconnect_without_chat_channel_sends_nothing(client, seed, db, fake_discord):
    calls, _ = _ready(db, seed, fake_discord)

    response = _disconnect(client, seed["workspace_id"])

    assert response.status_code == 204
    assert calls == []
