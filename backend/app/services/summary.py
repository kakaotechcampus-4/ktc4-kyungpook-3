"""회의 요약 대기열과 저장. Extraction.summary*, Topic*, Decision 의 유일한 작성자다.

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
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import delete, exists, func, or_, select, tuple_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.core.errors import AppError, ErrorCode
from app.models import (
    Decision,
    Extraction,
    ExtractionItem,
    Meeting,
    MeetingStatus,
    Member,
    Source,
    Task,
    Topic,
    TopicItem,
    TopicMeeting,
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
        asr_terms=list(db.scalars(
            select(WorkspaceAsrTerm.word).where(WorkspaceAsrTerm.workspace_id == meeting.workspace_id)
            .order_by(WorkspaceAsrTerm.word)
        )),
        lines=_input_lines(db, meeting.meeting_id),
        items=_input_items(db, extraction_id),
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
            text=src.text,
        )
        for src, display_name in rows
    ]


def _input_items(db: Session, extraction_id: str) -> list[SummaryInputItem]:
    """반영된 항목만, 값은 Task 의 지금 값이다(PM 이 승인하며 고친 값). 같은 Task 에 합쳐진 항목은 먼저 나온 하나만 둔다."""
    final = item_fate.final_items().where(ExtractionItem.extraction_id == extraction_id).subquery()
    rows = db.execute(
        select(final.c.item_id, ExtractionItem.action, Task, Member.display_name)
        .join(ExtractionItem, ExtractionItem.item_id == final.c.item_id)
        .join(Task, Task.task_id == final.c.task_id)
        .outerjoin(Member, Member.member_id == Task.assignee_member_id)
        .order_by(final.c.created_at, final.c.item_id)
    ).all()
    items: dict[str, SummaryInputItem] = {}
    for item_id, action, task, display_name in rows:
        items.setdefault(task.task_id, SummaryInputItem(
            item_id=item_id, action=action, title=task.title, assignee=display_name, due_date=task.due_date,
        ))
    return list(items.values())


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
    readiness = item_fate.readiness(db, extraction, meeting.source)
    if not readiness.waiting_cards and not readiness.ready:
        return "no_approved_items"
    waits = "awaiting_approval" if readiness.waiting_cards else None
    if force:
        return waits or "requested"
    if extraction.summary_requested_at is not None:
        return (waits or "queued") if _queue_alive(extraction, now) else "gave_up"
    return "done" if _stored(extraction) is not None else waits or "requested"


def _queue_alive(extraction: Extraction, now: datetime) -> bool:
    """표시된 행이 아직 끝나지 않았는가. 마지막 시도의 임대가 살아 있으면 끝난 것이 아니다."""
    if extraction.summary_requested_at is None:
        return False
    if extraction.summary_attempts < SUMMARY_MAX_ATTEMPTS:
        return True
    claimed_at = extraction.summary_claimed_at
    return claimed_at is not None and utc(claimed_at) > utc(now) - SUMMARY_LEASE


def documents(db: Session, rows: list[tuple[Meeting, Extraction | None]]) -> dict[str, dict]:
    """화면, summary.md, 합본이 읽는 유일한 요약. meeting_id -> 보여 줄 문서.

    할 일 변화는 항목이 지금 반영된 것만 보인다. 항목 키가 없는 옛 요약의 할 일 변화와 요약 뒤 되돌린 항목은 숨는다.
    """
    stored = {
        meeting.meeting_id: (extraction.extraction_id, document)
        for meeting, extraction in rows
        if (document := _stored(extraction)) is not None
    }
    final = item_fate.final_items().where(
        ExtractionItem.extraction_id.in_({extraction_id for extraction_id, _ in stored.values()})
    ).subquery()
    shown = set(db.execute(select(final.c.extraction_id, final.c.item_id)).all()) if stored else set()
    for extraction_id, document in stored.values():
        if isinstance(document.get("task_changes"), list):
            document["task_changes"] = [
                change for change in document["task_changes"]
                if isinstance(change, dict) and (extraction_id, change.get("item_id")) in shown
            ]
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
    _clear_meeting(db, meeting.meeting_id, extraction_id)

    item_ids = set(db.scalars(select(ExtractionItem.item_id).where(ExtractionItem.extraction_id == extraction_id)))
    topics: dict[str, str] = {}
    links: set[tuple[str, str]] = set()
    details: list[dict] = []
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
        for decision in entry.decisions:
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
                "replaces": _replace_decisions(db, row, meeting, decision.replaces),
            })

    db.add_all(TopicMeeting(topic_id=topic_id, meeting_id=meeting.meeting_id) for topic_id in topics)
    db.add_all(TopicItem(topic_id=topic_id, item_id=item_id) for topic_id, item_id in links)
    extraction.summary = json.dumps(_document(payload, topics, details), ensure_ascii=False)
    extraction.summary_requested_at = None
    extraction.summary_attempts = 0
    extraction.summary_claimed_at = None
    extraction.summary_claim_token_hash = None
    db.flush()
    _delete_orphan_topics(db, previous_topics - set(topics))
    return SummarySaveResponse(
        extraction_id=extraction_id,
        meeting_id=meeting.meeting_id,
        applied=True,
        topic_count=len(topics),
        decision_count=len(details),
    )


def _clear_meeting(db: Session, meeting_id: str, extraction_id: str | None) -> None:
    decision_ids = select(Decision.decision_id).where(Decision.meeting_id == meeting_id)
    # 이 회의가 뒤집었던 옛 결정을 유효로 되돌린다. 새 요약이 다시 뒤집으면 다시 걸린다
    db.execute(update(Decision).where(Decision.replaced_by.in_(decision_ids)).values(replaced_by=None))
    db.execute(delete(Decision).where(Decision.meeting_id == meeting_id))
    extractions = select(Extraction.extraction_id).where(Extraction.meeting_id == meeting_id)
    item_ids = select(ExtractionItem.item_id).where(
        ExtractionItem.extraction_id == extraction_id if extraction_id is not None
        else ExtractionItem.extraction_id.in_(extractions)
    )
    db.execute(delete(TopicItem).where(TopicItem.item_id.in_(item_ids)))
    db.execute(delete(TopicMeeting).where(TopicMeeting.meeting_id == meeting_id))


def remove_meeting_summary(db: Session, meeting: Meeting) -> None:
    topic_ids = set(db.scalars(select(TopicMeeting.topic_id).where(TopicMeeting.meeting_id == meeting.meeting_id)))
    decision_ids = set(db.scalars(select(Decision.decision_id).where(Decision.meeting_id == meeting.meeting_id)))
    rows = db.scalars(select(Extraction).join(Meeting, Meeting.meeting_id == Extraction.meeting_id).where(
        Meeting.workspace_id == meeting.workspace_id, Meeting.meeting_id != meeting.meeting_id,
        Extraction.summary.is_not(None),
    ))
    for extraction in rows:
        document = _stored(extraction)
        if document is None:
            continue
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
    _clear_meeting(db, meeting.meeting_id, None)
    _delete_orphan_topics(db, topic_ids)


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
    return db.scalars(select(Topic).where(Topic.workspace_id == workspace_id, Topic.name_key == key)).first()


def _create_topic(db: Session, workspace_id: str, key: str, entry: SummaryTopicIn) -> Topic:
    topic = Topic(workspace_id=workspace_id, name=entry.name.strip(), name_key=key, description=entry.description)
    try:
        with db.begin_nested():
            db.add(topic)
            db.flush()
    except IntegrityError:
        return _topic_by_key(db, workspace_id, key)
    return topic


def _replace_decisions(db: Session, new: Decision, meeting: Meeting, replaces: list[str]) -> list[dict]:
    """옛 결정에 뒤집은 결정을 걸고, 문서에 넣을 사본을 돌려준다. 사본은 옛 결정이 또 바뀌어도 그 회의의 기록으로 남는다."""
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
        old.replaced_by = new.decision_id
        copies.append({
            "decision_id": old.decision_id,
            "text": old.text,
            "meeting_id": old_meeting.meeting_id,
            "meeting_title": old_meeting.title,
            "decided_on": meeting_date(old_meeting.started_at).isoformat(),
        })
    return copies


def _delete_orphan_topics(db: Session, topic_ids: set[str]) -> None:
    """이 회의가 더 쓰지 않는 주제 중 어느 회의에도 남지 않은 것을 지운다. 결정과 항목 연결은 회의를 통해서만 달리므로 함께 남는 것이 없다."""
    if topic_ids:
        db.execute(
            delete(Topic).where(Topic.topic_id.in_(topic_ids), ~exists().where(TopicMeeting.topic_id == Topic.topic_id))
        )


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
