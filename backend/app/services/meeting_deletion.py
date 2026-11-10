import hashlib
import hmac
import json
import logging
import os
import secrets
import threading
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.errors import AppError, ErrorCode
from app.models import (
    AliasResolutionLog,
    AliasReview,
    ApprovalRequest,
    ApprovalStatus,
    Evidence,
    EvidenceType,
    Extraction,
    ExtractionItem,
    Meeting,
    MeetingPurge,
    MeetingStatus,
    MeetingAudio,
    MeetingUpload,
    Notification,
    Source,
)
from app.schemas.meeting_deletion import MeetingDeletionReceipt
from app.services import upload_storage
from app.services import lifecycle
from app.services.pending_merge import merge_into_pending

logger = logging.getLogger(__name__)
LEASE_SECONDS = 120


def enabled() -> bool:
    return os.getenv("MEETING_DELETION_ENABLED") == "true"


def deletion_available(db: Session, meeting: Meeting) -> bool:
    if not enabled() or meeting.deleted_at is not None:
        return False
    lineage = db.scalars(select(Meeting).where(lineage_condition(meeting))).all()
    return bool(lineage) and all(
        row.deletion_ready and row.status in (MeetingStatus.DONE, MeetingStatus.FAILED)
        for row in lineage
    )


def require_live_meeting(
    db: Session, meeting_id: str, *, lock: bool = False
) -> Meeting:
    owner = db.scalar(select(Meeting.workspace_id).where(Meeting.meeting_id == meeting_id))
    if owner is not None:
        lifecycle.workspace(db, owner)
    stmt = select(Meeting).where(Meeting.meeting_id == meeting_id).execution_options(populate_existing=True)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    meeting = db.scalar(stmt)
    if meeting is None:
        raise AppError(ErrorCode.MEETING_NOT_FOUND, details={"meeting_id": meeting_id})
    if meeting.deleted_at is not None:
        raise AppError(ErrorCode.MEETING_DELETED)
    return meeting


def assert_live(meeting: Meeting) -> None:
    if meeting.deleted_at is not None:
        raise AppError(ErrorCode.MEETING_DELETED)


def lineage_condition(meeting: Meeting):
    root_id = meeting.recording_root_id or meeting.meeting_id
    return or_(Meeting.meeting_id == root_id, Meeting.recording_root_id == root_id)


def receipt(db: Session, meeting: Meeting) -> MeetingDeletionReceipt:
    ids = sorted(
        db.scalars(select(Meeting.meeting_id).where(lineage_condition(meeting))).all()
    )
    purges = db.scalars(
        select(MeetingPurge).where(MeetingPurge.meeting_id.in_(ids))
    ).all()
    if meeting.deleted_at is None or len(purges) != len(ids):
        raise AppError(ErrorCode.MEETING_NOT_FOUND)
    return MeetingDeletionReceipt(
        meeting_id=meeting.meeting_id,
        deleted_at=(
            meeting.deleted_at.replace(tzinfo=timezone.utc)
            if meeting.deleted_at.tzinfo is None
            else meeting.deleted_at
        ),
        deleted_meeting_ids=ids,
        cleanup_status="complete"
        if all(p.backend_done_at and p.ai_done_at for p in purges)
        else "pending",
    )


def _item_evidence(db: Session, item: ExtractionItem, fallback: dict, meeting_id: str) -> dict:
    source = db.scalar(
        select(Source)
        .join(Evidence, Evidence.source_id == Source.source_id)
        .where(
            Evidence.item_id == item.item_id,
            Evidence.type == str(EvidenceType.TASK),
            Source.meeting_id == meeting_id,
        )
        .order_by(Source.seq.desc())
        .limit(1)
    )
    if source is None:
        return {
            key: fallback.get(key)
            for key in (
                "evidence_quote",
                "evidence_speaker",
                "evidence_speaker_member_id",
                "evidence_at_ms",
            )
        }
    return {
        "evidence_quote": source.text if source else None,
        "evidence_speaker": source.speaker_discord_user_id if source else None,
        "evidence_speaker_member_id": source.member_id if source else None,
        "evidence_at_ms": source.start_ms if source else None,
    }


def prune_meeting_from_card(contributions: list[dict], meeting_id: str) -> dict | None:
    surviving = [part for part in contributions if part["meeting_id"] != meeting_id]
    if not surviving:
        return None
    first, *later = surviving
    rebuilt = {key: value for key, value in first.items() if key != "created_at"}
    rebuilt["due_date"] = first["due_date"].isoformat() if first["due_date"] else None
    if not rebuilt.get("status"):
        rebuilt.pop("status", None)
    for part in later:
        rebuilt = merge_into_pending(
            rebuilt,
            item_id=part["extraction_item_id"],
            meeting_id=part["meeting_id"],
            category=part["category"],
            due_date=part["due_date"],
            due_raw=part["due_raw"],
            status=part["status"],
            assignee_member_id=part["assignee_member_id"],
            assignee_raw=part["assignee_raw"],
            gate=part["gate"],
            doc_text=part["doc_text"],
            evidence=part,
            now=part["created_at"],
        )
    return rebuilt


