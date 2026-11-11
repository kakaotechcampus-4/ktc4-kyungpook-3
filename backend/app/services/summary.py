"""회의 요약 대기열과 저장, 팀원의 주제·결정 고치기. Extraction.summary*, Topic*, Decision 의 유일한 작성자다.

대기열 상태는 Extraction의 요청·시도·임대에서 나오고 claim token hash가 같은 임대의 저장만 허용한다.

- 대상 아님: summary_requested_at 이 NULL. 옛 회의가 여기 있어 표시 없이는 돌지 않는다.
- 승인 대기: 표시가 있어도 item_fate.ready 가 아니면 claim 이 건너뛴다. 승인이 끝나면 훅 없이 다음 claim 이 집는다.
- 대기: 표시가 있고 attempts 가 상한 아래이며 임대가 없거나 지났다.
- 처리 중: 임대가 살아 있다.
- 포기: attempts 가 상한에 닿았고 임대가 지났다. 재처리(force)로만 살아난다.
- 완료: summary 가 있고 표시가 비었다.

실패를 알리는 API 가 없다. 봇이 보내지 않으면 임대가 지나 다음 claim 이 다시 집으므로 LLM 실패와 워커 크래시가 같은 길을 간다.
"""
import json
import hashlib
import logging
import secrets
import unicodedata
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import delete, exists, func, or_, select, tuple_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.core.errors import AppError, ErrorCode
from app.models import (
    ApprovalRequest,
    Decision,
    DecisionState,
    Extraction,
    ExtractionAction,
    ExtractionItem,
    Meeting,
    MeetingStatus,
    Member,
    Source,
    Task,
    Topic,
    TopicAlias,
    TopicItem,
    TopicMeeting,
    TopicTaskDetach,
    Workspace,
    WorkspaceAsrTerm,
)
from app.schemas.project_map import (
    SummaryClaimResponse,
    SummaryInputDecision,
    SummaryInputItem,
    SummaryInputLine,
    SummaryInputResponse,
    SummaryInputTopic,
    SummaryRequestResponse,
    SummaryRequestRow,
    SummaryRequestState,
    SummarySaveResponse,
    SummaryTopicIn,
    SummaryWriteRequest,
)
from app.services.messages import utc
from app.services import item_fate, lifecycle, meeting_deletion
from app.services.scheduler import WORKSPACE_TZ

logger = logging.getLogger(__name__)

SUMMARY_MAX_ATTEMPTS = 2
SUMMARY_LEASE = timedelta(minutes=15)
# 표시나 마지막 승인 처리 뒤 이만큼 지나면 화면에 요약 중이라 하지 않는다. 스위치가 꺼졌거나 워커가 멈추면 끝없이 요약 중으로
# 보이기 때문이다. 일감은 그대로 남아 나중에 집히면 요약이 나타난다
SUMMARY_PENDING_WINDOW = timedelta(hours=1)
JOB_TOPIC_LIMIT = 100
JOB_DECISION_LIMIT = 50
SCHEMA_VERSION = 2


def meeting_date(started_at: datetime) -> date:
    """회의가 열린 날. 워크스페이스 시간대 기준이다."""
    return utc(started_at).astimezone(WORKSPACE_TZ).date()


def mark_requested(db: Session, meeting: Meeting, extraction: Extraction) -> None:
    """발화가 있으면 줄 세운다. 승인을 기다리는지는 claim 이 본다. 커밋은 호출자가 한다."""
    if db.scalar(select(exists().where(Source.meeting_id == meeting.meeting_id))):
        extraction.summary_requested_at = datetime.now(timezone.utc)


def claim_next(db: Session, *, only: list[str] | None = None, now: datetime | None = None) -> SummaryClaimResponse | None:
    """가장 오래된 회의 하나를 가져간다. 앞 회의의 주제와 결정이 있어야 뒤 회의가 재사용하고 뒤집을 수 있어 회의 시각 순이다.

    only 를 주면 그 extraction 안에서만 고른다. 빈 목록이면 아무것도 고르지 않는다. 커밋은 호출자가 한다.
    """
    now = now or datetime.now(timezone.utc)
    # 워커와 측정 명령이 동시에 claim 하거나 저장해도 커밋 전인 앞 claim·주제 연결을 건너뛰지 않게 한 줄로 선다
    lifecycle.worker_gate(db)
    lease_alive = Extraction.summary_claimed_at > now - SUMMARY_LEASE
    # 앞 회의의 시도가 저장 없이 끝났으면 임대가 끝날 때까지 같은 워크스페이스의 뒤 회의를 주지 않는다. 포기한 앞 회의는 막지 않는다
    earlier, earlier_meeting = aliased(Extraction), aliased(Meeting)
    earlier_in_flight = exists().where(
        earlier_meeting.meeting_id == earlier.meeting_id,
        earlier_meeting.workspace_id == Meeting.workspace_id,
        earlier_meeting.deleted_at.is_(None),
        tuple_(earlier_meeting.started_at, earlier.extraction_id) < tuple_(Meeting.started_at, Extraction.extraction_id),
        earlier.summary_requested_at.is_not(None),
        earlier.summary_claimed_at > now - SUMMARY_LEASE,
    )
    stmt = (
        select(Extraction)
        .join(Meeting, Meeting.meeting_id == Extraction.meeting_id)
        .join(Workspace, Workspace.workspace_id == Meeting.workspace_id)
        .where(
            Workspace.deleted_at.is_(None),
            Meeting.deleted_at.is_(None),
            Meeting.status == MeetingStatus.DONE,
            Extraction.summary_requested_at.is_not(None),
            Extraction.summary_attempts < SUMMARY_MAX_ATTEMPTS,
            or_(Extraction.summary_claimed_at.is_(None), ~lease_alive),
            ~earlier_in_flight,
            item_fate.ready(Extraction.extraction_id, Meeting.source),
        )
        .order_by(Meeting.started_at, Extraction.extraction_id)
        .limit(1)
        .execution_options(populate_existing=True)
    )
    if only is not None:
        stmt = stmt.where(Extraction.extraction_id.in_(only))
    extraction = db.scalars(stmt).first()
    if extraction is None:
        return None
    workspace = lifecycle.workspace(db, extraction.meeting.workspace_id, check_epoch=False)
    meeting = db.scalar(select(Meeting).where(Meeting.meeting_id == extraction.meeting_id)
                        .with_for_update().execution_options(populate_existing=True))
    if meeting is None or meeting.deleted_at is not None or meeting.status != MeetingStatus.DONE:
        return None
    extraction = db.get(Extraction, extraction.extraction_id, with_for_update=True, populate_existing=True)
    if extraction is None or extraction.summary_requested_at is None or extraction.summary_attempts >= SUMMARY_MAX_ATTEMPTS:
        return None
    if extraction.summary_claimed_at is not None and utc(extraction.summary_claimed_at) > utc(now) - SUMMARY_LEASE:
        return None
    # 고른 뒤 잠그기 전에 되돌리기나 합치기가 대기 카드를 붙였을 수 있다
    if not item_fate.readiness(db, extraction, meeting.source).ready:
        return None
    token = secrets.token_urlsafe(32)
    extraction.summary_attempts += 1
    extraction.summary_claimed_at = now
    extraction.summary_claim_token_hash = _token_hash(token, workspace.identity_epoch)
    db.flush()
    return SummaryClaimResponse(
        extraction_id=extraction.extraction_id,
        meeting_id=extraction.meeting_id,
        workspace_id=extraction.meeting.workspace_id,
        attempt=extraction.summary_attempts,
        claim_token=token,
        identity_epoch=workspace.identity_epoch,
    )


