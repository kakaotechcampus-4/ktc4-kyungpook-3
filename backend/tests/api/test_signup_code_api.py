"""가입 코드 API(#427). 실제 SMTP 에는 접속하지 않고 send_mail 을 가짜로 바꾼다."""
import logging
import re

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import User
from app.services import mailer

EMAIL = "new@example.com"


class _InlineExecutor:
    def submit(self, fn, *args, **kwargs):
        return fn(*args, **kwargs)


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setattr(mailer, "_executor", _InlineExecutor())
    monkeypatch.setattr(mailer, "_sleep", lambda s: None)
    monkeypatch.setenv("OAUTH_STATE_SECRET", "k" * 40)
    monkeypatch.setenv("SMTP_HOST", "smtp.example")
    monkeypatch.setenv("SMTP_USERNAME", "user")
    monkeypatch.setenv("SMTP_PASSWORD", "pw")
    monkeypatch.setenv("APP_BASE_URL", "https://mm.example")


@pytest.fixture
def sent(monkeypatch):
    box = []
    monkeypatch.setattr(mailer, "send_mail", lambda to, subject, text, html=None: box.append((to, subject, text)))
    return box


@pytest.fixture
def client():
    return TestClient(app, base_url="https://testserver")


def _ask(client, email=EMAIL):
    return client.post("/api/v1/auth/signup/code", json={"email": email})


def _confirm(client, code, email=EMAIL):
    return client.post("/api/v1/auth/signup/code/confirm", json={"email": email, "code": code})


def _code(sent):
    return re.search(r"^(\d{6})$", sent[-1][2], re.M).group(1)


def test_request_sends_a_mail_and_reports_timings(mdb, client, sent):
    res = _ask(client)

    assert res.status_code == 200, res.text
    assert res.json()["data"] == {"expires_in": 600, "resend_after": 60}
    assert [(to, subject) for to, subject, _ in sent] == [(EMAIL, "[Manager's Manager] 가입 인증 코드")]


def test_request_without_mail_config_is_503_and_sends_nothing(mdb, client, sent, monkeypatch):
    monkeypatch.delenv("SMTP_HOST")

    res = _ask(client)

    assert res.status_code == 503
    assert res.json()["error"]["code"] == "MAIL_UNAVAILABLE"
    assert sent == []


def test_request_for_a_registered_email_is_409_and_sends_nothing(mdb, client, sent):
    mdb.add(User(email=EMAIL, name="t", provider="local"))
    mdb.commit()

    res = _ask(client, EMAIL.upper())

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "EMAIL_ALREADY_EXISTS"
    assert sent == []


def test_resend_is_429_with_a_reason_and_sends_nothing_more(mdb, client, sent):
    _ask(client)

    res = _ask(client)

    assert res.status_code == 429
    body = res.json()["error"]
    assert body["code"] == "SIGNUP_CODE_RATE_LIMITED"
    assert body["details"]["reason"] == "cooldown"
    assert 0 < body["details"]["retry_after"] <= 60
    assert len(sent) == 1


def test_confirm_gives_a_token_for_the_normalized_email(mdb, client, sent):
    _ask(client, "  New@Example.com ".strip())

    res = _confirm(client, _code(sent), "NEW@example.com")

    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["expires_in"] == 1800
    assert data["verification_token"]
    assert sent[0][0] == EMAIL


def test_confirm_wrong_code_is_400_with_attempts_left(mdb, client, sent):
    _ask(client)
    wrong = "000000" if _code(sent) != "000000" else "111111"

    res = _confirm(client, wrong)

    assert res.status_code == 400
    body = res.json()["error"]
    assert body["code"] == "SIGNUP_CODE_INVALID"
    assert body["details"] == {"reason": "wrong", "attempts_left": 4}


@pytest.mark.parametrize("code", ["12345", "1234567", "abcdef", "12345\n", "١٢٣٤٥٦"])
def test_malformed_code_is_invalid_request_and_does_not_count(mdb, client, sent, code):
    _ask(client)
    wrong = "000000" if _code(sent) != "000000" else "111111"

    res = _confirm(client, code)

    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_REQUEST"
    assert _confirm(client, wrong).json()["error"]["details"]["attempts_left"] == 4


def test_failed_mail_is_logged_without_the_code(mdb, client, monkeypatch, caplog):
    bodies = []

    def fail(to, subject, text, html=None):
        bodies.append(text)
        raise OSError("connection refused")

    monkeypatch.setattr(mailer, "send_mail", fail)

    with caplog.at_level(logging.DEBUG):
        res = _ask(client)

    assert res.status_code == 200
    assert len(bodies) == 4
    code = re.search(r"^(\d{6})$", bodies[0], re.M).group(1)
    assert "mail failed" in caplog.text
    assert code not in caplog.text
    assert EMAIL not in caplog.text


def test_code_never_appears_in_logs_through_the_whole_flow(mdb, client, sent, caplog):
    with caplog.at_level(logging.DEBUG):
        _ask(client)
        code = _code(sent)
        wrong = "000000" if code != "000000" else "111111"
        _confirm(client, wrong)
        _confirm(client, code)

    assert code not in caplog.text
