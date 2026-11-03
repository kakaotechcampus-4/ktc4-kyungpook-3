"""리마인드와 대화 메시지의 상태 전이.

라우트와 앞으로 붙을 스케줄러가 같은 함수를 부른다. 시각(now)은 부르는 쪽이 넘기고, 함수는 flush 까지만 하며
commit 은 부르는 쪽 몫이다. 시각은 UTC 로 바꿔 저장한다. sqlite 는 시간대를 떼고 저장하므로 비교가 어긋나지 않게
들어오는 값을 모두 UTC 로 맞춘다.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import (
    DmFailureReason,
    DmStatus,
    Member,
    MessageSender,
    MessageThread,
    Reminder,
    ReminderKind,
    ReminderOrigin,
    ReminderStatus,
    ReplyChannel,
    Task,
    ThreadMessage,
)

# 봇이 가져간 뒤 결과 보고가 이 시간 안에 없으면 못 보냄(알 수 없음)으로 닫는다. 다시 주지 않는다(최대 한 번).
CLAIM_TIMEOUT = timedelta(minutes=10)

_S = ReminderStatus
# 리마인드 동작이 어느 상태에서 가능한지와 끝난 뒤 상태. 목표 상태가 None 이면 상태는 그대로다.
_TRANSITIONS: dict[str, tuple[frozenset[ReminderStatus], ReminderStatus | None]] = {
    "edit": (frozenset({_S.SCHEDULED}), None),
    "approve": (frozenset({_S.SCHEDULED}), None),
    "cancel": (frozenset({_S.SCHEDULED}), _S.CANCELLED),
    "expire": (frozenset({_S.SCHEDULED}), _S.EXPIRED),
    "send": (frozenset({_S.SCHEDULED}), _S.SENT),
}


def utc(value: datetime) -> datetime:
    """시간대 없는 값(sqlite 가 돌려준 값)은 UTC 로 보고, 있는 값은 UTC 로 바꾼다."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _transition(reminder: Reminder, action: str) -> None:
    allowed_from, target = _TRANSITIONS[action]
    if reminder.status not in allowed_from:
        raise AppError(
            ErrorCode.REMINDER_NOT_EDITABLE,
            details={"reminder_id": reminder.reminder_id, "status": str(reminder.status)},
        )
    if target is not None:
        reminder.status = target


def _require_future(scheduled_at: datetime, now: datetime) -> None:
    if scheduled_at <= now:
        raise AppError(ErrorCode.REMINDER_SCHEDULED_AT_PASSED)


def get_or_create_thread(db: Session, workspace_id: str, member_id: str) -> MessageThread:
    thread = db.scalar(
        select(MessageThread).where(
            MessageThread.workspace_id == workspace_id, MessageThread.member_id == member_id
        )
    )
    if thread is None:
        thread = MessageThread(workspace_id=workspace_id, member_id=member_id)
        db.add(thread)
        db.flush()
    return thread


def get_reminder(db: Session, workspace_id: str, reminder_id: str) -> Reminder:
    """다른 워크스페이스의 리마인드는 없는 것으로 본다. 상태를 바꾸는 쪽이 부르므로 행을 잠근다."""
    reminder = db.get(Reminder, reminder_id, with_for_update=True)
    if reminder is None or reminder.workspace_id != workspace_id:
        raise AppError(ErrorCode.REMINDER_NOT_FOUND, details={"reminder_id": reminder_id})
    return reminder


def create_reminder(
    db: Session,
    *,
    workspace_id: str,
    task_id: str,
    member_id: str,
    body: str,
    scheduled_at: datetime,
    created_by: str | None,
    now: datetime,
    origin: ReminderOrigin = ReminderOrigin.PM,
) -> Reminder:
    now, scheduled_at = utc(now), utc(scheduled_at)
    task = db.get(Task, task_id)
    if task is None or task.workspace_id != workspace_id or task.is_deleted:
        raise AppError(ErrorCode.TASK_NOT_FOUND, details={"task_id": task_id})
    member = db.get(Member, member_id)
    if member is None or member.workspace_id != workspace_id or member.is_deleted:
        raise AppError(ErrorCode.MEMBER_NOT_FOUND, details={"member_id": member_id})
    _require_future(scheduled_at, now)

    thread = get_or_create_thread(db, workspace_id, member_id)
    reminder = Reminder(
        workspace_id=workspace_id, thread_id=thread.thread_id, task_id=task_id, kind=ReminderKind.NUDGE,
        origin=origin, created_by=created_by, body=body, scheduled_at=scheduled_at,
        created_at=now, updated_at=now,
    )
    db.add(reminder)
    db.flush()
    return reminder


