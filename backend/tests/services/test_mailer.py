import logging
import smtplib
import ssl
import threading
import time

import pytest

from app.services import mailer

ENV = {
    "SMTP_HOST": "smtp.example.com",
    "SMTP_USERNAME": "user@example.com",
    "SMTP_PASSWORD": "pw",
    "APP_BASE_URL": "https://app.example.com",
}
ALL_KEYS = [*ENV, "SMTP_PORT", "SMTP_SECURITY", "SMTP_FROM", "SMTP_TIMEOUT_SECONDS"]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    CONTEXTS.clear()
    for key in ALL_KEYS:
        monkeypatch.delenv(key, raising=False)


def set_env(monkeypatch, **overrides):
    for key, value in {**ENV, **overrides}.items():
        monkeypatch.setenv(key, value)


CONTEXTS: list = []


def make_fake(calls: list, kind: str):
    class FakeSMTP:
        def __init__(self, host, port, timeout=None, context=None):
            CONTEXTS.append(("init", context))
            calls.append(f"{kind}({host},{port},{timeout})" if kind != "init" else f"init({host},{port},{timeout})")
            self.messages = []

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def starttls(self, context=None):
            CONTEXTS.append(("starttls", context))
            calls.append("starttls")

        def login(self, username, password):
            calls.append("login")

        def send_message(self, msg):
            calls.append("send_message")
            calls.append(msg)

    return FakeSMTP


def test_is_configured_requires_host_user_password_and_base_url(monkeypatch):
    assert mailer.is_configured() is False
    for missing in ENV:
        for key in ALL_KEYS:
            monkeypatch.delenv(key, raising=False)
        set_env(monkeypatch)
        monkeypatch.delenv(missing)
        assert mailer.is_configured() is False
    set_env(monkeypatch)
    assert mailer.is_configured() is True


def test_send_mail_uses_starttls_by_default(monkeypatch):
    set_env(monkeypatch)
    calls: list = []
    monkeypatch.setattr(smtplib, "SMTP", make_fake(calls, "init"))
    monkeypatch.setattr(smtplib, "SMTP_SSL", make_fake(calls, "ssl"))

    mailer.send_mail("to@example.com", "제목", "본문")

    assert calls[:4] == ["init(smtp.example.com,587,10)", "starttls", "login", "send_message"]
    msg = calls[4]
    assert msg["To"] == "to@example.com"
    assert msg["From"] == "user@example.com"
    assert msg["Subject"] == "제목"


def _assert_verifying(context):
    assert isinstance(context, ssl.SSLContext)
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True


def test_starttls_verifies_the_server_certificate(monkeypatch):
    """context 를 주지 않으면 인증서를 검증하지 않아 앱 비밀번호와 재설정 토큰이 가짜 서버로 넘어갈 수 있다."""
    set_env(monkeypatch)
    monkeypatch.setattr(smtplib, "SMTP", make_fake([], "init"))

    mailer.send_mail("to@example.com", "s", "t")

    [context] = [c for name, c in CONTEXTS if name == "starttls"]
    _assert_verifying(context)


def test_smtp_ssl_verifies_the_server_certificate(monkeypatch):
    set_env(monkeypatch, SMTP_SECURITY="ssl", SMTP_PORT="465")
    monkeypatch.setattr(smtplib, "SMTP_SSL", make_fake([], "ssl"))

    mailer.send_mail("to@example.com", "s", "t")

    [context] = [c for name, c in CONTEXTS if name == "init"]
    _assert_verifying(context)


def test_send_mail_uses_from_env_when_set(monkeypatch):
    set_env(monkeypatch, SMTP_FROM="noreply@example.com")
    calls: list = []
    monkeypatch.setattr(smtplib, "SMTP", make_fake(calls, "init"))

    mailer.send_mail("to@example.com", "s", "t")

    assert calls[4]["From"] == "noreply@example.com"


def test_send_mail_uses_ssl_when_configured(monkeypatch):
    set_env(monkeypatch, SMTP_SECURITY="ssl", SMTP_PORT="465")
    calls: list = []
    monkeypatch.setattr(smtplib, "SMTP", make_fake(calls, "init"))
    monkeypatch.setattr(smtplib, "SMTP_SSL", make_fake(calls, "ssl"))

    mailer.send_mail("to@example.com", "s", "t")

    assert calls[:3] == ["ssl(smtp.example.com,465,10)", "login", "send_message"]
    assert "starttls" not in calls


def _patch_send(monkeypatch, fail_times):
    attempts = []
    sleeps = []

    def fake_send(to, subject, text):
        attempts.append(1)
        if len(attempts) <= fail_times:
            raise OSError("boom")

    monkeypatch.setattr(mailer, "send_mail", fake_send)
    monkeypatch.setattr(mailer, "_sleep", sleeps.append)
    return attempts, sleeps


