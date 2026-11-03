"""리마인드 스케줄러. 시간이 되면 재촉을 제안하고, 발송 직전에 응답을 다시 보고, 72시간 무응답이면 막는다.

틱 하나(run_tick)는 지금 상태만 보고 할 일을 정한다. 그래서 서버가 꺼졌다 켜지면 밀린 일을 한 번에 처리하고, 같은
시각에 두 번 돌려도 결과가 같다. 시각(now)은 부르는 쪽이 넘긴다.

응답은 그 팀원의 대화에 온 답장(디스코드, 웹)과 사람이 바꾼 태스크 상태·마감이다. 스케줄러가 건 막힘(출처 scheduler)은
응답이 아니다. 답장 판단 작업 전까지는 대화 답장 하나가 그 대화로 나간 모든 태스크의 응답이다.
"""
import logging
import threading
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.errors import AppError, ErrorCode
from app.models import (
    ChangedField,
    ChangeSource,
    DmStatus,
    Member,
    MessageSender,
    PushSubscription,
    Reminder,
    ReminderBundle,
    ReminderOrigin,
    ReminderStatus,
    ReminderWatch,
    SchedulerSuggestion,
    Task,
    TaskHistory,
    TaskStatus,
    ThreadMessage,
    WatchState,
)
from app.services import messages, notifications, push, tasks

logger = logging.getLogger(__name__)

# 워크스페이스 시간대 칼럼이 없어 서울로 고정한다. 한국은 일광 절약 시간이 없어 고정 오프셋으로 충분하다.
WORKSPACE_TZ = timezone(timedelta(hours=9))
SEND_HOUR = 9
PROPOSE_AHEAD = timedelta(days=3)
SILENCE = timedelta(hours=72)
BLOCKER_TEXT = "리마인드에 72시간 동안 응답이 없어요"
# 여러 BE 프로세스 가운데 한 곳만 틱을 돈다(PostgreSQL 트랜잭션 advisory lock).
TICK_LOCK_KEY = 318_001

_RESPONSE_FIELDS = (ChangedField.STATUS, ChangedField.DUE_DATE)


def send_slot(due: date) -> datetime:
    """마감 하루 전 09:00(워크스페이스 시간대). 재촉이 나가는 시각이다."""
    day = due - timedelta(days=1)
    return datetime(day.year, day.month, day.day, SEND_HOUR, tzinfo=WORKSPACE_TZ).astimezone(timezone.utc)


def _today(now: datetime) -> date:
    return now.astimezone(WORKSPACE_TZ).date()


# 응답

def _replied_after(db: Session, thread_id: str, after: datetime) -> bool:
    db.flush()
    return db.scalar(
        select(ThreadMessage.message_id).where(
            ThreadMessage.thread_id == thread_id,
            ThreadMessage.sender == MessageSender.MEMBER,
            ThreadMessage.created_at > after,
        ).limit(1)
    ) is not None


def _changed_after(db: Session, task_id: str, after: datetime) -> bool:
    db.flush()
    return db.scalar(
        select(TaskHistory.history_id).where(
            TaskHistory.task_id == task_id,
            TaskHistory.changed_field.in_(_RESPONSE_FIELDS),
            TaskHistory.change_source != ChangeSource.SCHEDULER,
            TaskHistory.created_at > after,
        ).limit(1)
    ) is not None


def _responded(db: Session, thread_id: str, task_id: str, after: datetime) -> bool:
    after = messages.utc(after)
    return _replied_after(db, thread_id, after) or _changed_after(db, task_id, after)


# 제안

def suggest(db: Session, now: datetime) -> None:
    """마감이 있는 미완료 태스크마다 발송 3일 전(남은 시간이 더 짧으면 바로) 승인 전 재촉을 만든다."""
    candidates = db.scalars(
        select(Task)
        .join(Member, Member.member_id == Task.assignee_member_id)
        .where(
            Task.is_deleted.is_(False),
            Task.status != TaskStatus.DONE,
            Task.due_date.is_not(None),
            Member.is_deleted.is_(False),
        )
        .order_by(Task.due_date, Task.task_id)
    ).all()
    for task in candidates:
        slot = send_slot(task.due_date)
        if not slot - PROPOSE_AHEAD <= now < slot:
            continue
        if _already_suggested(db, task) or _has_scheduled_reminder(db, task.task_id) or _answered_last(db, task):
            continue
        _suggest(db, task, slot, now)


def _already_suggested(db: Session, task: Task) -> bool:
    return db.scalar(
        select(SchedulerSuggestion.suggestion_id).where(
            SchedulerSuggestion.task_id == task.task_id, SchedulerSuggestion.due_date == task.due_date
        )
    ) is not None


