"""인증된 상태로만 가입한다(#427). 본문의 이메일은 읽지 않고, 카카오 연결은 link_kakao 로만 한다."""
import re
import threading
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.api import auth
from app.core.database import get_db
from app.main import app
from app.models import Session as SessionModel, User
from app.services import kakao_oauth, mailer, oauth_state, signup_codes
from app.services.kakao_oauth import KakaoIdentity
from app.services.passwords import verify_password
from tests.api.conftest import TEST_DATABASE_URL
from tests.usernames import username_for

EMAIL = "new@example.com"
PW = "pw-123456"
SIGNUP = "/api/v1/auth/signup"


class _InlineExecutor:
    def submit(self, fn, *args, **kwargs):
        return fn(*args, **kwargs)


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("OAUTH_STATE_SECRET", "k" * 40)


@pytest.fixture
def client():
    return TestClient(app, base_url="https://testserver")


def _proof(email=EMAIL, ttl=60):
    return oauth_state.seal(signup_codes.PROOF_KIND, ttl, {"m": email})


def _set_pending(client, identity):
    client.cookies.set(kakao_oauth.PENDING_COOKIE, kakao_oauth.seal_pending(identity))


def _signup(client, **body):
    return client.post(SIGNUP, json={"name": "새사람", "password": PW, "username": "newperson", **body})


def _users(db):
    db.expire_all()
    return db.scalars(select(User)).all()


def _error(res):
    return res.status_code, res.json()["error"]["code"]


VERIFIED = KakaoIdentity("77", "kim@example.com", True, "동우")
UNVERIFIED = KakaoIdentity("77", "kim@example.com", False, "동우")
NO_EMAIL = KakaoIdentity("77", None, False, "동우")