def edit_reminder(
    db: Session, reminder: Reminder, *, body: str | None, scheduled_at: datetime | None, now: datetime
) -> Reminder:
    """문구나 시각을 고친다. 승인은 그대로 유지한다."""
    now = utc(now)
    _transition(reminder, "edit")
    if scheduled_at is not None:
        scheduled_at = utc(scheduled_at)
        _require_future(scheduled_at, now)
        reminder.scheduled_at = scheduled_at
    if body is not None:
        reminder.body = body
    reminder.updated_at = now
    db.flush()
    return reminder


def approve_reminder(db: Session, reminder: Reminder, *, approved_by: str | None, now: datetime) -> Reminder:
    now = utc(now)
    _transition(reminder, "approve")
    if reminder.approved_at is not None:
        return reminder
    _require_future(utc(reminder.scheduled_at), now)
    reminder.approved_at = now
    reminder.approved_by = approved_by
    reminder.updated_at = now
    db.flush()
    return reminder


def cancel_reminder(db: Session, reminder: Reminder, *, now: datetime) -> Reminder:
    now = utc(now)
    _transition(reminder, "cancel")
    reminder.cancelled_at = now
    reminder.updated_at = now
    db.flush()
    return reminder


def expire_reminder(db: Session, reminder_id: str, now: datetime) -> Reminder:
    """놓친 예약을 만료로 닫는다. 라우트는 없고 스케줄러가 부른다."""
    now = utc(now)
    reminder = db.get(Reminder, reminder_id, with_for_update=True)
    if reminder is None:
        raise AppError(ErrorCode.REMINDER_NOT_FOUND, details={"reminder_id": reminder_id})
    _transition(reminder, "expire")
    reminder.expired_at = now
    reminder.updated_at = now
    db.flush()
    return reminder


def dispatch_due(db: Session, now: datetime) -> list[ThreadMessage]:
    """승인됐고 발송 시각이 된 리마인드를 (대화, 발송 시각)이 같은 것끼리 봇 메시지 한 통으로 합친다."""
    now = utc(now)
    due = db.scalars(
        select(Reminder)
        .where(
            Reminder.status == ReminderStatus.SCHEDULED,
            Reminder.approved_at.is_not(None),
            Reminder.message_id.is_(None),
            Reminder.scheduled_at <= now,
        )
        .order_by(Reminder.created_at, Reminder.reminder_id)
        .with_for_update(skip_locked=True)
    ).all()

    groups: dict[tuple[str, datetime], list[Reminder]] = {}
    for reminder in due:
        groups.setdefault((reminder.thread_id, utc(reminder.scheduled_at)), []).append(reminder)

    messages = []
    for (thread_id, scheduled_at), reminders in groups.items():
        member = db.get(MessageThread, thread_id).member
        linked = bool(member.discord_user_id) and not member.is_deleted
        message = ThreadMessage(
            thread_id=thread_id,
            sender=MessageSender.BOT,
            body="\n\n".join(r.body for r in reminders),
            created_at=now,
            scheduled_at=scheduled_at,
            dm_status=DmStatus.PENDING if linked else DmStatus.FAILED,
            dm_failure_reason=None if linked else DmFailureReason.DISCORD_NOT_LINKED,
        )
        db.add(message)
        db.flush()
        for reminder in reminders:
            _transition(reminder, "send")
            reminder.message_id = message.message_id
            reminder.updated_at = now
        messages.append(message)
    db.flush()
    return messages


@dataclass
class ClaimedMessage:
    message: ThreadMessage
    workspace_id: str
    member_id: str
    discord_user_id: str


def claim_for_bot(db: Session, now: datetime) -> list[ClaimedMessage]:
    """봇이 보낼 메시지를 가져간다. 한 번 가져간 메시지는 다시 주지 않는다."""
    now = utc(now)
    dispatch_due(db, now)

    stale = db.scalars(
        select(ThreadMessage)
        .where(
            ThreadMessage.sender == MessageSender.BOT,
            ThreadMessage.dm_status == DmStatus.CLAIMED,
            ThreadMessage.claimed_at < now - CLAIM_TIMEOUT,
        )
        .with_for_update(skip_locked=True)
    ).all()
    for message in stale:
        message.dm_status = DmStatus.FAILED
        message.dm_failure_reason = DmFailureReason.UNKNOWN

    pending = db.scalars(
        select(ThreadMessage)
        .where(ThreadMessage.sender == MessageSender.BOT, ThreadMessage.dm_status == DmStatus.PENDING)
        .order_by(ThreadMessage.created_at, ThreadMessage.message_id)
        .with_for_update(skip_locked=True)
    ).all()
    claimed = []
    for message in pending:
        message.dm_status = DmStatus.CLAIMED
        message.claimed_at = now
        member = message.thread.member
        claimed.append(ClaimedMessage(message, message.thread.workspace_id, member.member_id, member.discord_user_id))
    db.flush()
    return claimed


