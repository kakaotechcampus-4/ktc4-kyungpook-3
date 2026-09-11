from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError, ErrorCode, success
from app.models import Extraction, Meeting, MeetingStatus
from app.schemas.meeting import (
    MeetingCreateRequest,
    MeetingCreateResponse,
    MeetingDetailResponse,
    MeetingEndResponse,
    MeetingProgress,
)

router = APIRouter(prefix="/meetings", tags=["meetings"])

_ENDED_STATUSES = {MeetingStatus.PROCESSING, MeetingStatus.DONE, MeetingStatus.FAILED}


def _get_meeting(db: Session, meeting_id: str) -> Meeting:
    meeting = db.get(Meeting, meeting_id)
    if meeting is None:
        raise AppError(
            ErrorCode.MEETING_NOT_FOUND, details={"meeting_id": meeting_id}
        )
    return meeting


@router.post("", status_code=201)
def create_meeting(
    payload: MeetingCreateRequest,
    db: Session = Depends(get_db),
) -> dict:
    meeting = Meeting(
        workspace_id=payload.workspace_id,
        title=payload.title,
        source=str(payload.source),
        status=str(MeetingStatus.CREATED),
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)

    return success(
        MeetingCreateResponse.model_validate(meeting).model_dump(mode="json")
    )


@router.patch("/{meeting_id}/end", status_code=202)
def end_meeting(
    meeting_id: str,
    db: Session = Depends(get_db),
) -> dict:
    meeting = _get_meeting(db, meeting_id)

    if meeting.status in _ENDED_STATUSES:
        raise AppError(
            ErrorCode.MEETING_ALREADY_ENDED,
            details={"meeting_id": meeting_id, "status": meeting.status},
        )

    meeting.status = str(MeetingStatus.PROCESSING)
    meeting.ended_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(meeting)

    return success(
        MeetingEndResponse.model_validate(meeting).model_dump(mode="json")
    )


@router.get("/{meeting_id}")
def get_meeting(meeting_id: str, db: Session = Depends(get_db)) -> dict:
    meeting = _get_meeting(db, meeting_id)

    extraction_id = None
    if meeting.status == MeetingStatus.DONE:
        stmt = (
            select(Extraction.extraction_id)
            .where(Extraction.meeting_id == meeting_id)
            .order_by(Extraction.created_at.desc())
            .limit(1)
        )
        extraction_id = db.execute(stmt).scalar_one_or_none()

    detail = MeetingDetailResponse(
        meeting_id=meeting.meeting_id,
        workspace_id=meeting.workspace_id,
        title=meeting.title,
        status=meeting.status,
        started_at=meeting.started_at,
        ended_at=meeting.ended_at,
        progress=MeetingProgress(
            audio_merged=meeting.audio_merged,
            transcribed=meeting.transcribed,
            extracted=meeting.extracted,
        ),
        extraction_id=extraction_id,
        failed_stage=meeting.failed_stage,
    )
    return success(detail.model_dump(mode="json"))
