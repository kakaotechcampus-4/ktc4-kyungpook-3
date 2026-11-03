"""웹 안 알림(내 알림 목록·안 읽은 수·읽음)과 브라우저 푸시 구독."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_member, get_current_user
from app.core.database import get_db
from app.core.errors import Envelope, success
from app.models import Member, Notification, User
from app.schemas.notification import (
    NotificationListResponse,
    NotificationResponse,
    PushSubscribeRequest,
    PushUnsubscribeRequest,
    VapidKeyResponse,
)
from app.services import notifications as svc
from app.services import push

router = APIRouter(prefix="/workspaces/{workspace_id}/notifications", tags=["notifications"])
push_router = APIRouter(prefix="/push", tags=["push"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _dict(n: Notification) -> dict:
    return NotificationResponse(
        notification_id=n.notification_id, kind=n.kind, text=n.text,
        link={"type": n.link_type, "id": n.link_id}, read_at=n.read_at, created_at=n.created_at,
    ).model_dump(mode="json")


@router.get("", response_model=Envelope[NotificationListResponse])
def list_notifications(
    workspace_id: str,
    limit: int = Query(50, ge=1, le=200),
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> dict:
    """이 워크스페이스에서 나에게 온 알림. 최근 것부터. unread_count 는 배지 숫자다."""
    items = svc.list_for_member(db, member, limit=limit)
    return success({"items": [_dict(n) for n in items], "unread_count": svc.unread_count(db, member)})


@router.post("/{notification_id}/read", response_model=Envelope[NotificationResponse])
def read_notification(
    workspace_id: str,
    notification_id: str,
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> dict:
    notification = svc.mark_read(db, member, notification_id, now=_now())
    db.commit()
    return success(_dict(notification))


@push_router.get("/vapid-public-key", response_model=Envelope[VapidKeyResponse])
def vapid_public_key(_user: User = Depends(get_current_user)) -> dict:
    """브라우저가 구독할 때 쓰는 서버 공개키. 서버에 키가 없으면 null 이고, 그때는 웹 안 알림만 쓴다."""
    return success({"public_key": push.public_key()})


@push_router.post("/subscriptions", status_code=201)
def subscribe(
    payload: PushSubscribeRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    svc.subscribe(
        db, user_id=user.user_id, endpoint=payload.endpoint, p256dh=payload.keys.p256dh,
        auth=payload.keys.auth, now=_now(),
    )
    db.commit()
    return success({"endpoint": payload.endpoint})


@push_router.delete("/subscriptions", status_code=204)
def unsubscribe(
    payload: PushUnsubscribeRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    svc.unsubscribe(db, user_id=user.user_id, endpoint=payload.endpoint)
    db.commit()
    return Response(status_code=204)