def report_result(
    db: Session,
    message_id: str,
    *,
    delivered: bool,
    failure_reason: DmFailureReason | None,
    now: datetime,
) -> ThreadMessage:
    """봇의 발송 결과. 가져간 메시지에만 받는다. 시간 초과로 닫힌 메시지는 늦은 보고가 실제 결과로 덮어쓴다."""
    now = utc(now)
    message = db.get(ThreadMessage, message_id, with_for_update=True)
    if message is None or message.sender != MessageSender.BOT:
        raise AppError(ErrorCode.MESSAGE_NOT_FOUND, details={"message_id": message_id})
    if not delivered and failure_reason in (None, DmFailureReason.DISCORD_NOT_LINKED):
        raise AppError(ErrorCode.INVALID_REQUEST, message="실패 사유는 dm_blocked 또는 unknown 이어야 합니다.")

    status = DmStatus.DELIVERED if delivered else DmStatus.FAILED
    reason = None if delivered else failure_reason
    if message.dm_reported_at is not None:
        if (message.dm_status, message.dm_failure_reason) == (status, reason):
            return message
        raise AppError(ErrorCode.MESSAGE_RESULT_CONFLICT, details={"message_id": message_id})

    timed_out = (
        message.dm_status == DmStatus.FAILED
        and message.dm_failure_reason == DmFailureReason.UNKNOWN
        and message.claimed_at is not None
    )
    if message.dm_status != DmStatus.CLAIMED and not timed_out:
        raise AppError(ErrorCode.MESSAGE_RESULT_CONFLICT, details={"message_id": message_id})
    message.dm_status = status
    message.dm_failure_reason = reason
    message.dm_reported_at = now
    db.flush()
    return message


def ingest_discord_reply(
    db: Session,
    *,
    discord_user_id: str,
    discord_message_id: str,
    body: str,
    sent_at: datetime,
    now: datetime,
) -> tuple[ThreadMessage, bool]:
    """봇 DM 창에 온 팀원의 글을 대화에 넣는다. 리마인드에 대한 답인지 가리지 않고 전부 저장한다.

    돌려주는 bool 은 새로 저장했는지다. 같은 디스코드 메시지 id 는 한 번만 저장한다.
    """
    now, sent_at = utc(now), utc(sent_at)
    existing = _message_by_discord_id(db, discord_message_id)
    if existing is not None:
        return existing, False

    member = _pick_member_for_discord_user(db, discord_user_id)
    thread = get_or_create_thread(db, member.workspace_id, member.member_id)
    message = ThreadMessage(
        thread_id=thread.thread_id, sender=MessageSender.MEMBER, body=body,
        reply_channel=ReplyChannel.DISCORD, discord_message_id=discord_message_id,
        created_at=min(sent_at, now), received_at=now,
    )
    try:
        with db.begin_nested():
            db.add(message)
    except IntegrityError:
        # 같은 id 가 동시에 들어와 다른 요청이 먼저 저장했다.
        return _message_by_discord_id(db, discord_message_id), False
    return message, True


def _message_by_discord_id(db: Session, discord_message_id: str) -> ThreadMessage | None:
    return db.scalar(select(ThreadMessage).where(ThreadMessage.discord_message_id == discord_message_id))


def _pick_member_for_discord_user(db: Session, discord_user_id: str) -> Member:
    """같은 디스코드 계정이 여러 워크스페이스에 있으면 봇이 가장 최근에 말을 건 쪽, 없으면 가장 나중에 만든 팀원."""
    members = db.scalars(
        select(Member).where(Member.discord_user_id == discord_user_id, Member.is_deleted.is_(False))
    ).all()
    if not members:
        raise AppError(ErrorCode.MEMBER_NOT_FOUND, details={"discord_user_id": discord_user_id})
    if len(members) == 1:
        return members[0]
    last_bot = dict(
        db.execute(
            select(MessageThread.member_id, func.max(ThreadMessage.created_at))
            .join(ThreadMessage, ThreadMessage.thread_id == MessageThread.thread_id)
            .where(
                MessageThread.member_id.in_([m.member_id for m in members]),
                ThreadMessage.sender == MessageSender.BOT,
            )
            .group_by(MessageThread.member_id)
        ).all()
    )
    floor = datetime.min.replace(tzinfo=timezone.utc)
    return max(
        members,
        key=lambda m: (
            utc(last_bot[m.member_id]) if m.member_id in last_bot else floor,
            utc(m.created_at),
        ),
    )


def add_web_reply(db: Session, thread: MessageThread, *, body: str, now: datetime) -> ThreadMessage:
    now = utc(now)
    message = ThreadMessage(
        thread_id=thread.thread_id, sender=MessageSender.MEMBER, body=body,
        reply_channel=ReplyChannel.WEB, created_at=now, received_at=now,
    )
    db.add(message)
    db.flush()
    return message
