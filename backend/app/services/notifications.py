"""알림 하나를 웹 안 알림(목록·배지)과 기기 푸시로 같이 보낸다.

notify 는 알림 행만 만들고(부르는 쪽 트랜잭션 안), 푸시는 커밋된 뒤 send_pending_pushes 가 보낸다. 그래서 푸시가
실패하거나 서버가 그 사이 꺼져도 목록에는 남고, 다음 틱에 남은 푸시를 보낸다.
"""
import logging
import time
from collections.abc import Callable
from datetime import datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import Member, MemberRole, Notification, PushStatus, PushSubscription, User
from app.services import lifecycle, messages, push

logger = logging.getLogger(__name__)

PUSH_BATCH = 100
PUSH_MAX_ATTEMPTS = 3
# 보내는 중 표시(pushed_at)가 이만큼 지나면 그 프로세스가 죽은 것으로 보고 다시 보낸다.
PUSH_LEASE = timedelta(minutes=5)
# 틱 하나가 푸시에 쓰는 시간. 넘기면 나머지는 다음 틱으로 미뤄 시계 판정을 늦추지 않는다.
PUSH_TICK_SECONDS = 30
MAX_SUBSCRIPTIONS_PER_USER = 10


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
) -> Notification | None:
    """다른 작업이 부르는 입구. dedupe_key 가 같은 알림이 이미 있으면 새로 만들지 않고 그것을 돌려준다.
    탈퇴한 팀원에게는 알리지 않고 None 을 돌려준다."""
    if dedupe_key is not None:
        existing = _by_dedupe_key(db, dedupe_key)
        if existing is not None:
            return existing
    member = db.get(Member, member_id)
    if member.is_deleted:
        return None
    notification = Notification(
        workspace_id=member.workspace_id, member_id=member_id, kind=kind, text=text,
        link_type=link_type, link_id=link_id, dedupe_key=dedupe_key,
        push_status=PushStatus.PENDING, created_at=messages.utc(now),
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
    dedupe_key: str | None = None, exclude: str | None = None,
) -> list[Notification]:
    """워크스페이스의 PM 모두에게 알린다. exclude 는 뺄 팀원이다. dedupe_key 는 PM 마다 따로 붙는다."""
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
        for pm in pms if pm.member_id != exclude
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
        notification.read_at = messages.utc(now)
        db.flush()
    return notification


def subscribe(db: Session, *, user_id: str, endpoint: str, p256dh: str, auth: str, now: datetime) -> PushSubscription:
    """같은 브라우저가 다시 등록하면 키를 바꾸고, 다른 계정으로 로그인했으면 그 계정으로 옮긴다."""
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
    if sub is None:
        sub = PushSubscription(user_id=user_id, endpoint=endpoint, p256dh=p256dh, auth=auth, created_at=messages.utc(now))
        try:
            with db.begin_nested():
                db.add(sub)
        except IntegrityError:
            # 같은 브라우저의 등록이 동시에 들어왔다.
            sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
    sub.user_id, sub.p256dh, sub.auth = user_id, p256dh, auth
    db.flush()
    _drop_oldest_subscriptions(db, user_id)
    return sub


