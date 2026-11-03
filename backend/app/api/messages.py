from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_member, get_current_pm, get_current_user
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import (
    DmStatus,
    Member,
    MemberRole,
    MessageSender,
    MessageThread,
    Reminder,
    ReminderStatus,
    Task,
    ThreadMessage,
    User,
)
from app.schemas.message import (
    InboxResponse,
    MessageResponse,
    ReminderCreateRequest,
    ReminderResponse,
    ReminderUpdateRequest,
    ReplyCreateRequest,
    ThreadDetailResponse,
    ThreadSummary,
)
from app.services import messages as svc

router = APIRouter(prefix="/workspaces/{workspace_id}/messages", tags=["messages"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _reminder_dict(db: Session, reminder: Reminder, member_id: str) -> dict:
    task = db.get(Task, reminder.task_id) if reminder.task_id else None
    return ReminderResponse(
        reminder_id=reminder.reminder_id, thread_id=reminder.thread_id, member_id=member_id,
        task_id=reminder.task_id, task_title=task.title if task else None,
        kind=reminder.kind, origin=reminder.origin, body=reminder.body,
        scheduled_at=svc.utc(reminder.scheduled_at), status=reminder.status,
        approved=reminder.approved_at is not None, approved_at=reminder.approved_at,
        created_at=reminder.created_at,
    ).model_dump(mode="json")


def _scheduled_reminders(db: Session, workspace_id: str, thread_id: str | None = None) -> list[dict]:
    stmt = (
        select(Reminder, MessageThread.member_id)
        .join(MessageThread, MessageThread.thread_id == Reminder.thread_id)
        .join(Member, Member.member_id == MessageThread.member_id)
        .where(
            Reminder.workspace_id == workspace_id,
            Reminder.status == ReminderStatus.SCHEDULED,
            Member.is_deleted.is_(False),
        )
        .order_by(Reminder.scheduled_at, Reminder.created_at)
    )
    if thread_id is not None:
        stmt = stmt.where(Reminder.thread_id == thread_id)
    return [_reminder_dict(db, r, member_id) for r, member_id in db.execute(stmt).all()]


def _summary(db: Session, thread: MessageThread) -> dict:
    def messages():
        return select(ThreadMessage).where(ThreadMessage.thread_id == thread.thread_id)

    last = db.scalar(messages().order_by(ThreadMessage.created_at.desc()).limit(1))
    last_member_at = db.scalar(
        select(func.max(ThreadMessage.created_at)).where(
            ThreadMessage.thread_id == thread.thread_id, ThreadMessage.sender == MessageSender.MEMBER
        )
    )
    awaiting = select(func.min(ThreadMessage.created_at)).where(
        ThreadMessage.thread_id == thread.thread_id, ThreadMessage.sender == MessageSender.BOT
    )
    if last_member_at is not None:
        awaiting = awaiting.where(ThreadMessage.created_at > last_member_at)
    last_bot = db.scalar(
        messages().where(ThreadMessage.sender == MessageSender.BOT).order_by(ThreadMessage.created_at.desc()).limit(1)
    )
    awaiting_since = db.scalar(awaiting)
    return ThreadSummary(
        thread_id=thread.thread_id,
        member_id=thread.member_id,
        name=thread.member.display_name,
        last_message=None if last is None else {
            "message_id": last.message_id, "sender": last.sender, "body": last.body,
            "created_at": svc.utc(last.created_at),
        },
        awaiting_reply_since=awaiting_since and svc.utc(awaiting_since),
        dm_failed=last_bot is not None and last_bot.dm_status == DmStatus.FAILED,
    ).model_dump(mode="json")


def _get_thread(db: Session, workspace_id: str, thread_id: str) -> MessageThread:
    thread = db.get(MessageThread, thread_id)
    if thread is None or thread.workspace_id != workspace_id:
        raise AppError(ErrorCode.MESSAGE_THREAD_NOT_FOUND, details={"thread_id": thread_id})
    return thread


def _check_thread_access(thread: MessageThread, member: Member, user: User) -> None:
    if member.role != MemberRole.PM and thread.member.user_id != user.user_id:
        raise AppError(ErrorCode.FORBIDDEN, details={"thread_id": thread.thread_id})


@router.get("", response_model=Envelope[InboxResponse])
def get_inbox(
    workspace_id: str,
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> dict:
    """PM 은 모든 대화와 아직 예정인 리마인드를, 팀원은 자기 대화만 본다."""
    is_pm = member.role == MemberRole.PM
    stmt = (
        select(MessageThread)
        .join(Member, Member.member_id == MessageThread.member_id)
        .where(MessageThread.workspace_id == workspace_id, Member.is_deleted.is_(False))
    )
    if not is_pm:
        stmt = stmt.where(MessageThread.member_id == member.member_id)
    threads = [_summary(db, t) for t in db.scalars(stmt).all()]
    # 최근 대화가 위로. 메시지가 없는 대화(예정 리마인드만 있음)는 아래로 간다.
    with_message = sorted(
        (t for t in threads if t["last_message"]), key=lambda t: t["last_message"]["created_at"], reverse=True
    )
    without = [t for t in threads if not t["last_message"]]
    return success({
        "threads": with_message + without,
        "reminders": _scheduled_reminders(db, workspace_id) if is_pm else None,
    })


@router.get("/threads/{thread_id}", response_model=Envelope[ThreadDetailResponse])
def get_thread(
    workspace_id: str,
    thread_id: str,
    member: Member = Depends(get_current_member),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    thread = _get_thread(db, workspace_id, thread_id)
    _check_thread_access(thread, member, user)
    rows = db.scalars(
        select(ThreadMessage)
        .where(ThreadMessage.thread_id == thread_id)
        .order_by(ThreadMessage.created_at, ThreadMessage.message_id)
    ).all()
    return success({
        "thread": _summary(db, thread),
        "messages": [MessageResponse.model_validate(m).model_dump(mode="json") for m in rows],
        "reminders": _scheduled_reminders(db, workspace_id, thread_id) if member.role == MemberRole.PM else None,
    })


@router.post("/reminders", status_code=201, response_model=Envelope[ReminderResponse])
def create_reminder(
    workspace_id: str,
    payload: ReminderCreateRequest,
    pm: Member = Depends(get_current_pm),
    db: Session = Depends(get_db),
) -> dict:
    reminder = svc.create_reminder(
        db, workspace_id=workspace_id, task_id=payload.task_id, member_id=payload.member_id,
        body=payload.body, scheduled_at=payload.scheduled_at, created_by=pm.member_id, now=_now(),
    )
    db.commit()
    return success(_reminder_dict(db, reminder, payload.member_id))


def _reminder_action(db: Session, workspace_id: str, reminder_id: str, act) -> dict:
    reminder = svc.get_reminder(db, workspace_id, reminder_id)
    act(reminder)
    db.commit()
    return success(_reminder_dict(db, reminder, db.get(MessageThread, reminder.thread_id).member_id))


@router.patch("/reminders/{reminder_id}", response_model=Envelope[ReminderResponse])
def update_reminder(
    workspace_id: str,
    reminder_id: str,
    payload: ReminderUpdateRequest,
    _pm: Member = Depends(get_current_pm),
    db: Session = Depends(get_db),
) -> dict:
    return _reminder_action(
        db, workspace_id, reminder_id,
        lambda r: svc.edit_reminder(db, r, body=payload.body, scheduled_at=payload.scheduled_at, now=_now()),
    )


@router.post("/reminders/{reminder_id}/approve", response_model=Envelope[ReminderResponse])
def approve_reminder(
    workspace_id: str,
    reminder_id: str,
    pm: Member = Depends(get_current_pm),
    db: Session = Depends(get_db),
) -> dict:
    return _reminder_action(
        db, workspace_id, reminder_id,
        lambda r: svc.approve_reminder(db, r, approved_by=pm.member_id, now=_now()),
    )


@router.post("/reminders/{reminder_id}/cancel", response_model=Envelope[ReminderResponse])
def cancel_reminder(
    workspace_id: str,
    reminder_id: str,
    _pm: Member = Depends(get_current_pm),
    db: Session = Depends(get_db),
) -> dict:
    return _reminder_action(
        db, workspace_id, reminder_id, lambda r: svc.cancel_reminder(db, r, now=_now())
    )


@router.post("/threads/{thread_id}/replies", status_code=201, response_model=Envelope[MessageResponse])
def post_reply(
    workspace_id: str,
    thread_id: str,
    payload: ReplyCreateRequest,
    member: Member = Depends(get_current_member),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """대화 주인인 팀원의 웹 답장. PM 도 남의 대화에는 쓸 수 없다. 웹 답장은 디스코드로 보내지 않는다."""
    thread = _get_thread(db, workspace_id, thread_id)
    if thread.member.user_id != user.user_id:
        raise AppError(ErrorCode.FORBIDDEN, details={"thread_id": thread_id})
    message = svc.add_web_reply(db, thread, body=payload.body, now=_now())
    db.commit()
    return success(MessageResponse.model_validate(message).model_dump(mode="json"))
