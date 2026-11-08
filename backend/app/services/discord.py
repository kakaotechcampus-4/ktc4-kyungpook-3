"""Discord REST API 호출. 연결한 서버(guild)의 사용자 목록을 봇 토큰으로 읽는다.

온보딩의 팀원 매핑 화면이 이 목록으로 디스코드 계정과 팀원을 잇는다. 이어진 계정으로 봇이 녹음한
화자(디스코드 uid)를 팀원으로 찾는다(`services/matching.resolve_speaker`).

서버 사용자 목록 API는 Discord 개발자 포털에서 봇의 Server Members Intent(GUILD_MEMBERS)가 켜져 있어야
읽힌다. 녹음 봇(ai/capture)과 같은 봇 토큰을 쓴다. 토큰은 로그·오류 메시지에 남기지 않는다.

채팅 수집 채널 설정(#428)을 위해 텍스트 채널 목록·메시지 읽기 확인·메시지 보내기도 한다. 읽기 확인(GET
messages)은 Message Content Intent 가 켜져 있는지는 확인하지 못한다. 채널 읽기 권한만 확인한다. 또 VIEW_CHANNEL 만 있고 READ_MESSAGE_HISTORY 가 없으면
Discord 가 403 대신 200 빈 목록을 줄 수 있어(확인 필요) 이 경우 읽기 확인을 통과할 수 있다.
"""
from urllib.parse import quote

import httpx

DISCORD_API_BASE = "https://discord.com/api/v10"
DISCORD_CDN_BASE = "https://cdn.discordapp.com"
# Discord는 봇 요청에 이 형식의 User-Agent를 요구한다.
USER_AGENT = "DiscordBot (https://github.com/kakaotechcampus-4, 1.0)"
# 한 번에 받을 수 있는 최대 인원(Discord 제한)
PAGE_SIZE = 1000
# Discord 채널 type: 0 = 일반 텍스트 채널, 4 = 카테고리
TEXT_CHANNEL_TYPE = 0
CATEGORY_CHANNEL_TYPE = 4
# 페이지를 끝없이 넘기지 않도록 둔 상한. 서비스가 다루는 팀 규모보다 훨씬 크다.
MAX_PAGES = 20


class DiscordApiError(Exception):
    """Discord API가 목록을 주지 않았다. status_code가 None이면 응답을 받지 못한 것이다."""

    def __init__(
        self, reason: str, *, status_code: int | None = None, discord_code: int | None = None
    ) -> None:
        super().__init__(reason)
        self.reason = reason
        self.status_code = status_code
        # Discord 오류 JSON 의 정수 code(예: 50001 Missing Access). 없으면 None.
        self.discord_code = discord_code


def _avatar_url(guild_id: str, user: dict, member: dict) -> str | None:
    # 서버 전용 아바타가 있으면 그것을, 없으면 계정 아바타를 쓴다. 둘 다 없으면 프론트가 기본 이미지를 그린다.
    user_id = user["id"]
    if isinstance(member.get("avatar"), str) and member["avatar"]:
        return f"{DISCORD_CDN_BASE}/guilds/{guild_id}/users/{user_id}/avatars/{member['avatar']}.png"
    if isinstance(user.get("avatar"), str) and user["avatar"]:
        return f"{DISCORD_CDN_BASE}/avatars/{user_id}/{user['avatar']}.png"
    return None


def _first_text(*values: object) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value
    return None


def to_member_item(guild_id: str, member: dict) -> dict | None:
    """Discord 서버 멤버 객체를 화면의 사용자 한 줄로 바꾼다. 사용자 정보가 없으면 None이다.

    표시 이름은 서버 별명 → 계정 표시 이름(global_name) → 사용자 이름 순이다. 녹음 봇이 화자 이름을
    정하는 순서와 같다.
    """
    user = member.get("user")
    if not isinstance(user, dict) or not isinstance(user.get("id"), str) or not user["id"]:
        return None
    username = user.get("username") if isinstance(user.get("username"), str) else ""
    return {
        "discord_user_id": user["id"],
        "username": username,
        "display_name": _first_text(member.get("nick"), user.get("global_name"), username),
        "avatar_url": _avatar_url(guild_id, user, member),
        "is_bot": user.get("bot") is True,
    }


def _raise_for_status(response: httpx.Response) -> None:
    """200 이 아니면 Discord 오류 본문의 message·code 를 담아 `DiscordApiError` 를 던진다."""
    if response.status_code == 200:
        return
    try:
        body = response.json()
    except ValueError:
        body = None
    message = body.get("message") if isinstance(body, dict) else None
    code = body.get("code") if isinstance(body, dict) else None
    suffix = f" ({message})" if isinstance(message, str) else ""
    raise DiscordApiError(
        f"HTTP {response.status_code}{suffix}",
        status_code=response.status_code,
        discord_code=code if isinstance(code, int) and not isinstance(code, bool) else None,
    )


def _client(bot_token: str, transport: httpx.BaseTransport | None, timeout: float = 5.0) -> httpx.Client:
    headers = {"Authorization": f"Bot {bot_token}", "User-Agent": USER_AGENT}
    return httpx.Client(timeout=timeout, headers=headers, transport=transport)


def _send(client: httpx.Client, method: str, url: str, **kwargs) -> httpx.Response:
    try:
        return client.request(method, url, **kwargs)
    except httpx.HTTPError as exc:
        # 예외 문자열에 주소가 들어갈 수 있어서 종류만 남긴다.
        raise DiscordApiError(f"요청 실패: {type(exc).__name__}") from None