def rebuild_pending_card(
    db: Session, card: ApprovalRequest, payload: dict, meeting_id: str
) -> dict | None:
    parts = [payload, *(payload.get("merged_items") or [])]
    contributions = []
    seen = set()
    for part in parts:
        if not isinstance(part, dict):
            continue
        item_id = part.get("extraction_item_id")
        if not isinstance(item_id, str) or item_id in seen:
            continue
        item = db.get(ExtractionItem, item_id)
        extraction = db.get(Extraction, item.extraction_id) if item else None
        origin = db.get(Meeting, extraction.meeting_id) if extraction else None
        if (
            item is not None and extraction is not None and origin is not None
            and part.get("meeting_id") == origin.meeting_id
            and origin.workspace_id == card.workspace_id
            and item.approval_id == card.approval_id
            and origin.deleted_at is None
        ):
            seen.add(item_id)
            contributions.append(
                {
                    "task_title": item.task_title,
                    "assignee_member_id": item.assignee_member_id,
                    "assignee_raw": item.assignee_raw,
                    "assignee_needs_check": item.assignee_needs_check,
                    "due_date": item.due_date,
                    "due_raw": item.due_raw,
                    "status": item.status,
                    "extraction_item_id": item.item_id,
                    "meeting_id": extraction.meeting_id,
                    "gate": item.gate,
                    "doc_text": item.doc_text,
                    "category": item.category,
                    "created_at": item.created_at,
                    **_item_evidence(db, item, part, origin.meeting_id),
                }
            )
    return prune_meeting_from_card(contributions, meeting_id)


