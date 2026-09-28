from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Extraction, Meeting, MeetingStatus, Member, User
from app.schemas.meeting import (
    MeetingCreateRequest,
    MeetingCreateResponse,
    MeetingDetailResponse,
    MeetingEndResponse,
    MeetingFailRequest,
    MeetingMinutesResponse,
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


def _compute_progress(db: Session, meeting: Meeting) -> MeetingProgress:
    audio_merged = bool(meeting.audio and meeting.audio.is_complete)
    extraction = (
        db.query(Extraction)
        .filter(Extraction.meeting_id == meeting.meeting_id)
        .order_by(Extraction.created_at.desc())
        .first()
    )
    transcribed = bool(extraction and extraction.transcript_path)
    extracted = bool(extraction and extraction.items)
    return MeetingProgress(
        audio_merged=audio_merged, transcribed=transcribed, extracted=extracted
    )


@router.post("", status_code=201, response_model=Envelope[MeetingCreateResponse])
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


@router.patch(
    "/{meeting_id}/end", status_code=202, response_model=Envelope[MeetingEndResponse]
)
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


@router.patch(
    "/{meeting_id}/fail", status_code=200, response_model=Envelope[MeetingDetailResponse]
)
def fail_meeting(
    meeting_id: str,
    payload: MeetingFailRequest,
    db: Session = Depends(get_db),
) -> dict:
    # ── 조건부 UPDATE (CAS): 아직 끝나지 않은 회의만 failed로 전이한다 ──
    # 상태를 읽고 나서 쓰면, 그 사이 추출 등록이 processing → done으로 선점한 결과를
    # 늦게 도착한 실패 요청이 failed로 덮을 수 있다. 판정과 쓰기를 한 문장으로 묶는다.
    fail_stmt = (
        update(Meeting)
        .where(
            Meeting.meeting_id == meeting_id,
            Meeting.status.not_in([str(MeetingStatus.DONE), str(MeetingStatus.FAILED)]),
        )
        .values(
            status=str(MeetingStatus.FAILED),
            failed_stage=payload.failed_stage,
            ended_at=datetime.now(timezone.utc),
        )
    )
    result = db.execute(fail_stmt)

    if result.rowcount == 0:
        db.rollback()
        meeting = _get_meeting(db, meeting_id)
        raise AppError(
            ErrorCode.MEETING_ALREADY_ENDED,
            details={"meeting_id": meeting_id, "status": meeting.status},
        )

    db.commit()
    meeting = _get_meeting(db, meeting_id)

    detail = MeetingDetailResponse(
        meeting_id=meeting.meeting_id,
        workspace_id=meeting.workspace_id,
        title=meeting.title,
        status=meeting.status,
        started_at=meeting.started_at,
        ended_at=meeting.ended_at,
        extraction_id=None,
        failed_stage=meeting.failed_stage,
        progress=_compute_progress(db, meeting),
    )
    return success(detail.model_dump(mode="json"))


@router.get("/{meeting_id}", response_model=Envelope[MeetingDetailResponse])
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
        extraction_id=extraction_id,
        failed_stage=meeting.failed_stage,
        progress=_compute_progress(db, meeting),
    )
    return success(detail.model_dump(mode="json"))


@router.get("/{meeting_id}/minutes", response_model=Envelope[MeetingMinutesResponse])
def get_meeting_minutes(
    meeting_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> dict:
    import json
    meeting = _get_meeting(db, meeting_id)
    
    member = db.query(Member).filter(
        Member.workspace_id == meeting.workspace_id, Member.user_id == user.user_id, Member.is_deleted.is_(False)
    ).first()

    if not member:
        raise AppError(ErrorCode.FORBIDDEN)

    segment_member_ids = {seg.member_id for seg in meeting.segments if seg.member_id}
    display_names = {
        m.member_id: m.display_name
        for m in db.query(Member).filter(Member.member_id.in_(segment_member_ids)).all()
    } if segment_member_ids else {}

    attendees = []
    seen = set()
    for seg in meeting.segments:
        if seg.member_id and seg.member_id not in seen:
            seen.add(seg.member_id)
            attendees.append({
                "member_id": seg.member_id,
                "display_name": display_names.get(seg.member_id)
            })
            
    summary = None
    transcript = []
    
    extraction = db.query(Extraction).filter(Extraction.meeting_id == meeting_id).order_by(Extraction.created_at.desc()).first()
    if extraction:
        if extraction.summary:
            try:
                summary = json.loads(extraction.summary)
            except:
                pass
                
        # 대본 구성 (향후 실제 대본 맵핑 로직 필요, 임시 Mock)
        transcript = [
            {
                "at_ms": 0,
                "speaker_member_id": None,
                "speaker_display_name": None,
                "speaker_fallback": "Speaker 1",
                "text": "회의 기록입니다. 추후 대본 맵핑 기능이 연결될 예정입니다."
            }
        ]
        
    return success(MeetingMinutesResponse(
        meeting_id=meeting.meeting_id,
        title=meeting.title,
        started_at=meeting.started_at,
        duration_ms=meeting.audio.duration_ms if meeting.audio else 0,
        source=meeting.source,
        attendees=attendees,
        summary=summary,
        transcript=transcript,
        permissions={"can_review": member.role == "pm", "can_undo": member.role == "pm"}
    ).model_dump(mode="json"))

