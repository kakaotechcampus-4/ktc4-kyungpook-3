"""가입 아이디(#610): 영문·숫자 4~20자, 대소문자를 가리지 않고 유일, 소문자로 저장한다."""
import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.api import auth
from app.core.database import get_db
from app.main import app
from app.models import User
from app.services import oauth_state, signup_codes
from tests.api.conftest import TEST_DATABASE_URL

SIGNUP = "/api/v1/auth/signup"
PW = "pw-123456"


@pytest.fixture(autouse=True)
def _secret(signup_secret):
    pass


def _client():
    return TestClient(app, base_url="https://testserver")


def _body(email, username):
    proof = oauth_state.seal(signup_codes.PROOF_KIND, 60, {"m": email})
    return {"verification_token": proof, "password": PW, "name": "새사람", "username": username}


def _signup(client, email, username):
    return client.post(SIGNUP, json=_body(email, username))


def _error(res):
    return res.status_code, res.json()["error"]["code"]


def test_signup_stores_the_username_in_lowercase_and_me_shows_it(mdb):
    client = _client()

    res = _signup(client, "a@example.com", "  DongWoo01 ")

    assert res.status_code == 201, res.text
    assert res.json()["data"]["user"]["username"] == "dongwoo01"
    assert client.get("/api/v1/auth/me").json()["data"]["user"]["username"] == "dongwoo01"
    assert mdb.scalars(select(User.username)).all() == ["dongwoo01"]


@pytest.mark.parametrize("second", ["dongwoo", "DongWoo", "DONGWOO"])
def test_taken_username_is_409_even_in_another_case(mdb, second):
    assert _signup(_client(), "a@example.com", "dongwoo").status_code == 201

    assert _error(_signup(_client(), "b@example.com", second)) == (409, "USERNAME_TAKEN")
    assert len(mdb.scalars(select(User)).all()) == 1


def test_registered_email_is_reported_before_a_taken_username(mdb):
    assert _signup(_client(), "a@example.com", "dongwoo").status_code == 201

    assert _error(_signup(_client(), "a@example.com", "dongwoo")) == (409, "EMAIL_ALREADY_EXISTS")


@pytest.mark.parametrize(
    "username",
    ["abc", "a" * 21, "dong woo", "dong_woo", "dong-woo", "동우동우", "dongwoo!", "", "\u212aelvin", "dong\nwoo"],
    ids=["3-chars", "21-chars", "space", "underscore", "dash", "hangul", "symbol", "empty", "kelvin-sign", "newline"],
)
def test_username_outside_the_rule_is_rejected(mdb, username):
    res = _signup(_client(), "a@example.com", username)

    assert _error(res) == (400, "INVALID_REQUEST")
    assert any("username" in f["loc"] for f in res.json()["error"]["details"]["fields"])
    assert mdb.scalars(select(User)).all() == []


def test_signup_without_a_username_is_rejected(mdb):
    body = _body("a@example.com", "x")
    del body["username"]

    assert _error(_client().post(SIGNUP, json=body)) == (400, "INVALID_REQUEST")


@pytest.mark.parametrize("username", ["abcd", "a" * 20, "1234", "Ab12"])
def test_username_at_the_rule_edges_is_accepted(mdb, username):
    assert _signup(_client(), "a@example.com", username).status_code == 201


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없습니다.")
@pytest.mark.parametrize("mdb", ["postgresql"], indirect=True)
def test_two_signups_racing_for_one_username_make_one_account(mdb, monkeypatch):
    """이메일이 달라 잠금이 갈린다. 두 요청이 사전 조회를 모두 지난 뒤에 넣게 맞춰 unique 인덱스에서 부딪히게 한다."""
    real, both_checked, seen = auth._signup_conflict, threading.Barrier(2), threading.local()

    def check_then_wait(db, user):
        result = real(db, user)
        if not getattr(seen, "first", False):
            seen.first = True
            both_checked.wait(timeout=10)
        return result

    monkeypatch.setattr(auth, "_signup_conflict", check_then_wait)
    make = sessionmaker(bind=mdb.get_bind(), autoflush=False)

    def per_request():
        with make() as db:
            yield db

    app.dependency_overrides[get_db] = per_request
    bodies = [_body("a@example.com", "dongwoo"), _body("b@example.com", "DongWoo")]
    start = threading.Barrier(len(bodies))
    results = [None] * len(bodies)

    def run(i):
        client = _client()
        start.wait()
        results[i] = client.post(SIGNUP, json=bodies[i])

    threads = [threading.Thread(target=run, args=(i,)) for i in range(len(bodies))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    mdb.rollback()

    assert sorted(r.status_code for r in results) == [201, 409]
    assert {r.json()["error"]["code"] for r in results if r.status_code == 409} == {"USERNAME_TAKEN"}
    assert len(mdb.scalars(select(User)).all()) == 1
