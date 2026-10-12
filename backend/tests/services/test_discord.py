"""Discord 서버 사용자 목록(봇 토큰, REST API) 조회와 화면 형식 변환(#171)."""
import httpx
import pytest

from app.services import discord
from app.services.discord import DiscordApiError, list_guild_members, to_member_item

GUILD = "900000000000000000"


def _member(user_id: str, **fields) -> dict:
    user = {"id": user_id, "username": f"user{user_id}", "global_name": None, "avatar": None}
    user.update(fields.pop("user", {}))
    return {"user": user, "nick": None, "avatar": None, **fields}


def _list(pages_or_error, seen: list | None = None) -> list[dict]:
    pages = list(pages_or_error) if isinstance(pages_or_error, list) else pages_or_error

    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if isinstance(pages, Exception):
            raise pages
        if isinstance(pages, httpx.Response):
            return pages
        return pages.pop(0)

    return list_guild_members("bot-token", GUILD, transport=httpx.MockTransport(handler))


# ---------- 화면 형식 ----------


def test_display_name_prefers_server_nickname_then_global_name_then_username():
    nick = _member("1", nick="서버별명", user={"global_name": "표시이름"})
    global_name = _member("2", user={"global_name": "표시이름"})
    username = _member("3")

    assert to_member_item(GUILD, nick)["display_name"] == "서버별명"
    assert to_member_item(GUILD, global_name)["display_name"] == "표시이름"
    assert to_member_item(GUILD, username)["display_name"] == "user3"


def test_blank_nickname_falls_back():
    assert to_member_item(GUILD, _member("1", nick="  ", user={"global_name": "표시이름"}))["display_name"] == "표시이름"


def test_item_has_the_shape_the_onboarding_screen_reads():
    item = to_member_item(GUILD, _member("42", user={"bot": True}))

    assert item == {
        "discord_user_id": "42",
        "username": "user42",
        "display_name": "user42",
        "avatar_url": None,
        "is_bot": True,
    }


def test_avatar_prefers_the_server_avatar_then_the_account_avatar():
    server = _member("1", avatar="guildhash", user={"avatar": "userhash"})
    account = _member("2", user={"avatar": "userhash"})

    assert to_member_item(GUILD, server)["avatar_url"] == (
        f"https://cdn.discordapp.com/guilds/{GUILD}/users/1/avatars/guildhash.png"
    )
    assert to_member_item(GUILD, account)["avatar_url"] == "https://cdn.discordapp.com/avatars/2/userhash.png"


@pytest.mark.parametrize("member", [{"nick": "x"}, {"user": None}, {"user": {"username": "id 없음"}}])
def test_member_without_user_is_skipped(member):
    assert to_member_item(GUILD, member) is None


# ---------- 조회 ----------


def test_lists_members_with_the_bot_token():
    seen: list[httpx.Request] = []

    items = _list([httpx.Response(200, json=[_member("1"), _member("2", user={"bot": True})])], seen)

    assert [i["discord_user_id"] for i in items] == ["1", "2"]
    (request,) = seen
    assert request.url.path == f"/api/v10/guilds/{GUILD}/members"
    assert dict(request.url.params) == {"limit": "1000", "after": "0"}
    assert request.headers["authorization"] == "Bot bot-token"
    assert request.headers["user-agent"].startswith("DiscordBot ")


def test_continues_after_the_highest_user_id_when_a_page_is_full(monkeypatch):
    monkeypatch.setattr(discord, "PAGE_SIZE", 2)
    seen: list[httpx.Request] = []

    items = _list(
        [
            httpx.Response(200, json=[_member("5"), _member("30")]),
            httpx.Response(200, json=[_member("40")]),
        ],
        seen,
    )

    assert [i["discord_user_id"] for i in items] == ["5", "30", "40"]
    assert [r.url.params["after"] for r in seen] == ["0", "30"]


def test_stops_when_too_many_pages(monkeypatch):
    monkeypatch.setattr(discord, "PAGE_SIZE", 1)
    monkeypatch.setattr(discord, "MAX_PAGES", 2)

    with pytest.raises(DiscordApiError, match="너무 많습니다"):
        _list([httpx.Response(200, json=[_member("1")]), httpx.Response(200, json=[_member("2")])])


@pytest.mark.parametrize(
    ("response", "status", "reason"),
    [
        (httpx.Response(401, json={"message": "401: Unauthorized", "code": 0}), 401, "HTTP 401 (401: Unauthorized)"),
        (httpx.Response(403, json={"message": "Missing Access", "code": 50001}), 403, "HTTP 403 (Missing Access)"),
        (httpx.Response(404, json={"message": "Unknown Guild", "code": 10004}), 404, "HTTP 404 (Unknown Guild)"),
        (httpx.Response(429, json={"message": "You are being rate limited.", "retry_after": 1.5}), 429,
         "HTTP 429 (You are being rate limited.)"),
        (httpx.Response(502, text="Bad Gateway"), 502, "HTTP 502"),
        (httpx.Response(200, text="not json"), 200, "응답이 JSON이 아닙니다"),
        (httpx.Response(200, json={"members": []}), 200, "응답이 목록이 아닙니다"),
    ],
)
def test_api_failure_is_a_discord_api_error(response, status, reason):
    with pytest.raises(DiscordApiError) as caught:
        _list(response)

    assert (caught.value.status_code, caught.value.reason) == (status, reason)


def test_network_failure_names_only_the_kind_and_not_the_token():
    with pytest.raises(DiscordApiError) as caught:
        _list(httpx.ConnectError("Bot bot-token https://discord.com"))

    assert caught.value.status_code is None
    assert caught.value.reason == "요청 실패: ConnectError"
    assert "bot-token" not in str(caught.value)
