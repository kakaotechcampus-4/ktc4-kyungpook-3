"""리마인드가 왜 나가는지(이유)와 그 근거, 묶음 요약을 계산한다. 읽기 전용이다.

"진행 소식"의 정의는 스케줄러의 응답 정의와 같다(scheduler._RESPONSE_FIELDS, _NOT_RESPONSE_SOURCES).
묶음 대화의 팀원 메시지, 또는 그 태스크의 응답 이력 중 늦은 것이 기준이고, 태스크 생성 이전 것은 세지 않고, 태스크 변경은 생성 직후 CREATION_GRACE 안의 것도 세지 않는다.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Member, MessageSender, Reminder, ReminderOrigin, TaskHistory, ThreadMessage
from app.services import messages, scheduler

DELETED_TASK_TITLE = "지워진 태스크"
# 승인 카드에서 PM 이 값을 고쳐 만든 태스크는 생성 직후(같은 요청 안에서) manual 이력이 남는다. 생성의 일부라 소식이 아니다.
CREATION_GRACE = timedelta(seconds=5)


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
    # 시각만 필요해서 같은 시각 이력의 순서는 의미가 없다. 동률 기준은 message_id 를 돌려주는 답장 조회에만 둔다.
    change = db.scalar(
        select(func.max(TaskHistory.created_at)).where(
            TaskHistory.task_id == task.task_id,
            TaskHistory.changed_field.in_(scheduler._RESPONSE_FIELDS),
            TaskHistory.change_source.notin_(scheduler._NOT_RESPONSE_SOURCES),
        )
    )
    reply_ev = Evidence("reply", messages.utc(reply.created_at), reply.message_id) if reply else None
    change_ev = Evidence("task_change", messages.utc(change), None) if change is not None else None
    if change_ev is not None and change_ev.at <= floor + CREATION_GRACE:
        change_ev = None
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
        news = f"{_kst_day(task.created_at)}에 태스크를 만든 뒤로 진행 소식이 없어요."
    if reminder.origin == ReminderOrigin.PM:
        # "누가 만들었는가"를 밝히는 문장이라 만든 PM 이 탈퇴했어도 그 사람 이름을 쓴다. DM 첫 줄에 쓰는
        # messages._pm_name 은 지금 말하는 PM 이라 탈퇴하면 다른 PM 으로 바꾸지만, 여기서는 그러면 사실과 다르다.
        creator = db.get(Member, reminder.created_by) if reminder.created_by else None
        name = creator.display_name if creator is not None else "PM"
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
