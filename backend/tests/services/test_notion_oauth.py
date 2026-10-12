import base64
from urllib.parse import parse_qsl, urlsplit

import httpx
import pytest

from app.services import notion_oauth
from app.services.notion_oauth import (
    NotionOAuthError,
    OAuthConfigError,
    StatePayload,
    authorize_url,
    exchange_code,
    frontend_return_url,
    safe_return_path,
    sign_state,
    verify_state,
)

SECRET = "k" * 40
NOW = 1_700_000_000


@pytest.fixture(autouse=True)
def oauth_env(monkeypatch):
    monkeypatch.setenv("OAUTH_STATE_SECRET", SECRET)
    monkeypatch.setenv("NOTION_CLIENT_ID", "client-id")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("NOTION_REDIRECT_URI", "http://localhost:5173/api/v1/integrations/notion/callback")


# ---------- state 서명 ----------


def test_state_round_trip_returns_original_values():
    state, nonce = sign_state("ws1", "user1", "/onboarding", now=NOW)

    payload = verify_state(state, now=NOW + 1)

    assert payload == StatePayload("ws1", "user1", "/onboarding", nonce)


def test_each_state_has_its_own_nonce():
    _, first = sign_state("ws1", "user1", "/", now=NOW)
    _, second = sign_state("ws1", "user1", "/", now=NOW)

    assert first != second


def test_sign_state_replaces_unsafe_return_path():
    state, _ = sign_state("ws1", "user1", "https://evil.example", now=NOW)

    assert verify_state(state, now=NOW).return_path == "/"


def test_state_is_valid_until_ttl_then_rejected():
    state, _ = sign_state("ws1", "user1", "/", now=NOW)

    assert verify_state(state, now=NOW + notion_oauth.STATE_TTL_SECONDS - 1) is not None
    assert verify_state(state, now=NOW + notion_oauth.STATE_TTL_SECONDS) is None
    assert verify_state(state, now=NOW + notion_oauth.STATE_TTL_SECONDS + 60) is None


def test_state_with_changed_content_is_rejected():
    state, _ = sign_state("ws1", "user1", "/", now=NOW)
    _, signature = state.split(".")
    forged = notion_oauth._encode({"w": "ws2", "u": "user1", "p": "/", "n": "x", "e": NOW + 600})
    forged_segment, _ = forged.split(".")

    # 다른 워크스페이스로 바꾼 내용에 원래 서명을 붙인다
    assert verify_state(f"{forged_segment}.{signature}", now=NOW) is None


def test_state_with_changed_signature_is_rejected():
    state, _ = sign_state("ws1", "user1", "/", now=NOW)
    flipped = "A" if state[-1] != "A" else "B"

    assert verify_state(state[:-1] + flipped, now=NOW) is None


def test_state_signed_with_another_key_is_rejected(monkeypatch):
    state, _ = sign_state("ws1", "user1", "/", now=NOW)
    monkeypatch.setenv("OAUTH_STATE_SECRET", "z" * 40)

    assert verify_state(state, now=NOW) is None


@pytest.mark.parametrize("token", ["", "abc", "a.b.c", ".", "..", "가.나", "a." + "b" * 10])
def test_malformed_state_is_rejected(token):
    assert verify_state(token, now=NOW) is None


def test_state_that_is_not_a_string_is_rejected():
    assert verify_state(None, now=NOW) is None  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "payload",
    [
        {"u": "user1", "p": "/", "n": "x", "e": NOW + 600},  # w 없음
        {"w": "ws1", "p": "/", "n": "x", "e": NOW + 600},  # u 없음
        {"w": "ws1", "u": "user1", "p": "/", "e": NOW + 600},  # n 없음
        {"w": "ws1", "u": "user1", "p": "/", "n": "x"},  # e 없음
        {"w": "ws1", "u": "user1", "p": "/", "n": "x", "e": "999999999999"},  # e가 문자열
        {"w": "ws1", "u": "user1", "p": "/", "n": "x", "e": True},  # e가 bool
        {"w": 1, "u": "user1", "p": "/", "n": "x", "e": NOW + 600},  # w가 문자열이 아님
        {"w": "", "u": "user1", "p": "/", "n": "x", "e": NOW + 600},  # w가 빈 문자열
    ],
)
def test_signed_state_with_missing_or_wrong_fields_is_rejected(payload):
    assert verify_state(notion_oauth._encode(payload), now=NOW) is None


