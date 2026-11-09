"""아이디 중복 확인(GET /auth/username-availability)과 변경(PATCH /users/me) (#610)."""
import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.core.database import get_db
from app.main import app
from app.models import User
from tests.api.conftest import TEST_DATABASE_URL, signup_verified
from tests.usernames import username_for

P = "/api/v1"
CHECK = f"{P}/auth/username-availability"
ME = f"{P}/users/me"


@pytest.fixture(autouse=True)
def _secret(signup_secret):
    pass


def _client():
    return TestClient(app, base_url="https://testserver")


def _signed_up(email):
    client = _client()
    assert signup_verified(client, email).status_code == 201
    return client


def _check(client, username):
    res = client.get(CHECK, params={"username": username})
    assert res.status_code == 200, res.text
    return res.json()["data"]


def _error(res):
    return res.status_code, res.json()["error"]["code"]


def test_free_username_is_available_without_logging_in(mdb):
    assert _check(_client(), "dongwoo") == {"available": True, "reason": None}


@pytest.mark.parametrize("asked", ["dongwoo", "DongWoo", " DONGWOO "])
def test_registered_username_is_taken_in_any_case(mdb, asked):
    _signed_up("a@example.com")
    mdb.execute(User.__table__.update().values(username="dongwoo"))
    mdb.commit()

    assert _check(_client(), asked) == {"available": False, "reason": "taken"}


@pytest.mark.parametrize("asked", ["abc", "a" * 21, "dong_woo", "동우동우", ""])
def test_username_outside_the_rule_is_invalid_not_an_error(mdb, asked):
    assert _check(_client(), asked) == {"available": False, "reason": "invalid"}


def test_my_own_username_reads_as_taken(mdb):
    client = _signed_up("a@example.com")

    assert _check(client, username_for("a@example.com")) == {"available": False, "reason": "taken"}


def test_changed_username_shows_on_me_and_frees_the_old_one(mdb):
    client = _signed_up("a@example.com")
    old = username_for("a@example.com")

    res = client.patch(ME, json={"username": "  NewName1 "})

    assert res.status_code == 200, res.text
    assert res.json()["data"]["username"] == "newname1"
    assert res.json()["data"]["email"] == "a@example.com"
    assert client.get(f"{P}/auth/me").json()["data"]["user"]["username"] == "newname1"
    assert _check(_client(), old) == {"available": True, "reason": None}
    assert _check(_client(), "NEWNAME1") == {"available": False, "reason": "taken"}


@pytest.mark.parametrize("asked", ["othername", "OtherName"])
def test_someone_elses_username_is_409_and_nothing_changes(mdb, asked):
    _signed_up("b@example.com").patch(ME, json={"username": "othername"})
    client = _signed_up("a@example.com")

    assert _error(client.patch(ME, json={"username": asked})) == (409, "USERNAME_TAKEN")
    assert client.get(f"{P}/auth/me").json()["data"]["user"]["username"] == username_for("a@example.com")


def test_setting_my_current_username_again_is_ok(mdb):
    client = _signed_up("a@example.com")
    mine = username_for("a@example.com")

    res = client.patch(ME, json={"username": mine.upper()})

    assert res.status_code == 200, res.text
    assert res.json()["data"]["username"] == mine


@pytest.mark.parametrize("asked", ["abc", "a" * 21, "dong woo", None])
def test_username_outside_the_rule_is_refused(mdb, asked):
    client = _signed_up("a@example.com")

    assert _error(client.patch(ME, json={"username": asked})) == (400, "INVALID_REQUEST")
    assert client.get(f"{P}/auth/me").json()["data"]["user"]["username"] == username_for("a@example.com")


def test_change_needs_a_login(mdb):
    assert _error(_client().patch(ME, json={"username": "dongwoo"})) == (401, "UNAUTHENTICATED")


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없습니다.")
@pytest.mark.parametrize("mdb", ["postgresql"], indirect=True)
def test_two_accounts_racing_for_one_username_leave_one_owner(mdb):
    clients = [_signed_up("a@example.com"), _signed_up("b@example.com")]
    make = sessionmaker(bind=mdb.get_bind(), autoflush=False)

    def per_request():
        with make() as db:
            yield db

    app.dependency_overrides[get_db] = per_request
    start = threading.Barrier(len(clients))
    results = [None] * len(clients)

    def run(i):
        start.wait()
        results[i] = clients[i].patch(ME, json={"username": "dongwoo"})

    threads = [threading.Thread(target=run, args=(i,)) for i in range(len(clients))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    mdb.rollback()

    assert sorted(r.status_code for r in results) == [200, 409]
    assert {r.json()["error"]["code"] for r in results if r.status_code == 409} == {"USERNAME_TAKEN"}
    assert mdb.scalars(select(User.username).where(User.username == "dongwoo")).all() == ["dongwoo"]
