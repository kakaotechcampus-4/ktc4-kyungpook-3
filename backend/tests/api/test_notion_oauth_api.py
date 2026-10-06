import logging
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlsplit

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import Integration, Member, Session as SessionModel, User, Workspace
from app.services import notion, notion_connect, notion_oauth
from app.services.notion_oauth import NONCE_COOKIE, NotionToken

FAILED = "oauth=notion&oauth_result=failed"


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()

    def override_get_db():
        yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield session
    finally:
        app.dependency_overrides.pop(get_db, None)
        session.close()


@pytest.fixture(autouse=True)
def oauth_env(monkeypatch):
    monkeypatch.setenv("OAUTH_STATE_SECRET", "k" * 40)
    monkeypatch.setenv("NOTION_CLIENT_ID", "client-id")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("NOTION_REDIRECT_URI", "http://localhost:5173/api/v1/integrations/notion/callback")


def _user(db, email: str, token: str) -> User:
    user = User(email=email, name=email.split("@")[0])
    db.add(user)
    db.flush()
    db.add(SessionModel(user_id=user.user_id, session_token=token, expires_at=datetime.now(timezone.utc) + timedelta(days=1)))
    return user


@pytest.fixture
def seed(db):
    """워크스페이스의 PM alice와 일반 멤버 bob."""
    alice = _user(db, "alice@example.com", "alice-token")
    bob = _user(db, "bob@example.com", "bob-token")
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    db.add(Member(workspace_id=ws.workspace_id, user_id=alice.user_id, display_name="alice", role="pm"))
    db.add(Member(workspace_id=ws.workspace_id, user_id=bob.user_id, display_name="bob", role="member"))
    db.commit()
    return {"workspace_id": ws.workspace_id, "alice": alice.user_id, "bob": bob.user_id}


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def fake_notion(monkeypatch):
    """토큰 교환·DB 확인·뒤의 작업을 가짜로 바꾸고, 불린 내용을 기록한다."""
    calls = {"exchange": [], "verify": [], "attach": []}
    state = {
        "token": NotionToken("secret_new", "refresh_new", "개인 페이지", "copied-page"),
        "verify": [],
    }

    def exchange(code, *, transport=None):
        calls["exchange"].append(code)
        if isinstance(state["token"], Exception):
            raise state["token"]
        return state["token"]

    def verify(access_token, database_id, *, transport=None):
        calls["verify"].append((access_token, database_id))
        return state["verify"]

    def attach(*args, **kwargs):
        calls["attach"].append(args)

    monkeypatch.setattr(notion_oauth, "exchange_code", exchange)
    monkeypatch.setattr(notion, "verify_database_schema", verify)
    monkeypatch.setattr(notion_connect, "attach_template_database", attach)
    return calls, state


def _cookie(session: str | None = None, nonce: str | None = None) -> dict[str, str]:
    parts = []
    if session:
        parts.append(f"session_token={session}")
    if nonce:
        parts.append(f"{NONCE_COOKIE}={nonce}")
    return {"Cookie": "; ".join(parts)} if parts else {}


def _start(client, workspace_id, *, state="/onboarding", session="alice-token"):
    return client.get(
        f"/api/v1/workspaces/{workspace_id}/integrations/notion/start",
        params={"state": state},
        headers=_cookie(session=session),
        follow_redirects=False,
    )


def _callback(client, *, state, nonce, session="alice-token", **params):
    response = client.get(
        notion_oauth.CALLBACK_PATH,
        params={"state": state, **params},
        headers=_cookie(session=session, nonce=nonce),
        follow_redirects=False,
    )
    assert response.status_code == 302
    # 어떤 결과든 짝 쿠키를 지운다
    deleted = response.headers.get("set-cookie", "")
    assert f"{NONCE_COOKIE}=" in deleted and "Max-Age=0" in deleted
    return response


def _signed(seed, *, user="alice", path="/onboarding", now=None):
    return notion_oauth.sign_state(seed["workspace_id"], seed[user], path, now=now)


def _row(db, seed) -> Integration | None:
    db.expire_all()
    return notion.get_notion_integration(db, seed["workspace_id"])


# ---------- start ----------