def _token_hash(token: str, identity_epoch: int) -> str:
    return hashlib.sha256(f"{identity_epoch}:{token}".encode()).hexdigest()


def require_live_extraction(db: Session, extraction_id: str, *, lock: bool = False) -> tuple[Meeting, Extraction]:
    meeting_id = db.scalar(select(Extraction.meeting_id).where(Extraction.extraction_id == extraction_id))
    if meeting_id is None:
        raise AppError(ErrorCode.EXTRACTION_NOT_FOUND, details={"extraction_id": extraction_id})
    meeting = meeting_deletion.require_live_meeting(db, meeting_id, lock=lock)
    extraction = db.get(Extraction, extraction_id, with_for_update=lock, populate_existing=True)
    if extraction is None:
        raise AppError(ErrorCode.EXTRACTION_NOT_FOUND, details={"extraction_id": extraction_id})
    return meeting, extraction


def summary_input(db: Session, extraction_id: str) -> SummaryInputResponse:
    """요약 재료. 상태를 바꾸지 않아 미리 보기가 같이 쓴다."""
    meeting, extraction = require_live_extraction(db, extraction_id)
    workspace = db.get(Workspace, meeting.workspace_id)
    expected_epoch = db.info.get("privacy_epoch")
    if expected_epoch is not None and expected_epoch != str(workspace.identity_epoch):
        raise AppError(ErrorCode.PRIVACY_VERSION_CHANGED, details={"identity_epoch": workspace.identity_epoch})
    return SummaryInputResponse(
        extraction_id=extraction.extraction_id,
        meeting_id=meeting.meeting_id,
        workspace_id=meeting.workspace_id,
        identity_epoch=workspace.identity_epoch,
        title=meeting.title,
        started_at=meeting.started_at,
        source=meeting.source,
        members=list(db.scalars(
            select(Member.display_name)
            .where(Member.workspace_id == meeting.workspace_id, Member.is_deleted.is_(False))
            .order_by(Member.created_at, Member.member_id)
        )),
        asr_terms=sorted(db.scalars(
            select(WorkspaceAsrTerm.word).where(WorkspaceAsrTerm.workspace_id == meeting.workspace_id)
        )),
        lines=_input_lines(db, meeting.meeting_id),
        items=(items := _input_items(db, extraction_id)),
        rejected_items=_input_rejected(db, extraction_id, {item.title for item in items}),
        topics=_input_topics(db, meeting.workspace_id),
        decisions=_input_decisions(db, meeting),
    )


def _input_lines(db: Session, meeting_id: str) -> list[SummaryInputLine]:
    rows = db.execute(
        select(Source, Member.display_name)
        .outerjoin(Member, Member.member_id == Source.member_id)
        .where(Source.meeting_id == meeting_id)
        .order_by(Source.seq)
    ).all()
    return [
        SummaryInputLine(
            seq=src.seq,
            at_ms=src.start_ms,
            speaker=display_name or src.speaker_name or src.speaker_discord_user_id or "Unknown",
            text=src.shown_text,
        )
        for src, display_name in rows
    ]


def _input_items(db: Session, extraction_id: str) -> list[SummaryInputItem]:
    """반영된 항목만. 값은 그 회의 항목이 정한 값에 PM 이 승인하며 고친 값을 덮은 것이다. 뒤 회의나 직접 수정이
    바꾼 Task 의 지금 값은 쓰지 않는다. 같은 Task 의 새 항목(create, merge)은 먼저 나온 하나만 둔다. 수정 항목은
    카드마다 따로 승인되고 바꾼 칸만 있어 접으면 승인된 변경이 사라지므로 항목마다 둔다."""
    final = item_fate.final_items().where(ExtractionItem.extraction_id == extraction_id).subquery()
    rows = db.execute(
        select(ExtractionItem, ApprovalRequest.payload)
        .join(final, final.c.item_id == ExtractionItem.item_id)
        .outerjoin(ApprovalRequest, ApprovalRequest.approval_id == ExtractionItem.approval_id)
        .order_by(final.c.created_at, final.c.item_id)
    ).all()
    approved: dict[str, tuple[ExtractionItem, dict]] = {}
    for item, payload in rows:
        key = item.item_id if item.action == str(ExtractionAction.UPDATE) else item.task_id
        approved.setdefault(key, (item, _approved_values(item, json.loads(payload) if payload else {})))
    names = _member_names(db, {values["assignee_member_id"] for _, values in approved.values()})
    return [
        SummaryInputItem(
            item_id=item.item_id, action=item.action, title=values["task_title"],
            assignee=names.get(values["assignee_member_id"]), due_date=values["due_date"], status=values["status"],
            cleared=values["cleared"], scope=values["scope"],
        )
        for item, values in approved.values()
    ]


# 수정 항목이 바꿀 수 있는 값. 카드 payload 에 같은 이름 키가 있으면 그 수정이 바꾼 것이고, 값이 None 이면 비운 것이다
_UPDATE_FIELDS = ("assignee_member_id", "due_date", "status")
# 비울 수 있는 칸과 재료에서의 이름
_CLEARABLE = {"assignee_member_id": "assignee", "due_date": "due_date"}


def _approved_values(item: ExtractionItem, payload: dict) -> dict:
    """새 항목은 항목 값, 수정 항목은 그 수정이 바꾼 값에 PM 이 고친 값(task_overrides)을 덮는다."""
    overrides = payload.get("task_overrides") or {}
    if item.action == str(ExtractionAction.UPDATE):
        return _update_change(item, {**payload, **overrides})
    return {"task_title": item.task_title, "assignee_member_id": item.assignee_member_id,
            "due_date": item.due_date, "status": None, "cleared": [], "scope": None, **overrides}


