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