def test_callback_route_matches_redirect_path():
    # Notion에 등록하는 redirect URI·짝 쿠키의 Path와 실제 주소가 같아야 한다
    assert app.url_path_for("notion_oauth_callback") == notion_oauth.CALLBACK_PATH


def test_start_sends_pm_to_notion_with_signed_state_and_nonce_cookie(client, seed):
    response = _start(client, seed["workspace_id"])

    assert response.status_code == 302
    location = urlsplit(response.headers["location"])
    assert f"{location.scheme}://{location.netloc}{location.path}" == notion_oauth.AUTHORIZE_URL
    payload = notion_oauth.verify_state(dict(parse_qsl(location.query))["state"])
    assert (payload.workspace_id, payload.user_id, payload.return_path) == (
        seed["workspace_id"], seed["alice"], "/onboarding"
    )

    cookie = response.headers["set-cookie"]
    assert f"{NONCE_COOKIE}={payload.nonce}" in cookie
    for attribute in ("HttpOnly", "Secure", "SameSite=lax", "Max-Age=600", f"Path={notion_oauth.CALLBACK_PATH}"):
        assert attribute in cookie


@pytest.mark.parametrize("session", ["bob-token", None, "unknown-token"])
def test_start_rejects_non_pm_or_anonymous(client, seed, session):
    response = _start(client, seed["workspace_id"], session=session)

    assert response.status_code == 302
    assert response.headers["location"] == f"/onboarding?{FAILED}"
    assert "set-cookie" not in response.headers


def test_start_rejects_other_workspace(client, seed, db):
    other = Workspace(name="B")
    db.add(other)
    db.commit()

    assert _start(client, other.workspace_id).headers["location"] == f"/onboarding?{FAILED}"


def test_start_fails_without_state_secret(client, seed, monkeypatch):
    monkeypatch.delenv("OAUTH_STATE_SECRET")

    response = _start(client, seed["workspace_id"])

    assert response.headers["location"] == f"/onboarding?{FAILED}"
    assert "set-cookie" not in response.headers


def test_start_replaces_external_return_path(client, seed):
    response = _start(client, seed["workspace_id"], state="https://evil.example/phish")

    state = dict(parse_qsl(urlsplit(response.headers["location"]).query))["state"]
    assert notion_oauth.verify_state(state).return_path == "/"


# ---------- callback: 성공 ----------


def test_callback_saves_token_and_schedules_database_lookup(client, seed, db, fake_notion):
    calls, _ = fake_notion
    state, nonce = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, code="the-code")

    assert response.headers["location"] == "/onboarding?oauth=notion&oauth_result=success"
    row = _row(db, seed)
    assert (row.access_token, row.refresh_token, row.provider_channel_id) == ("secret_new", "refresh_new", None)
    assert calls["exchange"] == ["the-code"]
    assert calls["attach"] == [(seed["workspace_id"], "secret_new", "copied-page")]


def test_reconnect_keeps_database_that_still_works(client, seed, db, fake_notion):
    calls, state_ = fake_notion
    db.add(Integration(workspace_id=seed["workspace_id"], provider="notion", access_token="secret_old", provider_channel_id="db-old"))
    db.commit()
    state_["verify"] = []  # 새 토큰으로도 쓸 수 있다
    state, nonce = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, code="the-code")

    assert "oauth_result=success" in response.headers["location"]
    row = _row(db, seed)
    assert (row.access_token, row.provider_channel_id) == ("secret_new", "db-old")
    assert calls["verify"] == [("secret_new", "db-old")]
    assert calls["attach"] == []


def test_reconnect_looks_up_new_database_when_old_one_is_unusable(client, seed, db, fake_notion):
    calls, state_ = fake_notion
    db.add(Integration(workspace_id=seed["workspace_id"], provider="notion", access_token="secret_old", provider_channel_id="db-old"))
    db.commit()
    state_["verify"] = ["접근할 수 없음"]
    state, nonce = _signed(seed)

    _callback(client, state=state, nonce=nonce, code="the-code")

    row = _row(db, seed)
    assert (row.access_token, row.provider_channel_id) == ("secret_new", None)
    assert calls["attach"] == [(seed["workspace_id"], "secret_new", "copied-page")]


