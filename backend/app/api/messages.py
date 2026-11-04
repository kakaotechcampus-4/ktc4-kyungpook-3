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
    ReminderBundle,
    ReminderStatus,
    ThreadMessage,
    User,
)
from app.schemas.message import (
    BundleApproveRequest,
    BundleResponse,
    BundleUpdateRequest,
    InboxResponse,
    MessageResponse,
    ReminderCreateRequest,
    ReminderResponse,
    ReminderUpdateRequest,
    ReminderWithBundleResponse,
    ReplyCreateRequest,
    ThreadDetailResponse,
    ThreadSummary,
)
from app.schemas.reply import AttributionRequest, AttributionResponse, ReplyAttributionListResponse
from app.services import messages as svc
from app.services import replies

router = APIRouter(prefix="/workspaces/{workspace_id}/messages", tags=["messages"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _reminder_dict(reminder: Reminder) -> dict:
    task = reminder.task
    return ReminderResponse(
        reminder_id=reminder.reminder_id, bundle_id=reminder.bundle_id, task_id=reminder.task_id,
        task_title=task.title if task else None, due_date=task.due_date if task else None,
        note=reminder.note, status=reminder.status, kind=reminder.kind, origin=reminder.origin,
        created_at=svc.utc(reminder.created_at),
    ).model_dump(mode="json")


def _bundle_dict(db: Session, bundle: ReminderBundle) -> dict:
    """묶음과 그 안의 리마인드. 리마인드는 묶음과 같은 상태인 것만 보인다(예정 묶음이면 예정 리마인드, 취소 묶음이면 함께 취소된 것)."""
    member = bundle.thread.member
    return BundleResponse(
        bundle_id=bundle.bundle_id, thread_id=bundle.thread_id, member_id=member.member_id,
        recipient_name=member.display_name, scheduled_at=svc.utc(bundle.scheduled_at), status=bundle.status,
        approved=bundle.approved_at is not None,
        approved_at=bundle.approved_at and svc.utc(bundle.approved_at),
        body=bundle.body, body_source=bundle.body_source, draft_status=bundle.draft_status,
        draft_version=bundle.draft_version,
        reminders=[_reminder_dict(r) for r in svc.bundle_reminders(db, bundle.bundle_id, bundle.status)],
    ).model_dump(mode="json")


def _scheduled_bundles(db: Session, workspace_id: str, thread_id: str | None = None) -> list[dict]:
    stmt = (
        select(ReminderBundle)
        .join(MessageThread, MessageThread.thread_id == ReminderBundle.thread_id)
        .join(Member, Member.member_id == MessageThread.member_id)
        .where(
            ReminderBundle.workspace_id == workspace_id,
            ReminderBundle.status == ReminderStatus.SCHEDULED,
            Member.is_deleted.is_(False),
        )
        .order_by(ReminderBundle.scheduled_at, ReminderBundle.created_at)
    )
    if thread_id is not None:
        stmt = stmt.where(ReminderBundle.thread_id == thread_id)
    return [_bundle_dict(db, b) for b in db.scalars(stmt).all()]


def _summary(db: Session, thread: MessageThread) -> ThreadSummary:
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
    )


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
    """PM 은 모든 대화와 아직 예정인 보낼 메시지(묶음)를, 팀원은 자기 대화만 본다."""
    is_pm = member.role == MemberRole.PM
    stmt = (
        select(MessageThread)
        .join(Member, Member.member_id == MessageThread.member_id)
        .where(MessageThread.workspace_id == workspace_id, Member.is_deleted.is_(False))
    )
    if not is_pm:
        stmt = stmt.where(MessageThread.member_id == member.member_id)
    threads = [_summary(db, t) for t in db.scalars(stmt).all()]
    # 최근 대화가 위로. 메시지가 없는 대화(예정 묶음만 있음)는 아래로 간다.
    with_message = sorted(
        (t for t in threads if t.last_message), key=lambda t: t.last_message.created_at, reverse=True
    )
    without = [t for t in threads if not t.last_message]
    return success({
        "threads": [t.model_dump(mode="json") for t in with_message + without],
        "bundles": _scheduled_bundles(db, workspace_id) if is_pm else None,
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
        "thread": _summary(db, thread).model_dump(mode="json"),
        "messages": [MessageResponse.model_validate(m).model_dump(mode="json") for m in rows],
        "bundles": _scheduled_bundles(db, workspace_id, thread_id) if member.role == MemberRole.PM else None,
    })


def _with_bundle(db: Session, reminder: Reminder) -> dict:
    return success({"reminder": _reminder_dict(reminder), "bundle": _bundle_dict(db, reminder.bundle)})


@router.post("/reminders", status_code=201, response_model=Envelope[ReminderWithBundleResponse])
def create_reminder(
    workspace_id: str,
    payload: ReminderCreateRequest,
    pm: Member = Depends(get_current_pm),
    db: Session = Depends(get_db),
) -> dict:
    """리마인드를 만들어 그 팀원·시각의 보낼 메시지에 넣는다. 같은 시각의 메시지가 있으면 합쳐지고 승인이 풀린다."""
    reminder = svc.create_reminder(
        db, workspace_id=workspace_id, task_id=payload.task_id, member_id=payload.member_id,
        scheduled_at=payload.scheduled_at, note=payload.note, created_by=pm.member_id, now=_now(),
    )
    db.commit()
    return _with_bundle(db, reminder)


@router.patch("/reminders/{reminder_id}", response_model=Envelope[ReminderWithBundleResponse])
def update_reminder(
    workspace_id: str,
    reminder_id: str,
    payload: ReminderUpdateRequest,
    _pm: Member = Depends(get_current_pm),
    db: Session = Depends(get_db),
) -> dict:
    """메모를 고치거나 다른 시각으로 옮긴다. 보낼 메시지 문구가 바뀌므로 승인이 풀린다."""
    reminder = svc.get_reminder(db, workspace_id, reminder_id)
    note = payload.note if "note" in payload.model_fields_set else svc.KEEP
    svc.edit_reminder(db, reminder, note=note, scheduled_at=payload.scheduled_at, now=_now())
    db.commit()
    return _with_bundle(db, reminder)


@router.post("/reminders/{reminder_id}/cancel", response_model=Envelope[ReminderWithBundleResponse])
def cancel_reminder(
    workspace_id: str,
    reminder_id: str,
    _pm: Member = Depends(get_current_pm),
    db: Session = Depends(get_db),
) -> dict:
    """리마인드 하나를 뺀다. 마지막 하나였으면 보낼 메시지도 취소된다."""
    reminder = svc.get_reminder(db, workspace_id, reminder_id)
    svc.cancel_reminder(db, reminder, now=_now())
    db.commit()
    return _with_bundle(db, reminder)


def _bundle_action(db: Session, workspace_id: str, bundle_id: str, act) -> dict:
    bundle = act(svc.get_bundle(db, workspace_id, bundle_id))
    db.commit()
    return success(_bundle_dict(db, bundle))


@router.patch("/bundles/{bundle_id}", response_model=Envelope[BundleResponse])
def update_bundle(
    workspace_id: str,
    bundle_id: str,
    payload: BundleUpdateRequest,
    _pm: Member = Depends(get_current_pm),
    db: Session = Depends(get_db),
) -> dict:
    """문구나 시각을 고친다. 승인은 유지한다. 옮긴 시각에 다른 보낼 메시지가 있으면 합쳐진 쪽을 돌려준다."""
    return _bundle_action(
        db, workspace_id, bundle_id,
        lambda b: svc.edit_bundle(db, b, body=payload.body, scheduled_at=payload.scheduled_at, now=_now()),
    )


@router.post("/bundles/{bundle_id}/approve", response_model=Envelope[BundleResponse])
def approve_bundle(
    workspace_id: str,
    bundle_id: str,
    payload: BundleApproveRequest,
    pm: Member = Depends(get_current_pm),
    db: Session = Depends(get_db),
) -> dict:
    """PM 이 본 판(draft_version)이 지금 판과 다르면 409 BUNDLE_CHANGED. 이미 승인했으면 판과 상관없이 그대로 200."""
    return _bundle_action(
        db, workspace_id, bundle_id,
        lambda b: svc.approve_bundle(
            db, b, draft_version=payload.draft_version, approved_by=pm.member_id, now=_now()
        ),
    )


@router.post("/bundles/{bundle_id}/cancel", response_model=Envelope[BundleResponse])
def cancel_bundle(
    workspace_id: str,
    bundle_id: str,
    _pm: Member = Depends(get_current_pm),
    db: Session = Depends(get_db),
) -> dict:
    return _bundle_action(db, workspace_id, bundle_id, lambda b: svc.cancel_bundle(db, b, now=_now()))


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


@router.get("/threads/{thread_id}/attributions", response_model=Envelope[ReplyAttributionListResponse])
def list_attributions(
    workspace_id: str,
    thread_id: str,
    _pm: Member = Depends(get_current_pm),
    db: Session = Depends(get_db),
) -> dict:
    """그 대화에서 어느 태스크인지 PM 이 고를 답장과 고른 답장."""
    _get_thread(db, workspace_id, thread_id)
    items = replies.attributions(db, workspace_id, thread_id)
    return success(ReplyAttributionListResponse(items=items, total=len(items)).model_dump(mode="json"))


@router.post("/replies/{message_id}/attribution", response_model=Envelope[AttributionResponse])
def attribute_reply(
    workspace_id: str,
    message_id: str,
    payload: AttributionRequest,
    _pm: Member = Depends(get_current_pm),
    db: Session = Depends(get_db),
) -> dict:
    """태스크를 고르면 그 태스크만 후보로 다시 판단한다. task_id 가 null 이면 해당 없음으로 닫는다."""
    replies.attribute(db, workspace_id, message_id, payload.task_id, _now())
    db.commit()
    return success({"message_id": message_id})