def test_signed_state_that_is_not_an_object_is_rejected():
    segment = base64.urlsafe_b64encode(b"[1,2]").rstrip(b"=").decode()
    token = f"{segment}.{notion_oauth._signature(segment)}"

    assert verify_state(token, now=NOW) is None


@pytest.mark.parametrize("secret", ["", "k" * (notion_oauth.MIN_SECRET_LENGTH - 1)])
def test_missing_or_short_secret_raises_config_error(monkeypatch, secret):
    monkeypatch.setenv("OAUTH_STATE_SECRET", secret)

    with pytest.raises(OAuthConfigError):
        sign_state("ws1", "user1", "/", now=NOW)
    with pytest.raises(OAuthConfigError):
        verify_state("a.b", now=NOW)


def test_unset_secret_raises_config_error(monkeypatch):
    monkeypatch.delenv("OAUTH_STATE_SECRET")

    with pytest.raises(OAuthConfigError):
        sign_state("ws1", "user1", "/", now=NOW)


# ---------- 인가 주소 ----------


def test_authorize_url_carries_client_redirect_and_state():
    state = "abc.DEF-ghi_123"

    url = authorize_url(state)

    parts = urlsplit(url)
    assert f"{parts.scheme}://{parts.netloc}{parts.path}" == "https://api.notion.com/v1/oauth/authorize"
    assert dict(parse_qsl(parts.query)) == {
        "client_id": "client-id",
        "response_type": "code",
        "owner": "user",
        "redirect_uri": "http://localhost:5173/api/v1/integrations/notion/callback",
        "state": state,
    }


@pytest.mark.parametrize("name", ["NOTION_CLIENT_ID", "NOTION_REDIRECT_URI"])
def test_authorize_url_requires_env(monkeypatch, name):
    monkeypatch.delenv(name)

    with pytest.raises(OAuthConfigError):
        authorize_url("state")


# ---------- 토큰 교환 ----------


def _exchange(response: httpx.Response | Exception):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if isinstance(response, Exception):
            raise response
        return response

    return seen, httpx.MockTransport(handler)


def test_exchange_code_sends_basic_auth_and_parses_token():
    seen, transport = _exchange(
        httpx.Response(
            200,
            json={
                "access_token": "secret_abc",
                "refresh_token": "refresh_abc",
                "workspace_name": "우리팀",
                "duplicated_template_id": "page-1",
                "bot_id": "ignored",
            },
        )
    )

    token = exchange_code("the-code", transport=transport)

    request = seen[0]
    expected_auth = base64.b64encode(b"client-id:client-secret").decode()
    assert request.method == "POST"
    assert str(request.url) == "https://api.notion.com/v1/oauth/token"
    assert request.headers["Authorization"] == f"Basic {expected_auth}"
    assert request.read() == (
        b'{"grant_type":"authorization_code","code":"the-code",'
        b'"redirect_uri":"http://localhost:5173/api/v1/integrations/notion/callback"}'
    )
    assert token.access_token == "secret_abc"
    assert token.refresh_token == "refresh_abc"
    assert token.workspace_name == "우리팀"
    assert token.duplicated_template_id == "page-1"


@pytest.mark.parametrize("duplicated", [None, ""])
def test_exchange_code_without_template_has_no_duplicated_page(duplicated):
    _, transport = _exchange(
        httpx.Response(200, json={"access_token": "secret_abc", "duplicated_template_id": duplicated})
    )

    token = exchange_code("the-code", transport=transport)

    assert token.duplicated_template_id is None
    assert token.refresh_token is None