def test_reconnect_clears_database_saved_by_previous_lookup_meanwhile(client, seed, db, fake_notion, monkeypatch):
    calls, _ = fake_notion
    # 이전 연결의 DB 찾기가 아직 끝나지 않았다(DB ID가 비어 있음)
    db.add(Integration(workspace_id=seed["workspace_id"], provider="notion", access_token="secret_old"))
    db.commit()
    find = notion.get_notion_integration

    def read_then_previous_lookup_saves(session, workspace_id):
        # callback이 행을 읽은 직후, 이전 작업이 옛 토큰의 DB ID를 저장한다(callback이 읽은 값은 그대로 None)
        integration = find(session, workspace_id)
        session.execute(
            update(Integration).where(Integration.workspace_id == workspace_id).values(provider_channel_id="db-old"),
            execution_options={"synchronize_session": False},
        )
        return integration

    monkeypatch.setattr(notion, "get_notion_integration", read_then_previous_lookup_saves)
    state, nonce = _signed(seed)

    _callback(client, state=state, nonce=nonce, code="the-code")

    db.expire_all()
    row = db.query(Integration).filter(Integration.workspace_id == seed["workspace_id"]).one()
    # 새 토큰에 옛 DB가 짝지어 남지 않는다. DB는 새 작업이 다시 찾는다.
    assert (row.access_token, row.provider_channel_id) == ("secret_new", None)
    assert calls["attach"] == [(seed["workspace_id"], "secret_new", "copied-page")]


def test_concurrent_first_connect_fails_without_overwriting(client, seed, db, fake_notion, monkeypatch):
    calls, _ = fake_notion
    # 다른 callback이 방금 행을 만들었는데, 이 callback은 그 전에 "행 없음"을 읽었다
    db.add(Integration(workspace_id=seed["workspace_id"], provider="notion", access_token="secret_other"))
    db.commit()
    monkeypatch.setattr(notion, "get_notion_integration", lambda session, workspace_id: None)
    state, nonce = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, code="the-code")

    assert response.headers["location"] == f"/onboarding?{FAILED}"
    row = db.query(Integration).filter(Integration.workspace_id == seed["workspace_id"]).one()
    assert row.access_token == "secret_other"
    assert calls["attach"] == []


# ---------- callback: 취소·실패 ----------


def test_cancel_on_notion_returns_cancelled(client, seed, db, fake_notion):
    calls, _ = fake_notion
    state, nonce = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, error="access_denied")

    assert response.headers["location"] == "/onboarding?oauth=notion&oauth_result=cancelled"
    assert _row(db, seed) is None
    assert calls["exchange"] == []


def test_other_notion_error_fails(client, seed, db, fake_notion):
    state, nonce = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, error="server_error")

    assert response.headers["location"] == f"/onboarding?{FAILED}"


def test_choosing_pages_instead_of_template_fails_without_saving(client, seed, db, fake_notion):
    calls, state_ = fake_notion
    state_["token"] = NotionToken("secret_new", None, "개인 페이지", None)
    state, nonce = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, code="the-code")

    assert response.headers["location"] == f"/onboarding?{FAILED}"
    assert _row(db, seed) is None
    assert calls["attach"] == []


def test_token_exchange_failure_fails_without_saving(client, seed, db, fake_notion):
    _, state_ = fake_notion
    state_["token"] = notion_oauth.NotionOAuthError("토큰 교환 거절: HTTP 400 (invalid_grant)")
    state, nonce = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, code="the-code")

    assert response.headers["location"] == f"/onboarding?{FAILED}"
    assert _row(db, seed) is None


def test_missing_code_fails(client, seed, fake_notion):
    calls, _ = fake_notion
    state, nonce = _signed(seed)

    assert _callback(client, state=state, nonce=nonce).headers["location"] == f"/onboarding?{FAILED}"
    assert calls["exchange"] == []


@pytest.mark.parametrize("state", ["", "garbage", "a.b"])
def test_invalid_state_fails_to_root(client, seed, fake_notion, state):
    calls, _ = fake_notion

    response = _callback(client, state=state, nonce="whatever", code="the-code")

    assert response.headers["location"] == f"/?{FAILED}"
    assert calls["exchange"] == []


