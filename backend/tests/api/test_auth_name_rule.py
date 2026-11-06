"""회원가입 이름 규칙(#435): 앞뒤 공백을 지우고 1~100자, 제어문자·줄 구분자 금지, 보이는 글자 필수."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import Member, User
from app.services.passwords import hash_password

PASSWORD = "pw-123456"


def _client():
    return TestClient(app, base_url="https://testserver")


def _signup(client, name, email="name@example.com"):
    return client.post("/api/v1/auth/signup", json={"email": email, "password": PASSWORD, "name": name})


def _assert_name_rejected(res):
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "INVALID_REQUEST"
    assert any("name" in f["loc"] for f in body["error"]["details"]["fields"])


@pytest.mark.parametrize(
    "name",
    [
        "",
        "   ",
        "　",
        "​",
        "﻿",
        "​‍",
        "​ ​",
        "​　​",
        "가" * 101,
        " " + "가" * 101,
        "홍\x00길동",
        "홍\n길동",
        "홍\t길동",
        "홍 길동",
        "홍 길동",
    ],
    ids=[
        "empty", "spaces", "ideographic-space", "zwsp", "bom", "zwsp-zwj", "zwsp-space-zwsp",
        "zwsp-ideographic-zwsp", "101-chars", "space-101-chars", "nul", "newline", "tab",
        "line-separator", "paragraph-separator",
    ],
)
def test_signup_rejects_invalid_name(mdb, name):
    res = _signup(_client(), name)
    _assert_name_rejected(res)
    assert "set-cookie" not in res.headers
    assert mdb.query(User).count() == 0


@pytest.mark.parametrize(
    "name", ["  홍길동  ", "　홍길동　", "홍길동\n"], ids=["spaces", "ideographic", "newline"]
)
def test_signup_strips_surrounding_whitespace(mdb, name):
    res = _signup(_client(), name)
    assert res.status_code == 201
    assert res.json()["data"]["user"]["name"] == "홍길동"
    assert mdb.query(User).one().name == "홍길동"


def test_signup_accepts_100_chars_after_strip(mdb):
    res = _signup(_client(), "  " + "가" * 100 + "  ")
    assert res.status_code == 201
    assert len(mdb.query(User).one().name) == 100


def test_pm_display_name_uses_stripped_name(mdb):
    client = _client()
    assert _signup(client, "  홍길동  ").status_code == 201
    res = client.post("/api/v1/workspaces", json={"name": "팀"})
    assert res.status_code == 201
    assert mdb.query(Member).one().display_name == "홍길동"


@pytest.mark.parametrize(
    "name",
    ["가" * 100, "홍 길동", "홍  길동", "홍　길동", "\U0001f469‍\U0001f4bb", "​ 홍"],
    ids=["100-chars", "inner-space", "inner-double-space", "inner-ideographic", "zwj-emoji", "zwsp-space-letter"],
)
def test_signup_keeps_valid_name_as_is(mdb, name):
    res = _signup(_client(), name)
    assert res.status_code == 201
    assert res.json()["data"]["user"]["name"] == name
    assert mdb.query(User).one().name == name


def test_signup_rejects_missing_name(mdb):
    res = _client().post("/api/v1/auth/signup", json={"email": "a@example.com", "password": PASSWORD})
    _assert_name_rejected(res)


def test_signup_rejects_null_name(mdb):
    _assert_name_rejected(_signup(_client(), None))


def test_signup_blank_name_with_existing_email_returns_400(mdb):
    client = _client()
    assert _signup(client, "홍길동", "dup@example.com").status_code == 201
    _assert_name_rejected(_signup(client, "   ", "dup@example.com"))


def test_signup_rejects_lone_surrogate(mdb):
    raw = '{"email":"a@example.com","password":"pw-123456","name":"홍\\ud800"}'
    res = _client().post(
        "/api/v1/auth/signup", content=raw.encode("utf-8"), headers={"Content-Type": "application/json"}
    )
    _assert_name_rejected(res)
    assert mdb.query(User).count() == 0


def test_existing_account_with_empty_name_still_works(mdb):
    mdb.add(User(email="legacy@example.com", name="", password_hash=hash_password(PASSWORD)))
    mdb.commit()
    client = _client()
    login = client.post("/api/v1/auth/login", json={"email": "legacy@example.com", "password": PASSWORD})
    assert login.status_code == 200
    assert login.json()["data"]["user"]["name"] == ""
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["data"]["user"]["name"] == ""


@pytest.mark.parametrize(
    "name",
    ["\u0301", "\ufe0f", "\u20dd", "\u200b\u0301", "\u0301 \ufe0f"],
    ids=["combining-acute", "variation-selector", "enclosing-circle", "zwsp-combining", "marks-and-space"],
)
def test_signup_rejects_name_with_only_invisible_marks(mdb, name):
    """결합 부호(Mn)·둘러싸는 부호(Me)만 있으면 이름이 빈칸처럼 보인다(PR #445 리뷰)."""
    res = _signup(_client(), name)
    _assert_name_rejected(res)
    assert mdb.query(User).count() == 0


@pytest.mark.parametrize("name", ["e\u0301", "홍길동\ufe0f", "\u0301홍"], ids=["accent-on-letter", "trailing-selector", "leading-mark"])
def test_signup_keeps_marks_next_to_visible_letters(mdb, name):
    res = _signup(_client(), name)
    assert res.status_code == 201
    assert mdb.query(User).one().name == name
