"""리마인드 답장 판단. reply_judgment, reply_change 의 유일한 쓰기 주체다.

답장 한 통이 판단 작업 한 건이다. 저장과 같은 트랜잭션에서 행이 생기고, 봇이 맡아 판단해 돌려주면 게이트·반영·승인·기록·알림을
한 트랜잭션에서 끝낸다. 시계는 scheduler 가 쓰고 여기서는 답장이 시계에 뜻하는 바(clock_effect)만 읽어 준다.
"""
import json
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    MessageThread,
    Reminder,
    ReminderBundle,
    ReminderStatus,
    ReminderWatch,
    ReplyJudgment,
    ReplyJudgmentState,
    Task,
    ThreadMessage,
)
from app.services import messages, scheduler


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
