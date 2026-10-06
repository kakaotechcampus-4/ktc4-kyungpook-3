"""Notion OAuth(§4.3 `/integrations/notion/start`·`/callback`)에 쓰는 함수 모음.

이 모듈은 DB와 요청 처리 흐름을 모른다. state를 만들고 검사하고, 인가 주소를 만들고,
일회용 code를 토큰으로 바꾸는 일만 한다. 언제 부를지, 결과를 어디에 저장할지는 API 계층이 정한다.

state는 서버가 서명한 값이라 DB에 저장하지 않는다. callback 주소에는 workspace_id가 없어서
(Notion에 등록한 redirect URI는 한 글자도 달라질 수 없다) 시작할 때 정한 값을 state에 담아
돌려받는다. `base64url(JSON).HMAC-SHA256` 형식이다.

**서명이지 암호화가 아니다.** 내용은 누구나 읽을 수 있고, 서명은 내용을 바꾸지 못하게
할 뿐이다. 그래서 state에는 노출돼도 되는 값만 넣는다(토큰·비밀번호 금지).

state를 한 번만 쓰게 하는 일은 API 계층의 짝 쿠키(`NONCE_COOKIE`)가 맡는다. state 안의
nonce와 쿠키 값이 같아야 통과시키고, 응답에서 쿠키를 지운다.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass, field
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

from app.services.notion import NOTION_API_BASE

AUTHORIZE_URL = f"{NOTION_API_BASE}/oauth/authorize"
TOKEN_URL = f"{NOTION_API_BASE}/oauth/token"

NONCE_COOKIE = "notion_oauth_nonce"
CALLBACK_PATH = "/api/v1/integrations/notion/callback"
STATE_TTL_SECONDS = 600
# HMAC 키가 이보다 짧으면 서명하지 않는다. 짧은 키는 무차별 대입에 약하다.
MIN_SECRET_LENGTH = 32
MAX_RETURN_PATH_LENGTH = 512
# 프론트(shared/lib/oauth/returnParams.ts)가 읽는 결과 값이다.
OAUTH_RESULTS = ("success", "cancelled", "failed")


class OAuthConfigError(Exception):
    """필요한 환경 변수가 없거나 잘못됐다. 사용자 입력이 아니라 서버 설정의 문제다."""


class NotionOAuthError(Exception):
    """Notion이 code를 토큰으로 바꿔 주지 않았다. 메시지에 code와 토큰은 넣지 않는다."""


@dataclass(frozen=True)
class StatePayload:
    workspace_id: str
    user_id: str
    return_path: str
    nonce: str


@dataclass(frozen=True)
class NotionToken:
    # repr에 토큰이 찍혀 로그로 새지 않게 한다.
    access_token: str = field(repr=False)
    refresh_token: str | None = field(repr=False)
    workspace_name: str | None
    # 사용자가 템플릿 복제를 고르면 복제된 페이지의 ID, 기존 페이지를 골랐으면 None.
    duplicated_template_id: str | None


def _env(name: str) -> str:
    value = os.getenv(name, "")
    if not value:
        raise OAuthConfigError(f"{name} 환경 변수가 없습니다")
    return value


def _secret() -> bytes:
    secret = os.getenv("OAUTH_STATE_SECRET", "")
    if len(secret) < MIN_SECRET_LENGTH:
        raise OAuthConfigError(f"OAUTH_STATE_SECRET은 {MIN_SECRET_LENGTH}자 이상이어야 합니다")
    return secret.encode()


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _signature(segment: str) -> str:
    return _b64encode(hmac.new(_secret(), segment.encode(), hashlib.sha256).digest())


def _encode(payload: dict[str, object]) -> str:
    # 같은 내용은 항상 같은 글자가 되게 키를 정렬하고 공백을 뺀다.
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    segment = _b64encode(raw)
    return f"{segment}.{_signature(segment)}"


def safe_return_path(path: str | None) -> str:
    """앱 안의 경로만 받는다. 외부 주소로 보내는 리디렉트가 되지 않게 아니면 `/`로 바꾼다."""
    if not path or len(path) > MAX_RETURN_PATH_LENGTH:
        return "/"
    if not path.startswith("/") or path.startswith("//") or "\\" in path:
        return "/"
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in path):
        return "/"
    return path


def sign_state(
    workspace_id: str, user_id: str, return_path: str, *, now: float | None = None
) -> tuple[str, str]:
    """(Notion에 보낼 state, 짝 쿠키에 심을 nonce)를 돌려준다."""
    issued_at = int(time.time() if now is None else now)
    nonce = secrets.token_urlsafe(16)
    state = _encode(
        {
            "w": workspace_id,
            "u": user_id,
            "p": safe_return_path(return_path),
            "n": nonce,
            "e": issued_at + STATE_TTL_SECONDS,
        }
    )
    return state, nonce


def verify_state(token: str, *, now: float | None = None) -> StatePayload | None:
    """서명이 맞고 만료되지 않은 state의 내용을 돌려준다. 아니면 None이다."""
    parts = token.split(".") if isinstance(token, str) else []
    if len(parts) != 2:
        return None
    segment, signature = parts
    if not hmac.compare_digest(signature.encode(), _signature(segment).encode()):
        return None
    try:
        data = json.loads(_b64decode(segment))
    except ValueError:  # base64·UTF-8·JSON 오류가 모두 ValueError의 하위 클래스다
        return None
    if not isinstance(data, dict):
        return None

    workspace_id, user_id, return_path, nonce = (data.get(key) for key in ("w", "u", "p", "n"))
    expires_at = data.get("e")
    if not all(isinstance(v, str) and v for v in (workspace_id, user_id, return_path, nonce)):
        return None
    if isinstance(expires_at, bool) or not isinstance(expires_at, int):
        return None
    if (time.time() if now is None else now) >= expires_at:
        return None
    return StatePayload(workspace_id, user_id, safe_return_path(return_path), nonce)


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
    """앱의 복귀 화면 주소. 프론트가 `?oauth=notion&oauth_result=...`를 읽는다.

    프론트와 API는 같은 주소에서 서빙된다(백엔드에 CORS가 없고 프론트는 같은 주소의 `/api`를
    부른다). 그래서 앞부분 없이 경로만 돌려주면 브라우저가 callback이 온 주소 기준으로 이동한다.
    """
    if result not in OAUTH_RESULTS:
        raise ValueError(f"result는 {OAUTH_RESULTS} 중 하나여야 합니다")
    parts = urlsplit(safe_return_path(path))
    # 이미 붙어 있는 같은 이름의 값은 이번 결과로 덮어쓴다.
    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key not in ("oauth", "oauth_result")
    ]
    query += [("oauth", "notion"), ("oauth_result", result)]
    return urlunsplit(("", "", parts.path, urlencode(query), parts.fragment))
