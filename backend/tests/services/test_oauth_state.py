"""OAuth state를 제공자에 묶는 동작(#171). 서명·만료·복귀 경로 규칙은 test_notion_oauth.py가 확인한다."""
import pytest

from app.services import oauth_state

NOW = 1_700_000_000


@pytest.fixture(autouse=True)
def oauth_env(monkeypatch):
    monkeypatch.setenv("OAUTH_STATE_SECRET", "k" * 40)


def test_state_is_valid_only_for_the_provider_it_was_signed_for():
    notion_state, _ = oauth_state.sign_state("notion", "ws1", "user1", "/", now=NOW)
    discord_state, _ = oauth_state.sign_state("discord", "ws1", "user1", "/", now=NOW)

    assert oauth_state.verify_state("notion", notion_state, now=NOW) is not None
    assert oauth_state.verify_state("discord", discord_state, now=NOW) is not None
    # 한 제공자의 state를 다른 제공자의 callback에 쓰지 못한다
    assert oauth_state.verify_state("discord", notion_state, now=NOW) is None
    assert oauth_state.verify_state("notion", discord_state, now=NOW) is None


def test_signed_state_without_provider_is_rejected():
    token = oauth_state.encode({"w": "ws1", "u": "user1", "p": "/", "n": "x", "e": NOW + 600})

    assert oauth_state.verify_state("notion", token, now=NOW) is None


def test_return_url_names_the_provider():
    assert oauth_state.frontend_return_url("discord", "/onboarding", "success") == (
        "/onboarding?oauth=discord&oauth_result=success"
    )


def test_nonce_cookie_and_callback_path_differ_by_provider():
    assert oauth_state.nonce_cookie("discord") == "discord_oauth_nonce"
    assert oauth_state.callback_path("discord") == "/api/v1/integrations/discord/callback"
    assert oauth_state.nonce_cookie("notion") != oauth_state.nonce_cookie("discord")


KINDS = ("kakao_login", "signup_email", "kakao_pending", "notion", "discord")


def test_sealed_token_opens_only_as_its_own_kind():
    for kind in KINDS:
        token = oauth_state.seal(kind, 60, {"m": "a@b.c"}, now=NOW)
        assert oauth_state.decode(kind, token, now=NOW)["m"] == "a@b.c"
        for other in KINDS:
            if other != kind:
                assert oauth_state.decode(other, token, now=NOW) is None


def test_provider_state_does_not_open_as_a_sealed_kind():
    state, _ = oauth_state.sign_state("notion", "ws1", "user1", "/", now=NOW)

    for kind in ("kakao_login", "signup_email", "kakao_pending"):
        assert oauth_state.decode(kind, state, now=NOW) is None


def test_verify_state_rejects_login_state():
    token = oauth_state.seal("kakao_login", 600, {"p": "/", "n": "x"}, now=NOW)

    assert oauth_state.verify_state("kakao_login", token, now=NOW) is None
    assert oauth_state.verify_state("notion", token, now=NOW) is None


def test_sealed_token_expires_at_its_ttl():
    token = oauth_state.seal("signup_email", 60, {"m": "a@b.c"}, now=NOW)

    assert oauth_state.decode("signup_email", token, now=NOW + 59) is not None
    assert oauth_state.decode("signup_email", token, now=NOW + 60) is None


def test_fields_cannot_override_kind_or_expiry():
    token = oauth_state.seal("signup_email", 60, {"v": "kakao_pending", "e": NOW + 9999}, now=NOW)

    assert oauth_state.decode("kakao_pending", token, now=NOW) is None
    assert oauth_state.decode("signup_email", token, now=NOW + 60) is None


@pytest.mark.parametrize("token", ["", "abc", "a.b", "a.b.c"])
def test_decode_rejects_malformed_tokens(token):
    assert oauth_state.decode("signup_email", token, now=NOW) is None


def test_tampered_token_is_rejected():
    token = oauth_state.seal("signup_email", 60, {"m": "a@b.c"}, now=NOW)
    forged = oauth_state.seal("signup_email", 60, {"m": "x@b.c"}, now=NOW)

    assert oauth_state.decode("signup_email", f"{forged.split('.')[0]}.{token.split('.')[1]}", now=NOW) is None


def test_mac_depends_on_purpose_text_and_secret(monkeypatch):
    base = oauth_state.mac("signup_code", "a@b.c:123456")

    assert len(base) == 64
    assert oauth_state.mac("signup_code", "a@b.c:123456") == base
    assert oauth_state.mac("other", "a@b.c:123456") != base
    assert oauth_state.mac("signup_code", "a@b.c:123457") != base
    monkeypatch.setenv("OAUTH_STATE_SECRET", "z" * 40)
    assert oauth_state.mac("signup_code", "a@b.c:123456") != base


def test_return_url_drops_a_stale_reason():
    url = oauth_state.frontend_return_url("kakao", "/login?oauth_reason=old", "failed")

    assert url == "/login?oauth=kakao&oauth_result=failed"


@pytest.mark.parametrize("token", ["a.\ud800", "\ud800.a"])
def test_decode_refuses_a_token_that_cannot_be_encoded(token):
    assert oauth_state.decode("signup_email", token) is None
