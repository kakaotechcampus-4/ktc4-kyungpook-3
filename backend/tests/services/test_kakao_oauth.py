"""카카오 로그인 함수 모음(app/services/kakao_oauth.py). 카카오에는 접속하지 않고 httpx.MockTransport 로 답한다."""
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.services import kakao_oauth, oauth_state
from app.services.kakao_oauth import KakaoIdentity, KakaoOAuthError

NOW = 1_700_000_000
ME = {
    "id": 4242424242,
    "kakao_account": {
        "email": " Kim@Example.com",
        "is_email_valid": True,
        "is_email_verified": True,
        "profile": {"nickname": "동우"},
    },
}


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("OAUTH_STATE_SECRET", "k" * 40)
    monkeypatch.setenv("KAKAO_REST_API_KEY", "rest-key")
    monkeypatch.setenv("KAKAO_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("KAKAO_REDIRECT_URI", "https://mm.example/api/v1/auth/kakao/callback")


def _transport(me=ME, *, token_status=200, token_body=None, me_status=200, seen=None):
    def handler(request):
        if seen is not None:
            seen.append(request)
        if request.url.path == "/oauth/token":
            return httpx.Response(token_status, json={"access_token": "at-1"} if token_body is None else token_body)
        return httpx.Response(me_status, json=me)

    return httpx.MockTransport(handler)


def _identity(**overrides):
    account = {**ME["kakao_account"], **overrides}
    return kakao_oauth.fetch_identity("c", transport=_transport({"id": 7, "kakao_account": account}))


def test_authorize_url_sends_state_and_no_scope():
    url = urlsplit(kakao_oauth.authorize_url("st"))

    assert f"{url.scheme}://{url.netloc}{url.path}" == "https://kauth.kakao.com/oauth/authorize"
    assert parse_qs(url.query) == {
        "client_id": ["rest-key"],
        "redirect_uri": ["https://mm.example/api/v1/auth/kakao/callback"],
        "response_type": ["code"],
        "state": ["st"],
    }


def test_authorize_url_without_settings_is_a_config_error(monkeypatch):
    monkeypatch.delenv("KAKAO_REST_API_KEY")

    with pytest.raises(oauth_state.OAuthConfigError):
        kakao_oauth.authorize_url("st")


def test_fetch_identity_exchanges_the_code_then_reads_the_user():
    seen = []

    identity = kakao_oauth.fetch_identity("code-1", transport=_transport(seen=seen))

    assert identity == KakaoIdentity("4242424242", "동우")
    token_call, me_call = seen
    assert str(token_call.url) == "https://kauth.kakao.com/oauth/token"
    assert parse_qs(token_call.content.decode()) == {
        "grant_type": ["authorization_code"],
        "client_id": ["rest-key"],
        "client_secret": ["client-secret"],
        "redirect_uri": ["https://mm.example/api/v1/auth/kakao/callback"],
        "code": ["code-1"],
    }
    assert str(me_call.url) == "https://kapi.kakao.com/v2/user/me"
    assert me_call.headers["authorization"] == "Bearer at-1"


def test_a_verified_kakao_email_is_not_read():
    assert _identity() == KakaoIdentity("7", "동우")


def test_user_with_no_account_details_has_only_an_id():
    identity = kakao_oauth.fetch_identity("c", transport=_transport({"id": 7}))

    assert identity == KakaoIdentity("7", None)


@pytest.mark.parametrize("me", [{}, {"id": None}, {"id": "7"}, {"id": True}, []])
def test_user_info_without_a_numeric_id_fails(me):
    with pytest.raises(KakaoOAuthError):
        kakao_oauth.fetch_identity("c", transport=_transport(me))


@pytest.mark.parametrize(
    "kwargs",
    [
        {"token_status": 400, "token_body": {"error": "invalid_grant"}},
        {"token_body": {}},
        {"token_body": {"access_token": 3}},
        {"me_status": 401},
    ],
)
def test_kakao_refusal_fails_without_leaking_the_code_or_token(kwargs):
    with pytest.raises(KakaoOAuthError) as exc:
        kakao_oauth.fetch_identity("code-1", transport=_transport(**kwargs))

    assert "code-1" not in str(exc.value)
    assert "at-1" not in str(exc.value)


def test_network_failure_is_a_kakao_error():
    def boom(request):
        raise httpx.ConnectError("https://kauth.kakao.com/oauth/token?code=code-1")

    with pytest.raises(KakaoOAuthError) as exc:
        kakao_oauth.fetch_identity("code-1", transport=httpx.MockTransport(boom))

    assert "code-1" not in str(exc.value)


def test_login_state_round_trip_keeps_only_a_safe_return_path():
    state, nonce = kakao_oauth.sign_state("/workspaces/1", now=NOW)
    evil, _ = kakao_oauth.sign_state("//evil.example", now=NOW)

    login = kakao_oauth.verify_state(state, now=NOW)
    assert (login.return_path, login.nonce) == ("/workspaces/1", nonce)
    assert kakao_oauth.verify_state(evil, now=NOW).return_path == "/"


def test_login_state_expires_after_ten_minutes():
    state, _ = kakao_oauth.sign_state("/", now=NOW)

    assert kakao_oauth.verify_state(state, now=NOW + 600) is None


def test_integration_state_is_not_a_login_state():
    state, _ = oauth_state.sign_state("notion", "ws", "u", "/", now=NOW)

    assert kakao_oauth.verify_state(state, now=NOW) is None


def test_pending_round_trip():
    token = kakao_oauth.seal_pending(KakaoIdentity("7", "동우"), now=NOW)

    assert kakao_oauth.read_pending(token, now=NOW) == KakaoIdentity("7", "동우")


def test_pending_token_carries_only_the_kakao_id_and_nickname():
    """서명만 하고 암호화하지 않는 쿠키라 브라우저에서 읽힌다."""
    token = kakao_oauth.seal_pending(KakaoIdentity("7", "동우"), now=NOW)

    data = oauth_state.decode("kakao_pending", token, now=NOW)
    assert (data["i"], data["k"]) == ("7", "동우")
    assert "m" not in data


def test_pending_sealed_with_an_email_before_the_change_still_reads():
    token = oauth_state.seal("kakao_pending", 1800, {"i": "7", "m": "kim@example.com", "k": "동우"}, now=NOW)

    assert kakao_oauth.read_pending(token, now=NOW) == KakaoIdentity("7", "동우")


def test_pending_expires_after_thirty_minutes():
    token = kakao_oauth.seal_pending(KakaoIdentity("7", None), now=NOW)

    assert kakao_oauth.read_pending(token, now=NOW + 1799) is not None
    assert kakao_oauth.read_pending(token, now=NOW + 1800) is None


def test_other_kinds_are_not_a_pending_token():
    assert kakao_oauth.read_pending(oauth_state.seal("signup_email", 60, {"i": "7"}, now=NOW), now=NOW) is None
    assert kakao_oauth.read_pending("", now=NOW) is None


def test_return_url_keeps_next_on_the_login_screen():
    url = kakao_oauth.frontend_return_url("/workspaces/1?tab=a", "failed")

    parts = urlsplit(url)
    assert parts.path == "/login"
    assert parse_qs(parts.query) == {
        "next": ["/workspaces/1?tab=a"],
        "oauth": ["kakao"],
        "oauth_result": ["failed"],
    }


def test_signup_url_carries_a_mode_and_no_identity():
    parts = urlsplit(kakao_oauth.signup_url("/workspaces/1"))

    assert parts.path == "/signup"
    assert parse_qs(parts.query) == {"kakao": ["1"], "next": ["/workspaces/1"]}


def test_too_long_next_is_dropped_so_the_screen_survives():
    long_path = "/" + "가" * 150

    assert kakao_oauth.signup_url(long_path) == "/signup?kakao=1"
    assert urlsplit(kakao_oauth.frontend_return_url(long_path, "failed")).path == "/login"
