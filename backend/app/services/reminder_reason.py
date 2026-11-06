"""리마인드가 왜 나가는지(이유)와 그 근거, 묶음 요약을 계산한다. 읽기 전용이다.

"진행 소식"의 정의는 스케줄러의 응답 정의와 같다(scheduler._RESPONSE_FIELDS, _NOT_RESPONSE_SOURCES).
묶음 대화의 팀원 메시지, 또는 그 태스크의 응답 이력 중 늦은 것이 기준이고, 태스크 생성 이전 것은 세지 않는다.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import MessageSender, Reminder, ReminderOrigin, TaskHistory, ThreadMessage
from app.services import messages, scheduler

DELETED_TASK_TITLE = "지워진 태스크"


@dataclass(frozen=True)
class Evidence:
    kind: Literal["reply", "task_change"]
    at: datetime
    message_id: str | None


def _kst_day(value) -> str:
    if isinstance(value, datetime):
        value = messages.utc(value).astimezone(scheduler.WORKSPACE_TZ).date()
    return f"{value.month}/{value.day}({messages._WEEKDAYS[value.weekday()]})"


def _latest_news(db: Session, task, thread_id: str) -> Evidence | None:
    db.flush()
    floor = messages.utc(task.created_at)
    reply = db.execute(
        select(ThreadMessage.message_id, ThreadMessage.created_at)
        .where(ThreadMessage.thread_id == thread_id, ThreadMessage.sender == MessageSender.MEMBER)
        .order_by(ThreadMessage.created_at.desc(), ThreadMessage.message_id.desc())
        .limit(1)
    ).first()
    change = db.scalar(
        select(TaskHistory.created_at)
        .where(
            TaskHistory.task_id == task.task_id,
            TaskHistory.changed_field.in_(scheduler._RESPONSE_FIELDS),
            TaskHistory.change_source.notin_(scheduler._NOT_RESPONSE_SOURCES),
        )
        .order_by(TaskHistory.created_at.desc(), TaskHistory.history_id.desc())
        .limit(1)
    )
    reply_ev = Evidence("reply", messages.utc(reply.created_at), reply.message_id) if reply else None
    change_ev = Evidence("task_change", messages.utc(change), None) if change is not None else None
    candidates = [e for e in (reply_ev, change_ev) if e is not None and e.at > floor]
    if not candidates:
        return None
    # 같은 시각이면 reply 가 앞선다.
    return max(candidates, key=lambda e: (e.at, e.kind == "reply"))


def reminder_reason(db: Session, reminder: Reminder, thread_id: str) -> tuple[str | None, Evidence | None]:
    task = reminder.task
    if task is None:
        return None, None
    evidence = _latest_news(db, task, thread_id)
    if evidence is not None:
        news = f"{_kst_day(evidence.at)} 이후로 진행 소식이 없어요."
    else:
        news = f"{_kst_day(task.created_at)}에 만든 뒤로 진행 소식이 없어요."
    if reminder.origin == ReminderOrigin.PM:
        name = messages._pm_name(db, reminder.workspace_id, reminder.created_by)
        return f"{name}님이 직접 만든 재촉이에요. {news}", evidence
    if task.due_date is not None:
        return f"'{task.title}' 마감이 {_kst_day(task.due_date)}인데, {news}", evidence
    return news, evidence


def bundle_summary(reminders: list[Reminder]) -> str:
    if not reminders:
        return ""
    first = reminders[0].task.title if reminders[0].task is not None else DELETED_TASK_TITLE
    if len(reminders) == 1:
        return f"{first} 진행 상황 확인"
    return f"{first} 외 {len(reminders) - 1}건 진행 상황 확인"