def _update_change(item: ExtractionItem, card: dict) -> dict:
    """수정 카드가 바꾼 값. 바꾸지 않은 칸은 None 이고 비운 칸은 cleared 에 적는다. 범위 결정은 바꾸는 칸이 없어
    승인 때 이력에 남기는 설명(doc_text)을 scope 로 둔다."""
    changed = {field: card[field] for field in _UPDATE_FIELDS if field in card}
    doc_text = card.get("doc_text")
    scope = doc_text.strip() if card.get("category") == "scope" and isinstance(doc_text, str) else ""
    return {
        "task_title": item.task_title,
        **{field: changed.get(field) for field in _UPDATE_FIELDS},
        "cleared": [name for field, name in _CLEARABLE.items() if field in changed and changed[field] is None],
        "scope": scope or None,
    }


def _member_names(db: Session, member_ids: set[str | None]) -> dict[str, str]:
    ids = member_ids - {None}
    if not ids:
        return {}
    return dict(db.execute(select(Member.member_id, Member.display_name).where(Member.member_id.in_(ids))).all())


def _input_rejected(db: Session, extraction_id: str, approved_titles: set[str]) -> list[str]:
    """그 회의에서 PM 이 반려한 할 일. 요약 문장이 정해진 일로 쓰지 않게 준다. 수정 항목은 Task 가 그대로 있어 반려된
    변경을 같이 적고, 바꿀 값이 없던 수정은 그 설명을 적는다. 반영된 항목의 제목과 같은 것은 빼서 승인된 일을 막지 않는다."""
    rejected = item_fate.rejected_items().where(ExtractionItem.extraction_id == extraction_id).subquery()
    rows = db.execute(
        select(ExtractionItem, ApprovalRequest.payload)
        .join(rejected, rejected.c.item_id == ExtractionItem.item_id)
        .join(ApprovalRequest, ApprovalRequest.approval_id == ExtractionItem.approval_id)
        .order_by(rejected.c.created_at, rejected.c.item_id)
    ).all()
    payloads = [json.loads(payload) for _, payload in rows]
    names = _member_names(db, {payload.get("assignee_member_id") for payload in payloads})
    titles: list[str] = []
    for (item, _), payload in zip(rows, payloads):
        title = item.task_title
        if item.action == str(ExtractionAction.UPDATE):
            change = _update_change(item, payload)
            changed = [f"{label} {value}" for label, value in (
                ("담당", "없앰" if "assignee" in change["cleared"] else names.get(change["assignee_member_id"])),
                ("마감", "없앰" if "due_date" in change["cleared"] else change["due_date"]),
                ("상태", change["status"]),
            ) if value] + ([f"범위: {change['scope']}"] if change["scope"] else [])
            changed = changed or ([item.doc_text] if item.doc_text else [])
            if not changed:
                continue
            title = f"{title} (반려된 변경: {', '.join(changed)})"
        if title not in approved_titles and title not in titles:
            titles.append(title)
    return titles


def _input_topics(db: Session, workspace_id: str) -> list[SummaryInputTopic]:
    rows = db.scalars(
        select(Topic)
        .join(TopicMeeting, TopicMeeting.topic_id == Topic.topic_id)
        .join(Meeting, Meeting.meeting_id == TopicMeeting.meeting_id)
        .where(Topic.workspace_id == workspace_id, Meeting.deleted_at.is_(None))
        .group_by(Topic.topic_id)
        .order_by(func.max(Meeting.started_at).desc(), Topic.topic_id)
        .limit(JOB_TOPIC_LIMIT)
    ).all()
    return [SummaryInputTopic(topic_id=t.topic_id, name=t.name, description=t.description) for t in rows]


def _input_decisions(db: Session, meeting: Meeting) -> list[SummaryInputDecision]:
    """이 회의 시점에 유효했던 결정. 순서가 어긋난 측정이나 전체 재실행도 같은 조건으로 돈다."""
    replacement = aliased(Decision)
    replacement_meeting = aliased(Meeting)
    rows = db.execute(
        select(Decision.decision_id, Decision.text, Topic.name, Meeting.started_at)
        .join(Topic, Topic.topic_id == Decision.topic_id)
        .join(Meeting, Meeting.meeting_id == Decision.meeting_id)
        .outerjoin(replacement, replacement.decision_id == Decision.replaced_by)
        .outerjoin(replacement_meeting, replacement_meeting.meeting_id == replacement.meeting_id)
        .where(
            Decision.workspace_id == meeting.workspace_id,
            Meeting.deleted_at.is_(None),
            Meeting.started_at < meeting.started_at,
            Decision.state == DecisionState.VALID,
            or_(Decision.replaced_by.is_(None), replacement_meeting.started_at >= meeting.started_at),
        )
        .order_by(Meeting.started_at.desc(), Meeting.meeting_id, Decision.position)
        .limit(JOB_DECISION_LIMIT)
    ).all()
    return [
        SummaryInputDecision(decision_id=decision_id, text=text, topic=topic, decided_on=meeting_date(started_at))
        for decision_id, text, topic, started_at in rows
    ]


def request_summaries(
    db: Session,
    workspace_id: str,
    *,
    meeting_ids: list[str] | None,
    include_all: bool,
    force: bool,
    dry_run: bool,
    now: datetime | None = None,
) -> SummaryRequestResponse:
    """재처리 표시. dry_run 이면 쓰지 않고, state=requested 는 표시할 회의라는 뜻이다.

    force 면 시도 횟수를 비우고 다시 줄 세운다. 기존 요약은 새 요약이 올 때까지 남는다. 커밋은 호출자가 한다.
    """
    now = now or datetime.now(timezone.utc)
    lifecycle.workspace(db, workspace_id)
    stmt = select(Meeting).where(Meeting.workspace_id == workspace_id).order_by(Meeting.started_at, Meeting.meeting_id)
    if include_all:
        stmt = stmt.where(Meeting.deleted_at.is_(None))
    if not include_all:
        stmt = stmt.where(Meeting.meeting_id.in_(meeting_ids))
    meetings = db.scalars(stmt).all()
    if not include_all:
        missing = set(meeting_ids) - {meeting.meeting_id for meeting in meetings}
        if missing:
            raise AppError(ErrorCode.MEETING_NOT_FOUND, details={"meeting_ids": sorted(missing)})

    found_ids = [meeting.meeting_id for meeting in meetings]
    # 시각 오름차순으로 덮어 회의마다 최신 추출만 남긴다. /minutes 가 읽는 행과 같다
    extractions = {
        extraction.meeting_id: extraction
        for extraction in db.scalars(
            select(Extraction).where(Extraction.meeting_id.in_(found_ids)).order_by(Extraction.created_at)
        )
    }
    chars = dict(db.execute(
        select(Source.meeting_id, func.sum(func.length(Source.text)))
        .where(Source.meeting_id.in_(found_ids))
        .group_by(Source.meeting_id)
    ).all())

    rows = []
    for meeting in meetings:
        meeting_deletion.assert_live(meeting)
        extraction = extractions.get(meeting.meeting_id)
        meeting_chars = int(chars.get(meeting.meeting_id) or 0)
        state = _request_state(db, meeting, extraction, meeting_chars, force=force, now=now)
        if (state in ("requested", "awaiting_approval") and not dry_run
                and (force or extraction.summary_requested_at is None)):
            extraction.summary_requested_at = now
            extraction.summary_attempts = 0
            extraction.summary_claimed_at = None
            extraction.summary_claim_token_hash = None
        rows.append(SummaryRequestRow(
            meeting_id=meeting.meeting_id,
            extraction_id=extraction.extraction_id if extraction else None,
            title=meeting.title,
            started_at=meeting.started_at,
            state=state,
            chars=meeting_chars,
        ))
    db.flush()
    return SummaryRequestResponse(items=rows)


