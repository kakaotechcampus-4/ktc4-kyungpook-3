"""로그인 시도 제한(#436): 이메일 10회·IP 50회를 넘으면 429, 맞는 비밀번호도 막는다."""
import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.api import auth
from app.main import app
from app.services import login_limit, mailer
from tests.api.conftest import signup_verified

EMAIL = "limit@example.com"
PW = "rightpass123"
BLOCK_MESSAGE = "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요."


@pytest.fixture(autouse=True)
def _cheap_hash(monkeypatch):
    # 수십 번 로그인하므로 해시 반복을 줄인다. 해시 횟수는 test_login_timing 이 맡는다.
    monkeypatch.setattr("app.services.passwords._PBKDF2_ITERATIONS", 1)


class _InlineExecutor:
    def submit(self, fn, *args, **kwargs):
        return fn(*args, **kwargs)


@pytest.fixture
def sent(monkeypatch):
    # 실제 SMTP 에 접속하지 않고 발송 내용만 모은다.
    box = []
    monkeypatch.setattr(mailer, "_executor", _InlineExecutor())
    monkeypatch.setattr(mailer, "send_mail", lambda to, subject, text, html=None: box.append((to, subject, text)))
    monkeypatch.setattr(mailer, "_sleep", lambda s: None)
    monkeypatch.setenv("SMTP_HOST", "smtp.example")
    monkeypatch.setenv("SMTP_USERNAME", "user")
    monkeypatch.setenv("SMTP_PASSWORD", "pw")
    monkeypatch.setenv("APP_BASE_URL", "https://mm.example/")
    return box


def _client(**kwargs):
    return TestClient(app, base_url="https://testserver", **kwargs)


@pytest.fixture(autouse=True)
def _secret(signup_secret):
    pass


def _signup(c, email=EMAIL):
    r = signup_verified(c, email, PW, "t")
    assert r.status_code == 201, r.text


def _login(c, email=EMAIL, password=PW):
    return c.post("/api/v1/auth/login", json={"email": email, "password": password})


def _fail(c, email=EMAIL):
    return _login(c, email, "wrongpass123")


def _fail_n(c, n, email=EMAIL):
    for _ in range(n):
        r = _fail(c, email)
        assert r.status_code == 401, r.text


def test_blocks_after_limit_even_with_correct_password(mdb, monkeypatch):
    c = _client()
    _signup(c)
    _fail_n(c, 10)
    calls = []
    real = auth.verify_password
    monkeypatch.setattr(auth, "verify_password", lambda *a: calls.append(1) or real(*a))

    r = _login(c)

    assert r.status_code == 429, r.text
    assert r.json()["error"]["code"] == "TOO_MANY_LOGIN_ATTEMPTS"
    assert calls == []


def test_email_case_and_spaces_share_one_count(mdb):
    """대소문자·앞뒤 공백만 다른 이메일은 같은 횟수로 센다. LoginRequest.email 의 정규화에 기대는 동작이다(#456 리뷰)."""
    c = _client()
    _signup(c)
    _fail_n(c, 10, " LIMIT@Example.com ")

    assert _login(c, "limit@example.com").status_code == 429


def test_block_response_is_same_for_unknown_email(mdb, monkeypatch):
    monkeypatch.setattr(login_limit, "clock", lambda: 1000.0)
    c = _client()
    _signup(c)
    results = []
    for email in (EMAIL, "nobody@example.com"):
        _fail_n(c, 10, email)
        r = _fail(c, email)
        results.append((r.status_code, r.json()["error"], r.headers["Retry-After"]))

    assert results[0][0] == 429
    assert results[0] == results[1]


def test_retry_after_header_and_details_match(mdb, monkeypatch):
    monkeypatch.setattr(login_limit, "clock", lambda: 1000.0)
    c = _client()
    _signup(c)
    _fail_n(c, 10)

    r = _fail(c)

    assert r.status_code == 429
    error = r.json()["error"]
    assert error["message"] == BLOCK_MESSAGE
    assert error["details"]["retry_after_seconds"] == int(r.headers["Retry-After"]) == 900


