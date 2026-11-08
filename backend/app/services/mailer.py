"""SMTP 메일 발송. 설정은 환경 변수로만 받는다."""
import logging
import os
import smtplib
import ssl
import time
from concurrent.futures import ThreadPoolExecutor
from email.message import EmailMessage
from pathlib import Path

logger = logging.getLogger(__name__)

LOGO_PATH = Path(__file__).resolve().parent.parent / "assets" / "mail-logo.png"

# 첫 시도 뒤 재시도 전에 쉬는 초. 테스트가 _sleep 을 바꿔 끼운다.
RETRY_DELAYS = (2, 4, 8)
_sleep = time.sleep

# 메일은 건당 최대 54초(시도 4번 x 10초 + 재시도 대기 14초)를 잡는다. API 요청 스레드 풀(BackgroundTasks)에서
# 돌리면 SMTP 가 응답하지 않을 때 로그인까지 막히므로, 메일 전용 스레드로만 보낸다.
MAIL_WORKERS = 2
_executor = ThreadPoolExecutor(max_workers=MAIL_WORKERS, thread_name_prefix="mail")


def is_configured() -> bool:
    return bool(
        os.getenv("SMTP_HOST")
        and os.getenv("SMTP_USERNAME")
        and os.getenv("SMTP_PASSWORD")
        and os.getenv("APP_BASE_URL")
    )


def app_base_url() -> str:
    return (os.getenv("APP_BASE_URL") or "").rstrip("/")


def send_mail(to: str, subject: str, text: str, html: str | None = None) -> None:
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
    if html is not None:
        msg.add_alternative(html, subtype="html")
        # 외부 이미지는 메일 앱이 막을 수 있어 본문에 싣는다. base64 data URI 는 Gmail 이 지운다.
        msg.get_body(("html",)).add_related(
            LOGO_PATH.read_bytes(), "image", "png", cid="<logo>", disposition="inline"
        )

    # context 를 주지 않으면 서버 인증서를 검증하지 않는다. 앱 비밀번호와 재설정 토큰이 가짜 서버로 넘어갈 수 있다.
    context = ssl.create_default_context()
    if use_ssl:
        smtp_cm = smtplib.SMTP_SSL(host, port, timeout=timeout, context=context)
    else:
        smtp_cm = smtplib.SMTP(host, port, timeout=timeout)
    with smtp_cm as smtp:
        if not use_ssl:
            smtp.starttls(context=context)
        smtp.login(username, password)
        smtp.send_message(msg)


def send_with_retry(to: str, subject: str, text: str, *, log_label: str, html: str | None = None) -> bool:
    """첫 시도 + 재시도 3회. 모두 실패하면 로그만 남기고 False. 토큰·코드가 든 본문은 로그에 넣지 않는다."""
    last_exc: Exception | None = None
    for delay in (*RETRY_DELAYS, None):
        try:
            send_mail(to, subject, text, html=html)
            return True
        except Exception as exc:
            last_exc = exc
            if delay is None:
                break
            _sleep(delay)
    # exc_info 는 쓰지 않는다: traceback locals 에 토큰·코드가 든 본문이 보일 수 있다.
    # 수신 거부 예외는 메시지에 받는 사람 주소가 그대로 들어 종류만 남긴다. 나머지는 진단용으로 메시지도 남긴다.
    detail = "" if isinstance(last_exc, smtplib.SMTPRecipientsRefused) else f": {last_exc}"
    logger.error("mail failed: %s (%s%s)", log_label, type(last_exc).__name__, detail)
    return False


def send_in_background(to: str, subject: str, text: str, *, log_label: str, html: str | None = None) -> None:
    """메일 전용 스레드에서 재시도까지 보낸다. 대기열이 길면 메일이 늦게 나갈 뿐 API 는 막히지 않는다."""
    _executor.submit(send_with_retry, to, subject, text, log_label=log_label, html=html)