def _request_state(
    db: Session, meeting: Meeting, extraction: Extraction | None, chars: int, *, force: bool, now: datetime
) -> SummaryRequestState:
    """awaiting_approval 은 표시했거나 지금 표시하지만 승인이 끝나야 도는 회의, no_approved_items 는 표시하지 않는 채팅 회의다."""
    if meeting.status != MeetingStatus.DONE or extraction is None:
        return "not_done"
    if not chars:
        return "no_sources"
    leased = extraction.summary_claimed_at is not None and utc(extraction.summary_claimed_at) > utc(now) - SUMMARY_LEASE
    if extraction.summary_requested_at is not None and leased:
        return "queued"     # 돌고 있는 회의는 force 로도 덮지 않는다. 덮으면 같은 회의에 호출이 두 번 나간다
    if not force and extraction.summary_requested_at is None and _stored(extraction) is not None:
        return "done"
    readiness = item_fate.readiness(db, extraction, meeting.source)
    if not readiness.waiting_cards and not readiness.ready:
        return "no_approved_items"
    waits = "awaiting_approval" if readiness.waiting_cards else None
    if force:
        return waits or "requested"
    if extraction.summary_requested_at is not None:
        return (waits or "queued") if _queue_alive(extraction, now) else "gave_up"
    return waits or "requested"


def _queue_alive(extraction: Extraction, now: datetime) -> bool:
    """표시된 행이 아직 끝나지 않았는가. 마지막 시도의 임대가 살아 있으면 끝난 것이 아니다."""
    if extraction.summary_requested_at is None:
        return False
    if extraction.summary_attempts < SUMMARY_MAX_ATTEMPTS:
        return True
    claimed_at = extraction.summary_claimed_at
    return claimed_at is not None and utc(claimed_at) > utc(now) - SUMMARY_LEASE


def documents(db: Session, rows: list[tuple[Meeting, Extraction | None]]) -> dict[str, dict]:
    """화면, summary.md, 합본이 읽는 유일한 요약. meeting_id -> 보여 줄 문서. 회의 수와 무관하게 쿼리는 많아야 다섯 번이다.

    JSON 은 AI 의 기록이고 결정 문장·상태와 주제 이름은 행이 정본이라 여기서 합친다. 결정은 지우지 않은 행을 회의 안 순서로 두고
    문자열 목록(decisions)에는 유효한 것만 둔다. 버린 대안과 뒤집은 결정 사본은 같은 decision_id 의 JSON 에서 가져오고, 사본은
    지운 결정을 빼고 회의 제목을 지금 값으로 바꾼다. 주제는 회의에 이어진 주제의 지금 이름을 저장된 순서대로 둔다.
    할 일 변화는 항목이 지금 반영된 것만 보인다. 항목 키가 없는 옛 요약의 할 일 변화와 요약 뒤 되돌린 항목은 숨는다.
    """
    stored = {
        meeting.meeting_id: (extraction.extraction_id, document)
        for meeting, extraction in rows
        if (document := _stored(extraction)) is not None
    }
    if not stored:
        return {}
    final = item_fate.final_items().where(
        ExtractionItem.extraction_id.in_({extraction_id for extraction_id, _ in stored.values()})
    ).subquery()
    shown = set(db.execute(select(final.c.extraction_id, final.c.item_id)).all())
    for extraction_id, document in stored.values():
        if isinstance(document.get("task_changes"), list):
            document["task_changes"] = [
                change for change in document["task_changes"]
                if isinstance(change, dict) and (extraction_id, change.get("item_id")) in shown
            ]
    decisions: dict[str, list[tuple[Decision, str]]] = {}
    for row, topic_name in db.execute(
        select(Decision, Topic.name).join(Topic, Topic.topic_id == Decision.topic_id)
        .where(Decision.meeting_id.in_(stored), Decision.state != DecisionState.REMOVED)
        .order_by(Decision.meeting_id, Decision.position)
    ):
        decisions.setdefault(row.meeting_id, []).append((row, topic_name))
    topics: dict[str, list[tuple[str, str]]] = {}
    for meeting_id, topic_id, name in db.execute(
        select(TopicMeeting.meeting_id, Topic.topic_id, Topic.name).join(Topic, Topic.topic_id == TopicMeeting.topic_id)
        .where(TopicMeeting.meeting_id.in_(stored)).order_by(Topic.created_at, Topic.topic_id)
    ):
        topics.setdefault(meeting_id, []).append((topic_id, name))
    records = {
        meeting_id: {detail.get("decision_id"): detail for detail in document.get("decision_details", [])
                     if isinstance(detail, dict)}
        for meeting_id, (_, document) in stored.items()
    }
    copies = [copy for details in records.values() for detail in details.values()
              for copy in detail.get("replaces", []) if isinstance(copy, dict)]
    removed = set(db.scalars(select(Decision.decision_id).where(
        Decision.decision_id.in_({copy.get("decision_id") for copy in copies}), Decision.state == DecisionState.REMOVED,
    ))) if copies else set()
    titles = dict(db.execute(select(Meeting.meeting_id, Meeting.title).where(
        Meeting.meeting_id.in_({copy.get("meeting_id") for copy in copies}),
    )).all()) if copies else {}
    for meeting_id, (_, document) in stored.items():
        details = []
        for row, topic_name in decisions.get(meeting_id, []):
            record = records[meeting_id].get(row.decision_id, {})
            details.append({
                "decision_id": row.decision_id,
                "text": row.text,
                "reason": row.reason,
                "rejected": record.get("rejected", []),
                "topic": topic_name,
                "replaces": [
                    {**copy, "meeting_title": titles.get(copy.get("meeting_id"), copy.get("meeting_title"))}
                    for copy in record.get("replaces", [])
                    if isinstance(copy, dict) and copy.get("decision_id") not in removed
                ],
                "state": row.state,
                "edited": row.edited_at is not None,
            })
        document["decision_details"] = details
        document["decisions"] = [detail["text"] for detail in details if detail["state"] == DecisionState.VALID]
        order = {topic_id: i for i, topic_id in enumerate(document.get("topic_ids") or [])}
        linked = sorted(topics.get(meeting_id, []), key=lambda topic: order.get(topic[0], len(order)))
        document["topics"] = [name for _, name in linked]
        document["topic_ids"] = [topic_id for topic_id, _ in linked]
    return {meeting_id: document for meeting_id, (_, document) in stored.items()}