def test_token_repr_does_not_show_secrets():
    _, transport = _exchange(
        httpx.Response(200, json={"access_token": "secret_abc", "refresh_token": "refresh_abc"})
    )

    text = repr(exchange_code("the-code", transport=transport))

    assert "secret_abc" not in text
    assert "refresh_abc" not in text


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(400, json={"error": "invalid_grant"}),
        httpx.Response(401, json={"error": "unauthorized"}),
        httpx.Response(500, text="oops"),
        httpx.Response(200, json={}),
        httpx.Response(200, json={"access_token": ""}),
        httpx.Response(200, json=["not", "an", "object"]),
        httpx.Response(200, text="not json"),
    ],
)
def test_exchange_code_failure_raises_without_leaking_code(response):
    _, transport = _exchange(response)

    with pytest.raises(NotionOAuthError) as caught:
        exchange_code("the-code", transport=transport)

    assert "the-code" not in str(caught.value)


def test_exchange_code_error_message_names_status_and_error():
    _, transport = _exchange(httpx.Response(400, json={"error": "invalid_grant"}))

    with pytest.raises(NotionOAuthError, match=r"HTTP 400 \(invalid_grant\)"):
        exchange_code("the-code", transport=transport)


def test_exchange_code_network_error_raises_without_leaking_code():
    _, transport = _exchange(httpx.ConnectError("failed to reach https://x/?code=the-code"))

    with pytest.raises(NotionOAuthError) as caught:
        exchange_code("the-code", transport=transport)

    assert "the-code" not in str(caught.value)
    assert caught.value.__cause__ is None


@pytest.mark.parametrize("name", ["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET", "NOTION_REDIRECT_URI"])
def test_exchange_code_requires_env(monkeypatch, name):
    monkeypatch.delenv(name)
    _, transport = _exchange(httpx.Response(200, json={"access_token": "secret_abc"}))

    with pytest.raises(OAuthConfigError):
        exchange_code("the-code", transport=transport)


# ---------- 복귀 경로 ----------


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/onboarding", "/onboarding"),
        ("/", "/"),
        ("/meetings/new?step=2", "/meetings/new?step=2"),
        ("/a/b#section", "/a/b#section"),
        ("//evil.example", "/"),
        ("//evil.example/path", "/"),
        ("https://evil.example", "/"),
        ("javascript:alert(1)", "/"),
        ("/\\evil.example", "/"),
        ("/ok\\path", "/"),
        ("onboarding", "/"),
        ("", "/"),
        (None, "/"),
        ("/line\nbreak", "/"),
        ("/tab\tbreak", "/"),
        ("/nul\x00byte", "/"),
        ("/" + "a" * notion_oauth.MAX_RETURN_PATH_LENGTH, "/"),
    ],
)
def test_safe_return_path(path, expected):
    assert safe_return_path(path) == expected


def test_safe_return_path_accepts_longest_allowed_path():
    path = "/" + "a" * (notion_oauth.MAX_RETURN_PATH_LENGTH - 1)

    assert safe_return_path(path) == path


# ---------- 앱 복귀 주소 ----------


@pytest.mark.parametrize(
    ("path", "result", "expected"),
    [
        ("/onboarding", "success", "/onboarding?oauth=notion&oauth_result=success"),
        ("/onboarding", "cancelled", "/onboarding?oauth=notion&oauth_result=cancelled"),
        ("/meetings?tab=a", "failed", "/meetings?tab=a&oauth=notion&oauth_result=failed"),
        ("/a#top", "success", "/a?oauth=notion&oauth_result=success#top"),
        ("/a?oauth=discord&oauth_result=failed&x=1", "success", "/a?x=1&oauth=notion&oauth_result=success"),
        ("//evil.example", "failed", "/?oauth=notion&oauth_result=failed"),
        ("https://evil.example/x", "failed", "/?oauth=notion&oauth_result=failed"),
    ],
)
def test_frontend_return_url(path, result, expected):
    assert frontend_return_url(path, result) == expected


@pytest.mark.parametrize("path", ["/onboarding", "//evil.example", "https://evil.example", "/\\evil.example"])
def test_frontend_return_url_never_leaves_the_app(path):
    # 앞부분(scheme·host)이 붙지 않아야 브라우저가 callback이 온 같은 주소로만 이동한다
    url = urlsplit(frontend_return_url(path, "success"))

    assert url.scheme == "" and url.netloc == ""
    assert url.path.startswith("/") and not url.path.startswith("//")


def test_frontend_return_url_rejects_unknown_result():
    with pytest.raises(ValueError):
        frontend_return_url("/", "maybe")