def test_full_flow_from_code_to_account(mdb, client, monkeypatch):
    box = []
    monkeypatch.setattr(mailer, "_executor", _InlineExecutor())
    monkeypatch.setattr(mailer, "send_mail", lambda to, subject, text, html=None: box.append(text))
    for key in ("SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "APP_BASE_URL"):
        monkeypatch.setenv(key, "x")

    client.post(f"{SIGNUP}/code", json={"email": EMAIL})
    code = re.search(r"^(\d{6})$", box[0], re.M).group(1)
    token = client.post(f"{SIGNUP}/code/confirm", json={"email": EMAIL, "code": code}).json()["data"]
    res = _signup(client, verification_token=token["verification_token"])

    assert res.status_code == 201, res.text
    assert res.json()["data"]["user"]["email"] == EMAIL
    assert client.get("/api/v1/auth/me").status_code == 200
    [user] = _users(mdb)
    assert (user.provider, user.provider_id) == ("local", None)
    assert verify_password(PW, user.password_hash)


def test_signup_without_a_code_is_refused(mdb, client):
    res = client.post(SIGNUP, json={"email": EMAIL, "name": "x", "password": PW, "username": "newperson"})

    assert _error(res) == (400, "SIGNUP_VERIFICATION_INVALID")
    assert _users(mdb) == []


def test_email_in_the_body_is_never_read(mdb, client):
    """이 이메일을 그대로 믿던 것이 팀원 초대를 가로채는 구멍이었다."""
    res = _signup(client, verification_token=_proof("attacker@example.com"), email="victim@example.com")

    assert res.status_code == 201, res.text
    assert [u.email for u in _users(mdb)] == ["attacker@example.com"]


@pytest.mark.parametrize(
    "make",
    [
        lambda: "garbage",
        lambda: "",
        lambda: oauth_state.seal(signup_codes.PROOF_KIND, -1, {"m": EMAIL}),
        lambda: oauth_state.seal("kakao_login", 60, {"m": EMAIL, "p": "/", "n": "x"}),
        lambda: kakao_oauth.seal_pending(VERIFIED),
    ],
    ids=["garbage", "empty", "expired", "login_state", "pending_token"],
)
def test_unusable_token_is_refused(mdb, client, make):
    assert _error(_signup(client, verification_token=make())) == (400, "SIGNUP_VERIFICATION_INVALID")
    assert _users(mdb) == []


def test_registered_email_is_409_even_in_another_case(mdb, client):
    mdb.add(User(username=username_for("New@example.com"), email="New@example.com", name="old", provider="local"))
    mdb.commit()

    assert _error(_signup(client, verification_token=_proof())) == (409, "EMAIL_ALREADY_EXISTS")


def test_token_replay_is_409(mdb, client):
    proof = _proof()
    assert _signup(client, verification_token=proof).status_code == 201

    assert _error(_signup(TestClient(app, base_url="https://testserver"), verification_token=proof)) == (
        409,
        "EMAIL_ALREADY_EXISTS",
    )


def _kakao_signup(client, **body):
    return client.post(SIGNUP, json={"name": "새사람", "username": "newperson", "link_kakao": True, **body})


def test_link_without_a_cookie_is_refused_rather_than_creating_an_unlinked_account(mdb, client):
    assert _error(_kakao_signup(client)) == (400, "KAKAO_LINK_EXPIRED")
    assert _users(mdb) == []


def test_link_with_an_expired_cookie_is_refused(mdb, client):
    client.cookies.set(kakao_oauth.PENDING_COOKIE, kakao_oauth.seal_pending(NO_EMAIL, now=time.time() - 1800))

    assert _error(_kakao_signup(client)) == (400, "KAKAO_LINK_EXPIRED")


def test_link_with_a_proof_in_the_cookie_slot_is_refused(mdb, client):
    client.cookies.set(kakao_oauth.PENDING_COOKIE, _proof())

    assert _error(_kakao_signup(client)) == (400, "KAKAO_LINK_EXPIRED")


@pytest.mark.parametrize("identity", [VERIFIED, UNVERIFIED, NO_EMAIL], ids=["verified", "unverified", "no_email"])
def test_kakao_signup_needs_only_username_and_name_and_stores_no_email_or_password(mdb, client, identity):
    _set_pending(client, identity)

    res = _kakao_signup(client)

    assert res.status_code == 201, res.text
    assert res.json()["data"]["user"]["email"] is None
    assert res.json()["data"]["user"]["username"] == "newperson"
    [user] = _users(mdb)
    assert (user.email, user.password_hash) == (None, None)
    assert (user.username, user.name, user.provider, user.provider_id) == ("newperson", "새사람", "kakao", "77")
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["data"]["user"]["email"] is None


@pytest.mark.parametrize("fields", [("password",), ("verification_token",), ("password", "verification_token")])
def test_kakao_signup_refuses_a_password_or_email_proof(mdb, client, fields):
    """프론트에 남은 옛 필드를 조용히 버리지 않고 바로 드러낸다."""
    _set_pending(client, VERIFIED)
    extra = {"password": PW, "verification_token": _proof()}

    assert _error(_kakao_signup(client, **{f: extra[f] for f in fields})) == (400, "INVALID_REQUEST")
    assert _users(mdb) == []


def test_email_signup_still_needs_a_password(mdb, client):
    res = client.post(SIGNUP, json={"verification_token": _proof(), "name": "새사람", "username": "newperson"})

    assert _error(res) == (400, "INVALID_REQUEST")
    assert _users(mdb) == []


def test_link_false_never_binds_even_with_a_cookie(mdb, client):
    """다른 사람이 같은 브라우저로 가입해도 앞 사람의 카카오가 그 계정에 묶이면 안 된다."""
    _set_pending(client, VERIFIED)

    res = _signup(client, verification_token=_proof())

    assert res.status_code == 201, res.text
    [user] = _users(mdb)
    assert (user.email, user.provider, user.provider_id) == (EMAIL, "local", None)


def test_link_false_does_not_borrow_the_cookie_email(mdb, client):
    _set_pending(client, VERIFIED)

    assert _error(_signup(client)) == (400, "SIGNUP_VERIFICATION_INVALID")
    assert _users(mdb) == []


@pytest.mark.parametrize("link", [True, False])
def test_success_clears_the_pending_cookie_on_its_own_path(mdb, client, link):
    _set_pending(client, NO_EMAIL)

    res = _kakao_signup(client) if link else _signup(client, verification_token=_proof())

    assert res.status_code == 201, res.text
    cookies = res.headers.get_list("set-cookie")
    [cleared] = [c for c in cookies if c.startswith(f"{kakao_oauth.PENDING_COOKIE}=")]
    assert "Max-Age=0" in cleared
    assert "Path=/api/v1/auth" in cleared
    assert "Secure" in cleared
    assert any(c.startswith("session_token=") for c in cookies)


def test_kakao_email_of_an_existing_account_makes_a_separate_account(mdb, client):
    """카카오 이메일이 기존 계정과 같아도 병합하지 않는다. 새 계정은 이메일을 갖지 않는다."""
    mdb.add(User(username="olduser", email="kim@example.com", name="old", provider="local"))
    mdb.commit()
    _set_pending(client, VERIFIED)

    res = _kakao_signup(client)

    assert res.status_code == 201, res.text
    old, new = sorted(_users(mdb), key=lambda u: u.username != "olduser")
    assert (old.email, old.provider, old.provider_id) == ("kim@example.com", "local", None)
    assert (new.email, new.provider, new.provider_id) == (None, "kakao", "77")


def test_kakao_id_bound_to_another_account_is_409(mdb, client):
    mdb.add(User(username="first", email="first@example.com", name="old", provider="kakao", provider_id="77"))
    mdb.commit()
    _set_pending(client, NO_EMAIL)

    assert _error(_kakao_signup(client)) == (409, "KAKAO_ALREADY_LINKED")


def test_kakao_id_lost_at_the_db_is_kakao_already_linked(mdb, client, monkeypatch):
    """사전 검사와 재검사가 모두 놓친 카카오 충돌. 카카오 가입은 이메일을 넣지 않으니 이메일 중복이 아니다."""
    mdb.add(User(username="first", email="first@example.com", name="old", provider="kakao", provider_id="77"))
    mdb.commit()
    _set_pending(client, NO_EMAIL)
    monkeypatch.setattr(auth, "_signup_conflict", lambda db, user: None)

    assert _error(_kakao_signup(client)) == (409, "KAKAO_ALREADY_LINKED")


def test_kakao_signup_with_a_taken_username_is_409(mdb, client):
    mdb.add(User(username="NewPerson", email="first@example.com", name="old", provider="local"))
    mdb.commit()
    _set_pending(client, NO_EMAIL)

    assert _error(_kakao_signup(client)) == (409, "USERNAME_TAKEN")


def test_failed_signup_keeps_the_pending_cookie_and_makes_no_session(mdb, client):
    mdb.add(User(username="newperson", email="first@example.com", name="old", provider="local"))
    mdb.commit()
    _set_pending(client, NO_EMAIL)

    res = _kakao_signup(client)

    assert res.status_code == 409
    assert res.headers.get_list("set-cookie") == []
    assert mdb.scalar(select(SessionModel.session_id)) is None


pg_only = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없습니다.")


def _race(mdb, bodies, cookie=None):
    """요청마다 세션을 새로 열어 둘을 겹친다. 비밀번호 해시가 느려 둘 다 사전 조회를 지나 insert 에서 부딪힌다."""
    make = sessionmaker(bind=mdb.get_bind(), autoflush=False)

    def per_request():
        with make() as db:
            yield db

    app.dependency_overrides[get_db] = per_request
    start = threading.Barrier(len(bodies))
    results = [None] * len(bodies)

    def run(i, body):
        client = TestClient(app, base_url="https://testserver")
        if cookie:
            client.cookies.set(kakao_oauth.PENDING_COOKIE, cookie)
        start.wait()
        results[i] = client.post(SIGNUP, json={"name": "새사람", "username": f"racer{i}", **body})

    threads = [threading.Thread(target=run, args=(i, b)) for i, b in enumerate(bodies)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    mdb.rollback()
    return sorted(r.status_code for r in results), results


@pg_only
@pytest.mark.parametrize("mdb", ["postgresql"], indirect=True)
def test_double_submit_makes_one_account(mdb):
    proof = _proof()

    codes, results = _race(mdb, [{"verification_token": proof, "password": PW}] * 2)

    assert codes == [201, 409]
    assert {r.json()["error"]["code"] for r in results if r.status_code == 409} == {"EMAIL_ALREADY_EXISTS"}
    assert len(_users(mdb)) == 1


@pg_only
@pytest.mark.parametrize("mdb", ["postgresql"], indirect=True)
def test_one_kakao_cannot_bind_two_new_accounts(mdb):
    bodies = [{"link_kakao": True}] * 2

    codes, results = _race(mdb, bodies, kakao_oauth.seal_pending(NO_EMAIL))

    assert codes == [201, 409]
    assert {r.json()["error"]["code"] for r in results if r.status_code == 409} == {"KAKAO_ALREADY_LINKED"}
    assert len(_users(mdb)) == 1
