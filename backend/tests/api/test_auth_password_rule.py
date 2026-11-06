"""회원가입 비밀번호 규칙(#356): 8자 이상, ASCII 숫자 하나 이상."""
import pytest
from fastapi.testclient import TestClient

from app.main import app


def _client():
    return TestClient(app, base_url="https://testserver")


def _signup(client, email, password):
    return client.post("/api/v1/auth/signup", json={"email": email, "password": password, "name": "테스터"})


@pytest.mark.parametrize("password", ["abcdefgh", "1234567", "abcdefg١"])
def test_signup_rejects_weak_password(mdb, password):
    res = _signup(_client(), "weak@example.com", password)
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "INVALID_REQUEST"
    assert any("password" in f["loc"] for f in body["error"]["details"]["fields"])


@pytest.mark.parametrize("password", ["pw-123456", "12345678"])
def test_signup_accepts_valid_password(mdb, password):
    res = _signup(_client(), "ok@example.com", password)
    assert res.status_code == 201


def test_signup_weak_password_and_existing_email_returns_400(mdb):
    client = _client()
    assert _signup(client, "dup@example.com", "pw-123456").status_code == 201
    res = _signup(client, "dup@example.com", "abc")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_REQUEST"
