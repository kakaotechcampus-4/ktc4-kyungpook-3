"""카카오 로그인 API(#427). 카카오에는 접속하지 않고 fetch_identity 를 가짜로 바꾼다."""
import logging
import threading
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import sessionmaker

from app.api import auth
from app.core.database import get_db
from app.main import app
from app.models import Session as SessionModel, User
from app.services import kakao_oauth, oauth_state, signup_codes
from app.services.kakao_oauth import KakaoIdentity, KakaoOAuthError
from app.services.passwords import hash_password
from tests.api.conftest import TEST_DATABASE_URL

START = "/api/v1/auth/kakao/start"
CALLBACK = "/api/v1/auth/kakao/callback"
PENDING = "/api/v1/auth/kakao/pending"
EMAIL = "kim@example.com"
PW = "pw-123456"
VERIFIED = KakaoIdentity("77", EMAIL, True, "동우")
UNVERIFIED = KakaoIdentity("77", EMAIL, False, "동우")
NO_EMAIL = KakaoIdentity("77", None, False, None)


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("OAUTH_STATE_SECRET", "k" * 40)
    monkeypatch.setenv("KAKAO_REST_API_KEY", "rest-key")
    monkeypatch.setenv("KAKAO_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("KAKAO_REDIRECT_URI", "https://mm.example/api/v1/auth/kakao/callback")


@pytest.fixture
def client():
    return TestClient(app, base_url="https://testserver", follow_redirects=False)


@pytest.fixture
def kakao(monkeypatch):
    """fetch_identity 가 돌려줄 값을 고른다. 호출된 code 는 calls 에 남는다."""

    class Fake:
        identity = VERIFIED
        calls: list = []

    Fake.calls = []

    def fetch(code):
        Fake.calls.append(code)
        if isinstance(Fake.identity, Exception):
            raise Fake.identity
        return Fake.identity

    monkeypatch.setattr(kakao_oauth, "fetch_identity", fetch)
    return Fake


def _state(client, next_path="/workspaces/1"):
    """start 를 거쳐 짝 쿠키를 받고 state 를 돌려준다."""
    res = client.get(START, params={"next": next_path})
    assert res.status_code == 302, res.text
    return parse_qs(urlsplit(res.headers["location"]).query)["state"][0]


def _callback(client, **params):
    return client.get(CALLBACK, params=params)


def _login(client, identity=None, kakao=None, next_path="/workspaces/1"):
    if kakao is not None and identity is not None:
        kakao.identity = identity
    return _callback(client, code="kakao-code", state=_state(client, next_path))


def _query(res):
    return parse_qs(urlsplit(res.headers["location"]).query)


def _path(res):
    return urlsplit(res.headers["location"]).path


def _cookies(res):
    return res.headers.get_list("set-cookie")


def _cookie(res, name):
    found = [c for c in _cookies(res) if c.startswith(f"{name}=")]
    return found[0] if found else None


def _user(db, email=EMAIL, **kw):
    user = User(email=email, name="기존", password_hash=hash_password(PW), provider="local", **kw)
    db.add(user)
    db.commit()
    return user


def _row(db, email=EMAIL):
    db.expire_all()
    return db.scalars(select(User).where(User.email == email)).first()


def _session_count(db):
    db.expire_all()
    return len(db.scalars(select(SessionModel.session_id)).all())


def test_start_redirects_to_kakao_with_a_nonce_cookie(mdb, client):
    res = client.get(START, params={"next": "/workspaces/1"})

    assert res.status_code == 302
    url = urlsplit(res.headers["location"])
    assert url.netloc == "kauth.kakao.com"
    query = parse_qs(url.query)
    assert "scope" not in query
    login = kakao_oauth.verify_state(query["state"][0])
    assert login.return_path == "/workspaces/1"
    cookie = _cookie(res, kakao_oauth.NONCE_COOKIE)
    assert login.nonce in cookie
    assert f"Path={CALLBACK}" in cookie
    for attribute in ("HttpOnly", "Secure", "SameSite=lax", "Max-Age=600"):
        assert attribute in cookie


def test_start_ignores_an_outside_return_path(mdb, client):
    state = _state(client, "//evil.example")

    assert kakao_oauth.verify_state(state).return_path == "/"


@pytest.mark.parametrize("name", ["KAKAO_REST_API_KEY", "KAKAO_REDIRECT_URI", "OAUTH_STATE_SECRET"])
def test_start_without_settings_returns_to_login_as_failed(mdb, client, monkeypatch, name):
    monkeypatch.delenv(name)

    res = client.get(START, params={"next": "/workspaces/1"})

    assert res.status_code == 302
    assert _path(res) == "/login"
    assert _query(res)["oauth_result"] == ["failed"]
    assert _cookie(res, kakao_oauth.NONCE_COOKIE) is None


def test_cancel_without_state_is_cancelled_and_changes_nothing(mdb, client, kakao):
    res = _callback(client, error="access_denied", error_description="User denied access")

    assert res.status_code == 302
    assert _path(res) == "/login"
    assert _query(res) == {"next": ["/"], "oauth": ["kakao"], "oauth_result": ["cancelled"]}
    assert kakao.calls == []
    assert _session_count(mdb) == 0


def test_cancel_with_a_valid_state_keeps_next(mdb, client, kakao):
    res = _callback(client, error="access_denied", state=_state(client))

    assert _query(res)["next"] == ["/workspaces/1"]
    assert _query(res)["oauth_result"] == ["cancelled"]


def test_cancel_with_a_forged_state_drops_next(mdb, client, kakao):
    res = _callback(client, error="access_denied", state="forged.state")

    assert _query(res)["next"] == ["/"]


def test_other_kakao_error_is_failed(mdb, client, kakao):
    res = _callback(client, error="server_error", state=_state(client))

    assert _query(res)["oauth_result"] == ["failed"]
    assert _query(res)["next"] == ["/workspaces/1"]


@pytest.mark.parametrize(
    "make",
    [
        lambda: "forged.state",
        lambda: "",
        lambda: oauth_state.sign_state("notion", "ws", "u", "/")[0],
        lambda: oauth_state.seal(signup_codes.PROOF_KIND, 60, {"m": EMAIL, "p": "/", "n": "x"}),
        lambda: kakao_oauth.seal_pending(VERIFIED),
    ],
    ids=["forged", "empty", "notion_state", "signup_proof", "pending_token"],
)
def test_bad_state_fails_before_asking_kakao(mdb, client, kakao, make):
    _state(client)

    res = _callback(client, code="c", state=make())

    assert _path(res) == "/login"
    assert _query(res)["oauth_result"] == ["failed"]
    assert kakao.calls == []


def test_callback_with_no_nonce_cookie_binds_nothing(mdb, kakao):
    _user(mdb)
    state, _ = kakao_oauth.sign_state("/")
    client = TestClient(app, base_url="https://testserver", follow_redirects=False)

    res = _callback(client, code="c", state=state)

    assert _query(res)["oauth_result"] == ["failed"]
    assert kakao.calls == []
    assert _row(mdb).provider_id is None
    assert _session_count(mdb) == 0


def test_callback_with_another_browsers_nonce_binds_nothing(mdb, client, kakao):
    _user(mdb)
    _state(client)
    state, _ = kakao_oauth.sign_state("/")

    res = _callback(client, code="c", state=state)

    assert _query(res)["oauth_result"] == ["failed"]
    assert _row(mdb).provider_id is None


def test_kakao_failure_is_failed_and_keeps_next(mdb, client, kakao):
    kakao.identity = KakaoOAuthError("토큰 교환 거절: HTTP 400")

    res = _login(client)

    assert _query(res)["oauth_result"] == ["failed"]
    assert _query(res)["next"] == ["/workspaces/1"]


def test_missing_client_secret_is_failed_not_a_500(mdb, client, monkeypatch):
    state = _state(client)
    monkeypatch.delenv("KAKAO_CLIENT_SECRET")

    res = _callback(client, code="c", state=state)

    assert res.status_code == 302
    assert _query(res)["oauth_result"] == ["failed"]


def test_nonce_cookie_is_deleted_on_every_branch(mdb, client, kakao):
    def assert_deleted(res):
        cookie = _cookie(res, kakao_oauth.NONCE_COOKIE)
        assert cookie is not None and "Max-Age=0" in cookie and f"Path={CALLBACK}" in cookie

    assert_deleted(_callback(client, error="access_denied"))
    assert_deleted(_callback(client, code="c", state="forged.state"))
    kakao.identity = KakaoOAuthError("x")
    assert_deleted(_login(client))
    kakao.identity = NO_EMAIL
    assert_deleted(_login(client))
    _user(mdb)
    assert_deleted(_login(client, UNVERIFIED, kakao))
    assert_deleted(_login(client, VERIFIED, kakao))


def test_a_state_cannot_be_replayed(mdb, client, kakao):
    kakao.identity = NO_EMAIL
    state = _state(client)
    first = _callback(client, code="c", state=state)
    assert _path(first) == "/signup"

    second = _callback(client, code="c", state=state)

    assert _query(second)["oauth_result"] == ["failed"]
    assert len(kakao.calls) == 1


def test_returning_kakao_user_gets_a_session_on_the_302(mdb, client, kakao):
    user = _user(mdb, "older@example.com")
    mdb.execute(User.__table__.update().values(provider="kakao", provider_id="77"))
    mdb.commit()

    res = _login(client, VERIFIED, kakao)

    assert res.status_code == 302
    assert _path(res) == "/login"
    assert _query(res) == {"next": ["/workspaces/1"], "oauth": ["kakao"], "oauth_result": ["success"]}
    assert _cookie(res, "session_token") is not None
    assert "Secure" in _cookie(res, "session_token")
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["data"]["user"]["user_id"] == user.user_id


def test_verified_email_links_the_existing_account_and_logs_in(mdb, client, kakao):
    user = _user(mdb)

    res = _login(client, VERIFIED, kakao)

    assert _query(res)["oauth_result"] == ["success"]
    assert client.get("/api/v1/auth/me").json()["data"]["user"]["user_id"] == user.user_id
    row = _row(mdb)
    assert (row.provider, row.provider_id) == ("kakao", "77")
    assert row.password_hash


def test_account_bound_to_another_kakao_is_not_overwritten(mdb, client, kakao):
    _user(mdb)
    mdb.execute(User.__table__.update().values(provider="kakao", provider_id="other"))
    mdb.commit()

    res = _login(client, VERIFIED, kakao)

    assert _path(res) == "/login"
    assert _query(res)["oauth_result"] == ["failed"]
    assert _query(res)["oauth_reason"] == ["email_exists"]
    assert _row(mdb).provider_id == "other"
    assert _cookie(res, "session_token") is None
    assert _session_count(mdb) == 0


def test_unverified_email_on_a_registered_account_points_to_login(mdb, client, kakao):
    _user(mdb)

    res = _login(client, UNVERIFIED, kakao)

    assert _path(res) == "/login"
    assert _query(res)["oauth_reason"] == ["email_exists"]
    assert _row(mdb).provider_id is None
    assert _clears_pending(res)
    assert _session_count(mdb) == 0


@pytest.mark.parametrize("identity", [VERIFIED, UNVERIFIED, NO_EMAIL], ids=["verified", "unverified", "no_email"])
def test_unknown_user_goes_to_signup_and_no_account_is_made(mdb, client, kakao, identity):
    res = _login(client, identity, kakao)

    assert res.status_code == 302
    assert _path(res) == "/signup"
    assert _query(res) == {"kakao": ["1"], "next": ["/workspaces/1"]}
    assert mdb.scalars(select(User)).all() == []
    assert _cookie(res, "session_token") is None


def test_pending_cookie_attributes(mdb, client, kakao):
    res = _login(client, VERIFIED, kakao)

    cookie = _cookie(res, kakao_oauth.PENDING_COOKIE)
    for attribute in ("HttpOnly", "Secure", "SameSite=lax", "Max-Age=1800", "Path=/api/v1/auth"):
        assert attribute in cookie


def test_pending_identity_is_never_in_a_url(mdb, client, kakao):
    res = _login(client, KakaoIdentity("7777777", EMAIL, True, "동우닉네임"), kakao)

    location = res.headers["location"]
    token = kakao_oauth.seal_pending(KakaoIdentity("7777777", EMAIL, True, "동우닉네임"))
    assert "7777777" not in location
    assert "kim" not in location
    assert "%EB%8F%99" not in location
    assert token not in location


def test_pending_shows_the_verified_email_and_nickname(mdb, client, kakao):
    _login(client, VERIFIED, kakao)

    res = client.get(PENDING)

    assert res.status_code == 200
    assert res.json()["data"] == {"email": EMAIL, "nickname": "동우"}


def test_pending_hides_an_unverified_email(mdb, client, kakao):
    _login(client, UNVERIFIED, kakao)

    assert client.get(PENDING).json()["data"] == {"email": None, "nickname": "동우"}


def test_pending_with_no_details(mdb, client, kakao):
    _login(client, NO_EMAIL, kakao)

    assert client.get(PENDING).json()["data"] == {"email": None, "nickname": None}


def test_pending_without_a_cookie_is_expired(mdb, client):
    res = client.get(PENDING)

    assert res.status_code == 400
    assert res.json()["error"]["code"] == "KAKAO_LINK_EXPIRED"


def _signup_body(**body):
    return {"name": "새사람", "password": PW, "link_kakao": True, **body}


def _proof(email):
    return oauth_state.seal(signup_codes.PROOF_KIND, 60, {"m": email})


@pytest.mark.parametrize("identity,token", [(VERIFIED, None), (NO_EMAIL, EMAIL)], ids=["kakao_email", "code_email"])
def test_one_account_works_with_both_logins(mdb, kakao, identity, token):
    first = TestClient(app, base_url="https://testserver", follow_redirects=False)
    _login(first, identity, kakao)
    body = _signup_body(verification_token=_proof(token)) if token else _signup_body()
    signed_up = first.post("/api/v1/auth/signup", json=body)
    assert signed_up.status_code == 201, signed_up.text
    user_id = signed_up.json()["data"]["user"]["user_id"]

    by_password = TestClient(app, base_url="https://testserver").post(
        "/api/v1/auth/login", json={"email": EMAIL, "password": PW}
    )
    assert by_password.status_code == 200
    assert by_password.json()["data"]["user"]["user_id"] == user_id

    second = TestClient(app, base_url="https://testserver", follow_redirects=False)
    res = _login(second, identity, kakao)
    assert _query(res)["oauth_result"] == ["success"]
    assert second.get("/api/v1/auth/me").json()["data"]["user"]["user_id"] == user_id
    assert len(mdb.scalars(select(User)).all()) == 1


def test_linked_existing_account_keeps_its_password_login(mdb, client, kakao):
    user = _user(mdb)
    _login(client, VERIFIED, kakao)

    res = TestClient(app, base_url="https://testserver").post(
        "/api/v1/auth/login", json={"email": EMAIL, "password": PW}
    )

    assert res.json()["data"]["user"]["user_id"] == user.user_id


def test_kakao_login_reads_the_user_row_with_a_share_lock():
    """재설정 confirm 과 겹친 로그인 세션이 남지 않게 한다. sqlite 는 행 잠금이 없어 SQL 로 본다."""
    sql = str(auth._kakao_session_user_stmt("77").compile(dialect=postgresql.dialect()))

    assert "FOR SHARE" in sql


def test_kakao_bound_elsewhere_in_the_gap_logs_into_that_account(mdb, client, kakao, monkeypatch):
    """unique 위반을 다시 조회로 푼다. PostgreSQL 은 되돌리지 않으면 다시 읽지 못한다."""
    _user(mdb)
    state = _state(client)
    make = sessionmaker(bind=mdb.get_bind(), autoflush=False)
    real = auth._login_user_stmt

    def bound_first(email):
        with make() as other:
            other.add(User(email="b@example.com", name="b", provider="kakao", provider_id="77"))
            other.commit()
        return real(email)

    monkeypatch.setattr(auth, "_login_user_stmt", bound_first)

    res = _callback(client, code="c", state=state)

    assert _query(res)["oauth_result"] == ["success"]
    assert client.get("/api/v1/auth/me").json()["data"]["user"]["email"] == "b@example.com"
    assert _row(mdb).provider_id is None


def test_account_claimed_in_the_gap_is_not_overwritten(mdb, client, kakao, monkeypatch):
    user_id = _user(mdb).user_id
    state = _state(client)
    real = auth._link_kakao

    def claimed_first(db, owner, provider_id):
        with sessionmaker(bind=mdb.get_bind(), autoflush=False)() as other:
            other.get(User, user_id).provider_id = "other"
            other.commit()
        return real(db, owner, provider_id)

    monkeypatch.setattr(auth, "_link_kakao", claimed_first)

    res = _callback(client, code="c", state=state)

    assert _query(res)["oauth_reason"] == ["email_exists"]
    assert _row(mdb).provider_id == "other"
    assert _session_count(mdb) == 0


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없습니다.")
@pytest.mark.parametrize("mdb", ["postgresql"], indirect=True)
def test_parallel_callbacks_link_once_and_both_log_in(mdb, kakao):
    _user(mdb)
    make = sessionmaker(bind=mdb.get_bind(), autoflush=False)

    def per_request():
        with make() as db:
            yield db

    app.dependency_overrides[get_db] = per_request
    clients = [TestClient(app, base_url="https://testserver", follow_redirects=False) for _ in range(4)]
    states = [_state(c) for c in clients]
    start = threading.Barrier(len(clients))
    results = [None] * len(clients)

    def run(i):
        start.wait()
        results[i] = _callback(clients[i], code="c", state=states[i])

    threads = [threading.Thread(target=run, args=(i,)) for i in range(len(clients))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    mdb.rollback()
    assert [_query(r)["oauth_result"] for r in results] == [["success"]] * len(clients)
    assert _row(mdb).provider_id == "77"


def test_callback_never_logs_the_code_or_state(mdb, client, kakao, caplog):
    kakao.identity = KakaoOAuthError("토큰 교환 거절: HTTP 400")
    state = _state(client)

    with caplog.at_level(logging.DEBUG, logger="app"):
        _callback(client, code="secret-kakao-code", state=state)

    assert "카카오 로그인 callback 실패" in caplog.text
    assert "secret-kakao-code" not in caplog.text
    assert state not in caplog.text


def _clears_pending(res):
    return any(
        header.startswith(f"{kakao_oauth.PENDING_COOKIE}=") and "Max-Age=0" in header
        for header in res.headers.get_list("set-cookie")
    )


def test_login_clears_a_pending_kakao_left_in_the_browser(mdb, client, kakao):
    _user(mdb)
    mdb.execute(User.__table__.update().values(provider="kakao", provider_id="77"))
    mdb.commit()

    assert _clears_pending(_login(client, VERIFIED, kakao))


def test_email_exists_clears_a_pending_kakao_left_in_the_browser(mdb, client, kakao):
    _user(mdb)
    mdb.execute(User.__table__.update().values(provider="kakao", provider_id="other"))
    mdb.commit()

    res = _login(client, VERIFIED, kakao)

    assert _query(res)["oauth_reason"] == ["email_exists"]
    assert _clears_pending(res)


@pytest.fixture
def notices(monkeypatch):
    box = []
    monkeypatch.setenv("APP_BASE_URL", "https://app.example.com/")
    monkeypatch.setattr(auth.mailer, "is_configured", lambda: True)
    monkeypatch.setattr(
        auth.mailer, "send_in_background", lambda to, subject, text, *, log_label: box.append((to, subject, text))
    )
    return box


def test_new_link_tells_the_account_mailbox_how_to_recover(mdb, client, kakao, notices):
    _user(mdb)

    res = _login(client, VERIFIED, kakao)

    assert _query(res)["oauth_result"] == ["success"]
    [(to, subject, text)] = notices
    assert to == EMAIL
    assert subject == "[Manager's Manager] 카카오 계정이 연결되었습니다"
    assert "https://app.example.com/forgot-password" in text


def test_returning_kakao_login_sends_no_link_notice(mdb, client, kakao, notices):
    _user(mdb)
    mdb.execute(User.__table__.update().values(provider="kakao", provider_id="77"))
    mdb.commit()

    _login(client, VERIFIED, kakao)

    assert notices == []


def test_refused_link_sends_no_link_notice(mdb, client, kakao, notices):
    _user(mdb)
    mdb.execute(User.__table__.update().values(provider="kakao", provider_id="other"))
    mdb.commit()

    _login(client, VERIFIED, kakao)

    assert notices == []


def test_link_still_logs_in_when_mail_is_not_configured(mdb, client, kakao, monkeypatch):
    _user(mdb)
    monkeypatch.setattr(auth.mailer, "is_configured", lambda: False)

    res = _login(client, VERIFIED, kakao)

    assert _query(res)["oauth_result"] == ["success"]
    assert _row(mdb).provider_id == "77"
