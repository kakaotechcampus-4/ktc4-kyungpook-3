"""카카오 로그인(`/auth/kakao/start`·`/callback`)에 쓰는 함수 모음.

이 모듈은 DB와 요청 처리 흐름을 모른다. 인가 주소를 만들고, 일회용 code로 카카오 사용자 정보를 읽고,
가입을 마칠 때까지 카카오 신원을 들고 있는 서명 토큰을 만든다. 서명과 복귀 경로 규칙은 `oauth_state`에 있다.

scope는 보내지 않는다. 동의 항목은 카카오 콘솔 설정을 따라서 비즈 앱 전환 전에도 동작한다.
"""
import secrets
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from app.schemas.invitation import normalize_email
from app.services import oauth_state
from app.services.oauth_state import require_env

PROVIDER = "kakao"
AUTHORIZE_URL = "https://kauth.kakao.com/oauth/authorize"
TOKEN_URL = "https://kauth.kakao.com/oauth/token"
USER_URL = "https://kapi.kakao.com/v2/user/me"

NONCE_COOKIE = oauth_state.nonce_cookie(PROVIDER)
# `oauth_state.callback_path`는 `/integrations` 아래 경로다. 로그인은 `/auth` 아래에 있다.
CALLBACK_PATH = "/api/v1/auth/kakao/callback"
PENDING_COOKIE = "kakao_pending"
PENDING_PATH = "/api/v1/auth"
PENDING_TTL_SECONDS = 1800

_LOGIN_KIND = "kakao_login"
_PENDING_KIND = "kakao_pending"


class KakaoOAuthError(Exception):
    """카카오가 사용자 정보를 주지 않았다. 메시지에 code와 토큰은 넣지 않는다."""


@dataclass(frozen=True)
class KakaoIdentity:
    provider_id: str
    email: str | None
    email_verified: bool
    nickname: str | None


@dataclass(frozen=True)
class LoginState:
    return_path: str
    nonce: str


def sign_state(return_path: str, *, now: float | None = None) -> tuple[str, str]:
    """(카카오에 보낼 state, 짝 쿠키에 심을 nonce)를 돌려준다."""
    nonce = secrets.token_urlsafe(16)
    fields = {"p": oauth_state.safe_return_path(return_path), "n": nonce}
    return oauth_state.seal(_LOGIN_KIND, oauth_state.STATE_TTL_SECONDS, fields, now=now), nonce


def verify_state(token: str, *, now: float | None = None) -> LoginState | None:
    """로그인으로 서명했고 만료되지 않은 state의 내용을 돌려준다. 아니면 None이다."""
    data = oauth_state.decode(_LOGIN_KIND, token, now=now)
    return LoginState(oauth_state.safe_return_path(data["p"]), data["n"]) if data else None


def authorize_url(state: str) -> str:
    """카카오 로그인 동의 화면 주소."""
    query = urlencode(
        {
            "client_id": require_env("KAKAO_REST_API_KEY"),
            "redirect_uri": require_env("KAKAO_REDIRECT_URI"),
            "response_type": "code",
            "state": state,
        }
    )
    return f"{AUTHORIZE_URL}?{query}"


def _json(response: httpx.Response, step: str) -> dict:
    if response.status_code != 200:
        raise KakaoOAuthError(f"{step} 거절: HTTP {response.status_code}")
    try:
        data = response.json()
    except ValueError:
        data = None
    return data if isinstance(data, dict) else {}


def _parse_identity(data: dict) -> KakaoIdentity:
    raw_id = data.get("id")
    if isinstance(raw_id, bool) or not isinstance(raw_id, int):
        raise KakaoOAuthError("사용자 정보에 id가 없습니다")
    account = data.get("kakao_account")
    account = account if isinstance(account, dict) else {}
    email = account.get("email")
    # is_email_valid가 거짓이면 다른 카카오 계정이 가져간 만료된 이메일이다.
    usable = isinstance(email, str) and bool(email) and account.get("is_email_valid") is True
    profile = account.get("profile")
    nickname = profile.get("nickname") if isinstance(profile, dict) else None
    return KakaoIdentity(
        provider_id=str(raw_id),
        email=normalize_email(email) if usable else None,
        email_verified=usable and account.get("is_email_verified") is True,
        nickname=nickname if isinstance(nickname, str) and nickname else None,
    )


def fetch_identity(code: str, *, transport: httpx.BaseTransport | None = None) -> KakaoIdentity:
    """일회용 code로 카카오 사용자 정보를 읽는다. 실패하면 `KakaoOAuthError`를 던진다."""
    form = {
        "grant_type": "authorization_code",
        "client_id": require_env("KAKAO_REST_API_KEY"),
        "client_secret": require_env("KAKAO_CLIENT_SECRET"),
        "redirect_uri": require_env("KAKAO_REDIRECT_URI"),
        "code": code,
    }
    try:
        with httpx.Client(timeout=10.0, transport=transport) as client:
            access_token = _json(client.post(TOKEN_URL, data=form), "토큰 교환").get("access_token")
            if not isinstance(access_token, str) or not access_token:
                raise KakaoOAuthError("토큰 응답에 access_token이 없습니다")
            user = client.get(USER_URL, headers={"Authorization": f"Bearer {access_token}"})
    except httpx.HTTPError as exc:
        # 예외 문자열에 주소가 들어갈 수 있어서 종류만 남긴다.
        raise KakaoOAuthError(f"카카오 요청 실패: {type(exc).__name__}") from None
    return _parse_identity(_json(user, "사용자 정보 조회"))


def seal_pending(identity: KakaoIdentity, *, now: float | None = None) -> str:
    """가입을 마칠 때까지 쿠키에 둘 토큰. 인증되지 않은 이메일은 담지 않아 가입에 쓰일 길이 없다."""
    email = identity.email if identity.email_verified else None
    fields = {"i": identity.provider_id, "m": email, "k": identity.nickname}
    return oauth_state.seal(_PENDING_KIND, PENDING_TTL_SECONDS, fields, now=now)


def read_pending(token: str, *, now: float | None = None) -> KakaoIdentity | None:
    """대기 쿠키의 카카오 신원. email이 있으면 카카오가 인증한 값이다. 쓸 수 없는 토큰이면 None이다."""
    data = oauth_state.decode(_PENDING_KIND, token, now=now)
    if data is None:
        return None
    return KakaoIdentity(data["i"], data["m"], data["m"] is not None, data["k"])


def _auth_screen(path: str, return_path: str) -> str:
    """로그인 전 화면 주소에 돌아갈 곳을 붙인다. 붙여서 너무 길어지면 화면을 잃지 않게 돌아갈 곳을 뺀다."""
    separator = "&" if "?" in path else "?"
    wrapped = f"{path}{separator}{urlencode({'next': return_path})}"
    return wrapped if len(wrapped) <= oauth_state.MAX_RETURN_PATH_LENGTH else path


def frontend_return_url(return_path: str, result: str, reason: str | None = None) -> str:
    """로그인 화면 주소. 프론트가 `?oauth=kakao&oauth_result=...`를 읽고 `next`로 이어 간다."""
    return oauth_state.frontend_return_url(PROVIDER, _auth_screen("/login", return_path), result, reason)


def signup_url(return_path: str) -> str:
    """가입 화면 주소. 카카오 신원은 쿠키에만 두고 주소에는 모드만 싣는다."""
    return _auth_screen("/signup?kakao=1", return_path)