def _has_scheduled_reminder(db: Session, task_id: str) -> bool:
    db.flush()
    return db.scalar(
        select(Reminder.reminder_id).where(Reminder.task_id == task_id, Reminder.status == ReminderStatus.SCHEDULED)
    ) is not None


def _answered_last(db: Session, task: Task) -> bool:
    """마지막으로 나간 재촉 뒤 응답이 있었는지. 그 뒤 마감이 바뀌었으면 새 마감이라 따지지 않는다."""
    last_sent = db.scalar(select(func.max(ReminderWatch.sent_at)).where(ReminderWatch.task_id == task.task_id))
    if last_sent is None:
        return False
    watch = db.scalar(
        select(ReminderWatch).where(ReminderWatch.task_id == task.task_id, ReminderWatch.sent_at == last_sent)
    )
    due_changed = db.scalar(
        select(func.max(TaskHistory.created_at)).where(
            TaskHistory.task_id == task.task_id, TaskHistory.changed_field == ChangedField.DUE_DATE
        )
    )
    if due_changed is not None and messages.utc(due_changed) > messages.utc(last_sent):
        return False
    return _responded(db, watch.thread_id, task.task_id, last_sent)


def _suggest(db: Session, task: Task, slot: datetime, now: datetime) -> None:
    thread = messages.get_or_create_thread(db, task.workspace_id, task.assignee_member_id)
    db.flush()
    approved_before = db.scalar(
        select(ReminderBundle.bundle_id).where(
            ReminderBundle.thread_id == thread.thread_id,
            ReminderBundle.scheduled_at == slot,
            ReminderBundle.status == ReminderStatus.SCHEDULED,
            ReminderBundle.approved_at.is_not(None),
        )
    ) is not None
    try:
        with db.begin_nested():
            reminder = messages.create_reminder(
                db, workspace_id=task.workspace_id, task_id=task.task_id, member_id=task.assignee_member_id,
                scheduled_at=slot, note=None, created_by=None, now=now, origin=ReminderOrigin.SCHEDULER,
            )
            db.add(SchedulerSuggestion(
                task_id=task.task_id, due_date=task.due_date, reminder_id=reminder.reminder_id, created_at=now,
            ))
            db.flush()
    except IntegrityError:
        return
    bundle = reminder.bundle
    name = thread.member.display_name
    if approved_before:
        notifications.notify_pms(
            db, workspace_id=task.workspace_id, kind="nudge_reapprove",
            text=f"{name}님에게 보낼 메시지에 재촉이 더해져 다시 승인이 필요해요",
            link_type="bundle", link_id=bundle.bundle_id, now=now,
            dedupe_key=f"reapprove:{bundle.bundle_id}:{bundle.draft_version}",
        )
    else:
        notifications.notify_pms(
            db, workspace_id=task.workspace_id, kind="nudge_suggested",
            text=f"{name}님에게 보낼 재촉을 제안했어요. 보내기 전 확인에서 승인해 주세요",
            link_type="bundle", link_id=bundle.bundle_id, now=now, dedupe_key=f"suggest:{bundle.bundle_id}",
        )


# 발송 직전

def before_dispatch(db: Session, now: datetime) -> None:
    """dispatch_due 가 묶음을 보내기 전에 부른다(봇이 가져갈 때도). 마감이 지난 예정은 만료하고, 만든 뒤 응답이
    있었던 리마인드는 취소한다. 묶음의 나머지는 #314 규칙대로 승인이 풀리고 PM 이 다시 본다."""
    now = messages.utc(now)
    db.flush()
    pending = db.execute(
        select(Reminder.reminder_id, Reminder.workspace_id)
        .join(ReminderBundle, ReminderBundle.bundle_id == Reminder.bundle_id)
        .where(Reminder.status == ReminderStatus.SCHEDULED, ReminderBundle.status == ReminderStatus.SCHEDULED)
        .order_by(Reminder.created_at, Reminder.reminder_id)
    ).all()
    for reminder_id, workspace_id in pending:
        reminder = messages.get_reminder(db, workspace_id, reminder_id)
        task = reminder.task
        if reminder.status != ReminderStatus.SCHEDULED or task is None:
            continue
        if task.due_date is not None and task.due_date < _today(now):
            messages.expire_reminder(db, reminder_id, now)
        elif _responded(db, reminder.bundle.thread_id, task.task_id, reminder.created_at):
            _auto_cancel(db, reminder, now)


