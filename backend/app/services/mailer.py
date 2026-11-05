"""SMTP 메일 발송. 설정은 환경 변수로만 받는다."""
import logging
import os
import smtplib
import time
from email.message import EmailMessage

logger = logging.getLogger(__name__)

# 첫 시도 뒤 재시도 전에 쉬는 초. 테스트가 _sleep 을 바꿔 끼운다.
RETRY_DELAYS = (2, 4, 8)
_sleep = time.sleep


def is_configured() -> bool:
    return bool(
        os.getenv("SMTP_HOST")
        and os.getenv("SMTP_USERNAME")
        and os.getenv("SMTP_PASSWORD")
        and os.getenv("APP_BASE_URL")
    )


def app_base_url() -> str:
    return (os.getenv("APP_BASE_URL") or "").rstrip("/")


def send_mail(to: str, subject: str, text: str) -> None:
    host = os.getenv("SMTP_HOST", "")
    port = int(os.getenv("SMTP_PORT") or 587)
    timeout = int(os.getenv("SMTP_TIMEOUT_SECONDS") or 10)
    username = os.getenv("SMTP_USERNAME", "")
    password = os.getenv("SMTP_PASSWORD", "")
    use_ssl = (os.getenv("SMTP_SECURITY") or "starttls").lower() == "ssl"

    msg = EmailMessage()
    msg["From"] = os.getenv("SMTP_FROM") or username
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)

    smtp_cls = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
    with smtp_cls(host, port, timeout=timeout) as smtp:
        if not use_ssl:
            smtp.starttls()
        smtp.login(username, password)
        smtp.send_message(msg)


def send_with_retry(to: str, subject: str, text: str, *, log_label: str) -> bool:
    """첫 시도 + 재시도 3회. 모두 실패하면 로그만 남기고 False. 토큰이 든 본문은 로그에 넣지 않는다."""
    last_exc: Exception | None = None
    for delay in (*RETRY_DELAYS, None):
        try:
            send_mail(to, subject, text)
            return True
        except Exception as exc:
            last_exc = exc
            if delay is None:
                break
            _sleep(delay)
    # exc_info 는 쓰지 않는다: traceback locals 에 토큰이 든 본문이 보일 수 있다.
    logger.error(
        "password reset mail failed: %s (%s: %s)", log_label, type(last_exc).__name__, last_exc
    )
    return False
