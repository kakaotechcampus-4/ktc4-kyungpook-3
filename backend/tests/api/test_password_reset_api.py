"""비밀번호 재설정 API(#356). 실제 SMTP 에는 접속하지 않고 send_mail 을 가짜로 바꾼다."""
import logging
import re

import pytest
from sqlalchemy import event
from fastapi.testclient import TestClient

from app.main import app
from app.services import mailer, password_reset

EMAIL = "reset@example.com"
OLD_PW = "oldpass123"
NEW_PW = "newpass456"
BASE = "https://mm.example"


class _InlineExecutor:
    """메일 전용 스레드 대신 호출한 자리에서 바로 돌려, 요청이 끝났을 때 발송 결과를 볼 수 있게 한다."""

    def submit(self, fn, *args, **kwargs):
        return fn(*args, **kwargs)


@pytest.fixture(autouse=True)
def inline_mail(monkeypatch):
    monkeypatch.setattr(mailer, "_executor", _InlineExecutor())


@pytest.fixture
def sent(monkeypatch):
    box = []
    monkeypatch.setattr(mailer, "send_mail", lambda to, subject, text: box.append((to, subject, text)))
    monkeypatch.setattr(mailer, "_sleep", lambda s: None)
    return box


@pytest.fixture
def smtp_env(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.example")
    monkeypatch.setenv("SMTP_USERNAME", "user")
    monkeypatch.setenv("SMTP_PASSWORD", "pw")
    monkeypatch.setenv("APP_BASE_URL", BASE + "/")


def _client():
    return TestClient(app, base_url="https://testserver")


def _signup(c):
    r = c.post("/api/v1/auth/signup", json={"email": EMAIL, "password": OLD_PW, "name": "r"})
    assert r.status_code == 201


def _token(sent_box):
    m = re.search(r"#token=(\S+)", sent_box[-1][2])
    return m.group(1)


def _request(c, email=EMAIL):
    return c.post("/api/v1/auth/password-reset/request", json={"email": email})


@pytest.mark.parametrize("signed_up", [True, False])
def test_request_without_mail_config_returns_503(mdb, sent, monkeypatch, signed_up):
    for k in ("SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "APP_BASE_URL"):
        monkeypatch.delenv(k, raising=False)
    c = _client()
    if signed_up:
        _signup(c)
    r = _request(c)
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "MAIL_UNAVAILABLE"
    assert sent == []


def test_request_unknown_email_returns_200_and_sends_nothing(mdb, sent, smtp_env):
    r = _request(_client(), "nobody@example.com")
    assert r.status_code == 200
    assert r.json()["data"] == {}
    assert sent == []


def test_request_with_uppercase_email_sends_to_stored_address(mdb, sent, smtp_env):
    c = _client()
    _signup(c)
    r = _request(c, EMAIL.upper())
    assert r.status_code == 200
    assert len(sent) == 1
    assert sent[0][0] == EMAIL


def test_request_known_email_sends_link(mdb, sent, smtp_env):
    c = _client()
    _signup(c)
    r = _request(c)
    assert r.status_code == 200
    assert r.json()["data"] == {}
    assert len(sent) == 1
    assert sent[0][0] == EMAIL
    assert f"{BASE}/reset-password#token=" in sent[0][2]


def test_request_invalid_email_returns_400(mdb, sent, smtp_env):
    r = _request(_client(), "not-an-email")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


def test_request_send_failure_still_200_and_no_token_in_logs(mdb, smtp_env, monkeypatch, caplog):
    attempts = []

    def boom(to, subject, text):
        attempts.append(1)
        raise RuntimeError("smtp down")

    monkeypatch.setattr(mailer, "send_mail", boom)
    monkeypatch.setattr(mailer, "_sleep", lambda s: None)
    monkeypatch.setattr(password_reset.secrets, "token_urlsafe", lambda n: "FIXED-TOKEN")
    c = _client()
    _signup(c)
    with caplog.at_level(logging.DEBUG):
        r = _request(c)
    assert r.status_code == 200
    assert len(attempts) == 4
    assert "FIXED-TOKEN" not in caplog.text


def test_full_flow(mdb, sent, smtp_env):
    c1, c2 = _client(), _client()
    _signup(c1)
    assert c2.post("/api/v1/auth/login", json={"email": EMAIL, "password": OLD_PW}).status_code == 200
    assert c1.get("/api/v1/auth/me").status_code == 200
    assert c2.get("/api/v1/auth/me").status_code == 200

    anon = _client()
    assert _request(anon).status_code == 200
    token = _token(sent)

    v = anon.post("/api/v1/auth/password-reset/verify", json={"token": token})
    assert v.status_code == 200
    assert v.json()["data"]["email_masked"] == "re***@example.com"
    assert v.json()["data"]["expires_at"]

    cf = anon.post("/api/v1/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PW})
    assert cf.status_code == 200
    assert cf.json()["data"] == {}

    assert c1.get("/api/v1/auth/me").status_code == 401
    assert c2.get("/api/v1/auth/me").status_code == 401
    ok = _client().post("/api/v1/auth/login", json={"email": EMAIL, "password": NEW_PW})
    assert ok.status_code == 200
    bad = _client().post("/api/v1/auth/login", json={"email": EMAIL, "password": OLD_PW})
    assert bad.status_code == 401


def test_confirm_weak_password_keeps_token_usable(mdb, sent, smtp_env):
    c = _client()
    _signup(c)
    _request(c)
    token = _token(sent)
    weak = c.post("/api/v1/auth/password-reset/confirm", json={"token": token, "new_password": "abcdefgh"})
    assert weak.status_code == 400
    assert weak.json()["error"]["code"] == "INVALID_REQUEST"
    ok = c.post("/api/v1/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PW})
    assert ok.status_code == 200


def test_verify_and_confirm_invalid_token_reason(mdb, sent, smtp_env):
    c = _client()
    _signup(c)
    v = c.post("/api/v1/auth/password-reset/verify", json={"token": "nope"})
    assert v.status_code == 400
    assert v.json()["error"]["code"] == "PASSWORD_RESET_TOKEN_INVALID"
    assert v.json()["error"]["details"]["reason"] == "invalid"

    _request(c)
    token = _token(sent)
    body = {"token": token, "new_password": NEW_PW}
    assert c.post("/api/v1/auth/password-reset/confirm", json=body).status_code == 200
    again = c.post("/api/v1/auth/password-reset/confirm", json=body)
    assert again.status_code == 400
    assert again.json()["error"]["code"] == "PASSWORD_RESET_TOKEN_INVALID"
    assert again.json()["error"]["details"]["reason"] == "used"


@pytest.mark.parametrize("path, extra", [("verify", {}), ("confirm", {"new_password": NEW_PW})])
def test_unpaired_surrogate_token_is_invalid_not_500(mdb, sent, smtp_env, path, extra):
    """짝 없는 서로게이트는 JSON·스키마를 통과하지만 utf-8 로 바뀌지 않는다. 500 대신 계약대로 400 이다."""
    c = _client()
    _signup(c)
    # JSON 본문 안의 \ud800 이스케이프 글자 그대로 보낸다(파이썬 문자열의 서로게이트가 아니다).
    body = '{"token": "\\ud800"' + "".join(f', "{k}": "{v}"' for k, v in extra.items()) + "}"

    r = c.post(f"/api/v1/auth/password-reset/{path}", content=body, headers={"Content-Type": "application/json"})

    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "PASSWORD_RESET_TOKEN_INVALID"
    assert r.json()["error"]["details"]["reason"] == "invalid"


PUBLIC = ("8.8.8.8", 50000)


def _public_client(host=PUBLIC):
    return TestClient(app, base_url="https://testserver", client=host)


def test_ip_cap_returns_same_200_and_sends_nothing(mdb, sent, smtp_env):
    _signup(_client())
    c = _public_client()
    for i in range(5):
        assert _request(c, f"nobody{i}@example.com").status_code == 200
    r = _request(c)
    assert r.status_code == 200
    assert r.json()["data"] == {}
    assert sent == []


def test_ip_cap_counts_unknown_emails_too(mdb, sent, smtp_env):
    _signup(_client())
    c = _public_client()
    for i in range(5):
        _request(c, f"ghost{i}@example.com")
    assert _request(c).status_code == 200
    assert sent == []
    # 다른 공인 IP 는 영향이 없다.
    assert _request(_public_client(("1.1.1.1", 50000))).status_code == 200
    assert len(sent) == 1


def test_ip_cap_blocks_before_db(mdb, sent, smtp_env):
    c = _public_client()
    for i in range(5):
        _request(c, f"ghost{i}@example.com")
    queries = []

    def record(*_a, **_k):
        queries.append(1)

    engine = mdb.get_bind()
    event.listen(engine, "before_cursor_execute", record)
    try:
        r = _request(c)
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert r.status_code == 200
    assert queries == []


def test_ip_cap_logs_reason_without_email(mdb, sent, smtp_env, caplog):
    c = _public_client()
    for i in range(5):
        _request(c, f"ghost{i}@example.com")
    with caplog.at_level(logging.WARNING):
        _request(c, "secret-person@example.com")
    assert "reason=ip" in caplog.text
    assert "secret-person" not in caplog.text


def test_private_ip_skips_ip_cap(mdb, sent, smtp_env):
    c = _client()
    for i in range(8):
        assert _request(c, f"ghost{i}@example.com").status_code == 200
    _signup(c)
    assert _request(c).status_code == 200
    assert len(sent) == 1


def test_mail_unconfigured_still_503_before_ip_cap(mdb, sent, monkeypatch):
    for k in ("SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "APP_BASE_URL"):
        monkeypatch.delenv(k, raising=False)
    c = _public_client()
    for _ in range(8):
        assert _request(c).status_code == 503
    # 503 은 IP 카운터를 늘리지 않는다.
    monkeypatch.setenv("SMTP_HOST", "smtp.example")
    monkeypatch.setenv("SMTP_USERNAME", "user")
    monkeypatch.setenv("SMTP_PASSWORD", "pw")
    monkeypatch.setenv("APP_BASE_URL", BASE + "/")
    _signup(_client())
    assert _request(c).status_code == 200
    assert len(sent) == 1


def test_global_cap_response_identical_known_unknown(mdb, sent, smtp_env):
    c = _client()
    for i in range(5):
        email = f"user{i}@example.com"
        assert c.post("/api/v1/auth/signup", json={"email": email, "password": OLD_PW, "name": "r"}).status_code == 201
        assert _request(_client(), email).status_code == 200
    assert len(sent) == 5
    _signup(_client())
    known = _request(_client())
    unknown = _request(_client(), "nobody@example.com")
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()
    assert len(sent) == 5