def _get_page(client: httpx.Client, guild_id: str, after: str) -> list:
    response = _send(
        client,
        "GET",
        f"{DISCORD_API_BASE}/guilds/{quote(guild_id, safe='')}/members",
        params={"limit": PAGE_SIZE, "after": after},
    )
    _raise_for_status(response)
    try:
        page = response.json()
    except ValueError:
        raise DiscordApiError("응답이 JSON이 아닙니다", status_code=response.status_code) from None
    if not isinstance(page, list):
        raise DiscordApiError("응답이 목록이 아닙니다", status_code=response.status_code)
    return page


def list_guild_members(
    bot_token: str, guild_id: str, *, transport: httpx.BaseTransport | None = None
) -> list[dict]:
    """서버의 모든 사용자(봇 포함)를 화면 형식으로 돌려준다. 실패하면 `DiscordApiError`를 던진다.

    한 번에 1000명까지라 마지막으로 받은 사용자 ID 다음부터 이어 받는다.
    """
    items: list[dict] = []
    after = "0"
    with _client(bot_token, transport, timeout=10.0) as client:
        for _ in range(MAX_PAGES):
            page = _get_page(client, guild_id, after)
            for member in page:
                item = to_member_item(guild_id, member) if isinstance(member, dict) else None
                if item is not None:
                    items.append(item)
            if len(page) < PAGE_SIZE:
                return items
            # 사용자 ID(snowflake)는 숫자 문자열이다. 가장 큰 값 다음부터 받는다.
            ids = [int(i["discord_user_id"]) for i in items if i["discord_user_id"].isdigit()]
            if not ids or str(max(ids)) == after:
                return items
            after = str(max(ids))
    raise DiscordApiError(f"사용자가 너무 많습니다(최대 {PAGE_SIZE * MAX_PAGES}명)")


def _snowflake_order(value: object) -> int:
    return int(value) if isinstance(value, str) and value.isdigit() else 0


def get_guild_member(
    bot_token: str,
    guild_id: str,
    user_id: str,
    *,
    transport: httpx.BaseTransport | None = None,
    timeout: float = 3.0,
) -> dict:
    """서버 사용자 한 명의 정보(서버 별명 nick 과 user)를 돌려준다. 실패하면 `DiscordApiError`를 던진다.

    팀원 등록 요청 안에서 부르므로 timeout 을 짧게 둔다(#459).
    """
    url = f"{DISCORD_API_BASE}/guilds/{quote(guild_id, safe='')}/members/{quote(user_id, safe='')}"
    with _client(bot_token, transport, timeout=timeout) as client:
        response = _send(client, "GET", url)
    _raise_for_status(response)
    try:
        member = response.json()
    except ValueError:
        raise DiscordApiError("응답이 JSON이 아닙니다", status_code=response.status_code) from None
    if not isinstance(member, dict):
        raise DiscordApiError("응답이 객체가 아닙니다", status_code=response.status_code)
    return member


def list_text_channels(
    bot_token: str, guild_id: str, *, transport: httpx.BaseTransport | None = None
) -> list[dict]:
    """서버의 텍스트 채널(type 0)만 `[{"channel_id", "name"}]` 로 Discord 화면 순서대로 돌려준다.

    순서는 카테고리 없는 채널, 그다음 카테고리 position 순이고 같은 카테고리 안은 채널 position,
    동률은 ID 숫자 순이다. 실패하면 `DiscordApiError` 를 던진다.
    """
    with _client(bot_token, transport) as client:
        response = _send(client, "GET", f"{DISCORD_API_BASE}/guilds/{quote(guild_id, safe='')}/channels")
    _raise_for_status(response)
    try:
        channels = response.json()
    except ValueError:
        raise DiscordApiError("응답이 JSON이 아닙니다", status_code=response.status_code) from None
    if not isinstance(channels, list):
        raise DiscordApiError("응답이 목록이 아닙니다", status_code=response.status_code)
    channels = [c for c in channels if isinstance(c, dict)]
    categories = {
        c.get("id"): c.get("position") if isinstance(c.get("position"), int) else 0
        for c in channels
        if c.get("type") == CATEGORY_CHANNEL_TYPE
    }

    def sort_key(channel: dict) -> tuple:
        parent = channel.get("parent_id")
        position = channel.get("position") if isinstance(channel.get("position"), int) else 0
        if parent is None or parent not in categories:
            return (0, 0, position, _snowflake_order(channel.get("id")))
        return (1, categories[parent], position, _snowflake_order(channel.get("id")))

    texts = [
        c
        for c in channels
        if c.get("type") == TEXT_CHANNEL_TYPE and isinstance(c.get("id"), str) and isinstance(c.get("name"), str)
    ]
    return [{"channel_id": c["id"], "name": c["name"]} for c in sorted(texts, key=sort_key)]


def read_one_message(
    bot_token: str, channel_id: str, *, transport: httpx.BaseTransport | None = None
) -> None:
    """채널의 메시지를 한 건 읽어 보며 봇의 읽기 권한을 확인한다. 200 이 아니면 `DiscordApiError`."""
    with _client(bot_token, transport) as client:
        response = _send(
            client,
            "GET",
            f"{DISCORD_API_BASE}/channels/{quote(channel_id, safe='')}/messages",
            params={"limit": 1},
        )
    _raise_for_status(response)


def post_channel_message(
    bot_token: str, channel_id: str, content: str, *, transport: httpx.BaseTransport | None = None
) -> None:
    """채널에 메시지를 보낸다. 멘션은 모두 끈다. 200 이 아니면 `DiscordApiError`."""
    with _client(bot_token, transport) as client:
        response = _send(
            client,
            "POST",
            f"{DISCORD_API_BASE}/channels/{quote(channel_id, safe='')}/messages",
            json={"content": content, "allowed_mentions": {"parse": []}},
        )
    _raise_for_status(response)
