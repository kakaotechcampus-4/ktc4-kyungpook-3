import logging
import smtplib

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
    for key in ALL_KEYS:
        monkeypatch.delenv(key, raising=False)


def set_env(monkeypatch, **overrides):
    for key, value in {**ENV, **overrides}.items():
        monkeypatch.setenv(key, value)


def make_fake(calls: list, kind: str):
    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            calls.append(f"{kind}({host},{port},{timeout})" if kind != "init" else f"init({host},{port},{timeout})")
            self.messages = []

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def starttls(self):
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


def test_app_base_url_strips_trailing_slash(monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", "https://app.example.com/")
    assert mailer.app_base_url() == "https://app.example.com"
