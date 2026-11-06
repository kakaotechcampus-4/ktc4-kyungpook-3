"""가입·로그인 이메일의 대소문자·공백 정규화와 동시 가입 충돌(#434)."""
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Query

from app.main import app
from app.models import User
from app.schemas.invitation import InvitationCreateRequest

PW = "password123"


def _client():
    return TestClient(app, base_url="https://testserver")


def _signup(c, email):
    return c.post("/api/v1/auth/signup", json={"email": email, "password": PW, "name": "v"})


def _users(db):
    return db.scalars(select(User)).all()


def test_signup_stores_lowercase_email(mdb):
    res = _signup(_client(), " Victim@Gmail.com")

    assert res.status_code == 201
    assert res.json()["data"]["user"]["email"] == "victim@gmail.com"
    assert [u.email for u in _users(mdb)] == ["victim@gmail.com"]


def test_signup_with_case_variant_is_409(mdb):
    assert _signup(_client(), "victim@gmail.com").status_code == 201

    res = _signup(_client(), "VICTIM@gmail.com")

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "EMAIL_ALREADY_EXISTS"
    assert len(_users(mdb)) == 1


def test_login_ignores_case(mdb):
    assert _signup(_client(), "victim@gmail.com").status_code == 201

    res = _client().post("/api/v1/auth/login", json={"email": "Victim@Gmail.COM", "password": PW})

    assert res.status_code == 200


def test_signup_race_lost_at_the_db_is_409_not_500(mdb, monkeypatch):
    # 사전 조회가 기존 행을 못 본 것처럼 만들어, 커밋 때 DB 유일 제약에서 지게 한다.
    assert _signup(_client(), "victim@gmail.com").status_code == 201
    monkeypatch.setattr(Query, "first", lambda self: None)

    res = _signup(_client(), "victim@gmail.com")

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "EMAIL_ALREADY_EXISTS"
    assert len(_users(mdb)) == 1


def test_invitation_schema_still_normalizes():
    assert InvitationCreateRequest(member_id="m", email=" A@B.com ").email == "a@b.com"
