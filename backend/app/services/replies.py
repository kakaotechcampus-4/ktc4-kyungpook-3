"""리마인드 답장 판단. reply_judgment, reply_change 의 유일한 쓰기 주체다.

답장 한 통이 판단 작업 한 건이다. 저장과 같은 트랜잭션에서 행이 생기고, 봇이 맡아 판단해 돌려주면 게이트·반영·승인·기록·알림을
한 트랜잭션에서 끝낸다. 시계는 scheduler 가 쓰고 여기서는 답장이 시계에 뜻하는 바(clock_effect)만 읽어 준다.
"""
import json
from collections import defaultdict
from datetime import datetime, timedelta
from enum import StrEnum

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    MessageSender,
    MessageThread,
    Reminder,
    ReminderBundle,
    ReminderStatus,
    ReminderWatch,
    ReplyChange,
    ReplyChangeField,
    ReplyChangeOutcome,
    ReplyJudgment,
    ReplyJudgmentState,
    Task,
    TaskStatus,
    ThreadMessage,
)
from app.services import messages, notifications, scheduler

JUDGE_WINDOW = timedelta(minutes=10)


class ClockEffect(StrEnum):
    NONE = "none"
    WAIT = "wait"
    PAUSE = "pause"
    ANSWERED = "answered"
    KEEP_BLOCKED = "keep_blocked"


# 답장이 여럿이면 앞쪽이 이긴다. "막혔어요" 뒤 이어 쓴 말이 막힘을 풀지 않게 KEEP_BLOCKED 가 ANSWERED 를 이긴다.
_EFFECT_ORDER = (ClockEffect.WAIT, ClockEffect.KEEP_BLOCKED, ClockEffect.ANSWERED, ClockEffect.PAUSE)
_BLOCK_OUTCOMES = (ReplyChangeOutcome.APPLIED, ReplyChangeOutcome.PROPOSED, ReplyChangeOutcome.NOTED)


def open_judgment(db: Session, message: ThreadMessage, now: datetime) -> None:
    """팀원 답장을 판단 큐에 넣는다. 후보가 없으면 리마인드와 무관한 글이라 행을 만들지 않는다."""
    db.flush()
    thread = db.get(MessageThread, message.thread_id)
    candidates = _candidates(db, thread, messages.utc(message.created_at))
    if candidates:
        db.add(ReplyJudgment(
            message_id=message.message_id, workspace_id=thread.workspace_id, thread_id=thread.thread_id,
            state=ReplyJudgmentState.PENDING, queued_at=messages.utc(now), candidates=json.dumps(candidates),
        ))
        db.flush()


def _candidates(db: Session, thread: MessageThread, replied_at: datetime) -> list[str]:
    """답장 앞에 나간 마지막 묶음의 태스크 ∪ 답장 앞에 열린 시계의 태스크. 지운 태스크, 담당이 대화 주인이 아닌 태스크는 뺀다.

    시계가 닫혀도 마지막 묶음이 남아 이어 쓴 답장이 같은 후보를 본다. 시계는 앞선 리마인드 중 답이 없는 것을 살린다.
    시간 창을 두면 창 밖 답장이 PM 에게 영영 보이지 않는다.
    """
    last_bundle = db.scalar(
        select(ReminderBundle.bundle_id)
        .join(ThreadMessage, ThreadMessage.message_id == ReminderBundle.message_id)
        .where(ReminderBundle.thread_id == thread.thread_id, ThreadMessage.created_at < replied_at)
        .order_by(ThreadMessage.created_at.desc())
        .limit(1)
    )
    reminded = db.scalars(
        select(Reminder.task_id).where(Reminder.bundle_id == last_bundle, Reminder.status == ReminderStatus.SENT)
    ).all()
    watched = db.scalars(
        select(ReminderWatch.task_id).where(
            ReminderWatch.thread_id == thread.thread_id,
            ReminderWatch.state.in_(scheduler._OPEN_STATES),
            ReminderWatch.sent_at < replied_at,
        )
    ).all()
    return sorted(db.scalars(
        select(Task.task_id).where(
            Task.task_id.in_({*reminded, *watched} - {None}),
            Task.is_deleted.is_(False),
            Task.assignee_member_id == thread.member_id,
        )
    ).all())