def _clean_cards(db: Session, meeting: Meeting, now: datetime) -> list[str]:
    cards = db.scalars(
        select(ApprovalRequest)
        .where(ApprovalRequest.workspace_id == meeting.workspace_id)
        .order_by(ApprovalRequest.approval_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    affected = []
    for card in cards:
        payload = json.loads(card.payload)
        parts = payload.get("merged_items") or []
        if payload.get("meeting_id") != meeting.meeting_id and not any(
            isinstance(part, dict) and part.get("meeting_id") == meeting.meeting_id
            for part in parts
        ):
            continue
        affected.append(card.approval_id)
        rebuilt = (
            rebuild_pending_card(db, card, payload, meeting.meeting_id)
            if card.status == ApprovalStatus.PENDING
            else None
        )
        if rebuilt is None:
            card.payload = json.dumps(
                {"meeting_id": meeting.meeting_id, "source_deleted": True}
            )
            if card.status == ApprovalStatus.PENDING:
                card.status = str(ApprovalStatus.REJECTED)
                card.resolved_at = now
        else:
            card.payload = json.dumps(rebuilt, ensure_ascii=False)
        card.embedding = None
        card.embedding_rejected_title = None
    return affected


def delete_meeting(db: Session, meeting_id: str) -> MeetingDeletionReceipt:
    if not enabled():
        raise AppError(ErrorCode.MEETING_DELETION_UNAVAILABLE)
    meeting = db.get(Meeting, meeting_id)
    if meeting is None:
        raise AppError(ErrorCode.MEETING_NOT_FOUND)
    root_id = meeting.recording_root_id or meeting.meeting_id
    db.scalar(
        select(Meeting)
        .where(Meeting.meeting_id == root_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    lineage = db.scalars(
        select(Meeting)
        .where(lineage_condition(meeting))
        .order_by(Meeting.meeting_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    if meeting.deleted_at is not None:
        return receipt(db, meeting)
    if any(not row.deletion_ready for row in lineage):
        raise AppError(ErrorCode.MEETING_LINEAGE_UNVERIFIED)
    for row in lineage:
        if row.status not in (MeetingStatus.DONE, MeetingStatus.FAILED):
            raise AppError(
                ErrorCode.MEETING_DELETE_BLOCKED, details={"status": row.status}
            )
    now = datetime.now(timezone.utc)
    for row in lineage:
        _delete_content(db, row, now)
    db.commit()
    for row in lineage:
        purge_backend_files(db, meeting_id=row.meeting_id)
    return receipt(db, meeting)


def _delete_content(db: Session, meeting: Meeting, now: datetime) -> None:
    from app.services import summary

    meeting_id = meeting.meeting_id
    cards = _clean_cards(db, meeting, now)
    summary.remove_meeting_summary(db, meeting)
    source_ids = select(Source.source_id).where(Source.meeting_id == meeting_id)
    extraction_ids = select(Extraction.extraction_id).where(
        Extraction.meeting_id == meeting_id
    )
    item_ids = select(ExtractionItem.item_id).where(
        ExtractionItem.extraction_id.in_(extraction_ids)
    )
    log_ids = select(AliasResolutionLog.log_id).where(
        or_(
            AliasResolutionLog.meeting_id == meeting_id,
            AliasResolutionLog.source_id.in_(source_ids),
        )
    )
    db.execute(delete(AliasReview).where(AliasReview.log_id.in_(log_ids)))
    db.execute(delete(AliasResolutionLog).where(AliasResolutionLog.log_id.in_(log_ids)))
    db.execute(
        delete(Evidence).where(
            or_(Evidence.source_id.in_(source_ids), Evidence.item_id.in_(item_ids))
        )
    )
    db.execute(
        delete(ExtractionItem).where(ExtractionItem.extraction_id.in_(extraction_ids))
    )
    db.execute(delete(Extraction).where(Extraction.meeting_id == meeting_id))
    db.execute(delete(Source).where(Source.meeting_id == meeting_id))
    db.execute(delete(MeetingUpload).where(MeetingUpload.meeting_id == meeting_id))
    db.execute(delete(MeetingAudio).where(MeetingAudio.meeting_id == meeting_id))
    db.execute(
        delete(Notification).where(
            Notification.workspace_id == meeting.workspace_id,
            or_(Notification.link_id == meeting_id, Notification.link_id.in_(cards)),
        )
    )
    meeting.deleted_at = now
    meeting.title = None
    meeting.failed_stage = None
    meeting.processing_stage = None
    meeting.processing_stage_at = None
    meeting.processing_stt_done = None
    meeting.processing_stt_total = None
    db.add(MeetingPurge(meeting_id=meeting_id))
    db.flush()


def remove_backend_files(meeting_id: str) -> None:
    upload_storage.remove_audio(meeting_id)


def purge_backend_files(db: Session, *, meeting_id: str | None = None) -> None:
    stmt = select(MeetingPurge).where(MeetingPurge.backend_done_at.is_(None))
    if meeting_id is not None:
        stmt = stmt.where(MeetingPurge.meeting_id == meeting_id)
    for row in db.scalars(stmt.limit(100)).all():
        try:
            remove_backend_files(row.meeting_id)
        except (OSError, ValueError):
            row.last_error_code = "BACKEND_STORAGE_DELETE_FAILED"
        else:
            row.backend_done_at = datetime.now(timezone.utc)
            row.last_error_code = None
        db.commit()


def claim_purge(db: Session) -> dict | None:
    now = datetime.now(timezone.utc)
    available = or_(MeetingPurge.lease_until.is_(None), MeetingPurge.lease_until <= now)
    candidates = db.scalars(
        select(MeetingPurge.meeting_id)
        .where(MeetingPurge.ai_done_at.is_(None), available)
        .order_by(MeetingPurge.meeting_id)
        .limit(20)
    ).all()
    for meeting_id in candidates:
        token = secrets.token_urlsafe(32)
        until = now + timedelta(seconds=LEASE_SECONDS)
        won = db.execute(
            update(MeetingPurge)
            .where(
                MeetingPurge.meeting_id == meeting_id,
                MeetingPurge.ai_done_at.is_(None),
                available,
            )
            .values(
                claim_token_hash=hashlib.sha256(token.encode()).hexdigest(),
                lease_until=until,
                attempts=MeetingPurge.attempts + 1,
            )
            .execution_options(synchronize_session=False)
        )
        db.commit()
        if won.rowcount:
            return {
                "meeting_id": meeting_id,
                "claim_token": token,
                "lease_until": until,
            }
    return None


def ack_purge(db: Session, meeting_id: str, token: str) -> MeetingDeletionReceipt:
    row = db.scalar(
        select(MeetingPurge)
        .where(MeetingPurge.meeting_id == meeting_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    digest = hashlib.sha256(token.encode()).hexdigest()
    if (
        row is None
        or row.claim_token_hash is None
        or not hmac.compare_digest(row.claim_token_hash, digest)
    ):
        raise AppError(ErrorCode.PURGE_CLAIM_EXPIRED)
    now = datetime.now(timezone.utc)
    until = row.lease_until
    if until is not None and until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    if row.ai_done_at is None:
        if until is None or until <= now:
            raise AppError(ErrorCode.PURGE_CLAIM_EXPIRED)
        row.ai_done_at = now
        db.commit()
    return receipt(db, db.get(Meeting, meeting_id))


def run_worker(stop: threading.Event, interval: float) -> None:
    while not stop.is_set():
        with SessionLocal() as db:
            try:
                purge_backend_files(db)
                from app.services.account_withdrawal import purge_backend
                purge_backend(db)
            except Exception:
                logger.exception("meeting purge worker failed")
                db.rollback()
        stop.wait(interval)


def start_worker(interval: float) -> tuple[threading.Thread, threading.Event]:
    stop = threading.Event()
    thread = threading.Thread(
        target=run_worker, args=(stop, interval), name="meeting-purge", daemon=True
    )
    thread.start()
    return thread, stop
