"""Discord 연결(봇 초대 OAuth)과 서버 사용자 목록 API(#171).

start → Discord 허용 화면 → callback으로 연결한 서버 ID를 저장하고, 그 서버의 실제 사용자를 팀원 매핑 화면에 준다.
외부 호출(토큰 교환·Discord API)은 가짜로 바꾼다. TEST_DATABASE_URL이 있으면 PostgreSQL에서도 돈다.
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlsplit

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import Integration, Member, Session as SessionModel, User, Workspace
from app.services import discord, discord_oauth, notion_oauth
from app.services.discord_oauth import NONCE_COOKIE, DiscordGuild

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
FAILED = "oauth=discord&oauth_result=failed"
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
def oauth_env(monkeypatch):
    monkeypatch.setenv("OAUTH_STATE_SECRET", "k" * 40)
    monkeypatch.setenv("DISCORD_CLIENT_ID", "client-id")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("DISCORD_REDIRECT_URI", "http://localhost:5173/api/v1/integrations/discord/callback")
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")
    monkeypatch.delenv("DISCORD_BOT_PERMISSIONS", raising=False)


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
    """토큰 교환과 사용자 목록 조회를 가짜로. state['guild']·state['members']에 돌려줄 값이나 예외를 둔다."""
    calls = {"exchange": [], "members": []}
    state = {"guild": DiscordGuild(guild_id=GUILD, name="우리 팀"), "members": []}

    def exchange(code, *, transport=None):
        calls["exchange"].append(code)
        if isinstance(state["guild"], Exception):
            raise state["guild"]
        return state["guild"]

    def members(bot_token, guild_id, *, transport=None):
        calls["members"].append((bot_token, guild_id))
        if isinstance(state["members"], Exception):
            raise state["members"]
        return state["members"]

    monkeypatch.setattr(discord_oauth, "exchange_code", exchange)
    monkeypatch.setattr(discord, "list_guild_members", members)
    return calls, state


def _cookie(session: str | None = None, nonce: str | None = None, nonce_cookie: str = NONCE_COOKIE) -> dict[str, str]:
    parts = []
    if session:
        parts.append(f"session_token={session}")
    if nonce:
        parts.append(f"{nonce_cookie}={nonce}")
    return {"Cookie": "; ".join(parts)} if parts else {}


def _start(client, workspace_id, *, state="/onboarding", session="alice-token"):
    return client.get(
        f"/api/v1/workspaces/{workspace_id}/integrations/discord/start",
        params={"state": state},
        headers=_cookie(session=session),
        follow_redirects=False,
    )


def _callback(client, *, state, nonce, session="alice-token", nonce_cookie=NONCE_COOKIE, **params):
    response = client.get(
        discord_oauth.CALLBACK_PATH,
        params={"state": state, **params},
        headers=_cookie(session=session, nonce=nonce, nonce_cookie=nonce_cookie),
        follow_redirects=False,
    )
    assert response.status_code == 302
    # 어떤 결과든 짝 쿠키를 지운다
    deleted = response.headers.get("set-cookie", "")
    assert f"{NONCE_COOKIE}=" in deleted and "Max-Age=0" in deleted
    return response


def _signed(seed, *, user="alice", workspace="workspace_id", path="/onboarding"):
    return discord_oauth.sign_state(seed[workspace], seed[user], path)


def _row(db, workspace_id) -> Integration | None:
    db.expire_all()
    return db.query(Integration).filter(
        Integration.workspace_id == workspace_id, Integration.provider == "discord"
    ).first()


def _connect(db, workspace_id, guild_id=GUILD) -> None:
    db.add(Integration(workspace_id=workspace_id, provider="discord", provider_channel_id=guild_id))
    db.commit()


# ---------- start ----------


def test_callback_route_matches_redirect_path():
    # Discord에 등록하는 redirect URI·짝 쿠키의 Path와 실제 주소가 같아야 한다
    assert app.url_path_for("discord_oauth_callback") == discord_oauth.CALLBACK_PATH


def test_start_sends_pm_to_discord_with_signed_state_and_nonce_cookie(client, seed):
    response = _start(client, seed["workspace_id"])

    assert response.status_code == 302
    location = urlsplit(response.headers["location"])
    assert f"{location.scheme}://{location.netloc}{location.path}" == discord_oauth.AUTHORIZE_URL
    query = dict(parse_qsl(location.query))
    assert query["scope"] == "bot applications.commands identify"
    payload = discord_oauth.verify_state(query["state"])
    assert (payload.workspace_id, payload.user_id, payload.return_path) == (
        seed["workspace_id"], seed["alice"], "/onboarding"
    )

    cookie = response.headers["set-cookie"]
    assert f"{NONCE_COOKIE}={payload.nonce}" in cookie
    for attribute in ("HttpOnly", "Secure", "SameSite=lax", "Max-Age=600", f"Path={discord_oauth.CALLBACK_PATH}"):
        assert attribute in cookie


@pytest.mark.parametrize("session", ["bob-token", None, "unknown-token", "carol-token"])
def test_start_rejects_non_pm_anonymous_or_outsider(client, seed, session):
    response = _start(client, seed["workspace_id"], session=session)

    assert response.headers["location"] == f"/onboarding?{FAILED}"
    assert "set-cookie" not in response.headers


@pytest.mark.parametrize("name", ["DISCORD_CLIENT_ID", "DISCORD_REDIRECT_URI", "OAUTH_STATE_SECRET"])
def test_start_fails_without_config(client, seed, monkeypatch, name):
    monkeypatch.delenv(name)

    response = _start(client, seed["workspace_id"])

    assert response.headers["location"] == f"/onboarding?{FAILED}"
    assert "set-cookie" not in response.headers


def test_start_rejection_is_logged_with_the_discord_label(client, seed, caplog):
    caplog.set_level(logging.INFO, logger="app.api.integrations")

    _start(client, seed["workspace_id"], session="bob-token")

    assert [(r.levelno, r.getMessage()) for r in caplog.records if r.name == "app.api.integrations"] == [
        (logging.WARNING, "Discord 연결 시작 실패 reason=FORBIDDEN")
    ]


# ---------- callback ----------


def test_callback_saves_the_guild_confirmed_by_discord(client, seed, db, fake_discord):
    calls, _ = fake_discord
    state, nonce = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, code="the-code", guild_id=GUILD, permissions="1166336")

    assert response.headers["location"] == "/onboarding?oauth=discord&oauth_result=success"
    assert calls["exchange"] == ["the-code"]
    row = _row(db, seed["workspace_id"])
    assert (row.provider_channel_id, row.access_token, row.refresh_token) == (GUILD, None, None)


def test_callback_without_guild_id_in_the_address_uses_the_confirmed_guild(client, seed, db, fake_discord):
    state, nonce = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, code="the-code")

    assert response.headers["location"].endswith("oauth_result=success")
    assert _row(db, seed["workspace_id"]).provider_channel_id == GUILD


def test_connected_workspace_shows_discord_as_connected(client, seed, fake_discord):
    state, nonce = _signed(seed)
    _callback(client, state=state, nonce=nonce, code="the-code")

    response = client.get(
        f"/api/v1/workspaces/{seed['workspace_id']}/integrations", headers=_cookie(session="alice-token")
    )

    assert response.json()["data"]["discord"]["status"] == "connected"


def test_reconnect_replaces_the_guild_of_the_same_workspace(client, seed, db, fake_discord):
    _, state_ = fake_discord
    _connect(db, seed["workspace_id"], "old-guild")
    state_["guild"] = DiscordGuild(guild_id=GUILD, name=None)
    state, nonce = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, code="the-code")

    assert response.headers["location"].endswith("oauth_result=success")
    assert _row(db, seed["workspace_id"]).provider_channel_id == GUILD
    assert db.query(Integration).filter(Integration.provider == "discord").count() == 1


def test_callback_rejects_a_guild_id_the_user_changed_in_the_address(client, seed, db, fake_discord):
    state, nonce = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, code="the-code", guild_id="someone-elses-guild")

    assert response.headers["location"] == f"/onboarding?{FAILED}"
    assert _row(db, seed["workspace_id"]) is None


def test_callback_rejects_a_guild_already_linked_to_another_workspace(client, seed, db, fake_discord):
    _connect(db, seed["other_workspace_id"], GUILD)
    state, nonce = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, code="the-code")

    assert response.headers["location"] == f"/onboarding?{FAILED}"
    assert _row(db, seed["workspace_id"]) is None
    assert _row(db, seed["other_workspace_id"]).provider_channel_id == GUILD


def test_guild_linked_meanwhile_by_another_workspace_is_caught_by_the_db(client, seed, db, fake_discord, monkeypatch):
    """두 워크스페이스가 같은 서버를 동시에 연결했다. 앞의 확인을 함께 지나쳐도 DB 유일 인덱스가 막는다."""
    from app.api import integrations as integrations_api

    _connect(db, seed["other_workspace_id"], GUILD)
    owners = iter([None, seed["other_workspace_id"]])  # 첫 확인은 아직 없었고, 커밋 뒤 다시 보면 있다
    monkeypatch.setattr(integrations_api, "_discord_guild_owner", lambda *args: next(owners))
    state, nonce = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, code="the-code")

    assert response.headers["location"] == f"/onboarding?{FAILED}"
    assert _row(db, seed["workspace_id"]) is None


def test_cancel_returns_cancelled(client, seed, db, fake_discord):
    calls, _ = fake_discord
    state, nonce = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, error="access_denied")

    assert response.headers["location"] == "/onboarding?oauth=discord&oauth_result=cancelled"
    assert calls["exchange"] == []


@pytest.mark.parametrize(
    "case",
    ["discord_error", "missing_code", "nonce_mismatch", "no_nonce", "user_mismatch", "not_logged_in", "not_pm"],
)
def test_callback_failures_save_nothing(client, seed, db, fake_discord, case):
    calls, _ = fake_discord
    state, nonce = _signed(seed)
    kwargs = {"state": state, "nonce": nonce, "code": "the-code"}
    if case == "discord_error":
        kwargs["error"] = "server_error"
    elif case == "missing_code":
        kwargs.pop("code")
    elif case == "nonce_mismatch":
        kwargs["nonce"] = "other"
    elif case == "no_nonce":
        kwargs["nonce"] = None
    elif case == "user_mismatch":
        kwargs["session"] = "bob-token"
    elif case == "not_logged_in":
        kwargs["session"] = None
    elif case == "not_pm":
        db.query(Member).filter(Member.user_id == seed["alice"]).update({"role": "member"})
        db.commit()

    response = _callback(client, **kwargs)

    assert response.headers["location"] == f"/onboarding?{FAILED}"
    assert _row(db, seed["workspace_id"]) is None
    assert calls["exchange"] == []


def test_token_exchange_failure_saves_nothing(client, seed, db, fake_discord):
    _, state_ = fake_discord
    state_["guild"] = discord_oauth.DiscordOAuthError("토큰 교환 거절: HTTP 400 (invalid_grant)")
    state, nonce = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, code="the-code")

    assert response.headers["location"] == f"/onboarding?{FAILED}"
    assert _row(db, seed["workspace_id"]) is None


def test_invalid_or_notion_state_goes_home_with_failed(client, seed, db, fake_discord):
    # 노션 연결로 서명한 state는 같은 키로 서명했어도 디스코드 callback에서 받지 않는다
    notion_state, nonce = notion_oauth.sign_state(seed["workspace_id"], seed["alice"], "/onboarding")

    for state in ("garbage", notion_state):
        response = _callback(client, state=state, nonce=nonce, code="the-code")
        assert response.headers["location"] == f"/?{FAILED}"
    assert _row(db, seed["workspace_id"]) is None


def test_callback_failure_is_logged_as_warning_with_reason(client, seed, fake_discord, caplog):
    state, nonce = _signed(seed)
    caplog.set_level(logging.INFO, logger="app.api.integrations")

    _callback(client, state=state, nonce=nonce, code="the-code", guild_id="someone-elses-guild")

    assert [(r.levelno, r.getMessage()) for r in caplog.records if r.name == "app.api.integrations"] == [
        (logging.WARNING, "Discord 연결 callback result=failed reason=guild_mismatch")
    ]


# ---------- 서버 사용자 목록 ----------


def _members(client, workspace_id, session="alice-token"):
    return client.get(f"/api/v1/workspaces/{workspace_id}/discord/members", headers=_cookie(session=session))


def test_members_are_the_real_users_of_the_connected_guild(client, seed, db, fake_discord):
    calls, state_ = fake_discord
    _connect(db, seed["workspace_id"])
    state_["members"] = [
        {"discord_user_id": "1", "username": "minsu", "display_name": "민수", "avatar_url": None, "is_bot": False},
        {"discord_user_id": "2", "username": "mm-bot", "display_name": "mm-bot", "avatar_url": None, "is_bot": True},
    ]

    response = _members(client, seed["workspace_id"], session="bob-token")  # 소속이면 누구나 본다

    assert response.status_code == 200, response.text
    assert response.json()["data"] == {"items": state_["members"], "total": 2}
    assert calls["members"] == [("bot-token", GUILD)]


@pytest.mark.parametrize("guild", [None, "no row"])
def test_members_without_a_connected_guild_is_409(client, seed, db, fake_discord, guild):
    if guild is None:
        # 서버 ID 없이 남은 옛 연결 행(개발 중 직접 만든 행)도 연결되지 않은 것으로 본다
        db.add(Integration(workspace_id=seed["workspace_id"], provider="discord"))
        db.commit()

    response = _members(client, seed["workspace_id"])

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INTEGRATION_NOT_CONNECTED"


def test_members_of_another_workspace_are_forbidden(client, seed, db, fake_discord):
    _connect(db, seed["workspace_id"])

    assert _members(client, seed["workspace_id"], session="carol-token").status_code == 403


def test_members_without_bot_token_is_502(client, seed, db, fake_discord, monkeypatch):
    calls, _ = fake_discord
    _connect(db, seed["workspace_id"])
    monkeypatch.delenv("DISCORD_BOT_TOKEN")

    response = _members(client, seed["workspace_id"])

    assert response.status_code == 502
    error = response.json()["error"]
    assert (error["code"], error["details"]) == (
        "DISCORD_API_FAILED", {"status": None, "reason": "bot_token_missing"}
    )
    assert calls["members"] == []


def test_discord_api_failure_is_502_with_status(client, seed, db, fake_discord):
    _, state_ = fake_discord
    _connect(db, seed["workspace_id"])
    state_["members"] = discord.DiscordApiError("HTTP 403 (Missing Access)", status_code=403)

    response = _members(client, seed["workspace_id"])

    assert response.status_code == 502
    error = response.json()["error"]
    assert (error["code"], error["details"]) == ("DISCORD_API_FAILED", {"status": 403})


# ---------- DB 유일 인덱스 ----------


def test_db_allows_one_workspace_per_guild(db, seed):
    _connect(db, seed["workspace_id"])
    db.add(Integration(workspace_id=seed["other_workspace_id"], provider="discord", provider_channel_id=GUILD))

    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_db_index_ignores_other_providers_and_unset_guilds(db, seed):
    # 노션의 provider_channel_id(대상 DB ID)나 서버 ID가 없는 디스코드 행은 걸리지 않는다
    db.add_all([
        Integration(workspace_id=seed["workspace_id"], provider="notion", provider_channel_id=GUILD),
        Integration(workspace_id=seed["other_workspace_id"], provider="notion", provider_channel_id=GUILD),
        Integration(workspace_id=seed["workspace_id"], provider="discord"),
        Integration(workspace_id=seed["other_workspace_id"], provider="discord"),
    ])
    db.commit()
