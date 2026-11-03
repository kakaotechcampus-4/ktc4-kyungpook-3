"""알림 하나를 웹 안 알림(목록·배지)과 기기 푸시로 같이 보낸다.

notify 는 알림 행만 만들고(부르는 쪽 트랜잭션 안), 푸시는 커밋된 뒤 send_pending_pushes 가 보낸다. 그래서 푸시가
실패하거나 서버가 그 사이 꺼져도 목록에는 남고, 다음 틱에 남은 푸시를 보낸다.
"""
import logging
from collections.abc import Callable
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import Member, MemberRole, Notification, PushStatus, PushSubscription
from app.services import push
from app.services.messages import utc

logger = logging.getLogger(__name__)

PUSH_BATCH = 100


def notify(
    db: Session,
    *,
    member_id: str,
    kind: str,
    text: str,
    link_type: str,
    link_id: str,
    now: datetime,
    dedupe_key: str | None = None,
) -> Notification:
    """다른 작업이 부르는 입구. dedupe_key 가 같은 알림이 이미 있으면 새로 만들지 않고 그것을 돌려준다."""
    if dedupe_key is not None:
        existing = _by_dedupe_key(db, dedupe_key)
        if existing is not None:
            return existing
    member = db.get(Member, member_id)
    notification = Notification(
        workspace_id=member.workspace_id, member_id=member_id, kind=kind, text=text,
        link_type=link_type, link_id=link_id, dedupe_key=dedupe_key,
        push_status=PushStatus.PENDING, created_at=utc(now),
    )
    try:
        with db.begin_nested():
            db.add(notification)
    except IntegrityError:
        # 같은 일을 다른 프로세스가 먼저 알렸다.
        return _by_dedupe_key(db, dedupe_key)
    return notification


def notify_pms(
    db: Session, *, workspace_id: str, kind: str, text: str, link_type: str, link_id: str, now: datetime,
    dedupe_key: str | None = None,
) -> list[Notification]:
    """워크스페이스의 PM 모두에게 알린다. dedupe_key 는 PM 마다 따로 붙는다."""
    pms = db.scalars(
        select(Member).where(
            Member.workspace_id == workspace_id, Member.role == MemberRole.PM, Member.is_deleted.is_(False)
        ).order_by(Member.created_at, Member.member_id)
    ).all()
    return [
        notify(
            db, member_id=pm.member_id, kind=kind, text=text, link_type=link_type, link_id=link_id, now=now,
            dedupe_key=None if dedupe_key is None else f"{dedupe_key}:{pm.member_id}",
        )
        for pm in pms
    ]


def _by_dedupe_key(db: Session, dedupe_key: str) -> Notification | None:
    db.flush()
    return db.scalar(select(Notification).where(Notification.dedupe_key == dedupe_key))


def list_for_member(db: Session, member: Member, *, limit: int) -> list[Notification]:
    return list(db.scalars(
        select(Notification)
        .where(Notification.member_id == member.member_id)
        .order_by(Notification.created_at.desc(), Notification.notification_id)
        .limit(limit)
    ).all())


def unread_count(db: Session, member: Member) -> int:
    return db.scalar(
        select(func.count()).select_from(Notification)
        .where(Notification.member_id == member.member_id, Notification.read_at.is_(None))
    )


def mark_read(db: Session, member: Member, notification_id: str, *, now: datetime) -> Notification:
    notification = db.get(Notification, notification_id)
    if notification is None or notification.member_id != member.member_id:
        raise AppError(ErrorCode.NOTIFICATION_NOT_FOUND, details={"notification_id": notification_id})
    if notification.read_at is None:
        notification.read_at = utc(now)
        db.flush()
    return notification


def subscribe(db: Session, *, user_id: str, endpoint: str, p256dh: str, auth: str, now: datetime) -> PushSubscription:
    """같은 브라우저가 다시 등록하면 키를 바꾸고, 다른 계정으로 로그인했으면 그 계정으로 옮긴다."""
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
    if sub is None:
        sub = PushSubscription(user_id=user_id, endpoint=endpoint, p256dh=p256dh, auth=auth, created_at=utc(now))
        db.add(sub)
    else:
        sub.user_id, sub.p256dh, sub.auth = user_id, p256dh, auth
    db.flush()
    return sub


def unsubscribe(db: Session, *, user_id: str, endpoint: str) -> None:
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
    if sub is not None and sub.user_id == user_id:
        db.delete(sub)
        db.flush()


def payload(notification: Notification) -> dict:
    """서비스 워커가 받는 푸시 내용. 계약 문서의 푸시 payload 와 같다."""
    return {
        "notification_id": notification.notification_id,
        "workspace_id": notification.workspace_id,
        "kind": notification.kind,
        "text": notification.text,
        "link": {"type": notification.link_type, "id": notification.link_id},
    }


def send_pending_pushes(
    db: Session, *, now: datetime, send: Callable[[PushSubscription, dict], None] = push.send
) -> int:
    """아직 푸시를 안 보낸 알림을 받는 사람 기기 모두로 보낸다. 한 번만 시도한다. 보낸 알림 수를 돌려준다."""
    now = utc(now)
    pending = db.scalars(
        select(Notification)
        .where(Notification.push_status == PushStatus.PENDING)
        .order_by(Notification.created_at, Notification.notification_id)
        .limit(PUSH_BATCH)
        .with_for_update(skip_locked=True)
    ).all()
    for notification in pending:
        user_id = notification.member.user_id
        subs = [] if user_id is None else list(db.scalars(
            select(PushSubscription).where(PushSubscription.user_id == user_id).order_by(PushSubscription.created_at)
        ).all())
        delivered = failed = False
        for sub in subs:
            try:
                send(sub, payload(notification))
                delivered = True
            except push.PushGone:
                db.delete(sub)
            except Exception:
                logger.warning("push failed", exc_info=True)
                failed = True
        notification.push_status = (
            PushStatus.SENT if delivered else PushStatus.FAILED if failed else PushStatus.SKIPPED
        )
        notification.pushed_at = now
    db.flush()
    return len(pending)