def has_document(extraction: Extraction | None) -> bool:
    return _stored(extraction) is not None


def _stored(extraction: Extraction | None) -> dict | None:
    """저장된 요약. 없거나, 깨졌거나, 객체가 아니면 None. 모듈 밖에서는 documents() 와 has_document() 를 쓴다."""
    if extraction is None or not extraction.summary:
        return None
    try:
        document = json.loads(extraction.summary)
    except ValueError:  # JSONDecodeError 포함
        return None
    return document if isinstance(document, dict) else None


SummaryStatus = Literal["ready", "pending", "awaiting_approval", "none"]


@dataclass(frozen=True)
class SummaryState:
    status: SummaryStatus
    waiting_cards: int = 0


_NO_EXTRACTION = item_fate.Readiness(ready=False, waiting_cards=0, last_resolved_at=None)


def summary_state(
    db: Session, meeting: Meeting, extraction: Extraction | None, *, now: datetime | None = None
) -> SummaryState:
    readiness = _NO_EXTRACTION if extraction is None else item_fate.readiness(db, extraction, meeting.source)
    return _state(extraction, has_document(extraction), readiness, now or datetime.now(timezone.utc))


def _state(extraction: Extraction | None, has_doc: bool, r: item_fate.Readiness, now: datetime) -> SummaryState:
    """순수 함수. 승인 대기는 시간 제한 없이 기다리고, 승인된 항목이 없는 채팅 회의는 요약하지 않는다."""
    if has_doc:
        return SummaryState("ready")
    if extraction is None or not _queue_alive(extraction, now):
        return SummaryState("none")
    if r.waiting_cards:
        return SummaryState("awaiting_approval", r.waiting_cards)
    if not r.ready:
        return SummaryState("none")
    since = max(utc(t) for t in (extraction.summary_requested_at, r.last_resolved_at) if t is not None)
    return SummaryState("pending" if since > utc(now) - SUMMARY_PENDING_WINDOW else "none")


def normalize_topic_name(name: str) -> str:
    """표기만 다른 이름을 하나로 모은다. 비슷하지만 다른 이름을 합치는 일은 하지 않는다."""
    letters = (
        ch for ch in unicodedata.normalize("NFKC", name).lower() if unicodedata.category(ch)[0] in "LMN"
    )
    # NFKC 가 글자 수를 늘릴 수 있어 칸 길이에 맞춘다
    return "".join(letters)[:100]


def save_summary(db: Session, extraction_id: str, payload: SummaryWriteRequest) -> SummarySaveResponse:
    """요약, 주제, 연결, 결정을 한 트랜잭션에 쓴다. 커밋은 호출자가 한다.

    공간·회의·추출 순으로 잠그고 요청 표시와 살아 있는 임대의 토큰을 확인한다. 이 회의의 연결과 결정은 지우고 다시 써서 한 벌이다.
    다른 extraction 의 항목, 다른 워크스페이스의 주제와 결정, 이 회의보다 늦은 결정은 건너뛴다.
    """
    lifecycle.worker_gate(db)
    meeting, extraction = require_live_extraction(db, extraction_id, lock=True)
    workspace = db.get(Workspace, meeting.workspace_id)
    now = datetime.now(timezone.utc)
    if (extraction.summary_requested_at is None
            or extraction.summary_claim_token_hash is None
            or not secrets.compare_digest(
                extraction.summary_claim_token_hash, _token_hash(payload.claim_token, workspace.identity_epoch))
            or extraction.summary_claimed_at is None
            or utc(extraction.summary_claimed_at) <= now - SUMMARY_LEASE):
        return SummarySaveResponse(
            extraction_id=extraction_id, meeting_id=extraction.meeting_id, applied=False, topic_count=0, decision_count=0
        )

    previous_topics = set(
        db.scalars(select(TopicMeeting.topic_id).where(TopicMeeting.meeting_id == meeting.meeting_id))
    )
    previous_decisions = _decision_keys(db, meeting.meeting_id)
    frozen = _clear_meeting(db, meeting.meeting_id, extraction_id, keep_human=True)
    kept_topics = set(
        db.scalars(select(TopicMeeting.topic_id).where(TopicMeeting.meeting_id == meeting.meeting_id))
    )

    item_ids = set(db.scalars(select(ExtractionItem.item_id).where(ExtractionItem.extraction_id == extraction_id)))
    topics: dict[str, str] = {}
    links: set[tuple[str, str]] = set()
    # 결정을 고정한 회의는 AI 의 결정을 버리고 앞 요약의 결정 기록을 그대로 옮긴다. 행의 위치와 ID 가 그대로라 맞는다
    details: list[dict] = list((_stored(extraction) or {}).get("decision_details", [])) if frozen else []
    for entry in payload.topics:
        topic = _resolve_topic(db, meeting.workspace_id, entry)
        if topic is None:
            logger.warning(
                "주제를 찾지 못해 건너뜁니다. 그 아래 결정도 저장하지 않습니다. extraction_id=%s topic_id=%s name=%s",
                extraction_id, entry.topic_id, entry.name,
            )
            continue
        topics.setdefault(topic.topic_id, topic.name)
        links.update((topic.topic_id, item_id) for item_id in entry.item_ids if item_id in item_ids)
        for decision in [] if frozen else entry.decisions:
            row = Decision(
                workspace_id=meeting.workspace_id,
                meeting_id=meeting.meeting_id,
                topic_id=topic.topic_id,
                position=len(details),
                text=decision.text,
                reason=decision.reason,
            )
            db.add(row)
            db.flush()
            details.append({
                "decision_id": row.decision_id,
                "text": decision.text,
                "reason": decision.reason,
                "rejected": decision.rejected,
                "topic": topic.name,
                "replaces": _replaced_copies(db, meeting, decision.replaces),
            })

    db.add_all(TopicMeeting(topic_id=topic_id, meeting_id=meeting.meeting_id) for topic_id in topics.keys() - kept_topics)
    db.add_all(TopicItem(topic_id=topic_id, item_id=item_id) for topic_id, item_id in links)
    extraction.summary = json.dumps(_document(payload, topics, details), ensure_ascii=False)
    extraction.summary_requested_at = None
    extraction.summary_attempts = 0
    extraction.summary_claimed_at = None
    extraction.summary_claim_token_hash = None
    db.flush()
    if not frozen:
        _carry_replaced(db, meeting.workspace_id, previous_decisions, _decision_keys(db, meeting.meeting_id))
    _relink(db, meeting.workspace_id)
    _delete_orphan_topics(db, previous_topics - set(topics), keep_human=True)
    return SummarySaveResponse(
        extraction_id=extraction_id,
        meeting_id=meeting.meeting_id,
        applied=True,
        topic_count=len(topics),
        decision_count=len(details),
    )