def clock_effect(db: Session, watch: ReminderWatch, *, before: datetime | None) -> ClockEffect:
    """시계가 나간 뒤(before 가 있으면 그 앞) 온 팀원 답장들이 이 시계에 뜻하는 바."""
    db.flush()
    query = (
        select(
            ThreadMessage.message_id, ReplyJudgment.state, ReplyJudgment.candidates, ReplyJudgment.picked_task_id,
        )
        .outerjoin(ReplyJudgment, ReplyJudgment.message_id == ThreadMessage.message_id)
        .where(
            ThreadMessage.thread_id == watch.thread_id,
            ThreadMessage.sender == MessageSender.MEMBER,
            ThreadMessage.created_at > messages.utc(watch.sent_at),
        )
    )
    if before is not None:
        query = query.where(ThreadMessage.created_at < before)
    rows = db.execute(query).all()
    lines = defaultdict(list)
    for line in db.execute(
        select(ReplyChange.message_id, ReplyChange.field, ReplyChange.new_value, ReplyChange.outcome).where(
            ReplyChange.task_id == watch.task_id, ReplyChange.message_id.in_([r.message_id for r in rows])
        )
    ).all():
        lines[line.message_id].append(line)
    effects = {_reply_effect(r, lines[r.message_id], watch.task_id) for r in rows}
    return next((effect for effect in _EFFECT_ORDER if effect in effects), ClockEffect.NONE)


def _reply_effect(row, lines: list, task_id: str) -> ClockEffect:
    """답장 하나의 효과. lines 는 이 태스크의 줄이다. 후보 안의 태스크라도 답장이 말하지 않았으면 그 시계는 계속 센다."""
    if row.state in (None, ReplyJudgmentState.FAILED, ReplyJudgmentState.TIMED_OUT):
        return ClockEffect.ANSWERED
    if row.state == ReplyJudgmentState.PENDING:
        return ClockEffect.WAIT
    if any(
        line.field == ReplyChangeField.STATUS and line.new_value == TaskStatus.BLOCKED
        and line.outcome in _BLOCK_OUTCOMES
        for line in lines
    ):
        return ClockEffect.KEEP_BLOCKED
    if lines or row.picked_task_id == task_id:
        return ClockEffect.ANSWERED
    if row.state == ReplyJudgmentState.NEEDS_PM and task_id in json.loads(row.candidates):
        return ClockEffect.PAUSE
    return ClockEffect.NONE


def overdue(db: Session, now: datetime) -> list[str]:
    db.flush()
    return list(db.scalars(
        select(ReplyJudgment.message_id)
        .where(
            ReplyJudgment.state == ReplyJudgmentState.PENDING,
            ReplyJudgment.queued_at <= messages.utc(now) - JUDGE_WINDOW,
        )
        .order_by(ReplyJudgment.queued_at, ReplyJudgment.message_id)
    ).all())


def expire(db: Session, message_id: str, now: datetime) -> None:
    """10분 안에 결과가 없는 판단을 끝낸다. overdue 뒤 PM 이 고르거나 결과가 왔을 수 있어 잠근 뒤 다시 본다."""
    now = messages.utc(now)
    row = db.get(ReplyJudgment, message_id, with_for_update=True, populate_existing=True)
    if row.state != ReplyJudgmentState.PENDING or messages.utc(row.queued_at) > now - JUDGE_WINDOW:
        return
    row.state = ReplyJudgmentState.TIMED_OUT
    _notify_unjudged(db, row, now)


def _notice_key(row: ReplyJudgment) -> str:
    return f"reply:{row.message_id}" + (":picked" if row.picked_task_id else "")


def _notify_unjudged(db: Session, row: ReplyJudgment, now: datetime) -> None:
    name = row.message.thread.member.display_name
    notifications.notify_pms(
        db, workspace_id=row.workspace_id, kind="reply_unjudged",
        text=f"{name} 답장이 왔어요. 자동 판단을 못 해서 확인이 필요해요",
        link_type="thread", link_id=row.thread_id, now=now, dedupe_key=_notice_key(row),
    )


def _judge_status(db: Session, task: Task) -> str:
    """판단에 보이고 게이트가 비교할 상태. 열린 시계가 있는 막힘 태스크는 막기 전 상태다.

    judge 는 후보와 같은 값을 지운다. 막힘을 그대로 보이면 "막혔어요" 가 변경으로 나오지 못하고, 막기 전 상태를 보이면
    "진행 중이에요" 는 바꿀 것 없음이 되어 시계가 푼다. 열린 시계가 없으면 풀어 줄 쪽이 없으니 실제 값을 보인다.
    """
    if task.status != TaskStatus.BLOCKED:
        return task.status
    db.flush()
    watch = db.scalar(
        select(ReminderWatch)
        .where(ReminderWatch.task_id == task.task_id, ReminderWatch.state.in_(scheduler._OPEN_STATES))
        .order_by(ReminderWatch.sent_at.desc())
        .limit(1)
    )
    return task.status if watch is None else scheduler.status_after_release(db, task, watch)
