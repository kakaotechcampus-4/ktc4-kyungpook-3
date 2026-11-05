"""리마인드 답장 판단. reply_judgment, reply_change 의 유일한 쓰기 주체다.

답장 한 통이 판단 작업 한 건이다. 저장과 같은 트랜잭션에서 행이 생기고, 봇이 맡아 판단해 돌려주면 게이트·반영·승인·기록·알림을
한 트랜잭션에서 끝낸다. 시계는 scheduler 가 쓰고 여기서는 답장이 시계에 뜻하는 바(clock_effect)만 읽어 준다.
"""
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import StrEnum

from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import (
    ApprovalRequest,
    ApprovalStatus,
    ApprovalType,
    ChangedField,
    ChangeSource,
    Gate,
    Member,
    MemberRole,
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
    TaskHistory,
    TaskStatus,
    ThreadMessage,
)
from app.schemas.reply import ClaimedCandidate, ClaimedLine, ClaimedReply, ReplyChangeRequest, ReplyJudgmentRequest
from app.services import matching, messages, notifications, scheduler, tasks

# 봇이 맡은 뒤 이만큼 결과가 없으면 다시 맡긴다. 10분보다 짧아 배포로 봇이 재시작해도 판단 실패 알림 전에 한 번 더 돈다.
JUDGE_LEASE = timedelta(minutes=3)
JUDGE_WINDOW = timedelta(minutes=10)
LINE_LIMIT = 12
FAILURE_REASON_LIMIT = 120
REPLY_BLOCKER_TEXT = "팀원이 막혔다고 답했어요"
# 맡기기를 한 줄로 세운다. 틱 잠금과 키가 달라 틱을 기다리지 않는다.
CLAIM_LOCK_KEY = 331_001


class ClockEffect(StrEnum):
    NONE = "none"
    WAIT = "wait"
    PAUSE = "pause"
    ANSWERED = "answered"
    KEEP_BLOCKED = "keep_blocked"


# 답장이 여럿이면 앞쪽이 이긴다. "막혔어요" 뒤 이어 쓴 말이 막힘을 풀지 않게 KEEP_BLOCKED 가 ANSWERED 를 이긴다.
_EFFECT_ORDER = (ClockEffect.WAIT, ClockEffect.KEEP_BLOCKED, ClockEffect.ANSWERED, ClockEffect.PAUSE)
_BLOCK_OUTCOMES = (ReplyChangeOutcome.APPLIED, ReplyChangeOutcome.PROPOSED, ReplyChangeOutcome.NOTED)
_ATTRIBUTION_OUTCOMES = (ReplyChangeOutcome.UNKNOWN, ReplyChangeOutcome.PICKED, ReplyChangeOutcome.DISMISSED)
# 값이 없어 게이트를 타지 않는 줄과 그 결과. due_clear·failed 는 어느 태스크인지 알면 task_id 가 실린다.
_NO_TASK_OUTCOME = {
    ReplyChangeField.UNKNOWN: ReplyChangeOutcome.UNKNOWN,
    ReplyChangeField.DUE_CLEAR: ReplyChangeOutcome.NOTED,
    ReplyChangeField.FAILED: ReplyChangeOutcome.NOTED,
}
_PAYLOAD_KEY = {
    ReplyChangeField.STATUS: "status",
    ReplyChangeField.DUE_DATE: "due_date",
    ReplyChangeField.ASSIGNEE: "assignee_member_id",
}
_CATEGORY = {
    ReplyChangeField.STATUS: "decision",
    ReplyChangeField.DUE_DATE: "schedule",
    ReplyChangeField.ASSIGNEE: "assignee",
    ReplyChangeField.SCOPE: "scope",
}
_STATUS_TO = {
    TaskStatus.TODO: "할 일로",
    TaskStatus.IN_PROGRESS: "진행 중으로",
    TaskStatus.BLOCKED: "막힘으로",
    TaskStatus.DONE: "완료로",
}


@dataclass(frozen=True)
class Notice:
    text: str
    link_type: str
    link_id: str


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