def test_send_with_retry_succeeds_on_third_try(monkeypatch):
    attempts, sleeps = _patch_send(monkeypatch, 2)

    assert mailer.send_with_retry("a@b.c", "s", "t", log_label="user=1") is True
    assert len(attempts) == 3
    assert sleeps == [2, 4]


def test_send_with_retry_gives_up_after_four_tries(monkeypatch, caplog):
    attempts, sleeps = _patch_send(monkeypatch, 99)

    with caplog.at_level(logging.ERROR):
        result = mailer.send_with_retry("a@b.c", "s", "SECRET-TOKEN", log_label="user=1")

    assert result is False
    assert len(attempts) == 4
    assert sleeps == [2, 4, 8]
    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(errors) == 1
    assert "SECRET-TOKEN" not in caplog.text
    assert "user=1" in errors[0].getMessage()


def test_send_with_retry_logs_last_exception_type_and_message_without_body(monkeypatch, caplog):
    def always_fail(to, subject, text):
        raise smtplib.SMTPAuthenticationError(535, b"bad creds")

    monkeypatch.setattr(mailer, "send_mail", always_fail)
    monkeypatch.setattr(mailer, "_sleep", lambda s: None)

    with caplog.at_level(logging.ERROR):
        assert mailer.send_with_retry("a@b.c", "s", "SECRET-TOKEN", log_label="user=1") is False

    assert "SMTPAuthenticationError" in caplog.text
    assert "bad creds" in caplog.text
    assert "user=1" in caplog.text
    assert "SECRET-TOKEN" not in caplog.text
    assert "Traceback" not in caplog.text


def test_send_with_retry_failure_log_does_not_name_a_mail_purpose(monkeypatch, caplog):
    """가입 코드 메일도 같은 함수로 나가므로 로그가 비밀번호 재설정이라고 적으면 원인을 잘못 찾게 된다."""
    _patch_send(monkeypatch, 99)

    with caplog.at_level(logging.ERROR):
        mailer.send_with_retry("a@b.c", "s", "123456", log_label="signup_code")

    assert "password reset" not in caplog.text
    assert "signup_code" in caplog.text
    assert "123456" not in caplog.text


def test_app_base_url_strips_trailing_slash(monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", "https://app.example.com/")
    assert mailer.app_base_url() == "https://app.example.com"


def test_send_in_background_returns_before_the_mail_is_sent(monkeypatch):
    started, release = threading.Event(), threading.Event()

    def slow(to, subject, text, *, log_label):
        started.set()
        release.wait(5)

    monkeypatch.setattr(mailer, "send_with_retry", slow)
    try:
        mailer.send_in_background("a@b.c", "s", "t", log_label="user=1")
        assert started.wait(5)
    finally:
        release.set()


def test_background_mail_never_uses_more_than_the_mail_workers(monkeypatch):
    """SMTP 가 응답하지 않아도 API 요청 스레드 풀을 쓰지 않고 메일 전용 스레드 수 안에서만 돈다."""
    lock = threading.Lock()
    running = {"now": 0, "max": 0}
    release = threading.Event()

    def blocked(to, subject, text, *, log_label):
        with lock:
            running["now"] += 1
            running["max"] = max(running["max"], running["now"])
        release.wait(5)
        with lock:
            running["now"] -= 1

    monkeypatch.setattr(mailer, "send_with_retry", blocked)
    try:
        for i in range(mailer.MAIL_WORKERS * 3):
            mailer.send_in_background("a@b.c", "s", "t", log_label=f"user={i}")
        deadline = time.time() + 5
        while running["now"] < mailer.MAIL_WORKERS and time.time() < deadline:
            time.sleep(0.01)
        time.sleep(0.1)
        assert running["max"] == mailer.MAIL_WORKERS
    finally:
        release.set()


def test_send_with_retry_hides_recipient_address_when_refused(monkeypatch, caplog):
    """수신 거부 예외의 메시지에는 받는 사람 주소가 그대로 든다. 그 예외만 종류만 남겨 이메일이 로그에 남지 않게 한다."""
    def refused(to, subject, text):
        raise smtplib.SMTPRecipientsRefused({"victim@corp.com": (550, b"no such user")})

    monkeypatch.setattr(mailer, "send_mail", refused)
    monkeypatch.setattr(mailer, "_sleep", lambda s: None)

    with caplog.at_level(logging.ERROR):
        assert mailer.send_with_retry("victim@corp.com", "s", "SECRET-TOKEN", log_label="user=1") is False

    assert "SMTPRecipientsRefused" in caplog.text
    assert "user=1" in caplog.text
    assert "victim@corp.com" not in caplog.text
    assert "SECRET-TOKEN" not in caplog.text
