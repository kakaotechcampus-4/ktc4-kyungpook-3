"""옛 형식(260,000회) 해시는 로그인에 성공할 때 지금 횟수로 다시 해시한다(#691)."""
import hashlib

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.api import auth
from app.main import app
from app.models import Session as SessionModel, User
from app.services.passwords import hash_password, verify_password
from tests.usernames import username_for

EMAIL = "legacy@example.com"
PW = "rightpass123"


def _legacy_hash(password: str) -> str:
    salt = "cd" * 16
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 260_000)
    return f"{salt}${digest.hex()}"


@pytest.fixture
def legacy_user(mdb):
    user = User(username=username_for(EMAIL), email=EMAIL, name="옛", password_hash=_legacy_hash(PW), provider="local")
    mdb.add(user)
    mdb.commit()
    return user.user_id


def _client():
    return TestClient(app, base_url="https://testserver")


def _stored(mdb, user_id):
    mdb.expire_all()
    return mdb.scalar(select(User.password_hash).where(User.user_id == user_id))


def test_login_upgrades_a_legacy_hash(mdb, legacy_user):
    r = _client().post("/api/v1/auth/login", json={"email": EMAIL, "password": PW})

    assert r.status_code == 200, r.text
    stored = _stored(mdb, legacy_user)
    assert stored.startswith("pbkdf2_sha256$600000$")
    assert verify_password(PW, stored)
    assert _client().post("/api/v1/auth/login", json={"email": EMAIL, "password": PW}).status_code == 200


def test_wrong_password_keeps_the_legacy_hash(mdb, legacy_user):
    before = _stored(mdb, legacy_user)

    r = _client().post("/api/v1/auth/login", json={"email": EMAIL, "password": "wrongpass123"})

    assert r.status_code == 401
    assert _stored(mdb, legacy_user) == before


def test_upgrade_does_not_overwrite_a_password_reset_during_the_check(mdb, legacy_user, monkeypatch):
    """검사하는 사이 재설정으로 비밀번호가 바뀌면 옛 비밀번호로 덮지도, 세션을 만들지도 않는다."""
    reset_hash = hash_password("newpass456")
    real_verify = auth.verify_password

    def verify_then_reset(password, stored_hash):
        ok = real_verify(password, stored_hash)
        mdb.execute(
            update(User).where(User.user_id == legacy_user).values(password_hash=reset_hash),
            execution_options={"synchronize_session": False},
        )
        return ok

    monkeypatch.setattr(auth, "verify_password", verify_then_reset)

    r = _client().post("/api/v1/auth/login", json={"email": EMAIL, "password": PW})

    assert r.status_code == 401, r.text
    assert _stored(mdb, legacy_user) == reset_hash
    assert mdb.query(SessionModel).filter(SessionModel.user_id == legacy_user).count() == 0
