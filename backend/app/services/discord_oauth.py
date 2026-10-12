"""Discord 연결(봇 초대 OAuth, `/integrations/discord/start`·`/callback`)에 쓰는 함수 모음.

이 모듈은 DB와 요청 처리 흐름을 모른다. 인가 주소를 만들고 일회용 code를 토큰으로 바꿔 봇이 들어간
서버(guild)를 확인하는 일만 한다. state 서명·검증과 앱 복귀 주소는 `oauth_state`에 있다.

봇 초대만 요청하면(scope `bot`·`applications.commands`) Discord는 callback 없이 끝난다. 그 외 scope를
하나 더 요청해야 code grant로 이어져, callback에 code·guild_id가 오고 토큰 응답에 guild가 담긴다
(Discord 문서 OAuth2 "Advanced Bot Authorization"). 그래서 사용자 정보 없이 쓸 수 있는 `identify`를 더한다.
받은 사용자 토큰은 쓰지 않고 버린다. 서버 사용자 목록은 봇 토큰으로 읽는다(`services/discord.py`).
"""
import os
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from app.services import oauth_state
from app.services.discord import DISCORD_API_BASE
from app.services.oauth_state import OAuthConfigError, StatePayload, require_env

PROVIDER = "discord"
AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
TOKEN_URL = f"{DISCORD_API_BASE}/oauth2/token"
SCOPES = ("bot", "applications.commands", "identify")

NONCE_COOKIE = oauth_state.nonce_cookie(PROVIDER)
CALLBACK_PATH = oauth_state.callback_path(PROVIDER)

# 봇이 서버에서 하는 일에 필요한 권한(ai/capture): 채널 보기, 메시지·파일 보내기와 고치기, 음성 채널 접속.
# 슬래시 명령은 applications.commands scope로 등록한다. DISCORD_BOT_PERMISSIONS로 바꿀 수 있다.
_PERMISSION_BITS = {
    "VIEW_CHANNEL": 1 << 10,
    "SEND_MESSAGES": 1 << 11,
    "EMBED_LINKS": 1 << 14,
    "ATTACH_FILES": 1 << 15,
    "READ_MESSAGE_HISTORY": 1 << 16,
    "CONNECT": 1 << 20,
}
DEFAULT_BOT_PERMISSIONS = sum(_PERMISSION_BITS.values())


class DiscordOAuthError(Exception):
    """Discord가 code를 토큰으로 바꿔 주지 않았거나 응답에 서버 정보가 없다. 메시지에 code와 토큰은 넣지 않는다."""


@dataclass(frozen=True)
class DiscordGuild:
    """봇을 초대한 서버."""

    guild_id: str
    name: str | None


def sign_state(
    workspace_id: str, user_id: str, return_path: str, *, now: float | None = None
) -> tuple[str, str]:
    """(Discord에 보낼 state, 짝 쿠키에 심을 nonce)를 돌려준다."""
    return oauth_state.sign_state(PROVIDER, workspace_id, user_id, return_path, now=now)


def verify_state(token: str, *, now: float | None = None) -> StatePayload | None:
    """Discord 연결로 서명했고 만료되지 않은 state의 내용을 돌려준다. 아니면 None이다."""
    return oauth_state.verify_state(PROVIDER, token, now=now)


def frontend_return_url(path: str, result: str) -> str:
    """앱의 복귀 화면 주소. 프론트가 `?oauth=discord&oauth_result=...`를 읽는다."""
    return oauth_state.frontend_return_url(PROVIDER, path, result)


def bot_permissions() -> int:
    """봇 초대 때 요청할 권한 값. DISCORD_BOT_PERMISSIONS가 있으면 그 값이다."""
    raw = os.getenv("DISCORD_BOT_PERMISSIONS", "").strip()
    if not raw:
        return DEFAULT_BOT_PERMISSIONS
    if not raw.isdigit():
        raise OAuthConfigError("DISCORD_BOT_PERMISSIONS는 0 이상의 정수여야 합니다")
    return int(raw)


def authorize_url(state: str) -> str:
    """봇을 서버에 초대하는 Discord 인가 화면 주소."""
    query = urlencode(
        {
            "client_id": require_env("DISCORD_CLIENT_ID"),
            "scope": " ".join(SCOPES),
            "permissions": str(bot_permissions()),
            "response_type": "code",
            "redirect_uri": require_env("DISCORD_REDIRECT_URI"),
            "state": state,
        }
    )
    return f"{AUTHORIZE_URL}?{query}"


def exchange_code(code: str, *, transport: httpx.BaseTransport | None = None) -> DiscordGuild:
    """일회용 code를 토큰으로 바꾸고 봇이 들어간 서버를 돌려준다. 실패하면 `DiscordOAuthError`를 던진다."""
    client_id = require_env("DISCORD_CLIENT_ID")
    client_secret = require_env("DISCORD_CLIENT_SECRET")
    redirect_uri = require_env("DISCORD_REDIRECT_URI")
    try:
        with httpx.Client(timeout=10.0, transport=transport) as client:
            # Discord 토큰 교환은 form 인코딩만 받는다(JSON이면 400).
            response = client.post(
                TOKEN_URL,
                auth=(client_id, client_secret),
                data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri},
            )
    except httpx.HTTPError as exc:
        # 예외 문자열에 주소가 들어갈 수 있어서 종류만 남긴다.
        raise DiscordOAuthError(f"토큰 교환 요청 실패: {type(exc).__name__}") from None

    try:
        data = response.json()
    except ValueError:
        data = None
    if not isinstance(data, dict):
        data = {}

    if response.status_code != 200:
        error = data.get("error")
        suffix = f" ({error})" if isinstance(error, str) else ""
        raise DiscordOAuthError(f"토큰 교환 거절: HTTP {response.status_code}{suffix}")
    guild = data.get("guild")
    guild_id = guild.get("id") if isinstance(guild, dict) else None
    if not isinstance(guild_id, str) or not guild_id:
        raise DiscordOAuthError("토큰 응답에 봇을 초대한 서버(guild)가 없습니다")
    name = guild.get("name")
    return DiscordGuild(guild_id=guild_id, name=name if isinstance(name, str) and name else None)