def test_tampered_state_fails(client, seed, fake_notion):
    calls, _ = fake_notion
    state, nonce = _signed(seed)
    segment, signature = state.split(".")
    flipped = ("A" if signature[0] != "A" else "B") + signature[1:]

    response = _callback(client, state=f"{segment}.{flipped}", nonce=nonce, code="the-code")

    assert response.headers["location"] == f"/?{FAILED}"
    assert calls["exchange"] == []


def test_expired_state_fails(client, seed, fake_notion):
    state, nonce = _signed(seed, now=time.time() - notion_oauth.STATE_TTL_SECONDS - 1)

    assert _callback(client, state=state, nonce=nonce, code="the-code").headers["location"] == f"/?{FAILED}"


@pytest.mark.parametrize("nonce", [None, "different-nonce"])
def test_missing_or_mismatched_nonce_cookie_fails(client, seed, fake_notion, nonce):
    calls, _ = fake_notion
    state, _ = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, code="the-code")

    assert response.headers["location"] == f"/onboarding?{FAILED}"
    assert calls["exchange"] == []


def test_state_cannot_be_reused_after_success(client, seed, db, fake_notion):
    calls, _ = fake_notion
    state, nonce = _signed(seed)
    first = _callback(client, state=state, nonce=nonce, code="the-code")
    assert "oauth_result=success" in first.headers["location"]

    # 브라우저는 첫 응답에서 쿠키를 지웠다. 같은 state로 다시 들어오면 막힌다.
    second = _callback(client, state=state, nonce=None, code="another-code")

    assert second.headers["location"] == f"/onboarding?{FAILED}"
    assert calls["exchange"] == ["the-code"]


def test_callback_from_another_user_fails(client, seed, db, fake_notion):
    calls, _ = fake_notion
    state, nonce = _signed(seed)  # alice가 시작한 state

    response = _callback(client, state=state, nonce=nonce, session="bob-token", code="the-code")

    assert response.headers["location"] == f"/onboarding?{FAILED}"
    assert _row(db, seed) is None
    assert calls["exchange"] == []


def test_callback_without_login_fails(client, seed, fake_notion):
    state, nonce = _signed(seed)

    response = _callback(client, state=state, nonce=nonce, session=None, code="the-code")

    assert response.headers["location"] == f"/onboarding?{FAILED}"


def _oauth_logs(caplog) -> list[tuple[int, str]]:
    return [(r.levelno, r.getMessage()) for r in caplog.records if r.name == "app.api.integrations"]


def test_callback_failure_is_logged_as_warning_with_reason(client, seed, fake_notion, caplog):
    _, state_ = fake_notion
    state_["token"] = NotionToken("secret_new", None, "개인 페이지", None)
    state, nonce = _signed(seed)
    caplog.set_level(logging.INFO, logger="app.api.integrations")

    _callback(client, state=state, nonce=nonce, code="the-code")

    assert _oauth_logs(caplog) == [
        (logging.WARNING, "Notion 연결 callback result=failed reason=template_not_used")
    ]


@pytest.mark.parametrize(("params", "result"), [({"code": "the-code"}, "success"), ({"error": "access_denied"}, "cancelled")])
def test_callback_success_and_cancel_are_logged_as_info(client, seed, fake_notion, caplog, params, result):
    state, nonce = _signed(seed)
    caplog.set_level(logging.INFO, logger="app.api.integrations")

    _callback(client, state=state, nonce=nonce, **params)

    assert [level for level, message in _oauth_logs(caplog) if f"result={result}" in message] == [logging.INFO]


def test_start_rejection_is_logged_as_warning(client, seed, caplog):
    caplog.set_level(logging.INFO, logger="app.api.integrations")

    _start(client, seed["workspace_id"], session="bob-token")

    assert _oauth_logs(caplog) == [(logging.WARNING, "Notion 연결 시작 실패 reason=FORBIDDEN")]


def test_user_who_stopped_being_pm_meanwhile_fails(client, seed, db, fake_notion):
    calls, _ = fake_notion
    state, nonce = _signed(seed)
    db.query(Member).filter(Member.user_id == seed["alice"]).update({"role": "member"})
    db.commit()

    response = _callback(client, state=state, nonce=nonce, code="the-code")

    assert response.headers["location"] == f"/onboarding?{FAILED}"
    assert _row(db, seed) is None
    assert calls["exchange"] == []
