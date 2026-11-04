"""리마인드, 보낼 메시지(묶음), 대화 메시지의 상태 전이.

라우트와 앞으로 붙을 스케줄러가 같은 함수를 부른다. 시각(now)은 부르는 쪽이 넘기고, 함수는 flush 까지만 하며
commit 은 부르는 쪽 몫이다. 시각은 UTC 로 바꿔 저장한다. sqlite 는 시간대를 떼고 저장하므로 비교가 어긋나지 않게
들어오는 값을 모두 UTC 로 맞춘다. 앱 세션은 autoflush 를 끄므로 조회 전에 직접 flush 한다.

같은 대화·같은 발송 시각의 예정 리마인드는 언제나 묶음 하나에 들어 있다. PM 은 묶음 문구를 보고 고치고 승인한다.
묶음 구성이 바뀌면 _rebuild 가 규칙 문구로 다시 만들고 승인을 풀며, AI 초안은 그 뒤 비어 있는 자리에 들어온다.

봇 이름으로 온 DM 만으로는 누가 보낸 연락인지 모르므로, 규칙 문구·메모·AI 초안은 가운데에 두고 BE 가 앞뒤 틀을
씌워 저장한다. 그 대화에 나간(delivered) 봇 DM 이 없으면 PM 소개와 맺음을, 있으면 PM 이름만 붙인다. PM 이 고친
문구는 보이는 전체를 고친 것이라 틀을 다시 씌우지 않는다.
"""
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import (
    BodySource,
    BotDmPart,
    DmFailureReason,
    DmStatus,
    DraftStatus,
    Member,
    MemberRole,
    MessageSender,
    MessageThread,
    Reminder,
    ReminderBundle,
    ReminderKind,
    ReminderOrigin,
    ReminderStatus,
    ReplyChannel,
    Task,
    ThreadMessage,
    Workspace,
    WorkspaceMessageSettings,
)
from app.services import scheduler

# 봇이 가져간 뒤 결과 보고가 이 시간 안에 없으면 못 보냄(알 수 없음)으로 닫는다. 다시 주지 않는다(최대 한 번).
CLAIM_TIMEOUT = timedelta(minutes=10)
# 초안은 다시 써도 해가 없으므로, 맡긴 뒤 이 시간 안에 안 돌아오면 다시 맡긴다.
DRAFT_CLAIM_TIMEOUT = timedelta(minutes=10)
STYLE_EXAMPLE_LIMIT = 5
# 디스코드 DM 한 통의 한도. 초안은 틀을 씌운 전체가 이 안이어야 한다.
DRAFT_MAX_LENGTH = 2000
# 디스코드 메시지 id(snowflake)는 앞 비트에 이 기준 이후 ms 를 담는다.
DISCORD_EPOCH_MS = 1420070400000
_WEEKDAYS = "월화수목금토일"

_S = ReminderStatus
# 리마인드와 묶음의 동작이 어느 상태에서 가능한지와 끝난 뒤 상태. 목표 상태가 None 이면 상태는 그대로다.
_TRANSITIONS: dict[str, tuple[frozenset[ReminderStatus], ReminderStatus | None]] = {
    "edit": (frozenset({_S.SCHEDULED}), None),
    "approve": (frozenset({_S.SCHEDULED}), None),
    "cancel": (frozenset({_S.SCHEDULED}), _S.CANCELLED),
    "expire": (frozenset({_S.SCHEDULED}), _S.EXPIRED),
    "send": (frozenset({_S.SCHEDULED}), _S.SENT),
}

# PATCH 에서 note 를 보내지 않은 것과 null 로 지운 것을 가른다.
KEEP = object()


