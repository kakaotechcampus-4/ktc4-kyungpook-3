"""OAuth 연결(`/integrations/{provider}/start`·`/callback`)이 공통으로 쓰는 state·복귀 주소 함수 모음.

Notion과 Discord 연결이 같이 쓴다. 제공자별 인가 주소와 토큰 교환은 `notion_oauth`·`discord_oauth`에 있다.
이 모듈은 DB와 요청 처리 흐름을 모른다.

state는 서버가 서명한 값이라 DB에 저장하지 않는다. callback 주소에는 workspace_id가 없어서
(제공자에 등록한 redirect URI는 한 글자도 달라질 수 없다) 시작할 때 정한 값을 state에 담아
돌려받는다. `base64url(JSON).HMAC-SHA256` 형식이다. 어느 제공자의 연결인지도 담아서, 한 제공자의
state를 다른 제공자의 callback에 쓰지 못하게 한다.

**서명이지 암호화가 아니다.** 내용은 누구나 읽을 수 있고, 서명은 내용을 바꾸지 못하게
할 뿐이다. 그래서 state에는 노출돼도 되는 값만 넣는다(토큰·비밀번호 금지).

state를 한 번만 쓰게 하는 일은 API 계층의 짝 쿠키(`nonce_cookie()`)가 맡는다. state 안의
nonce와 쿠키 값이 같아야 통과시키고, 응답에서 쿠키를 지운다.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

STATE_TTL_SECONDS = 600
# HMAC 키가 이보다 짧으면 서명하지 않는다. 짧은 키는 무차별 대입에 약하다.
MIN_SECRET_LENGTH = 32
MAX_RETURN_PATH_LENGTH = 512
# 프론트(shared/lib/oauth/returnParams.ts)가 읽는 결과 값이다.
OAUTH_RESULTS = ("success", "cancelled", "failed")


class OAuthConfigError(Exception):
    """필요한 환경 변수가 없거나 잘못됐다. 사용자 입력이 아니라 서버 설정의 문제다."""


@dataclass(frozen=True)
class StatePayload:
    workspace_id: str
    user_id: str
    return_path: str
    nonce: str


def require_env(name: str) -> str:
    """환경 변수 값. 비어 있으면 `OAuthConfigError`다."""
    value = os.getenv(name, "")
    if not value:
        raise OAuthConfigError(f"{name} 환경 변수가 없습니다")
    return value


def nonce_cookie(provider: str) -> str:
    """state와 짝을 이루는 쿠키 이름. 제공자마다 다르다."""
    return f"{provider}_oauth_nonce"


def callback_path(provider: str) -> str:
    """제공자에 redirect URI로 등록하는 callback 경로. 짝 쿠키도 이 경로로만 보낸다."""
    return f"/api/v1/integrations/{provider}/callback"


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


def encode(payload: dict[str, object]) -> str:
    """내용을 서명한 state 문자열로 만든다."""
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
    provider: str, workspace_id: str, user_id: str, return_path: str, *, now: float | None = None
) -> tuple[str, str]:
    """(제공자에 보낼 state, 짝 쿠키에 심을 nonce)를 돌려준다."""
    issued_at = int(time.time() if now is None else now)
    nonce = secrets.token_urlsafe(16)
    state = encode(
        {
            "v": provider,
            "w": workspace_id,
            "u": user_id,
            "p": safe_return_path(return_path),
            "n": nonce,
            "e": issued_at + STATE_TTL_SECONDS,
        }
    )
    return state, nonce


def verify_state(provider: str, token: str, *, now: float | None = None) -> StatePayload | None:
    """이 제공자로 서명했고 만료되지 않은 state의 내용을 돌려준다. 아니면 None이다."""
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
    if not isinstance(data, dict) or data.get("v") != provider:
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


def frontend_return_url(provider: str, path: str, result: str) -> str:
    """앱의 복귀 화면 주소. 프론트가 `?oauth=<provider>&oauth_result=...`를 읽는다.

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
    query += [("oauth", provider), ("oauth_result", result)]
    return urlunsplit(("", "", parts.path, urlencode(query), parts.fragment))
