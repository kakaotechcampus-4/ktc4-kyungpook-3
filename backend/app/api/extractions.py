from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError, ErrorCode, success
from app.models import (
    Extraction,
    ExtractionItem,
    Meeting,
    MeetingStatus,
    Member,
)
from app.schemas.meeting import (
    AssigneeInfo,
    DueDateInfo,
    EvidenceInfo,
    ExtractionCreateRequest,
    ExtractionCreateResponse,
    ExtractionDetailResponse,
    ExtractionItemResponse,
    TaskInfo,
)
from app.services.matching import (
    decide_gate,
    item_confidence,
    log_resolution,
    resolve_assignee,
)

router = APIRouter(prefix="/extractions", tags=["extractions"])


@router.post("", status_code=201)
def create_extraction(
    payload: ExtractionCreateRequest,
    db: Session = Depends(get_db),
) -> dict:
    """AI 분석 결과를 저장한다. 담당자 매칭·게이트 판정이 함께 수행된다."""
    meeting = db.get(Meeting, payload.meeting_id)
    if meeting is None:
        raise AppError(
            ErrorCode.MEETING_NOT_FOUND, details={"meeting_id": payload.meeting_id}
        )

    extraction = Extraction(
        meeting_id=payload.meeting_id,
        transcript_path=payload.transcript_path,
        model_name=payload.model_name,
    )
    db.add(extraction)
    db.flush()

    for raw_item in payload.items:
        match = resolve_assignee(db, payload.workspace_id, raw_item.assignee_raw)
        log_resolution(
            db,
            workspace_id=payload.workspace_id,
            alias_text=raw_item.assignee_raw,
            match=match,
            evidence_quote=raw_item.evidence_quote,
            meeting_id=payload.meeting_id,
        )

        conf = item_confidence(
            raw_item.task_confidence, match.confidence, raw_item.due_confidence
        )
        db.add(
            ExtractionItem(
                extraction_id=extraction.extraction_id,
                task_title=raw_item.task_title,
                task_confidence=raw_item.task_confidence,
                assignee_raw=raw_item.assignee_raw,
                assignee_member_id=match.member_id,
                assignee_confidence=match.confidence,
                assignee_needs_check=match.needs_check,
                due_date=raw_item.due_date,
                due_raw=raw_item.due_raw,
                due_confidence=raw_item.due_confidence,
                confidence=conf,
                gate=str(decide_gate(conf)),
                evidence_quote=raw_item.evidence_quote,
                evidence_speaker=raw_item.evidence_speaker,
                evidence_at_ms=raw_item.evidence_at_ms,
            )
        )

    meeting.extracted = True
    meeting.status = str(MeetingStatus.DONE)

    db.commit()
    db.refresh(extraction)

    return success(
        ExtractionCreateResponse(
            extraction_id=extraction.extraction_id,
            meeting_id=extraction.meeting_id,
            item_count=len(payload.items),
        ).model_dump(mode="json")
    )


@router.get("/{extraction_id}")
def get_extraction(extraction_id: str, db: Session = Depends(get_db)) -> dict:
    extraction = db.get(Extraction, extraction_id)
    if extraction is None:
        raise AppError(
            ErrorCode.EXTRACTION_NOT_FOUND, details={"extraction_id": extraction_id}
        )

    stmt = (
        select(ExtractionItem)
        .where(ExtractionItem.extraction_id == extraction_id)
        .order_by(ExtractionItem.created_at)
    )
    items = db.execute(stmt).scalars().all()

    member_ids = {i.assignee_member_id for i in items if i.assignee_member_id}
    names: dict[str, str] = {}
    if member_ids:
        rows = db.execute(
            select(Member.member_id, Member.display_name).where(
                Member.member_id.in_(member_ids)
            )
        ).all()
        names = {mid: name for mid, name in rows}

    item_responses = [
        ExtractionItemResponse(
            item_id=i.item_id,
            task=TaskInfo(title=i.task_title, confidence=i.task_confidence),
            assignee=AssigneeInfo(
                raw=i.assignee_raw,
                member_id=i.assignee_member_id,
                display_name=names.get(i.assignee_member_id) if i.assignee_member_id else None,
                confidence=i.assignee_confidence,
                needs_check=i.assignee_needs_check,
            ),
            due_date=DueDateInfo(
                value=i.due_date, raw=i.due_raw, confidence=i.due_confidence
            ),
            confidence=i.confidence,
            gate=i.gate,
            evidence=EvidenceInfo(
                quote=i.evidence_quote,
                speaker=i.evidence_speaker,
                at_ms=i.evidence_at_ms,
            ),
        )
        for i in items
    ]

    detail = ExtractionDetailResponse(
        extraction_id=extraction.extraction_id,
        meeting_id=extraction.meeting_id,
        items=item_responses,
    )
    return success(detail.model_dump(mode="json"))