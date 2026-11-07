"""세션 쿠키 원문은 DB 에 남지 않고 해시로만 찾는다(#437)."""
import hashlib
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import Session as SessionModel, User
from app.services import password_reset
from app.services.passwords import hash_password
from app.services.sessions import hash_session_token

PW = "password123"


def _client():
    return TestClient(app, base_url="https://testserver")


def _signup(c, email="s@example.com"):
    res = c.post("/api/v1/auth/signup", json={"email": email, "password": PW, "name": "세션"})
    assert res.status_code == 201
    return res.cookies["session_token"]


def _login(email="s@example.com"):
    c = _client()
    res = c.post("/api/v1/auth/login", json={"email": email, "password": PW})
    assert res.status_code == 200
    return res.cookies["session_token"]


def _me(cookie):
    c = _client()
    c.cookies.set("session_token", cookie)
    return c.get("/api/v1/auth/me")


def test_login_cookie_is_stored_as_hash(mdb):
    cookie = _signup(_client())

    assert _me(cookie).status_code == 200
    row = mdb.scalars(select(SessionModel)).one()
    assert row.session_token == hashlib.sha256(cookie.encode()).hexdigest()
    assert row.session_token != cookie
    assert "token_hash" not in SessionModel.__table__.columns
    assert {i.name for i in SessionModel.__table__.indexes if i.unique} == {"ix_session_session_token"}
    # DB 에 있는 해시값을 쿠키로 보내도 로그인되지 않는다(#437 완료 조건을 API 수준에서도 확인)
    assert _me(row.session_token).status_code == 401


def test_logout_deletes_only_current_session(mdb):
    _signup(_client())
    cookie_a, cookie_b = _login(), _login()

    c = _client()
    c.cookies.set("session_token", cookie_a)
    res = c.post("/api/v1/auth/logout")
    assert res.status_code == 200

    assert _me(cookie_a).status_code == 401
    assert _me(cookie_b).status_code == 200
    assert len(mdb.scalars(select(SessionModel)).all()) == 2  # 가입 세션 + B


def test_password_reset_confirm_invalidates_all_sessions(mdb):
    _signup(_client())
    cookie_a, cookie_b = _login(), _login()
    mail = password_reset.request_reset(
        mdb, "s@example.com", now=datetime.now(timezone.utc), base_url="https://mm.example"
    )
    mdb.commit()
    raw = mail.text.split("#token=")[1].split()[0]

    res = _client().post("/api/v1/auth/password-reset/confirm", json={"token": raw, "new_password": "new-pass-123"})
    assert res.status_code == 200

    assert _me(cookie_a).status_code == 401
    assert _me(cookie_b).status_code == 401


def test_expired_session_is_401(mdb):
    user = User(email="e@example.com", name="e", password_hash=hash_password(PW))
    mdb.add(user)
    mdb.flush()
    mdb.add(SessionModel(
        user_id=user.user_id,
        session_token=hash_session_token("expired-raw"),
        expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    ))
    mdb.commit()

    res = _me("expired-raw")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHENTICATED"
