"""로그인 실패 경로가 모두 같은 해시 계산을 거치고(#436), 서로게이트 비밀번호도 500 이 아닌 401 이 되게 한다."""
import hashlib

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app.main import app
from app.models import User

EMAIL = "timing@example.com"
PW = "rightpass123"


def _client(**kwargs):
    return TestClient(app, base_url="https://testserver", **kwargs)


def _signup(c):
    r = c.post("/api/v1/auth/signup", json={"email": EMAIL, "password": PW, "name": "t"})
    assert r.status_code == 201


def _login_body(email, password_json):
    return f'{{"email": "{email}", "password": "{password_json}"}}'


def _post_raw(c, body):
    return c.post("/api/v1/auth/login", content=body, headers={"Content-Type": "application/json"})


@pytest.mark.parametrize("case", ["unknown_email", "null_hash", "empty_hash", "wrong_password"])
def test_login_hashes_once_for_all_failure_paths(mdb, monkeypatch, case):
    c = _client()
    _signup(c)
    email, password = EMAIL, PW
    if case == "unknown_email":
        email = "nobody@example.com"
    elif case == "null_hash":
        mdb.execute(update(User).where(User.email == EMAIL).values(password_hash=None))
        mdb.commit()
    elif case == "empty_hash":
        mdb.execute(update(User).where(User.email == EMAIL).values(password_hash=""))
        mdb.commit()
    else:
        password = "wrongpass123"

    calls = []
    real = hashlib.pbkdf2_hmac

    def counting(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(hashlib, "pbkdf2_hmac", counting)

    r = c.post("/api/v1/auth/login", json={"email": email, "password": password})

    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert len(calls) == 1


def test_surrogate_password_is_401_for_known_and_unknown(mdb):
    c = _client(raise_server_exceptions=False)
    _signup(c)
    # JSON 본문 안의 \ud800 이스케이프 글자 그대로 보낸다(짝 없는 서로게이트가 된다).
    for email in (EMAIL, "nobody@example.com"):
        r = _post_raw(c, _login_body(email, "\\ud800aaaaaaa1"))
        assert r.status_code == 401, r.text
        assert r.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_correct_password_still_logs_in(mdb):
    c = _client()
    _signup(c)

    r = c.post("/api/v1/auth/login", json={"email": EMAIL, "password": PW})

    assert r.status_code == 200, r.text