def _clear_meeting(db: Session, meeting_id: str, extraction_id: str | None, *, keep_human: bool) -> bool:
    """재요약(keep_human)이면 팀원이 고친 결정이 하나라도 있는 회의의 결정 전부와 그 뒤집기 연결을 두고 True 를 돌려준다.

    결정이 남는 주제(상태와 무관)와 팀원이 고친 주제는 회의 연결도 둔다. Decision.topic_id 가 CASCADE 라 주제가 고아로 지워지면
    지운 결정 표시까지 사라져 다음 재요약에서 그 결정이 되살아나기 때문이다. 회의 삭제(keep_human 아님)는 전부 지운다.
    """
    frozen = keep_human and bool(
        db.scalar(select(exists().where(Decision.meeting_id == meeting_id, Decision.edited_at.is_not(None))))
    )
    if not frozen:
        db.execute(delete(Decision).where(Decision.meeting_id == meeting_id))
    extractions = select(Extraction.extraction_id).where(Extraction.meeting_id == meeting_id)
    item_ids = select(ExtractionItem.item_id).where(
        ExtractionItem.extraction_id == extraction_id if extraction_id is not None
        else ExtractionItem.extraction_id.in_(extractions)
    )
    db.execute(delete(TopicItem).where(TopicItem.item_id.in_(item_ids)))
    kept = [
        TopicMeeting.topic_id.not_in(select(Decision.topic_id).where(Decision.meeting_id == meeting_id)),
        TopicMeeting.topic_id.not_in(select(Topic.topic_id).where(Topic.edited_at.is_not(None))),
    ] if keep_human else []
    db.execute(delete(TopicMeeting).where(TopicMeeting.meeting_id == meeting_id, *kept))
    return frozen


def remove_meeting_summary(db: Session, meeting: Meeting) -> None:
    topic_ids = set(db.scalars(select(TopicMeeting.topic_id).where(TopicMeeting.meeting_id == meeting.meeting_id)))
    decision_ids = set(db.scalars(select(Decision.decision_id).where(Decision.meeting_id == meeting.meeting_id)))
    rows = db.scalars(select(Extraction).join(Meeting, Meeting.meeting_id == Extraction.meeting_id).where(
        Meeting.workspace_id == meeting.workspace_id, Meeting.meeting_id != meeting.meeting_id,
        Extraction.summary.is_not(None),
    ))
    named = set()
    for extraction in rows:
        document = _stored(extraction)
        if document is None:
            continue
        named.update(normalize_topic_name(name) for name in document.get("topics", []) if isinstance(name, str))
        changed = False
        for detail in document.get("decision_details", []):
            if not isinstance(detail, dict) or not isinstance(detail.get("replaces"), list):
                continue
            previous = detail["replaces"]
            detail["replaces"] = [copy for copy in previous if not isinstance(copy, dict) or (
                copy.get("meeting_id") != meeting.meeting_id and copy.get("decision_id") not in decision_ids
            )]
            changed |= len(previous) != len(detail["replaces"])
        if changed:
            extraction.summary = json.dumps(document, ensure_ascii=False)
    _clear_meeting(db, meeting.meeting_id, None, keep_human=False)
    _relink(db, meeting.workspace_id)
    _delete_orphan_topics(db, topic_ids, keep_human=False)
    # 합쳐 사라진 주제의 이름은 살아 있는 주제의 별칭으로 남아 FK 로 지워지지 않는다. 어느 회의의 이름인지 적어 두지 않아서
    # 남은 회의의 요약이 쓰지 않은 이름은 지운 회의의 것으로 보고 지운다
    db.execute(delete(TopicAlias).where(TopicAlias.topic_id.in_(topic_ids), TopicAlias.name_key.not_in(named)))


def _resolve_topic(db: Session, workspace_id: str, entry: SummaryTopicIn) -> Topic | None:
    if entry.topic_id is not None:
        topic = db.get(Topic, entry.topic_id)
        if topic is not None and topic.workspace_id == workspace_id:
            return topic
        if entry.name is None:
            return None
    key = normalize_topic_name(entry.name)
    if not key:
        return None
    return _topic_by_key(db, workspace_id, key) or _create_topic(db, workspace_id, key, entry)


def _topic_by_key(db: Session, workspace_id: str, key: str) -> Topic | None:
    """Topic.name_key, 없으면 이름을 바꾸거나 합쳐 사라진 옛 키(topic_alias)."""
    topic = db.scalars(select(Topic).where(Topic.workspace_id == workspace_id, Topic.name_key == key)).first()
    if topic is None:
        topic = db.scalars(
            select(Topic)
            .join(TopicAlias, TopicAlias.topic_id == Topic.topic_id)
            .where(TopicAlias.workspace_id == workspace_id, TopicAlias.name_key == key)
        ).first()
    return topic


def _create_topic(db: Session, workspace_id: str, key: str, entry: SummaryTopicIn) -> Topic:
    topic = Topic(workspace_id=workspace_id, name=entry.name.strip(), name_key=key, description=entry.description)
    try:
        with db.begin_nested():
            db.add(topic)
            db.flush()
    except IntegrityError:
        return _topic_by_key(db, workspace_id, key)
    return topic