def _drop_oldest_subscriptions(db: Session, user_id: str) -> None:
    extra = db.scalars(
        select(PushSubscription)
        .where(PushSubscription.user_id == user_id)
        .order_by(PushSubscription.created_at.desc(), PushSubscription.subscription_id)
        .offset(MAX_SUBSCRIPTIONS_PER_USER)
    ).all()
    for sub in extra:
        db.delete(sub)
    db.flush()


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
    db: Session, *, now: datetime, send: Callable[[PushSubscription, dict], None] | None
) -> int:
    """아직 푸시를 안 보낸 알림을 받는 사람 기기 모두로 보낸다. 다룬 알림 수를 돌려준다.

    대상을 표시해 커밋한 뒤 잠금 밖에서 보내고 결과만 짧게 쓴다. 느린 기기가 읽음 표시를 막지 않게 하려는 것이다.
    한 기기에도 못 보냈고 일시 오류가 있었으면 다음 틱에 다시 보낸다(최대 PUSH_MAX_ATTEMPTS 번). 한 기기라도
    받았으면 다시 보내지 않는다. send 가 None 이면 서버에 푸시 키가 없는 것이라 보내지 않고 건너뛴다.
    """
    db.info["read_only_request"] = False
    now = messages.utc(now)
    work = _claim_pushes(db, now, send is not None)
    db.commit()
    give_up_at = time.monotonic() + PUSH_TICK_SECONDS
    for notification_id, body, subs in work:
        if time.monotonic() > give_up_at:
            current = db.get(Notification, notification_id, populate_existing=True)
            if current is not None:
                current.pushed_at = None
            db.commit()
            continue
        delivered = failed = rejected = False
        gone = []
        for sub in subs:
            user_id = db.scalar(select(PushSubscription.user_id).where(PushSubscription.subscription_id == sub.subscription_id))
            if user_id is None or db.scalar(select(User.user_id).where(User.user_id == user_id)) is None:
                continue
            try:
                lifecycle.user(db, user_id)
            except AppError:
                continue
            current = db.get(Notification, notification_id, populate_existing=True)
            if current is None or db.get(PushSubscription, sub.subscription_id, populate_existing=True) is None:
                continue
            try:
                lifecycle.workspace(db, current.workspace_id, check_epoch=False)
            except AppError:
                continue
            current = db.get(Notification, notification_id, populate_existing=True)
            if current is None:
                continue
            try:
                send(sub, payload(current))
                delivered = True
            except push.PushGone:
                gone.append(sub.subscription_id)
            except push.PushRejected:
                logger.warning("push rejected", exc_info=True)
                rejected = True
            except Exception:
                logger.warning("push failed", exc_info=True)
                failed = True
        _record_push(
            db, notification_id, delivered=delivered, failed=failed, rejected=rejected, gone=gone, now=now,
        )
        db.commit()
    return len(work)


def _claim_pushes(db: Session, now: datetime, can_send: bool) -> list[tuple[str, dict, list[PushSubscription]]]:
    pending = db.scalars(
        select(Notification)
        .where(
            Notification.push_status == PushStatus.PENDING,
            or_(Notification.pushed_at.is_(None), Notification.pushed_at < now - PUSH_LEASE),
        )
        .order_by(Notification.created_at, Notification.notification_id)
        .limit(PUSH_BATCH)
        .with_for_update(skip_locked=True)
    ).all()
    work = []
    for notification in pending:
        notification.pushed_at = now
        user_id = None if notification.member.is_deleted else notification.member.user_id
        subs = [] if user_id is None or not can_send else db.scalars(
            select(PushSubscription).where(PushSubscription.user_id == user_id).order_by(PushSubscription.created_at)
        ).all()
        # 커밋 뒤에도 쓰도록 세션 밖 사본으로 넘긴다.
        copies = [
            PushSubscription(subscription_id=s.subscription_id, endpoint=s.endpoint, p256dh=s.p256dh, auth=s.auth)
            for s in subs
        ]
        work.append((notification.notification_id, payload(notification), copies))
    db.flush()
    return work


def _record_push(
    db: Session, notification_id: str, *, delivered: bool, failed: bool, rejected: bool, gone: list[str], now: datetime
) -> None:
    notification = db.get(Notification, notification_id, populate_existing=True)
    if notification is None:
        return
    for subscription_id in gone:
        sub = db.get(PushSubscription, subscription_id)
        if sub is not None:
            db.delete(sub)
    notification.push_attempts += 1
    notification.pushed_at = now
    if delivered:
        notification.push_status = PushStatus.SENT
    elif not failed:
        notification.push_status = PushStatus.FAILED if rejected else PushStatus.SKIPPED
    elif notification.push_attempts >= PUSH_MAX_ATTEMPTS:
        notification.push_status = PushStatus.FAILED
    else:
        notification.pushed_at = None  # 다음 틱에 다시 보낸다
    db.flush()