def utc(value: datetime) -> datetime:
    """시간대 없는 값(sqlite 가 돌려준 값)은 UTC 로 보고, 있는 값은 UTC 로 바꾼다."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _transition(obj: Reminder | ReminderBundle, action: str) -> None:
    allowed_from, target = _TRANSITIONS[action]
    if obj.status not in allowed_from:
        key = "bundle_id" if isinstance(obj, ReminderBundle) else "reminder_id"
        raise AppError(
            ErrorCode.REMINDER_NOT_EDITABLE, details={key: getattr(obj, key), "status": str(obj.status)}
        )
    if target is not None:
        obj.status = target


def _require_future(scheduled_at: datetime, now: datetime) -> None:
    if scheduled_at <= now:
        raise AppError(ErrorCode.REMINDER_SCHEDULED_AT_PASSED)


def rule_line(title: str, due: date | None) -> str:
    """기본 페르소나의 규칙 문구(가운데). AI 초안이 없거나 쓸 수 없을 때 틀을 씌워 이대로 나간다."""
    if due is None:
        return f"'{title}' 진행 상황 한번 여쭤봐요.\n지금 어디까지 됐는지 편하게 알려 주세요!"
    when = f"{due.month}/{due.day}({_WEEKDAYS[due.weekday()]})"
    return f"'{title}' 마감이 {when}이라 한번 여쭤봐요.\n지금 어디까지 됐는지 편하게 알려 주세요!"


def _copula(name: str) -> str:
    """이름 뒤 '이에요/예요'. 마지막 글자가 한글이 아니면 받침을 알 수 없다."""
    last = name[-1:]
    if not "가" <= last <= "힣":
        return "(이)에요"
    return "이에요" if (ord(last) - ord("가")) % 28 else "예요"


def _pm_name(db: Session, workspace_id: str, created_by: str | None) -> str:
    """리마인드를 만든 PM, 없거나 탈퇴했으면 가장 먼저 등록된 PM, 그도 없으면 'PM'."""
    member = db.get(Member, created_by) if created_by else None
    if member is None or member.is_deleted:
        member = db.scalar(
            select(Member)
            .where(Member.workspace_id == workspace_id, Member.role == MemberRole.PM, Member.is_deleted.is_(False))
            .order_by(Member.created_at, Member.member_id)
            .limit(1)
        )
    return member.display_name if member is not None else "PM"


def _has_delivered_dm(db: Session, thread_id: str) -> bool:
    db.flush()
    return db.scalar(
        select(ThreadMessage.message_id)
        .where(
            ThreadMessage.thread_id == thread_id,
            ThreadMessage.sender == MessageSender.BOT,
            ThreadMessage.dm_status == DmStatus.DELIVERED,
        )
        .limit(1)
    ) is not None


def framed_body(
    db: Session, bundle: ReminderBundle, reminders: list[Reminder], middle: str, *, first: bool | None = None
) -> str:
    """가운데 문구에 첫 DM 이면 PM 소개와 맺음을, 아니면 PM 이름을 씌운다. PM 은 묶음의 첫 리마인드를 만든 사람이다.

    first 를 주지 않으면 그 대화에 나간 봇 DM 이 있는지로 정한다.
    """
    recipient = bundle.thread.member.display_name
    pm = _pm_name(db, bundle.workspace_id, reminders[0].created_by)
    if first is None:
        first = not _has_delivered_dm(db, bundle.thread_id)
    if not first:
        return f"{recipient}님, {pm}{_copula(pm)}.\n{middle}"
    workspace = db.get(Workspace, bundle.workspace_id).name
    return f"안녕하세요 {recipient}님, {workspace} {pm}{_copula(pm)}.\n{_first_dm_rest(middle)}"


FIRST_DM_GREETING = re.compile(r"안녕하세요 .+님, .+(?:이에요|예요|\(이\)에요)\.")


def _first_dm_rest(middle: str) -> str:
    """첫 DM 틀에서 이름이 든 첫 줄을 뺀 나머지."""
    return f"앞으로 확인용 메시지는 이 봇으로 보낼게요.\n\n{middle}\n여기로 답장하시면 저한테 바로 전달돼요."


def get_or_create_thread(db: Session, workspace_id: str, member_id: str) -> MessageThread:
    query = select(MessageThread).where(
        MessageThread.workspace_id == workspace_id, MessageThread.member_id == member_id
    )
    thread = db.scalar(query)
    if thread is not None:
        return thread
    try:
        with db.begin_nested():
            thread = MessageThread(workspace_id=workspace_id, member_id=member_id)
            db.add(thread)
    except IntegrityError:
        # 첫 DM 두 통이나 첫 리마인드가 겹쳐 다른 요청이 먼저 만들었다.
        return db.scalars(query).one()
    return thread


def _lock_thread(db: Session, thread_id: str) -> None:
    # PM 조작끼리만 줄 세운다. 발송은 묶음을 잠근 채 thread_message 를 넣고, 그 FK 검사가 대화 행에 KEY SHARE 를
    # 건다. FOR UPDATE 는 KEY SHARE 와 부딪혀 교착이 나므로 부딪히지 않는 FOR NO KEY UPDATE 로 잠근다.
    db.execute(
        select(MessageThread.thread_id).where(MessageThread.thread_id == thread_id).with_for_update(key_share=True)
    )


def bundle_reminders(db: Session, bundle_id: str, status: str = ReminderStatus.SCHEDULED) -> list[Reminder]:
    """묶음 안의 그 상태 리마인드. 취소면 묶음이 닫힐 때 같이 취소된 것만이다.

    먼저 뺀 리마인드도 취소 상태로 남는다. 묶음을 닫는 취소는 남은 리마인드에 같은 시각을 찍으므로,
    가장 늦은 cancelled_at 과 같은 것이 함께 취소된 리마인드다.
    """
    db.flush()
    stmt = select(Reminder).where(Reminder.bundle_id == bundle_id, Reminder.status == status)
    if status == ReminderStatus.CANCELLED:
        closed_at = select(func.max(Reminder.cancelled_at)).where(Reminder.bundle_id == bundle_id)
        stmt = stmt.where(Reminder.cancelled_at == closed_at.scalar_subquery())
    return list(db.scalars(stmt.order_by(Reminder.created_at, Reminder.reminder_id)).all())


def _bundle_at(db: Session, thread_id: str, scheduled_at: datetime) -> ReminderBundle | None:
    db.flush()
    return db.scalar(
        select(ReminderBundle)
        .where(
            ReminderBundle.thread_id == thread_id,
            ReminderBundle.scheduled_at == scheduled_at,
            ReminderBundle.status == ReminderStatus.SCHEDULED,
        )
        .with_for_update()
    )


def _slot_bundle(db: Session, thread: MessageThread, scheduled_at: datetime, now: datetime) -> ReminderBundle:
    """그 대화·시각의 예정 묶음. 없으면 만든다. 부르는 쪽이 대화를 잠근 뒤 부른다."""
    bundle = _bundle_at(db, thread.thread_id, scheduled_at)
    if bundle is None:
        bundle = ReminderBundle(
            workspace_id=thread.workspace_id, thread_id=thread.thread_id, scheduled_at=scheduled_at,
            status=ReminderStatus.SCHEDULED, body="", body_source=BodySource.RULE,
            draft_status=DraftStatus.NEEDED, draft_version=0, created_at=now, updated_at=now,
        )
        db.add(bundle)
        db.flush()
    return bundle


def _rebuild(db: Session, bundle: ReminderBundle, now: datetime, closing: str = "cancel") -> None:
    """묶음 구성이 바뀐 뒤 부른다. 문구를 규칙으로 다시 만들고 초안 판을 올리고 승인을 푼다.

    예정 리마인드가 하나도 남지 않으면 묶음을 닫는다(closing: cancel 또는 expire).
    """
    reminders = bundle_reminders(db, bundle.bundle_id)
    bundle.draft_version += 1
    bundle.draft_claimed_at = None
    bundle.approved_at = None
    bundle.approved_by = None
    bundle.updated_at = now
    if not reminders:
        _transition(bundle, closing)
    elif len(reminders) == 1 and reminders[0].note:
        bundle.body = framed_body(db, bundle, reminders, reminders[0].note)
        bundle.body_source, bundle.draft_status = BodySource.PM, DraftStatus.DONE
    else:
        bundle.body = framed_body(db, bundle, reminders, rule_middle(reminders))
        bundle.body_source, bundle.draft_status = BodySource.RULE, DraftStatus.NEEDED
    db.flush()


def rule_middle(reminders: list[Reminder]) -> str:
    return "\n\n".join(r.note or rule_line(r.task.title, r.task.due_date) for r in reminders)


def get_reminder(db: Session, workspace_id: str, reminder_id: str) -> Reminder:
    """다른 워크스페이스의 리마인드는 없는 것으로 본다. 상태를 바꾸는 쪽이 부르므로 대화부터 잠근다."""
    reminder = db.get(Reminder, reminder_id)
    if reminder is None or reminder.workspace_id != workspace_id:
        raise AppError(ErrorCode.REMINDER_NOT_FOUND, details={"reminder_id": reminder_id})
    return _lock_reminder(db, reminder)


def _lock_reminder(db: Session, reminder: Reminder) -> Reminder:
    _lock_thread(db, reminder.bundle.thread_id)
    # 대화를 잠근 뒤에야 묶음 이동이 멈추므로 그때의 묶음을 다시 읽는다.
    db.refresh(reminder)
    db.refresh(reminder.bundle, with_for_update=True)
    db.refresh(reminder, with_for_update=True)
    return reminder


def get_bundle(db: Session, workspace_id: str, bundle_id: str) -> ReminderBundle:
    bundle = db.get(ReminderBundle, bundle_id)
    if bundle is None or bundle.workspace_id != workspace_id:
        raise AppError(ErrorCode.REMINDER_BUNDLE_NOT_FOUND, details={"bundle_id": bundle_id})
    _lock_thread(db, bundle.thread_id)
    db.refresh(bundle, with_for_update=True)
    return bundle


def create_reminder(
    db: Session,
    *,
    workspace_id: str,
    task_id: str,
    member_id: str,
    scheduled_at: datetime,
    note: str | None,
    created_by: str | None,
    now: datetime,
    origin: ReminderOrigin = ReminderOrigin.PM,
) -> Reminder:
    """리마인드를 만들어 그 대화·시각의 묶음에 넣는다."""
    now, scheduled_at = utc(now), utc(scheduled_at)
    task = db.get(Task, task_id)
    if task is None or task.workspace_id != workspace_id or task.is_deleted:
        raise AppError(ErrorCode.TASK_NOT_FOUND, details={"task_id": task_id})
    member = db.get(Member, member_id)
    if member is None or member.workspace_id != workspace_id or member.is_deleted:
        raise AppError(ErrorCode.MEMBER_NOT_FOUND, details={"member_id": member_id})
    _require_future(scheduled_at, now)

    thread = get_or_create_thread(db, workspace_id, member_id)
    _lock_thread(db, thread.thread_id)
    bundle = _slot_bundle(db, thread, scheduled_at, now)
    # 만들기를 두 번 눌러도 한 묶음에 같은 태스크가 두 번 들어가 문구가 겹치지 않게 한다.
    for reminder in bundle_reminders(db, bundle.bundle_id):
        if reminder.task_id == task_id:
            return reminder
    reminder = Reminder(
        workspace_id=workspace_id, bundle=bundle, task_id=task_id, kind=ReminderKind.NUDGE,
        origin=origin, created_by=created_by, note=note, created_at=now, updated_at=now,
    )
    db.add(reminder)
    _rebuild(db, bundle, now)
    return reminder


def edit_reminder(
    db: Session, reminder: Reminder, *, now: datetime, note: object = KEEP, scheduled_at: datetime | None = None
) -> Reminder:
    """메모를 고치거나 다른 시각으로 옮긴다. 옮기면 그 시각의 묶음에 들어간다. 묶음 문구가 바뀌므로 승인이 풀린다."""
    now = utc(now)
    _transition(reminder, "edit")
    source = reminder.bundle
    target = source
    # 화면이 폼 전체를 보내면 바뀌지 않은 시각도 온다. 같은 시각이면 옮기는 것이 아니므로 미래 검사를 하지 않는다.
    if scheduled_at is not None and utc(scheduled_at) != utc(source.scheduled_at):
        scheduled_at = utc(scheduled_at)
        _require_future(scheduled_at, now)
        target = _slot_bundle(db, source.thread, scheduled_at, now)
    note_changed = note is not KEEP and note != reminder.note
    if note_changed:
        reminder.note = note
    reminder.bundle = target
    reminder.updated_at = now
    if target is not source:
        _rebuild(db, source, now)
        _rebuild(db, target, now)
    elif note_changed:
        _rebuild(db, source, now)
    return reminder


def cancel_reminder(db: Session, reminder: Reminder, *, now: datetime) -> Reminder:
    now = utc(now)
    _transition(reminder, "cancel")
    reminder.cancelled_at = now
    reminder.updated_at = now
    _rebuild(db, reminder.bundle, now)
    return reminder


def expire_reminder(db: Session, reminder_id: str, now: datetime) -> Reminder:
    """놓친 예약을 만료로 닫는다. 라우트는 없고 스케줄러가 부른다."""
    now = utc(now)
    reminder = db.get(Reminder, reminder_id)
    if reminder is None:
        raise AppError(ErrorCode.REMINDER_NOT_FOUND, details={"reminder_id": reminder_id})
    _lock_reminder(db, reminder)
    _transition(reminder, "expire")
    reminder.expired_at = now
    reminder.updated_at = now
    _rebuild(db, reminder.bundle, now, closing="expire")
    return reminder


def edit_bundle(
    db: Session, bundle: ReminderBundle, *, body: str | None, scheduled_at: datetime | None, now: datetime
) -> ReminderBundle:
    """PM 이 묶음 문구나 시각을 고친다. 승인은 유지한다.

    옮긴 시각에 이미 예정 묶음이 있으면 그쪽으로 합치고 합쳐진 묶음을 돌려준다. 합치면 구성이 바뀌므로
    문구를 다시 만들고 승인이 풀린다. 합쳐지면 같이 보낸 문구가 쓸 곳이 없으므로 그 조합은 400 으로 막는다.
    """
    now = utc(now)
    _transition(bundle, "edit")
    # 바뀌지 않은 시각은 보내지 않은 것으로 본다(edit_reminder 와 같은 까닭).
    if scheduled_at is not None and utc(scheduled_at) == utc(bundle.scheduled_at):
        scheduled_at = None
    if scheduled_at is not None:
        scheduled_at = utc(scheduled_at)
        _require_future(scheduled_at, now)
        if body is not None and _bundle_at(db, bundle.thread_id, scheduled_at) is not None:
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                message="다른 보낼 메시지와 합쳐지는 시각으로 옮길 때는 문구를 같이 고칠 수 없습니다. 시각부터 옮겨 주세요.",
            )
    if body is not None:
        bundle.body, bundle.body_source, bundle.draft_status = body, BodySource.PM, DraftStatus.DONE
        bundle.draft_version += 1
        bundle.draft_claimed_at = None
    bundle.updated_at = now
    if scheduled_at is None:
        db.flush()
        return bundle
    other = _bundle_at(db, bundle.thread_id, scheduled_at)
    if other is None:
        bundle.scheduled_at = scheduled_at
        db.flush()
        return bundle
    for reminder in bundle_reminders(db, bundle.bundle_id):
        reminder.bundle = other
        reminder.updated_at = now
    _rebuild(db, bundle, now)
    _rebuild(db, other, now)
    return other


def approve_bundle(
    db: Session, bundle: ReminderBundle, *, draft_version: int, approved_by: str | None, now: datetime
) -> ReminderBundle:
    """PM 이 보고 있는 문구 그대로 승인한다. 초안을 기다리는 중이어도 된다. 승인 뒤에는 AI 초안을 받지 않는다.

    draft_version 은 PM 화면의 판이다. 그 뒤 AI 초안이 들어왔거나 다른 PM 이 바꿨으면 본 적 없는 문구이므로 거절한다.
    """
    now = utc(now)
    _transition(bundle, "approve")
    if bundle.approved_at is not None:
        return bundle
    if draft_version != bundle.draft_version:
        raise AppError(
            ErrorCode.BUNDLE_CHANGED, details={"bundle_id": bundle.bundle_id, "draft_version": bundle.draft_version}
        )
    _require_future(utc(bundle.scheduled_at), now)
    bundle.approved_at = now
    bundle.approved_by = approved_by
    # 승인한 문구가 그대로 나가므로 오던 AI 초안은 더 받지 않는다. 화면에 초안 대기로 남지 않게 닫는다.
    bundle.draft_status = DraftStatus.DONE
    bundle.updated_at = now
    db.flush()
    return bundle


def cancel_bundle(db: Session, bundle: ReminderBundle, *, now: datetime) -> ReminderBundle:
    now = utc(now)
    reminders = bundle_reminders(db, bundle.bundle_id)
    _transition(bundle, "cancel")
    for reminder in reminders:
        _transition(reminder, "cancel")
        reminder.cancelled_at = now
        reminder.updated_at = now
    bundle.updated_at = now
    db.flush()
    return bundle


def _auto_approve_due(db: Session, now: datetime, exclude: list[str]) -> None:
    """자동 승인이 켜진 워크스페이스의 승인 전 묶음 중 켠 뒤에 시각이 된 것을 승인한다. 초안 버전·미래 시각은 보지 않는다."""
    bundles = db.scalars(
        select(ReminderBundle)
        .join(MessageThread, MessageThread.thread_id == ReminderBundle.thread_id)
        .join(
            WorkspaceMessageSettings,
            WorkspaceMessageSettings.workspace_id == MessageThread.workspace_id,
        )
        .where(
            ReminderBundle.status == ReminderStatus.SCHEDULED,
            ReminderBundle.approved_at.is_(None),
            ReminderBundle.scheduled_at <= now,
            ReminderBundle.bundle_id.notin_(exclude),
            WorkspaceMessageSettings.reminder_auto_approve.is_(True),
            ReminderBundle.scheduled_at >= WorkspaceMessageSettings.auto_approve_since,
        )
        .with_for_update(skip_locked=True, of=ReminderBundle)
    ).all()
    for bundle in bundles:
        bundle.approved_at = now
        bundle.approved_by = None
        # approve_bundle 과 같이 오던 AI 초안을 닫는다. 보낸 묶음이 초안 대기로 남지 않게 한다.
        bundle.draft_status = DraftStatus.DONE
        bundle.updated_at = now
    db.flush()


def dispatch_due(db: Session, now: datetime) -> list[ThreadMessage]:
    """승인됐고 발송 시각이 된 묶음마다 봇 메시지 한 통을 만든다. 문구는 묶음 문구 그대로다. 탈퇴한 팀원의 묶음은 취소한다."""
    now = utc(now)
    unchecked = scheduler.before_dispatch(db, now)
    _auto_approve_due(db, now, unchecked)
    due = db.scalars(
        select(ReminderBundle)
        .where(
            ReminderBundle.status == ReminderStatus.SCHEDULED,
            ReminderBundle.approved_at.is_not(None),
            ReminderBundle.scheduled_at <= now,
            ReminderBundle.bundle_id.notin_(unchecked),
        )
        .order_by(ReminderBundle.scheduled_at, ReminderBundle.created_at)
        .with_for_update(skip_locked=True)
    ).all()

    messages = []
    for bundle in due:
        member = bundle.thread.member
        if member.is_deleted:
            cancel_bundle(db, bundle, now=now)
            continue
        linked = bool(member.discord_user_id)
        message = ThreadMessage(
            thread_id=bundle.thread_id,
            sender=MessageSender.BOT,
            body=bundle.body,
            created_at=now,
            scheduled_at=utc(bundle.scheduled_at),
            dm_status=DmStatus.PENDING if linked else DmStatus.FAILED,
            dm_failure_reason=None if linked else DmFailureReason.DISCORD_NOT_LINKED,
        )
        db.add(message)
        db.flush()
        for reminder in bundle_reminders(db, bundle.bundle_id):
            _transition(reminder, "send")
            reminder.updated_at = now
        _transition(bundle, "send")
        bundle.message_id = message.message_id
        bundle.updated_at = now
        messages.append(message)
    db.flush()
    return messages


@dataclass
class DraftRequest:
    bundle: ReminderBundle
    recipient_name: str
    reminders: list[Reminder]
    style_examples: list[str]


def claim_drafts(db: Session, now: datetime) -> list[DraftRequest]:
    """AI 가 초안을 쓸 묶음을 맡긴다. 아직 승인 전이고 시각이 남은 묶음만 준다(지난 묶음은 승인할 수 없다)."""
    now = utc(now)
    bundles = db.scalars(
        select(ReminderBundle)
        .join(MessageThread, MessageThread.thread_id == ReminderBundle.thread_id)
        .join(Member, Member.member_id == MessageThread.member_id)
        .where(
            ReminderBundle.status == ReminderStatus.SCHEDULED,
            ReminderBundle.approved_at.is_(None),
            ReminderBundle.scheduled_at > now,
            Member.is_deleted.is_(False),
            or_(
                ReminderBundle.draft_status == DraftStatus.NEEDED,
                and_(
                    ReminderBundle.draft_status == DraftStatus.CLAIMED,
                    ReminderBundle.draft_claimed_at < now - DRAFT_CLAIM_TIMEOUT,
                ),
            ),
        )
        .order_by(ReminderBundle.scheduled_at, ReminderBundle.created_at)
        .with_for_update(skip_locked=True, of=ReminderBundle)
    ).all()
    examples: dict[str, list[str]] = {}
    claimed = []
    for bundle in bundles:
        bundle.draft_status = DraftStatus.CLAIMED
        bundle.draft_claimed_at = now
        bundle.updated_at = now
        if bundle.workspace_id not in examples:
            examples[bundle.workspace_id] = _style_examples(db, bundle.workspace_id)
        claimed.append(DraftRequest(
            bundle, bundle.thread.member.display_name, bundle_reminders(db, bundle.bundle_id),
            examples[bundle.workspace_id],
        ))
    db.flush()
    return claimed


def _style_examples(db: Session, workspace_id: str) -> list[str]:
    """PM 이 쓰거나 고쳐서 승인한 문구. 최근 것부터."""
    return list(db.scalars(
        select(ReminderBundle.body)
        .where(
            ReminderBundle.workspace_id == workspace_id,
            ReminderBundle.body_source == BodySource.PM,
            or_(
                ReminderBundle.status == ReminderStatus.SENT,
                and_(ReminderBundle.status == ReminderStatus.SCHEDULED, ReminderBundle.approved_at.is_not(None)),
            ),
        )
        .order_by(ReminderBundle.updated_at.desc(), ReminderBundle.bundle_id)
        .limit(STYLE_EXAMPLE_LIMIT)
    ).all())


def write_draft(
    db: Session, bundle_id: str, *, draft_version: int, body: str | None, now: datetime
) -> ReminderBundle:
    """AI 초안(가운데)에 틀을 씌워 넣는다. body 가 None 이면 AI 가 못 쓴 것이라 규칙 문구를 둔다.

    맡긴 뒤 구성이 바뀌었거나(판이 다름), 이미 승인·발송됐거나, PM 이 문구를 직접 쓴 묶음에는 넣지 않는다.
    """
    now = utc(now)
    bundle = db.get(ReminderBundle, bundle_id, with_for_update=True)
    if bundle is None:
        raise AppError(ErrorCode.REMINDER_BUNDLE_NOT_FOUND, details={"bundle_id": bundle_id})
    if (
        bundle.draft_version != draft_version
        or bundle.status != ReminderStatus.SCHEDULED
        or bundle.approved_at is not None
        or bundle.body_source == BodySource.PM
    ):
        raise AppError(
            ErrorCode.DRAFT_STALE,
            details={"bundle_id": bundle_id, "draft_version": bundle.draft_version, "status": str(bundle.status)},
        )
    if body is not None:
        framed = framed_body(db, bundle, bundle_reminders(db, bundle_id), body)
        if len(framed) > DRAFT_MAX_LENGTH:
            raise AppError(
                ErrorCode.INVALID_REQUEST, message=f"앞뒤 안내를 붙인 초안은 {DRAFT_MAX_LENGTH}자 이하여야 합니다."
            )
        bundle.body, bundle.body_source = framed, BodySource.AI
        bundle.draft_version += 1
    bundle.draft_status = DraftStatus.DONE
    bundle.updated_at = now
    db.flush()
    return bundle


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
    discord_message_ids: list[str],
    now: datetime,
) -> ThreadMessage:
    """봇의 발송 결과. 가져간 메시지에만 받는다. 시간 초과로 닫힌 메시지는 늦은 보고가 실제 결과로 덮어쓴다.

    discord_message_ids 는 실제로 나간 DM 들의 id 다. 답장의 워크스페이스를 찾는 데 쓴다.
    그 대화에 처음 나간 DM 이면, 첫 DM 틀로 만들어 둔 승인 전 규칙·AI 묶음을 두 번째 틀로 다시 만든다.
    """
    now = utc(now)
    message = db.get(ThreadMessage, message_id, with_for_update=True)
    if message is None or message.sender != MessageSender.BOT:
        raise AppError(ErrorCode.MESSAGE_NOT_FOUND, details={"message_id": message_id})
    if not delivered and failure_reason in (None, DmFailureReason.DISCORD_NOT_LINKED):
        raise AppError(ErrorCode.INVALID_REQUEST, message="실패 사유는 dm_blocked 또는 unknown 이어야 합니다.")

    ids = list(dict.fromkeys(discord_message_ids))
    status = DmStatus.DELIVERED if delivered else DmStatus.FAILED
    reason = None if delivered else failure_reason
    if message.dm_reported_at is not None:
        stored = set(db.scalars(select(BotDmPart.discord_message_id).where(BotDmPart.message_id == message_id)))
        if (message.dm_status, message.dm_failure_reason, stored) == (status, reason, set(ids)):
            return message
        raise AppError(ErrorCode.MESSAGE_RESULT_CONFLICT, details={"message_id": message_id})

    timed_out = (
        message.dm_status == DmStatus.FAILED
        and message.dm_failure_reason == DmFailureReason.UNKNOWN
        and message.claimed_at is not None
    )
    if message.dm_status != DmStatus.CLAIMED and not timed_out:
        raise AppError(ErrorCode.MESSAGE_RESULT_CONFLICT, details={"message_id": message_id})
    if ids and db.scalar(select(BotDmPart.discord_message_id).where(BotDmPart.discord_message_id.in_(ids))):
        raise AppError(ErrorCode.MESSAGE_RESULT_CONFLICT, details={"message_id": message_id})
    first_delivery = False
    if delivered:
        # PM 조작과 같이 대화를 잠근 뒤 본다. 겹친 보고나 PM 조작이 첫 DM 판정을 엇갈려 보지 않는다.
        _lock_thread(db, message.thread_id)
        first_delivery = not _has_delivered_dm(db, message.thread_id)
    message.dm_status = status
    message.dm_failure_reason = reason
    message.dm_reported_at = now
    db.add_all(BotDmPart(discord_message_id=i, message_id=message_id, created_at=now) for i in ids)
    db.flush()
    if first_delivery:
        _reframe_unapproved(db, message.thread_id, now)
    return message


def _reframe_unapproved(db: Session, thread_id: str, now: datetime) -> None:
    """승인 전 묶음을 두 번째 틀로 다시 만든다. 규칙·AI 문구는 판이 오르고 AI 초안을 다시 받는다.

    PM 이 고친 글과 승인한 글은 PM 이 본 그대로 나가야 하므로 건드리지 않는다. 메모에 틀만 씌운 글은 PM 이 고친 글이 아니다.
    """
    bundles = db.scalars(
        select(ReminderBundle)
        .where(
            ReminderBundle.thread_id == thread_id,
            ReminderBundle.status == ReminderStatus.SCHEDULED,
            ReminderBundle.approved_at.is_(None),
        )
        .order_by(ReminderBundle.scheduled_at, ReminderBundle.bundle_id)
        .with_for_update()
    ).all()
    for bundle in bundles:
        if bundle.body_source != BodySource.PM or _is_framed_note(db, bundle):
            _rebuild(db, bundle, now)


def _is_framed_note(db: Session, bundle: ReminderBundle) -> bool:
    """첫 줄의 이름은 틀을 씌운 뒤 바뀔 수 있어 첫 줄은 틀 모양만 보고, 그 아래는 글자 그대로 본다."""
    reminders = bundle_reminders(db, bundle.bundle_id)
    if len(reminders) != 1 or not reminders[0].note:
        return False
    first_line, _, rest = bundle.body.partition("\n")
    return bool(FIRST_DM_GREETING.fullmatch(first_line)) and rest == _first_dm_rest(reminders[0].note)


def ingest_discord_reply(
    db: Session,
    *,
    discord_user_id: str,
    discord_message_id: str,
    body: str,
    sent_at: datetime,
    now: datetime,
    reply_to_discord_message_id: str | None = None,
) -> tuple[ThreadMessage, bool]:
    """봇 DM 창에 온 팀원의 글을 대화에 넣는다. 리마인드에 대한 답인지 가리지 않고 전부 저장한다.

    돌려주는 bool 은 새로 저장했는지다. 같은 디스코드 메시지 id 는 한 번만 저장한다.
    """
    now, sent_at = utc(now), utc(sent_at)
    existing = _message_by_discord_id(db, discord_message_id)
    if existing is not None:
        return existing, False

    member = _pick_member_for_discord_user(
        db, discord_user_id, reply_to=reply_to_discord_message_id,
        reply_at=_discord_time(discord_message_id, sent_at),
    )
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


def _discord_time(discord_message_id: str, fallback: datetime) -> datetime:
    """디스코드 메시지를 보낸 시각. id 가 snowflake 가 아니면 fallback."""
    if not (discord_message_id.isascii() and discord_message_id.isdigit()):
        return utc(fallback)
    return datetime.fromtimestamp(((int(discord_message_id) >> 22) + DISCORD_EPOCH_MS) / 1000, tz=timezone.utc)


def _pick_member_for_discord_user(
    db: Session, discord_user_id: str, *, reply_to: str | None, reply_at: datetime
) -> Member:
    """DM 에는 서버 id 가 없어서 같은 디스코드 계정이 여러 워크스페이스에 있으면 어느 대화인지 골라야 한다.

    답장 기능으로 고른 봇 DM, 그 DM 창에서 이 글 바로 앞에 봇이 보낸 DM, 봇이 가장 최근에 말을 건 쪽,
    가장 나중에 만든 팀원 순서로 정한다. 봇 DM 시각은 디스코드 id 에 든 보낸 시각이다. 결과 보고는 답장보다
    늦게 올 수 있으므로, 가져갔지만 보고가 없는 메시지(시간 초과 포함)는 가져간 시각에 나간 것으로 본다.
    """
    members = db.scalars(
        select(Member).where(Member.discord_user_id == discord_user_id, Member.is_deleted.is_(False))
    ).all()
    if not members:
        raise AppError(ErrorCode.MEMBER_NOT_FOUND, details={"discord_user_id": discord_user_id})
    if len(members) == 1:
        return members[0]
    by_id = {m.member_id: m for m in members}

    def bot_messages():
        return (
            select(MessageThread.member_id)
            .join(ThreadMessage, ThreadMessage.thread_id == MessageThread.thread_id)
            .where(MessageThread.member_id.in_(by_id), ThreadMessage.sender == MessageSender.BOT)
        )

    if reply_to is not None:
        owner = db.scalar(
            bot_messages()
            .join(BotDmPart, BotDmPart.message_id == ThreadMessage.message_id)
            .where(BotDmPart.discord_message_id == reply_to)
        )
        if owner is not None:
            return by_id[owner]
    sent_before = []
    for member_id, claimed_at, reported_at, part_id in db.execute(
        bot_messages()
        .add_columns(ThreadMessage.claimed_at, ThreadMessage.dm_reported_at, BotDmPart.discord_message_id)
        .outerjoin(BotDmPart, BotDmPart.message_id == ThreadMessage.message_id)
        .where(ThreadMessage.claimed_at.is_not(None))
    ).all():
        if part_id is not None:
            at = _discord_time(part_id, claimed_at)
        elif reported_at is None:
            at = utc(claimed_at)
        else:
            continue  # 보고는 왔고 나간 DM 이 없다
        if at <= reply_at:
            sent_before.append((at, member_id))
    if sent_before:
        return by_id[max(sent_before)[1]]

    last_bot = dict(
        db.execute(
            select(MessageThread.member_id, func.max(ThreadMessage.created_at))
            .join(ThreadMessage, ThreadMessage.thread_id == MessageThread.thread_id)
            .where(MessageThread.member_id.in_(by_id), ThreadMessage.sender == MessageSender.BOT)
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