def _replaced_copies(db: Session, meeting: Meeting, replaces: list[str]) -> list[dict]:
    """이 회의가 뒤집은 앞 회의의 결정을 문서에 넣을 사본으로 돌려준다. 사본은 옛 결정이 또 바뀌어도 그 회의의 기록으로 남는다."""
    if not replaces:
        return []
    rows = db.execute(
        select(Decision, Meeting)
        .join(Meeting, Meeting.meeting_id == Decision.meeting_id)
        .where(
            Decision.decision_id.in_(replaces),
            Decision.workspace_id == meeting.workspace_id,
            Meeting.deleted_at.is_(None),
            Meeting.started_at < meeting.started_at,
        )
        .order_by(Meeting.started_at, Decision.position)
    ).all()
    copies = []
    for old, old_meeting in rows:
        copies.append({
            "decision_id": old.decision_id,
            "text": old.text,
            "meeting_id": old_meeting.meeting_id,
            "meeting_title": old_meeting.title,
            "decided_on": meeting_date(old_meeting.started_at).isoformat(),
        })
    return copies


def _summarized(db: Session, workspace_id: str) -> list[Extraction]:
    return db.scalars(select(Extraction).join(Meeting, Meeting.meeting_id == Extraction.meeting_id).where(
        Meeting.workspace_id == workspace_id, Meeting.deleted_at.is_(None), Extraction.summary.is_not(None),
    )).all()


def _decision_keys(db: Session, meeting_id: str) -> dict[str, tuple[str, str]]:
    return {
        decision_id: (topic_id, text)
        for decision_id, topic_id, text in db.execute(
            select(Decision.decision_id, Decision.topic_id, Decision.text).where(Decision.meeting_id == meeting_id)
        )
    }


def _carry_replaced(
    db: Session, workspace_id: str, previous: dict[str, tuple[str, str]], current: dict[str, tuple[str, str]],
) -> None:
    """재요약이 지우고 다시 만든 결정을 다른 회의의 기록이 뒤집었다고 적었으면, 그 사본을 같은 주제·같은 문장의 새 결정으로 옮긴다.

    뒤집기는 뒤집은 회의의 것이라 앞 회의의 재요약이 지우지 않는다. 결정을 고친 뒤 회의는 다시 요약해도 뒤집기를 다시 걸지 못한다.
    주제나 문장이 바뀌었거나 한 주제에 같은 문장이 둘 이상이면 같은 결정인지 알 수 없어 옮기지 않는다.
    틀리게 이으면 유효한 결정이 말없이 사라진다.
    """
    def unique(keys: dict[str, tuple[str, str]]) -> dict[tuple[str, str], str]:
        counts = Counter(keys.values())
        return {key: decision_id for decision_id, key in keys.items() if counts[key] == 1}

    old, new = unique(previous), unique(current)
    successors = {old[key]: new[key] for key in old.keys() & new.keys()}
    if not successors:
        return
    for extraction in _summarized(db, workspace_id):
        document = _stored(extraction) or {}
        changed = False
        for detail in document.get("decision_details", []):
            for copy in detail.get("replaces", []) if isinstance(detail, dict) else []:
                if isinstance(copy, dict) and copy.get("decision_id") in successors:
                    copy["decision_id"] = successors[copy["decision_id"]]
                    changed = True
        if changed:
            extraction.summary = json.dumps(document, ensure_ascii=False)


def _relink(db: Session, workspace_id: str) -> None:
    """replaced_by 를 쓰는 유일한 곳. 뒤집기는 뒤집은 결정이 있는 회의의 기록(decision_details[].replaces)이 정본이고
    replaced_by 는 그 색인이라, 기록이나 결정 상태를 바꾼 쪽은 여기서 워크스페이스의 색인을 기록대로 다시 맞춘다.

    옛 결정을 뒤집었다고 적은, 지우지 않은 더 늦은 결정이 여럿이면 가장 이른 회의의 것을 건다. 그래야 회의 시점에 유효했던 결정
    (_input_decisions)이 맞고, 하나를 지워도 남은 것이 이어받으며, 되살린 결정이 다른 회의의 뒤집기를 빼앗지 않는다.
    """
    decisions = {
        decision.decision_id: (decision, started_at)
        for decision, started_at in db.execute(
            select(Decision, Meeting.started_at).join(Meeting, Meeting.meeting_id == Decision.meeting_id)
            .where(Decision.workspace_id == workspace_id, Meeting.deleted_at.is_(None))
        )
    }
    claims: dict[str, list[tuple]] = {}
    for extraction in _summarized(db, workspace_id):
        for detail in (_stored(extraction) or {}).get("decision_details", []):
            new, new_at = decisions.get(detail.get("decision_id"), (None, None)) if isinstance(detail, dict) else (None, None)
            if new is None or new.state == DecisionState.REMOVED:
                continue
            for copy in detail.get("replaces", []):
                old_id = copy.get("decision_id") if isinstance(copy, dict) else None
                if old_id in decisions and decisions[old_id][1] < new_at:
                    claims.setdefault(old_id, []).append((new_at, new.meeting_id, new.position, new.decision_id))
    for decision_id, (decision, _) in decisions.items():
        decision.replaced_by = min(claims[decision_id])[-1] if decision_id in claims else None
    db.flush()


def _delete_orphan_topics(db: Session, topic_ids: set[str], *, keep_human: bool) -> None:
    """이 회의가 더 쓰지 않는 주제 중 어느 회의에도 남지 않은 것을 지운다. 결정과 항목 연결은 회의를 통해서만 달리므로 함께 남는 것이 없다.

    keep_human 이면 팀원이 고친 주제는 회의가 없어도 둔다. 별칭과 뗀 표시는 주제와 함께 FK 로 지워진다.
    """
    if topic_ids:
        human = [Topic.edited_at.is_(None)] if keep_human else []
        db.execute(
            delete(Topic).where(
                Topic.topic_id.in_(topic_ids), ~exists().where(TopicMeeting.topic_id == Topic.topic_id), *human
            )
        )


def _workspace_topic(db: Session, workspace_id: str, topic_id: str) -> Topic:
    topic = db.get(Topic, topic_id)
    if topic is None or topic.workspace_id != workspace_id:
        raise AppError(ErrorCode.TOPIC_NOT_FOUND, details={"topic_id": topic_id})
    return topic


def rename_topic(db: Session, workspace_id: str, topic_id: str, *, name: str | None, description: str | None) -> Topic:
    """호출자가 worker_gate 를 먼저 잡는다. 옛 키는 별칭으로 남겨 재요약이 옛 이름을 내도 이 주제로 온다. 커밋은 호출자가 한다."""
    topic = _workspace_topic(db, workspace_id, topic_id)
    if name is not None:
        key = normalize_topic_name(name)
        if not key:
            raise AppError(ErrorCode.INVALID_REQUEST, message="주제 이름에 글자가 없습니다.")
        if key != topic.name_key:
            taken = db.scalar(select(Topic.topic_id).where(Topic.workspace_id == workspace_id, Topic.name_key == key))
            if taken is not None:
                raise AppError(ErrorCode.TOPIC_NAME_TAKEN, details={"topic_id": taken})
            # 새 키를 가리던 별칭은 지운다. 두면 별칭이 이 이름을 다른 주제로 보낸다
            db.execute(delete(TopicAlias).where(TopicAlias.workspace_id == workspace_id, TopicAlias.name_key == key))
            db.add(TopicAlias(workspace_id=workspace_id, name_key=topic.name_key, topic_id=topic.topic_id))
            topic.name_key = key
        topic.name = name
    if description is not None:
        topic.description = description
    topic.edited_at = datetime.now(timezone.utc)
    db.flush()
    return topic