def test_block_expires_after_window(mdb, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(login_limit, "clock", lambda: now[0])
    c = _client()
    _signup(c)
    _fail_n(c, 10)
    assert _login(c).status_code == 429

    now[0] += 901

    assert _login(c).status_code == 200


def test_success_clears_email_count(mdb):
    c = _client()
    _signup(c)
    _fail_n(c, 9)
    assert _login(c).status_code == 200

    _fail_n(c, 10)


def test_success_does_not_clear_ip_count(mdb):
    c = _client(client=("8.8.8.8", 50000))
    _signup(c)
    for i in range(49):
        r = _fail(c, f"other{i}@example.com")
        assert r.status_code == 401, r.text
    assert _login(c).status_code == 200
    assert _fail(c, "last@example.com").status_code == 401

    assert _fail(c, "after@example.com").status_code == 429


def test_ip_limit_blocks_across_emails(mdb):
    c = _client(client=("8.8.8.8", 50000))
    for i in range(50):
        r = _fail(c, f"other{i}@example.com")
        assert r.status_code == 401, r.text

    r = _fail(c, "other50@example.com")

    assert r.status_code == 429
    assert r.json()["error"]["code"] == "TOO_MANY_LOGIN_ATTEMPTS"


def test_private_client_skips_ip_limit(mdb):
    c = _client()
    for i in range(51):
        r = _fail(c, f"other{i}@example.com")
        assert r.status_code == 401, r.text


def test_existing_session_works_while_blocked(mdb):
    c = _client()
    _signup(c)
    assert _login(c).status_code == 200
    other = _client()
    _fail_n(other, 10)
    assert _login(other).status_code == 429

    assert c.get("/api/v1/auth/me").status_code == 200


def test_unexpected_error_does_not_count(mdb, monkeypatch):
    c = _client(raise_server_exceptions=False)
    _signup(c)

    def boom(*_a):
        raise RuntimeError("boom")

    monkeypatch.setattr(auth, "verify_password", boom)
    for _ in range(12):
        assert _login(c).status_code == 500
    monkeypatch.undo()
    monkeypatch.setattr("app.services.passwords._PBKDF2_ITERATIONS", 1)

    assert _login(c).status_code == 200


def test_response_failure_after_session_still_clears_email_count(mdb, monkeypatch):
    """세션까지 만든 뒤 응답 조립이 실패해도 인증은 성공했으므로 이전 실패 횟수를 지운다(#456 리뷰)."""
    c = _client(raise_server_exceptions=False)
    _signup(c)
    _fail_n(c, 9)

    def boom(*_a, **_k):
        raise RuntimeError("build failed")

    monkeypatch.setattr(auth, "_build_auth_response", boom)
    assert _login(c).status_code == 500
    monkeypatch.undo()
    monkeypatch.setattr("app.services.passwords._PBKDF2_ITERATIONS", 1)

    # 횟수가 지워졌다면 틀린 비밀번호 10번이 모두 401 이다. 9번이 남아 있었다면 두 번째부터 429 다.
    _fail_n(c, 10)


def test_invalid_body_is_not_counted(mdb):
    c = _client()
    _signup(c)
    for _ in range(11):
        assert c.post("/api/v1/auth/login", json={"email": "not-an-email", "password": "x"}).status_code == 400
        assert c.post("/api/v1/auth/login", json={"email": EMAIL}).status_code == 400

    assert _login(c).status_code == 200


def test_blocked_request_sends_no_sql(mdb):
    c = _client()
    _signup(c)
    _fail_n(c, 10)
    queries = []

    def record(*_a, **_k):
        queries.append(1)

    engine = mdb.get_bind()
    event.listen(engine, "before_cursor_execute", record)
    try:
        r = _login(c)
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert r.status_code == 429
    assert queries == []


def _reset_token(c, sent):
    assert c.post("/api/v1/auth/password-reset/request", json={"email": EMAIL}).status_code == 200
    return re.search(r"#token=(\S+)", sent[-1][2]).group(1)


def _confirm(c, token, password="newpass456"):
    return c.post("/api/v1/auth/password-reset/confirm", json={"token": token, "new_password": password})


def test_password_reset_confirm_unblocks_email(mdb, sent):
    c = _client()
    _signup(c)
    _fail_n(c, 10)
    assert _login(c).status_code == 429
    token = _reset_token(c, sent)

    assert _confirm(c, token).status_code == 200

    assert _login(c, password="newpass456").status_code == 200


def test_password_reset_confirm_keeps_ip_block(mdb, sent, monkeypatch):
    # confirm 은 그 이메일의 막힘만 푼다. 같은 공인 IP 의 막힘은 그대로라 FE 가 "재설정하면 풀린다"고 약속하면 안 된다(#549)
    now = [1000.0]
    monkeypatch.setattr(login_limit, "clock", lambda: now[0])
    c = _client(client=("8.8.8.8", 50000))
    _signup(c)
    for i in range(50):
        assert _fail(c, f"other{i}@example.com").status_code == 401
    assert _login(c).status_code == 429
    token = _reset_token(c, sent)

    assert _confirm(c, token).status_code == 200

    blocked = _login(c, password="newpass456")
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "TOO_MANY_LOGIN_ATTEMPTS"
    # 남은 막힘은 IP 뿐이다. 비밀번호는 실제로 바뀌었고 시간이 지나면 새 비밀번호로 들어간다
    now[0] += login_limit.BLOCK_SECONDS + 1
    assert _login(c, password="newpass456").status_code == 200


def test_failed_confirm_keeps_block(mdb, sent):
    c = _client()
    _signup(c)
    _fail_n(c, 10)
    _reset_token(c, sent)

    assert _confirm(c, "wrong-token").status_code == 400

    assert _login(c).status_code == 429


def test_commit_failure_keeps_block(mdb, sent, monkeypatch):
    c = _client(raise_server_exceptions=False)
    _signup(c)
    _fail_n(c, 10)
    token = _reset_token(c, sent)

    def boom(self):
        raise RuntimeError("commit failed")

    monkeypatch.setattr("sqlalchemy.orm.Session.commit", boom)
    assert _confirm(c, token).status_code == 500
    monkeypatch.undo()
    monkeypatch.setattr("app.services.passwords._PBKDF2_ITERATIONS", 1)

    assert _login(c).status_code == 429


def test_uvicorn_proxy_headers_resolve_client():
    """앱 코드가 아니라 설치된 uvicorn 의 동작을 고정한다. FORWARDED_ALLOW_IPS="*" 일 때 X-Forwarded-For 의 값이
    클라이언트 주소가 된다는 것이 결정 기록 "프록시 위험"의 전제다. uvicorn 을 올려 이 동작이 바뀌면 결정 기록의
    위험 설명을 다시 확인하라. 이 테스트만 보고 지우지 말 것(#456 리뷰)."""
    from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

    seen = {}

    async def inner(scope, receive, send):
        seen["client"] = scope["client"]

    wrapped = ProxyHeadersMiddleware(inner, trusted_hosts="*")
    scope = {
        "type": "http",
        "client": ("10.0.0.1", 1234),
        "headers": [(b"x-forwarded-for", b"8.8.8.8")],
    }

    import asyncio

    asyncio.run(wrapped(scope, None, None))

    assert seen["client"][0] == "8.8.8.8"