def _auto_cancel(db: Session, reminder: Reminder, now: datetime) -> None:
    bundle = reminder.bundle
    was_approved = bundle.approved_at is not None
    messages.cancel_reminder(db, reminder, now=now)
    rest = bundle.status == ReminderStatus.SCHEDULED
    name = bundle.thread.member.display_name
    message = f"{name}님이 '{reminder.task.title}'에 응답해서 보낼 예정이던 재촉을 취소했어요"
    if rest and was_approved:
        message += ". 같이 보낼 메시지는 다시 승인해 주세요"
    notifications.notify_pms(
        db, workspace_id=reminder.workspace_id, kind="reminder_auto_cancelled", text=message,
        link_type="bundle" if rest else "thread", link_id=bundle.bundle_id if rest else bundle.thread_id,
        now=now, dedupe_key=f"autocancel:{reminder.reminder_id}",
    )


# 72시간

def open_watches(db: Session, now: datetime) -> None:
    """나간 리마인드마다 시계를 연다. 같은 태스크의 이전 시계는 멈춘다. 받은 팀원에게 알린다."""
    db.flush()
    sent = db.execute(
        select(Reminder, ReminderBundle.message_id)
        .join(ReminderBundle, ReminderBundle.bundle_id == Reminder.bundle_id)
        .outerjoin(ReminderWatch, ReminderWatch.reminder_id == Reminder.reminder_id)
        .where(
            Reminder.status == ReminderStatus.SENT,
            Reminder.task_id.is_not(None),
            ReminderBundle.message_id.is_not(None),
            ReminderWatch.watch_id.is_(None),
        )
    ).all()
    opened = []
    for reminder, message_id in sent:
        message = db.get(ThreadMessage, message_id)
        opened.append((messages.utc(message.created_at), reminder, message))
    opened.sort(key=lambda item: (item[0], item[1].reminder_id))
    for sent_at, reminder, message in opened:
        for older in db.scalars(
            select(ReminderWatch).where(
                ReminderWatch.task_id == reminder.task_id,
                ReminderWatch.state == WatchState.WATCHING,
                ReminderWatch.sent_at <= sent_at,
            )
        ).all():
            _close(older, WatchState.STOPPED, now)
        try:
            with db.begin_nested():
                db.add(ReminderWatch(
                    workspace_id=reminder.workspace_id, reminder_id=reminder.reminder_id, task_id=reminder.task_id,
                    thread_id=message.thread_id, message_id=message.message_id, sent_at=sent_at,
                    deadline_at=sent_at + SILENCE, state=WatchState.WATCHING, created_at=now,
                ))
        except IntegrityError:
            continue
        notifications.notify(
            db, member_id=message.thread.member_id, kind="reminder_sent",
            text=f"새 메시지가 왔어요: {_preview(message.body)}",
            link_type="thread", link_id=message.thread_id, now=now, dedupe_key=f"sent:{message.message_id}",
        )


def _preview(body: str, limit: int = 60) -> str:
    line = body.strip().splitlines()[0] if body.strip() else ""
    return line if len(line) <= limit else line[: limit - 1] + "…"


def settle_watches(db: Session, now: datetime) -> None:
    """열린 시계를 응답·시각에 따라 닫거나 막는다. 막힌 태스크는 답장이 오면 푼다(D-059)."""
    db.flush()
    for watch in db.scalars(
        select(ReminderWatch)
        .where(ReminderWatch.state.in_((WatchState.WATCHING, WatchState.BLOCKED)))
        .order_by(ReminderWatch.sent_at, ReminderWatch.watch_id)
    ).all():
        task = db.get(Task, watch.task_id, with_for_update=True, populate_existing=True)
        if task.is_deleted:
            _close(watch, WatchState.STOPPED, now)
            continue
        sent_at = messages.utc(watch.sent_at)
        if _replied_after(db, watch.thread_id, sent_at):
            if task.status == TaskStatus.BLOCKED:
                _unblock(db, task, watch, now)
            _close(watch, WatchState.RELEASED if watch.state == WatchState.BLOCKED else WatchState.ANSWERED, now)
            continue
        if watch.state == WatchState.BLOCKED:
            continue
        if task.status == TaskStatus.DONE:
            _close(watch, WatchState.STOPPED, now)
        elif _changed_after(db, task.task_id, sent_at):
            _close(watch, WatchState.ANSWERED, now)
        elif watch.paused_at is None and now >= messages.utc(watch.deadline_at):
            if watch.message.dm_status == DmStatus.DELIVERED:
                _block(db, task, watch, now)
            elif watch.message.dm_status == DmStatus.FAILED:
                _close(watch, WatchState.STOPPED, now)


def _close(watch: ReminderWatch, state: WatchState, now: datetime) -> None:
    watch.state = state
    watch.closed_at = now


def _stamp(entries: list[TaskHistory], now: datetime) -> None:
    for entry in entries:
        entry.created_at = now