def merge_topics(db: Session, workspace_id: str, topic_id: str, into_topic_id: str) -> Topic:
    """topic 의 회의·항목·뗀 표시·결정·별칭을 into 로 옮기고 topic 의 키를 into 의 별칭으로 남긴 뒤 topic 을 지운다.

    into 가 합치기 전에 보이던 태스크의 뗀 표시는 옮기지 않는다. topic 에서 뗀 것이고 into 에서는 아무도 떼지 않았다.
    호출자가 worker_gate 를 먼저 잡는다. 커밋은 호출자가 한다.
    """
    from app.services import project_map

    if topic_id == into_topic_id:
        raise AppError(ErrorCode.INVALID_REQUEST, message="같은 주제로는 합칠 수 없습니다.")
    topic = _workspace_topic(db, workspace_id, topic_id)
    into = _workspace_topic(db, workspace_id, into_topic_id)
    links = project_map._visible_links(workspace_id).where(TopicItem.topic_id == into_topic_id).subquery()
    shown = list(db.scalars(select(links.c.task_id)))
    db.execute(
        delete(TopicTaskDetach).where(TopicTaskDetach.topic_id == topic_id, TopicTaskDetach.task_id.in_(shown))
        .execution_options(synchronize_session=False)
    )
    for model, column in ((TopicMeeting, "meeting_id"), (TopicItem, "item_id"), (TopicTaskDetach, "task_id")):
        # into 에 이미 있는 짝은 옮기지 않고 지운다. 옮기면 기본 키가 겹친다
        present = aliased(model)
        db.execute(
            update(model)
            .where(model.topic_id == topic_id,
                   getattr(model, column).not_in(select(getattr(present, column)).where(present.topic_id == into_topic_id)))
            .values(topic_id=into_topic_id)
            .execution_options(synchronize_session=False)
        )
        db.execute(delete(model).where(model.topic_id == topic_id).execution_options(synchronize_session=False))
    db.execute(update(Decision).where(Decision.topic_id == topic_id).values(topic_id=into_topic_id))
    db.execute(update(TopicAlias).where(TopicAlias.topic_id == topic_id).values(topic_id=into_topic_id))
    key = topic.name_key
    db.delete(topic)
    db.flush()
    db.add(TopicAlias(workspace_id=workspace_id, name_key=key, topic_id=into_topic_id))
    into.edited_at = datetime.now(timezone.utc)
    db.flush()
    return into


def edit_decision(
    db: Session, workspace_id: str, decision_id: str, *, text: str | None, state: DecisionState | None
) -> Decision:
    """문장 고치기와 상태 바꾸기. 고치면 그 회의의 결정은 재요약에서 고정된다. 커밋은 호출자가 한다.

    호출자가 worker_gate 를 먼저 잡는다. 회의 행을 잠가 회의 삭제와 줄을 선다. 지우면(removed) 이 결정이 뒤집은 옛 결정이 다시
    유효해지고(다른 결정도 뒤집었으면 그 결정이 이어받는다), 지운 것을 되돌리면 요약 기록대로 다시 뒤집는다. 유효하지 않음(invalid)은
    연결을 그대로 둔다.
    """
    meeting_id = db.scalar(
        select(Decision.meeting_id).where(Decision.decision_id == decision_id, Decision.workspace_id == workspace_id)
    )
    meeting = None if meeting_id is None else db.scalar(
        select(Meeting).where(Meeting.meeting_id == meeting_id).with_for_update().execution_options(populate_existing=True)
    )
    if meeting is None or meeting.deleted_at is not None:
        raise AppError(ErrorCode.DECISION_NOT_FOUND, details={"decision_id": decision_id})
    decision = db.get(Decision, decision_id, populate_existing=True)
    if text is not None:
        decision.text = text
    if state is not None:
        decision.state = state
    decision.edited_at = datetime.now(timezone.utc)
    db.flush()
    _relink(db, workspace_id)
    return decision


def detach_task(db: Session, workspace_id: str, topic_id: str, task_id: str) -> None:
    """주제에서 태스크를 뗀다. 항목 연결은 두고 _visible_links 가 가린다. 다시 불러도 같다. 커밋은 호출자가 한다."""
    from app.services import project_map

    topic = _workspace_topic(db, workspace_id, topic_id)
    task = db.get(Task, task_id)
    if task is None or task.workspace_id != workspace_id or task.is_deleted:
        raise AppError(ErrorCode.TASK_NOT_FOUND, details={"task_id": task_id})
    links = project_map._visible_links(workspace_id).where(TopicItem.topic_id == topic_id, Task.task_id == task_id)
    if not db.scalar(select(links.exists())):
        return
    db.add(TopicTaskDetach(topic_id=topic_id, task_id=task_id, workspace_id=workspace_id))
    # 떼기도 고친 것으로 친다. 표시가 없으면 주제를 뺀 재요약이 주제를 고아로 지울 때 뗀 표시도 함께 지워져 태스크가 다시 붙는다
    topic.edited_at = datetime.now(timezone.utc)
    db.flush()


def _document(payload: SummaryWriteRequest, topics: dict[str, str], details: list[dict]) -> dict:
    """저장할 JSON 을 만드는 유일한 곳. 화면이 읽는 overview, key_points, decisions(문자열 목록)가 항상 있다.

    topic_ids 는 topics 와 같은 순서이고 decision_details 의 decision_id 는 Decision 행이다. 사람이 고친 행과 다시 맞출 때 쓴다.
    """
    return {
        "overview": payload.overview,
        "key_points": payload.key_points,
        "decisions": [detail["text"] for detail in details],
        "schema_version": SCHEMA_VERSION,
        "discussion": [block.model_dump() for block in payload.discussion],
        "decision_details": details,
        "facts": payload.facts,
        "task_changes": [entry.model_dump() for entry in payload.task_changes],
        "schedule": [entry.model_dump() for entry in payload.schedule],
        "open_items": payload.open_items,
        "topics": list(topics.values()),
        "topic_ids": list(topics),
        "meta": {"model": payload.model_name, "truncated_input": payload.truncated_input},
    }