def claim(db: Session, now: datetime) -> ClaimedReply | None:
    """판단할 답장 한 통을 맡긴다. 대화마다 가장 오래된 행만 본다. 앞 답장이 끝나야 뒤 답장이 그 반영값을 본다."""
    now = messages.utc(now)
    db.flush()
    if not _take_claim_lock(db):
        return None
    pending = db.execute(
        select(ReplyJudgment.message_id, ReplyJudgment.thread_id, ReplyJudgment.claimed_at)
        .where(ReplyJudgment.state == ReplyJudgmentState.PENDING)
        .order_by(ReplyJudgment.queued_at, ReplyJudgment.message_id)
    ).all()
    seen: set[str] = set()
    for message_id, thread_id, claimed_at in pending:
        if thread_id in seen:
            continue
        seen.add(thread_id)
        if claimed_at is not None and messages.utc(claimed_at) > now - JUDGE_LEASE:
            continue
        row = db.get(ReplyJudgment, message_id, with_for_update=True, populate_existing=True)
        if row.state == ReplyJudgmentState.PENDING:
            row.attempt += 1
            row.claimed_at = now
            db.flush()
            return _claimed(db, row)
    return None


def _take_claim_lock(db: Session) -> bool:
    if db.get_bind().dialect.name != "postgresql":
        return True
    return bool(db.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": CLAIM_LOCK_KEY}))


def _claimed(db: Session, row: ReplyJudgment) -> ClaimedReply:
    message = row.message
    task_ids = json.loads(row.candidates)
    candidates = db.scalars(
        select(Task).where(Task.task_id.in_(task_ids), Task.is_deleted.is_(False)).order_by(Task.task_id)
    ).all()
    row.claimed_statuses = json.dumps({t.task_id: t.status for t in candidates})
    return ClaimedReply(
        message_id=row.message_id, attempt=row.attempt, workspace_id=row.workspace_id,
        member_name=message.thread.member.display_name,
        reply_date=_reply_date(message),
        lines=_lines(db, message, task_ids),
        candidates=[
            ClaimedCandidate(
                task_id=t.task_id, title=t.title, status=_judge_status(db, t), due_date=t.due_date,
                assignee_member_id=t.assignee_member_id, updated_at=messages.utc(t.updated_at),
            )
            for t in candidates
        ],
    )


def _reply_date(message: ThreadMessage) -> date:
    return messages.utc(message.created_at).astimezone(scheduler.WORKSPACE_TZ).date()


def _lines(db: Session, message: ThreadMessage, task_ids: list[str]) -> list[ClaimedLine]:
    """후보 태스크들의 마지막 리마인드 중 가장 앞선 것부터 이번 답장까지. 뒤 답장은 싣지 않는다."""
    replied_at = messages.utc(message.created_at)
    sent = db.scalars(
        select(func.max(ThreadMessage.created_at))
        .join(ReminderBundle, ReminderBundle.message_id == ThreadMessage.message_id)
        .join(Reminder, Reminder.bundle_id == ReminderBundle.bundle_id)
        .where(
            Reminder.task_id.in_(task_ids),
            ThreadMessage.thread_id == message.thread_id,
            ThreadMessage.created_at < replied_at,
        )
        .group_by(Reminder.task_id)
    ).all()
    start = min((messages.utc(at) for at in sent), default=replied_at)
    earlier = db.scalars(
        select(ThreadMessage)
        .where(
            ThreadMessage.thread_id == message.thread_id,
            ThreadMessage.created_at >= start,
            ThreadMessage.created_at <= replied_at,
            ThreadMessage.message_id != message.message_id,
        )
        .order_by(ThreadMessage.created_at.desc(), ThreadMessage.message_id.desc())
        .limit(LINE_LIMIT - 1)
    ).all()
    return [
        ClaimedLine(sender="pm" if m.sender == MessageSender.BOT else "member", text=m.body)
        for m in [*reversed(earlier), message]
    ]


def submit(db: Session, message_id: str, body: ReplyJudgmentRequest, now: datetime) -> None:
    """판단 결과를 받는다. 값 변경·승인 요청·변경 줄·상태·알림이 부르는 쪽의 한 트랜잭션에 들어간다.

    잠금 순서는 판단 행 → 태스크(id 순)다. _settle 은 태스크만 잠그고 판단 행은 읽기만 해 고리가 없다.
    """
    now = messages.utc(now)
    row = db.get(ReplyJudgment, message_id, with_for_update=True, populate_existing=True)
    if row is None:
        raise AppError(ErrorCode.REPLY_JUDGMENT_NOT_FOUND, details={"message_id": message_id})
    # PM 이 고르면 attempt 는 그대로이고 맡긴 표시만 지워진다. 고르기 전 판단의 재전송을 그것으로 거른다.
    if body.attempt != row.attempt or row.claimed_at is None:
        raise AppError(
            ErrorCode.REPLY_JUDGMENT_STALE,
            details={"message_id": message_id, "attempt": row.attempt, "state": row.state},
        )
    if row.finished_at is not None:
        return
    _check(row, body.changes)
    late = row.state == ReplyJudgmentState.TIMED_OUT
    row.finished_at, row.model_name = now, body.model_name
    if body.failure_reason:
        row.failure_reason = body.failure_reason[:FAILURE_REASON_LIMIT]
        if not late:
            row.state = ReplyJudgmentState.FAILED
            _notify_unjudged(db, row, now)
    elif late:
        for change in _fresh(db, row, body.changes):
            _line(db, row, change, ReplyChangeOutcome.RECORDED, now)
    else:
        _judged(db, row, _fresh(db, row, body.changes), now)
    db.flush()


def _check(row: ReplyJudgment, changes: list[ReplyChangeRequest]) -> None:
    """신뢰 경계. 무엇이든 쓰기 전에 본다."""
    candidates = json.loads(row.candidates)
    for change in changes:
        task_id = _line_task(change)
        if task_id is None and change.field in _NO_TASK_OUTCOME:
            continue
        if task_id not in candidates:
            raise AppError(
                ErrorCode.INVALID_REQUEST, message="후보에 없는 태스크입니다.",
                details={"task_id": change.task_id, "field": change.field},
            )
        if change.field == ReplyChangeField.STATUS:
            tasks.validate_task_fields({"status": change.new_value})
        elif change.field == ReplyChangeField.DUE_DATE and tasks.parse_date(change.new_value, field="due_date") is None:
            raise AppError(ErrorCode.INVALID_REQUEST, message="마감 변경에는 날짜가 필요합니다.", details={"field": "due_date"})


def _line_task(change: ReplyChangeRequest) -> str | None:
    return None if change.field == ReplyChangeField.UNKNOWN else change.task_id


def _fresh(db: Session, row: ReplyJudgment, changes: list[ReplyChangeRequest]) -> list[ReplyChangeRequest]:
    """새로 적을 변경만 남긴다. 재판단이 앞서 적은 필드를 또 내면 두 번 반영하지 않고, 재판단의 unknown 은 버린다."""
    recorded = {
        (task_id, field)
        for task_id, field in db.execute(
            select(ReplyChange.task_id, ReplyChange.field).where(ReplyChange.message_id == row.message_id)
        ).all()
    }
    fresh = []
    for change in changes:
        if change.field == ReplyChangeField.UNKNOWN and row.picked_task_id:
            continue
        task_id = _line_task(change)
        if task_id is not None:
            if (task_id, change.field) in recorded:
                continue
            recorded.add((task_id, change.field))
        fresh.append(change)
    return fresh


def _line(
    db: Session, row: ReplyJudgment, change: ReplyChangeRequest, outcome: ReplyChangeOutcome, now: datetime,
    *, new_value: str | None = None,
) -> ReplyChange:
    line = ReplyChange(
        message_id=row.message_id,
        task_id=_line_task(change),
        field=change.field, outcome=outcome, new_value=new_value or change.new_value, summary=change.summary,
        evidence_quote=change.evidence_quote, evidence_status=change.evidence_status, created_at=now,
    )
    db.add(line)
    db.flush()
    return line


def _judged(db: Session, row: ReplyJudgment, changes: list[ReplyChangeRequest], now: datetime) -> None:
    locked = _lock_tasks(db, {c.task_id for c in changes if c.field not in _NO_TASK_OUTCOME})
    owner_id = row.message.thread.member_id
    lines: list[ReplyChange] = []
    proposed: dict[str, list[tuple[ReplyChange, ReplyChangeRequest, matching.MatchResult | None]]] = defaultdict(list)
    for change in changes:
        if change.field in _NO_TASK_OUTCOME:
            lines.append(_line(db, row, change, _NO_TASK_OUTCOME[change.field], now))
            continue
        task = locked[change.task_id]
        match = _assignee(db, row, change, owner_id) if change.field == ReplyChangeField.ASSIGNEE else None
        value = (match.member_id or change.assignee_raw) if match else change.new_value
        outcome = ReplyChangeOutcome.SKIPPED if task.is_deleted else _gate(
            change, value, _current(db, change, task),
            owned=task.assignee_member_id == owner_id, blocked=task.status == TaskStatus.BLOCKED,
            unchanged=_unchanged(db, row, task),
        )
        line = _line(db, row, change, outcome, now, new_value=value)
        lines.append(line)
        # NOTED 는 이미 막힌 태스크라 상태는 그대로고 사유 규칙만 돈다.
        if outcome in (ReplyChangeOutcome.APPLIED, ReplyChangeOutcome.NOTED):
            _apply(db, task, line, now)
        elif outcome == ReplyChangeOutcome.PROPOSED:
            proposed[task.task_id].append((line, change, match))
    for task_id, group in proposed.items():
        _propose(db, row, locked[task_id], group, owner_id)
    unknown = any(line.outcome == ReplyChangeOutcome.UNKNOWN for line in lines)
    if not unknown and not any(line.task_id for line in lines):
        for task_id in _unrecorded(db, row):
            db.add(ReplyChange(
                message_id=row.message_id, task_id=task_id, field=ReplyChangeField.NONE,
                outcome=ReplyChangeOutcome.NOTED, created_at=now,
            ))
    row.state = ReplyJudgmentState.NEEDS_PM if unknown else ReplyJudgmentState.DONE
    message = row.message
    notice = _notice(
        message.thread.member.display_name, scheduler._preview(message.body), lines, locked, row.thread_id,
        picked=row.picked_task_id is not None,
    )
    if notice is not None:
        notifications.notify_pms(
            db, workspace_id=row.workspace_id, kind="reply_judged", text=notice.text,
            link_type=notice.link_type, link_id=notice.link_id, now=now, dedupe_key=_notice_key(row),
        )


def _lock_tasks(db: Session, task_ids: set[str]) -> dict[str, Task]:
    rows = db.scalars(
        select(Task)
        .where(Task.task_id.in_(task_ids))
        .order_by(Task.task_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    return {task.task_id: task for task in rows}


def _unrecorded(db: Session, row: ReplyJudgment) -> list[str]:
    """이 답장의 줄이 아직 없는 후보. 재판단에서 앞서 적은 태스크에 NONE 줄을 또 달지 않는다."""
    recorded = set(db.scalars(select(ReplyChange.task_id).where(ReplyChange.message_id == row.message_id)).all())
    return [task_id for task_id in json.loads(row.candidates) if task_id not in recorded]


def _assignee(
    db: Session, row: ReplyJudgment, change: ReplyChangeRequest, owner_id: str
) -> matching.MatchResult:
    if change.assignee_type == "first":
        return matching.speaker_match(db.get(Member, owner_id))
    return matching.resolve_assignee(db, row.workspace_id, change.assignee_raw)


def _claimed_status(row: ReplyJudgment, task: Task) -> str | None:
    return json.loads(row.claimed_statuses).get(task.task_id)


def _unchanged(db: Session, row: ReplyJudgment, task: Task) -> bool:
    """답장 뒤 사람이 상태를 바꾸지 않았고 옛 답장이 새 답장을 덮을 일이 없는가.

    _judge_status 는 사람이 건 막힘도 막기 전 상태로 보여 이것을 대신하지 못한다. 답장 판단과 스케줄러가 남긴 이력은
    사람 변경이 아니지만, 카드 승인과 되돌리기는 출처가 reminder_reply 여도 changed_by 가 있어 사람 변경이다.
    PM 이 고른 답장은 큐 끝으로 가므로 맡길 때 값이 이미 더 새 답장의 반영값일 수 있다.
    """
    replied_at = messages.utc(row.message.created_at)
    if db.scalar(
        select(TaskHistory.history_id)
        .where(
            TaskHistory.task_id == task.task_id,
            TaskHistory.changed_field == ChangedField.STATUS,
            TaskHistory.created_at > replied_at,
            or_(TaskHistory.changed_by.is_not(None), TaskHistory.change_source.notin_(scheduler._NOT_RESPONSE_SOURCES)),
        )
        .limit(1)
    ) is not None:
        return False
    if row.picked_task_id is None:
        return True
    return db.scalar(
        select(ReplyChange.change_id)
        .join(ThreadMessage, ThreadMessage.message_id == ReplyChange.message_id)
        .where(
            ReplyChange.task_id == task.task_id,
            ReplyChange.field != ReplyChangeField.NONE,
            ReplyChange.outcome.in_((
                ReplyChangeOutcome.APPLIED, ReplyChangeOutcome.PROPOSED, ReplyChangeOutcome.SKIPPED,
                ReplyChangeOutcome.NOTED,
            )),
            ThreadMessage.created_at > replied_at,
        )
        .limit(1)
    ) is None


def _current(db: Session, change: ReplyChangeRequest, task: Task) -> str | None:
    """게이트가 비교할 지금 값. 상태는 판단에 보인 값과 같은 _judge_status 다."""
    if change.field == ReplyChangeField.STATUS:
        return _judge_status(db, task)
    if change.field == ReplyChangeField.DUE_DATE:
        return task.due_date.isoformat() if task.due_date else None
    if change.field == ReplyChangeField.ASSIGNEE:
        return task.assignee_member_id
    return None


def _gate(
    change: ReplyChangeRequest, value: str | None, current: str | None, *, owned: bool, blocked: bool, unchanged: bool,
) -> ReplyChangeOutcome:
    """변경 한 줄의 갈림. 자동 반영은 상태 변경이면서 certain 이고 판단이 본 값이 지금도 그대로일 때만이다."""
    if change.field != ReplyChangeField.SCOPE and value == current:
        return ReplyChangeOutcome.SKIPPED
    if change.field == ReplyChangeField.STATUS:
        if change.evidence_status == "certain" and owned and unchanged and change.base and change.base.status == current:
            return ReplyChangeOutcome.APPLIED
        if value == TaskStatus.BLOCKED and blocked:
            return ReplyChangeOutcome.NOTED
    return ReplyChangeOutcome.PROPOSED


def _apply(db: Session, task: Task, line: ReplyChange, now: datetime) -> None:
    updates: dict[str, object] = {"status": line.new_value}
    # 무응답 사유는 답이 온 순간 사실이 아니다. PM 이 쓴 사유는 둔다. 답장 글은 대화 주인과 PM 만 보므로 원문을 쓰지 않는다.
    if line.new_value == TaskStatus.BLOCKED and (not task.blocker or task.blocker == scheduler.BLOCKER_TEXT):
        updates["blocker"] = line.summary or REPLY_BLOCKER_TEXT
    entries = tasks.apply_task_updates(db, task, updates, change_source=ChangeSource.REMINDER_REPLY)
    if not entries:
        line.outcome = ReplyChangeOutcome.NOTED
    for entry in entries:
        entry.reply_change_id = line.change_id
        entry.created_at = now


def _propose(
    db: Session, row: ReplyJudgment, task: Task,
    group: list[tuple[ReplyChange, ReplyChangeRequest, matching.MatchResult | None]], owner_id: str,
) -> None:
    """태스크당 승인 카드 한 장. 추출 경로의 task_update 승인과 키가 같고 회의 대신 답장을 가리킨다."""
    values: dict[str, object] = {}
    base_values: dict[str, object] = {}
    match = None
    for line, change, line_match in group:
        match = line_match or match
        key = _PAYLOAD_KEY.get(line.field)
        # 담당자를 못 찾았으면 원문만 보여 준다. 원문은 팀원 ID 가 아니라 값으로 싣지 않으므로 승인해도 담당자는 그대로다.
        if key and not (line_match and line_match.member_id is None):
            values[key] = line.new_value
            if line.field == ReplyChangeField.STATUS:
                base_values[key] = _claimed_status(row, task)
            else:
                base_values[key] = getattr(change.base, key) if change.base else _current(db, change, task)
    first_line, first = group[0][:2]
    payload = {
        **values,
        "base_values": base_values,
        "base_task_version": task.version,
        "base_title": (first.base.title if first.base else None) or task.title,
        "task_title": task.title,
        "doc_text": " ".join(dict.fromkeys(line.summary for line, *_ in group if line.summary)) or None,
        "category": _CATEGORY[ReplyChangeField.SCOPE if any(line.field == ReplyChangeField.SCOPE for line, *_ in group)
                              else first_line.field],
        "assignee_raw": next((c.assignee_raw for _, c, _m in group if c.assignee_raw), None),
        "assignee_needs_check": match.needs_check if match else False,
        "due_raw": None,
        "evidence_quote": first_line.evidence_quote,
        "evidence_speaker": None,
        "evidence_speaker_member_id": owner_id,
        "evidence_at_ms": None,
        "gate": str(Gate.REVIEW),
        "change_source": str(ChangeSource.REMINDER_REPLY),
        "reply_message_id": row.message_id,
    }
    approval = ApprovalRequest(
        workspace_id=row.workspace_id, type=str(ApprovalType.TASK_UPDATE),
        payload=json.dumps(payload, ensure_ascii=False), related_task_id=task.task_id, requested_by=None,
    )
    db.add(approval)
    db.flush()
    for line, *_ in group:
        line.approval_id = approval.approval_id


def rebase_cards(db: Session, task: Task) -> None:
    """막힘이 풀리면 대기 중인 답장 카드의 상태 기준을 따라 옮긴다. 답장이나 자동 막힘 되돌리기로 푼 것은 승인 충돌이 아니다."""
    for card in db.scalars(
        select(ApprovalRequest).where(
            ApprovalRequest.related_task_id == task.task_id, ApprovalRequest.status == ApprovalStatus.PENDING,
        )
    ).all():
        payload = json.loads(card.payload)
        base_values = payload.get("base_values", {})
        if payload.get("change_source") == ChangeSource.REMINDER_REPLY and base_values.get("status") == TaskStatus.BLOCKED:
            base_values["status"] = task.status
            card.payload = json.dumps(payload, ensure_ascii=False)


def _notice(
    name: str, preview: str, rows: list[ReplyChange], locked: dict[str, Task], thread_id: str, *, picked: bool = False,
) -> Notice | None:
    """답장 하나에 알림 하나. 한 건이면 그 태스크로, 그 밖은 대화로 보낸다. 바꿀 것이 없으면 알리지 않는다.

    PM 이 태스크를 고른 재판단은 바꿀 것이 없어도 알린다. 고른 PM 이 결과를 기다린다.
    """
    head = f"{name} 답장 '{preview}'"
    applied = [r for r in rows if r.outcome == ReplyChangeOutcome.APPLIED]
    asks = [r for r in rows if r.outcome == ReplyChangeOutcome.PROPOSED or r.field == ReplyChangeField.FAILED]
    unknown = any(r.outcome == ReplyChangeOutcome.UNKNOWN for r in rows)
    due_clear = any(r.field == ReplyChangeField.DUE_CLEAR for r in rows)
    if len(applied) + len(asks) == 1 and not unknown and not due_clear:
        row = (applied or asks)[0]
        if row.task_id and row.field != ReplyChangeField.FAILED:
            task = locked[row.task_id]
            tail = f"{task.title} {_STATUS_TO[row.new_value]} 바꿨어요(되돌리기)" if applied else _ask(row, task)
            return Notice(f"{head} → {tail}", "task", row.task_id)
    parts = []
    if applied:
        parts.append(f"{len(applied)}건 바꿨어요")
    if asks:
        parts.append(f"{len(asks)}건 확인이 필요해요")
    if unknown:
        parts.append("어느 태스크인지 골라 주세요")
    if due_clear:
        parts.append("마감을 없애자는 내용이에요. 직접 확인해 주세요")
    if picked and not parts:
        parts.append("바꿀 내용을 찾지 못했어요. 직접 확인해 주세요")
    return Notice(f"{head} → {', '.join(parts)}", "thread", thread_id) if parts else None


def _ask(row: ReplyChange, task: Task) -> str:
    if row.field == ReplyChangeField.STATUS:
        return f"{task.title} {_STATUS_TO[row.new_value]} 바꿀까요?"
    if row.field == ReplyChangeField.DUE_DATE:
        due = date.fromisoformat(row.new_value)
        verb = "당길까요" if task.due_date and due < task.due_date else "미룰까요"
        return f"{task.title} 마감을 {due.month}/{due.day}로 {verb}?"
    if row.field == ReplyChangeField.ASSIGNEE:
        return f"{task.title} 담당자를 바꿀까요?"
    return f"{task.title} 범위 변경을 확인해 주세요"


def _live_tasks(db: Session, task_ids: list[str]) -> set[str]:
    return set(db.scalars(select(Task.task_id).where(Task.task_id.in_(task_ids), Task.is_deleted.is_(False))).all())


def attribute(db: Session, workspace_id: str, message_id: str, task_id: str | None, now: datetime) -> None:
    """PM 이 태스크를 모르는 답장의 태스크를 고른다. 고르면 그 태스크만 후보로 다시 판단하고 task_id 가 None 이면 닫는다."""
    row = db.get(ReplyJudgment, message_id, with_for_update=True, populate_existing=True)
    if row is None or row.workspace_id != workspace_id:
        raise AppError(ErrorCode.REPLY_JUDGMENT_NOT_FOUND, details={"message_id": message_id})
    if row.state != ReplyJudgmentState.NEEDS_PM:
        raise AppError(ErrorCode.REPLY_ATTRIBUTION_NOT_NEEDED, details={"message_id": message_id, "state": row.state})
    if task_id is not None and task_id not in _live_tasks(db, json.loads(row.candidates)):
        raise AppError(ErrorCode.INVALID_REQUEST, message="후보에 없는 태스크입니다.", details={"task_id": task_id})
    for line in db.scalars(
        select(ReplyChange).where(
            ReplyChange.message_id == message_id, ReplyChange.outcome == ReplyChangeOutcome.UNKNOWN
        )
    ).all():
        line.outcome = ReplyChangeOutcome.DISMISSED if task_id is None else ReplyChangeOutcome.PICKED
    row.candidates = json.dumps([] if task_id is None else [task_id])
    if task_id is None:
        row.state = ReplyJudgmentState.DONE
    else:
        row.state, row.picked_task_id = ReplyJudgmentState.PENDING, task_id
        row.queued_at, row.claimed_at, row.finished_at = messages.utc(now), None, None
    db.flush()


def attributions(db: Session, workspace_id: str, thread_id: str) -> list[dict]:
    """그 대화에서 PM 이 태스크를 골라야 하거나 고른 답장들."""
    db.flush()
    rows = db.execute(
        select(ReplyJudgment, ReplyChange.outcome)
        .join(ReplyChange, ReplyChange.message_id == ReplyJudgment.message_id)
        .where(
            ReplyJudgment.workspace_id == workspace_id,
            ReplyJudgment.thread_id == thread_id,
            ReplyChange.outcome.in_(_ATTRIBUTION_OUTCOMES),
        )
        .order_by(ReplyJudgment.queued_at, ReplyJudgment.message_id)
    ).all()
    judgments = {row.message_id: (row, outcome) for row, outcome in rows}
    task_ids = {
        task_id for row, _ in judgments.values() for task_id in [*json.loads(row.candidates), row.picked_task_id]
    }
    titles = dict(db.execute(select(Task.task_id, Task.title).where(Task.task_id.in_(task_ids - {None}))).all())
    live = _live_tasks(db, list(titles))

    def ref(task_id: str) -> dict:
        return {"task_id": task_id, "title": titles[task_id]}

    return [
        {
            "message_id": row.message_id, "status": "needs_pm",
            "candidates": [ref(t) for t in json.loads(row.candidates) if t in live],
        }
        if outcome == ReplyChangeOutcome.UNKNOWN
        else {"message_id": row.message_id, "status": "resolved", "task": row.picked_task_id and ref(row.picked_task_id)}
        for row, outcome in judgments.values()
    ]


def undo_change(db: Session, task: Task, change_id: str, *, changed_by: str) -> Task:
    """자동 반영을 PM 이 되돌린다. 이어진 이력 중 하나라도 그 뒤 바뀌었으면 하나도 되돌리지 않는다. 닫힌 시계는 다시 열지 않는다.

    자동 막힘을 넘어온 변경은 막기 전 상태까지 간다. 시계가 닫혀 막힘으로 두면 풀 길이 없다.
    """
    change = db.get(ReplyChange, change_id)
    if change is None or change.task_id != task.task_id or change.outcome != ReplyChangeOutcome.APPLIED:
        raise AppError(ErrorCode.REPLY_CHANGE_NOT_UNDOABLE, details={"change_id": change_id})
    db.flush()
    entries = db.scalars(
        select(TaskHistory)
        .where(TaskHistory.reply_change_id == change_id, TaskHistory.is_rolled_back.is_(False))
        .order_by(TaskHistory.created_at.desc(), TaskHistory.history_id)
    ).all()
    if not entries:
        raise AppError(ErrorCode.REPLY_CHANGE_NOT_UNDOABLE, details={"change_id": change_id})
    left_block = any(e.changed_field == ChangedField.STATUS and e.old_value == TaskStatus.BLOCKED for e in entries)
    watch = scheduler.auto_block_watch(db, task) if left_block else None
    try:
        with db.begin_nested():
            for entry in entries:
                tasks.rollback_task_history(db, task, entry, changed_by=changed_by)
            if watch is not None:
                tasks.apply_task_updates(
                    db, task, {"status": watch.prev_status, "blocker": watch.prev_blocker},
                    change_source=ChangeSource.MANUAL, changed_by=changed_by,
                )
    except AppError as e:
        raise AppError(ErrorCode.REPLY_CHANGE_NOT_UNDOABLE, details={"change_id": change_id, **(e.details or {})}) from e
    return task


def link_history(db: Session, approval_id: str, entries: list[TaskHistory]) -> None:
    """승인이 남긴 이력을 제안한 줄에 잇는다. PM 이 고쳐 승인한 줄도 같은 필드라 같이 이어진다."""
    db.flush()
    change_ids = dict(db.execute(
        select(ReplyChange.field, ReplyChange.change_id).where(ReplyChange.approval_id == approval_id)
    ).all())
    for entry in entries:
        entry.reply_change_id = change_ids.get(entry.changed_field)


def timeline(db: Session, task: Task, viewer: Member) -> list[dict]:
    """태스크의 답장과 변경, 최신순. 답장에 이어진 이력은 답장 아래에만 나온다. 승인은 줄이 아니라 답장 줄의 결과다.

    답장 글은 대화 주인과 PM 만 본다(대화 조회와 같은 경계). 그 밖의 팀원에게는 무엇이 바뀌었는지만 보인다.
    """
    db.flush()
    history = db.scalars(select(TaskHistory).where(TaskHistory.task_id == task.task_id)).all()
    linked = defaultdict(list)
    for entry in history:
        if entry.reply_change_id:
            linked[entry.reply_change_id].append(entry)
    lines = db.scalars(
        select(ReplyChange)
        .where(ReplyChange.task_id == task.task_id)
        .order_by(ReplyChange.created_at, ReplyChange.change_id)
    ).all()
    approvals = dict(db.execute(
        select(ApprovalRequest.approval_id, ApprovalRequest.status)
        .where(ApprovalRequest.approval_id.in_({line.approval_id for line in lines} - {None}))
    ).all())
    by_message = defaultdict(list)
    for line in lines:
        by_message[line.message_id].append(line)
    items = [
        _reply_item(db, message_id, group, linked, approvals, viewer) for message_id, group in by_message.items()
    ] + [
        {
            "kind": "history", "history_id": entry.history_id, "changed_field": entry.changed_field,
            "old_value": entry.old_value, "new_value": entry.new_value, "change_source": entry.change_source,
            "at": messages.utc(entry.created_at),
        }
        for entry in history if entry.reply_change_id is None
    ]
    return sorted(items, key=lambda item: item["at"], reverse=True)


def _reply_item(
    db: Session, message_id: str, group: list[ReplyChange], linked: dict[str, list[TaskHistory]],
    approvals: dict[str, str], viewer: Member,
) -> dict:
    message = db.get(ThreadMessage, message_id)
    owner = message.thread.member
    readable = viewer.role == MemberRole.PM or viewer.member_id == owner.member_id
    changes = []
    for line in group:
        entries = linked[line.change_id]
        live = [entry for entry in entries if not entry.is_rolled_back]
        # PM 이 고쳐 승인했으면 이력의 값이 실제 값이다. 사유 이력도 같은 줄에 이어져 필드로 가른다.
        value = next((entry.new_value for entry in entries if entry.changed_field == line.field), line.new_value)
        changes.append({
            "change_id": line.change_id, "field": line.field, "new_value": value,
            "evidence_status": line.evidence_status,
            "summary": line.summary if readable else None,
            "evidence_quote": line.evidence_quote if readable else None,
            "result": "undone" if entries and not live else _result(line, approvals, entries),
            "undoable": line.outcome == ReplyChangeOutcome.APPLIED and bool(live),
        })
    return {
        "kind": "reply", "at": messages.utc(message.created_at), "message_id": message_id,
        "member_name": owner.display_name, "channel": message.reply_channel,
        "body": message.body if readable else None, "changes": changes,
    }


def _result(line: ReplyChange, approvals: dict[str, str], entries: list[TaskHistory]) -> str:
    if line.outcome == ReplyChangeOutcome.PROPOSED:
        status = approvals[line.approval_id]
        # 담당자를 못 찾은 카드는 승인해도 바뀌는 값이 없다.
        unchanged = status == ApprovalStatus.APPROVED and line.field == ReplyChangeField.ASSIGNEE and not entries
        return "noted" if unchanged else status
    if line.outcome in (ReplyChangeOutcome.APPLIED, ReplyChangeOutcome.RECORDED):
        return line.outcome
    return "noted"


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
    """답장 하나의 효과. lines 는 이 태스크의 줄이다. 후보 안의 태스크라도 답장이 말하지 않았으면 그 시계는 계속 센다.

    PM 이 다른 태스크를 고른 뒤에는 재판단의 상태가 이 시계를 가르지 않는다. 첫 판단이 이 태스크에 남긴 줄만 본다.
    """
    if row.state is None:
        return ClockEffect.ANSWERED
    if row.picked_task_id in (None, task_id):
        if row.state in (ReplyJudgmentState.FAILED, ReplyJudgmentState.TIMED_OUT):
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
