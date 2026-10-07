"""Discord 봇 초대 OAuth: 인가 주소와 토큰 교환(#171)."""
from urllib.parse import parse_qsl, urlsplit

import httpx
import pytest

from app.services import discord_oauth
from app.services.discord_oauth import (
    DEFAULT_BOT_PERMISSIONS,
    DiscordGuild,
    DiscordOAuthError,
    OAuthConfigError,
    authorize_url,
    exchange_code,
)

REDIRECT_URI = "https://example.com/api/v1/integrations/discord/callback"


@pytest.fixture(autouse=True)
def oauth_env(monkeypatch):
    monkeypatch.setenv("OAUTH_STATE_SECRET", "k" * 40)
    monkeypatch.setenv("DISCORD_CLIENT_ID", "client-id")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("DISCORD_REDIRECT_URI", REDIRECT_URI)
    monkeypatch.delenv("DISCORD_BOT_PERMISSIONS", raising=False)


# ---------- 인가 주소 ----------


def test_authorize_url_invites_the_bot_through_the_code_grant():
    url = urlsplit(authorize_url("the-state"))
    query = dict(parse_qsl(url.query))

    assert f"{url.scheme}://{url.netloc}{url.path}" == discord_oauth.AUTHORIZE_URL
    # bot·applications.commands만 요청하면 Discord가 callback 없이 끝낸다. identify를 더해야 code와 서버 정보가 온다
    assert query["scope"].split() == ["bot", "applications.commands", "identify"]
    assert query == {
        "client_id": "client-id",
        "scope": "bot applications.commands identify",
        "permissions": str(DEFAULT_BOT_PERMISSIONS),
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "state": "the-state",
    }


def test_default_permissions_cover_what_the_recording_bot_does():
    # 채널 보기·메시지·링크·파일·메시지 기록·음성 채널 접속. 관리자 권한은 요청하지 않는다
    assert DEFAULT_BOT_PERMISSIONS == (1 << 10) | (1 << 11) | (1 << 14) | (1 << 15) | (1 << 16) | (1 << 20)
    assert not DEFAULT_BOT_PERMISSIONS & (1 << 3)


def test_bot_permissions_can_be_overridden(monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_PERMISSIONS", "3072")

    assert dict(parse_qsl(urlsplit(authorize_url("s")).query))["permissions"] == "3072"


def test_bot_permissions_must_be_a_number(monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_PERMISSIONS", "admin")

    with pytest.raises(OAuthConfigError):
        authorize_url("s")


@pytest.mark.parametrize("name", ["DISCORD_CLIENT_ID", "DISCORD_REDIRECT_URI"])
def test_authorize_url_requires_env(monkeypatch, name):
    monkeypatch.delenv(name)

    with pytest.raises(OAuthConfigError):
        authorize_url("s")


# ---------- 토큰 교환 ----------


def _exchange(response: httpx.Response | Exception, seen: list | None = None) -> DiscordGuild:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if isinstance(response, Exception):
            raise response
        return response

    return exchange_code("the-code", transport=httpx.MockTransport(handler))


GUILD_RESPONSE = {
    "access_token": "user-token",
    "token_type": "Bearer",
    "expires_in": 604800,
    "refresh_token": "refresh",
    "scope": "bot applications.commands identify",
    "guild": {"id": "123456789012345678", "name": "우리 팀"},
}


def test_exchange_code_sends_form_with_basic_auth_and_returns_the_guild():
    seen: list[httpx.Request] = []

    guild = _exchange(httpx.Response(200, json=GUILD_RESPONSE), seen)

    assert guild == DiscordGuild(guild_id="123456789012345678", name="우리 팀")
    (request,) = seen
    assert str(request.url) == discord_oauth.TOKEN_URL
    assert request.headers["content-type"] == "application/x-www-form-urlencoded"
    assert request.headers["authorization"].startswith("Basic ")
    assert dict(parse_qsl(request.content.decode())) == {
        "grant_type": "authorization_code",
        "code": "the-code",
        "redirect_uri": REDIRECT_URI,
    }


def test_exchange_code_keeps_the_guild_without_a_name():
    body = {**GUILD_RESPONSE, "guild": {"id": "1"}}

    assert _exchange(httpx.Response(200, json=body)) == DiscordGuild(guild_id="1", name=None)


@pytest.mark.parametrize(
    "body",
    [
        {k: v for k, v in GUILD_RESPONSE.items() if k != "guild"},  # 서버 정보 없음(봇 초대 아님)
        {**GUILD_RESPONSE, "guild": {"name": "id 없음"}},
        {**GUILD_RESPONSE, "guild": {"id": ""}},
        {**GUILD_RESPONSE, "guild": "123"},
    ],
)
def test_exchange_code_without_a_guild_is_an_error(body):
    with pytest.raises(DiscordOAuthError, match="guild"):
        _exchange(httpx.Response(200, json=body))


def test_exchange_code_error_names_status_and_error_but_not_the_code():
    with pytest.raises(DiscordOAuthError) as caught:
        _exchange(httpx.Response(400, json={"error": "invalid_grant"}))

    assert str(caught.value) == "토큰 교환 거절: HTTP 400 (invalid_grant)"
    assert "the-code" not in str(caught.value)


def test_exchange_code_with_non_json_error_body():
    with pytest.raises(DiscordOAuthError, match="HTTP 502"):
        _exchange(httpx.Response(502, text="Bad Gateway"))


def test_exchange_code_network_error_names_only_the_kind():
    with pytest.raises(DiscordOAuthError) as caught:
        _exchange(httpx.ConnectError("connect to https://discord.com failed"))

    assert str(caught.value) == "토큰 교환 요청 실패: ConnectError"


@pytest.mark.parametrize("name", ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_REDIRECT_URI"])
def test_exchange_code_requires_env(monkeypatch, name):
    monkeypatch.delenv(name)

    with pytest.raises(OAuthConfigError):
        _exchange(httpx.Response(200, json=GUILD_RESPONSE))