def _block(db: Session, task: Task, watch: ReminderWatch, now: datetime) -> None:
    if task.status == TaskStatus.BLOCKED:
        watch.applied = False
    else:
        watch.prev_status, watch.prev_blocker = task.status, task.blocker
        _stamp(tasks.apply_task_updates(
            db, task, {"status": TaskStatus.BLOCKED, "blocker": BLOCKER_TEXT}, change_source=ChangeSource.SCHEDULER,
        ), now)
        watch.applied = True
    watch.state = WatchState.BLOCKED
    watch.blocked_at = now
    name = watch.message.thread.member.display_name
    text_ = f"{name}님이 '{task.title}' 재촉에 72시간 동안 답이 없어요"
    text_ += ". 막힘으로 바꿨어요" if watch.applied else " (이미 막힘 상태예요)"
    notifications.notify_pms(
        db, workspace_id=task.workspace_id, kind="silence_blocked", text=text_,
        link_type="task", link_id=task.task_id, now=now, dedupe_key=f"silence:{watch.watch_id}",
    )


def _unblock(db: Session, task: Task, watch: ReminderWatch, now: datetime) -> None:
    status = watch.prev_status if watch.applied and watch.prev_status else _status_before_block(db, task)
    _stamp(tasks.apply_task_updates(
        db, task, {"status": status, "blocker": None}, change_source=ChangeSource.REMINDER_REPLY,
    ), now)


def _status_before_block(db: Session, task: Task) -> str:
    """사람이 건 막힘의 이전 상태. 이력이 없으면 할 일로 돌린다."""
    old = db.scalar(
        select(TaskHistory.old_value)
        .where(
            TaskHistory.task_id == task.task_id,
            TaskHistory.changed_field == ChangedField.STATUS,
            TaskHistory.new_value == TaskStatus.BLOCKED,
        )
        .order_by(TaskHistory.created_at.desc())
        .limit(1)
    )
    return old if old and old != TaskStatus.BLOCKED else TaskStatus.TODO


def undo_auto_block(db: Session, task: Task, *, changed_by: str, now: datetime) -> Task:
    """PM 이 스케줄러가 건 막힘을 막기 전 상태와 사유로 되돌린다. 그 뒤 누가 바꿨으면 되돌리지 않는다."""
    watch = db.scalar(
        select(ReminderWatch)
        .where(
            ReminderWatch.task_id == task.task_id,
            ReminderWatch.state == WatchState.BLOCKED,
            ReminderWatch.applied.is_(True),
        )
        .order_by(ReminderWatch.blocked_at.desc())
        .limit(1)
    )
    if watch is None or task.status != TaskStatus.BLOCKED or task.blocker != BLOCKER_TEXT:
        raise AppError(ErrorCode.AUTO_BLOCK_NOT_FOUND, details={"task_id": task.task_id})
    tasks.apply_task_updates(
        db, task, {"status": watch.prev_status, "blocker": watch.prev_blocker},
        change_source=ChangeSource.MANUAL, changed_by=changed_by,
    )
    _close(watch, WatchState.RELEASED, now)
    db.flush()
    return task


# 틱

def _take_tick_lock(db: Session) -> bool:
    if db.get_bind().dialect.name != "postgresql":
        return True
    return bool(db.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": TICK_LOCK_KEY}))


def run_tick(
    db: Session, *, now: datetime, send: Callable[[PushSubscription, dict], None] | None = None
) -> None:
    """틱 하나. 상태를 바꾸고 커밋한 뒤 남은 푸시를 보낸다. send 가 None 이면 푸시 키가 없는 것이라 보내지 않는다."""
    now = messages.utc(now)
    # 제안은 태스크 순서로 대화를 잠그고, 발송 쪽(봇 경로 포함)은 리마인드 순서로 잠근다. 한 트랜잭션에 섞으면
    # 봇의 가져가기와 서로 잠금을 기다릴 수 있어 제안을 먼저 커밋한다.
    if _take_tick_lock(db):
        suggest(db, now)
    db.commit()
    if _take_tick_lock(db):
        messages.dispatch_due(db, now)
        open_watches(db, now)
        settle_watches(db, now)
    db.commit()
    notifications.send_pending_pushes(db, now=now, send=send)
    db.commit()


def run_worker(stop_event: threading.Event, interval: float) -> None:
    send = push.send if push.is_configured() else None
    if send is None:
        logger.warning("VAPID 키가 없어 기기 푸시 없이 웹 안 알림만 남깁니다.")
    while not stop_event.is_set():
        db = SessionLocal()
        try:
            run_tick(db, now=datetime.now(timezone.utc), send=send)
        except Exception:
            logger.exception("리마인드 스케줄러 오류")
            db.rollback()
        finally:
            db.close()
        stop_event.wait(interval)


def start_worker(interval: float) -> tuple[threading.Thread, threading.Event]:
    stop_event = threading.Event()
    thread = threading.Thread(
        target=run_worker, args=(stop_event, interval), name="reminder-scheduler", daemon=True
    )
    thread.start()
    return thread, stop_event
