"""웹 푸시(VAPID) 발송. 키는 서버 설정(환경 변수)으로만 받는다."""
import json
import logging
import os

from pywebpush import WebPushException, webpush

from app.models import PushSubscription

logger = logging.getLogger(__name__)

# 푸시 서비스가 메시지를 붙잡아 두는 시간(초). 기기가 하루 넘게 꺼져 있으면 그 푸시는 버리고 웹 안 알림만 남는다.
PUSH_TTL_SECONDS = 24 * 60 * 60


class PushGone(Exception):
    """푸시 서비스가 구독이 없어졌다고 답했다(404, 410). 그 구독은 지운다."""


class PushRejected(Exception):
    """푸시 서비스가 요청을 거절했다(400, 401, 403). VAPID 키를 바꾸면 기존 구독이 이렇게 답한다.

    다시 보내도 같으므로 재시도하지 않는다. 서버 키 설정이 잘못돼도 같은 답이 오므로 구독은 지우지 않는다.
    """


def public_key() -> str | None:
    return os.getenv("VAPID_PUBLIC_KEY") or None


def is_configured() -> bool:
    return bool(os.getenv("VAPID_PRIVATE_KEY") and public_key() and os.getenv("VAPID_SUBJECT"))


def send(subscription: PushSubscription, payload: dict) -> None:
    try:
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=os.environ["VAPID_PRIVATE_KEY"],
            vapid_claims={"sub": os.environ["VAPID_SUBJECT"]},
            ttl=PUSH_TTL_SECONDS,
            timeout=10,
        )
    except WebPushException as exc:
        code = None if exc.response is None else exc.response.status_code
        if code in (404, 410):
            raise PushGone() from exc
        if code in (400, 401, 403):
            raise PushRejected() from exc
        raise
