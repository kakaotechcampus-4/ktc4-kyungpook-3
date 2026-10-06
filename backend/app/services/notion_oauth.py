"""Notion OAuth(§4.3 `/integrations/notion/start`·`/callback`)에 쓰는 함수 모음.

이 모듈은 DB와 요청 처리 흐름을 모른다. 인가 주소를 만들고 일회용 code를 토큰으로 바꾸는 일만 한다.
언제 부를지, 결과를 어디에 저장할지는 API 계층이 정한다. state 서명·검증과 앱 복귀 주소는
Discord 연결과 같이 쓰는 `oauth_state`에 있고, 여기서는 Notion용으로 묶어 내보낸다.
"""
from dataclasses import dataclass, field
from urllib.parse import urlencode

import httpx

from app.services import oauth_state
from app.services.notion import NOTION_API_BASE
from app.services.oauth_state import (  # noqa: F401 — Notion 연결 코드와 테스트가 이 모듈 이름으로 쓴다
    MAX_RETURN_PATH_LENGTH,
    MIN_SECRET_LENGTH,
    OAUTH_RESULTS,
    STATE_TTL_SECONDS,
    OAuthConfigError,
    StatePayload,
    _signature,
    encode as _encode,
    require_env as _env,
    safe_return_path,
)

PROVIDER = "notion"
AUTHORIZE_URL = f"{NOTION_API_BASE}/oauth/authorize"
TOKEN_URL = f"{NOTION_API_BASE}/oauth/token"

NONCE_COOKIE = oauth_state.nonce_cookie(PROVIDER)
CALLBACK_PATH = oauth_state.callback_path(PROVIDER)


class NotionOAuthError(Exception):
    """Notion이 code를 토큰으로 바꿔 주지 않았다. 메시지에 code와 토큰은 넣지 않는다."""


@dataclass(frozen=True)
class NotionToken:
    # repr에 토큰이 찍혀 로그로 새지 않게 한다.
    access_token: str = field(repr=False)
    refresh_token: str | None = field(repr=False)
    workspace_name: str | None
    # 사용자가 템플릿 복제를 고르면 복제된 페이지의 ID, 기존 페이지를 골랐으면 None.
    duplicated_template_id: str | None


def sign_state(
    workspace_id: str, user_id: str, return_path: str, *, now: float | None = None
) -> tuple[str, str]:
    """(Notion에 보낼 state, 짝 쿠키에 심을 nonce)를 돌려준다."""
    return oauth_state.sign_state(PROVIDER, workspace_id, user_id, return_path, now=now)


def verify_state(token: str, *, now: float | None = None) -> StatePayload | None:
    """Notion 연결로 서명했고 만료되지 않은 state의 내용을 돌려준다. 아니면 None이다."""
    return oauth_state.verify_state(PROVIDER, token, now=now)


def authorize_url(state: str) -> str:
    query = urlencode(
        {
            "client_id": _env("NOTION_CLIENT_ID"),
            "response_type": "code",
            "owner": "user",
            "redirect_uri": _env("NOTION_REDIRECT_URI"),
            "state": state,
        }
    )
    return f"{AUTHORIZE_URL}?{query}"


def exchange_code(code: str, *, transport: httpx.BaseTransport | None = None) -> NotionToken:
    """일회용 code를 access_token으로 바꾼다. 실패하면 `NotionOAuthError`를 던진다."""
    client_id = _env("NOTION_CLIENT_ID")
    client_secret = _env("NOTION_CLIENT_SECRET")
    redirect_uri = _env("NOTION_REDIRECT_URI")
    try:
        with httpx.Client(timeout=10.0, transport=transport) as client:
            response = client.post(
                TOKEN_URL,
                auth=(client_id, client_secret),
                json={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri},
            )
    except httpx.HTTPError as exc:
        # 예외 문자열에 주소가 들어갈 수 있어서 종류만 남긴다.
        raise NotionOAuthError(f"토큰 교환 요청 실패: {type(exc).__name__}") from None

    try:
        data = response.json()
    except ValueError:
        data = None
    if not isinstance(data, dict):
        data = {}

    if response.status_code != 200:
        error = data.get("error")
        suffix = f" ({error})" if isinstance(error, str) else ""
        raise NotionOAuthError(f"토큰 교환 거절: HTTP {response.status_code}{suffix}")
    access_token = data.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise NotionOAuthError("토큰 응답에 access_token이 없습니다")

    return NotionToken(
        access_token=access_token,
        refresh_token=data.get("refresh_token") or None,
        workspace_name=data.get("workspace_name") or None,
        duplicated_template_id=data.get("duplicated_template_id") or None,
    )


def frontend_return_url(path: str, result: str) -> str:
    """앱의 복귀 화면 주소. 프론트가 `?oauth=notion&oauth_result=...`를 읽는다."""
    return oauth_state.frontend_return_url(PROVIDER, path, result)
