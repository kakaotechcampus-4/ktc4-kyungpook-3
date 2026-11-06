from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_member, require_pm, require_service_token
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Extraction, Meeting, MeetingStatus, Member, Source, User
from app.schemas.meeting import (
    MeetingCreateRequest,
    MeetingCreateResponse,
    MeetingDetailResponse,
    MeetingEndResponse,
    MeetingFailRequest,
    MeetingMinutesResponse,
    MeetingProgress,
)
from app.schemas.upload import SpeakerAssignRequest, SpeakerAssignResponse, SpeakerViewResponse
from app.services import meeting_failure, speaker_assignment

router = APIRouter(prefix="/meetings", tags=["meetings"])

_ENDED_STATUSES = {
    MeetingStatus.PROCESSING,
    MeetingStatus.AWAITING_SPEAKERS,
    MeetingStatus.DONE,
    MeetingStatus.FAILED,
}


def _get_meeting(db: Session, meeting_id: str) -> Meeting:
    meeting = db.get(Meeting, meeting_id)
    if meeting is None:
        raise AppError(
            ErrorCode.MEETING_NOT_FOUND, details={"meeting_id": meeting_id}
        )
    return meeting


def _compute_progress(db: Session, meeting: Meeting) -> MeetingProgress:
    extraction = (
        db.query(Extraction)
        .filter(Extraction.meeting_id == meeting.meeting_id)
        .order_by(Extraction.created_at.desc())
        .first()
    )
    audio_merged = bool(
        db.scalar(select(exists().where(Source.meeting_id == meeting.meeting_id)))
    )
    transcribed = audio_merged
    extracted = bool(extraction and extraction.items)
    return MeetingProgress(
        audio_merged=audio_merged, transcribed=transcribed, extracted=extracted
    )


# 생성·종료·실패는 디스코드 봇(ai/capture/handoff.py)이 사용자 세션 없이 부른다. 세션 대신 서비스 토큰으로 막는다.
@router.post(
    "",
    status_code=201,
    response_model=Envelope[MeetingCreateResponse],
    dependencies=[Depends(require_service_token)],
)
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
    if payload.started_at is not None:
        # 미래 시각이 done 이 되면 chat-cursor 가 그 뒤를 가리켜 채팅 수집이 멈춘다
        if payload.started_at > datetime.now(timezone.utc):
            raise AppError(ErrorCode.INVALID_REQUEST, message="started_at 은 지금보다 늦을 수 없습니다.")
        meeting.started_at = payload.started_at.astimezone(timezone.utc)
    db.add(meeting)
    db.commit()
    db.refresh(meeting)

    return success(
        MeetingCreateResponse.model_validate(meeting).model_dump(mode="json")
    )


@router.patch(
    "/{meeting_id}/end",
    status_code=202,
    response_model=Envelope[MeetingEndResponse],
    dependencies=[Depends(require_service_token)],
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
    "/{meeting_id}/fail",
    status_code=200,
    response_model=Envelope[MeetingDetailResponse],
    dependencies=[Depends(require_service_token)],
)
def fail_meeting(
    meeting_id: str,
    payload: MeetingFailRequest,
    db: Session = Depends(get_db),
) -> dict:
    if not meeting_failure.fail_meeting_if(db, meeting_id, payload.failed_stage):
        meeting = _get_meeting(db, meeting_id)
        raise AppError(
            ErrorCode.MEETING_ALREADY_ENDED,
            details={"meeting_id": meeting_id, "status": meeting.status},
        )

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
def get_meeting(
    meeting_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """웹의 회의 화면·처리 상태 화면이 부른다. 회의가 속한 워크스페이스 멤버만 읽는다. 봇은 이 경로를 쓰지 않는다."""
    meeting = _get_meeting(db, meeting_id)
    require_member(db, user, meeting.workspace_id)

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

    # 전사본은 추출 결과와 상관없이 저장된 발화를 순서대로 보여 준다.
    # 참석자도 같은 결과에서 뽑아 발화를 두 번 읽지 않는다.
    lines = db.execute(
        select(Source, Member.display_name)
        .outerjoin(Member, Member.member_id == Source.member_id)
        .where(Source.meeting_id == meeting.meeting_id)
        .order_by(Source.seq)
    ).all()
    transcript = [
        {
            "at_ms": src.start_ms,
            "speaker_member_id": src.member_id,
            "speaker_display_name": display_name,
            # 팀원이 아니면 FE가 이름 대신 보여 주는 값이다. 디스코드 표시 이름, 없으면 uid 순으로 쓴다
            "speaker_fallback": src.speaker_name or src.speaker_discord_user_id or "Unknown",
            "text": src.text,
        }
        for src, display_name in lines
    ]
    # 팀원별로 처음 말한 순서
    first_spoken: dict[str, str] = {}
    for src, display_name in lines:
        if src.member_id is not None:
            first_spoken.setdefault(src.member_id, display_name)
    attendees = [
        {"member_id": member_id, "display_name": display_name}
        for member_id, display_name in first_spoken.items()
    ]

    summary = None

    extraction = db.query(Extraction).filter(Extraction.meeting_id == meeting_id).order_by(Extraction.created_at.desc()).first()
    if extraction:
        if extraction.summary:
            try:
                summary = json.loads(extraction.summary)
            except ValueError:  # JSONDecodeError 포함. 깨진 요약은 없는 것으로 본다
                pass
            # JSON으로는 맞아도 객체가 아니면(목록·문자열) 응답 스키마(dict | None)에서 500이 난다. 없는 것으로 본다
            if not isinstance(summary, dict):
                summary = None

    return success(MeetingMinutesResponse(
        meeting_id=meeting.meeting_id,
        title=meeting.title,
        started_at=meeting.started_at,
        duration_ms=meeting.duration_ms or 0,
        source=meeting.source,
        attendees=attendees,
        summary=summary,
        transcript=transcript,
        permissions={"can_review": member.role == "pm", "can_undo": member.role == "pm"}
    ).model_dump(mode="json"))


@router.get("/{meeting_id}/speakers", response_model=Envelope[SpeakerViewResponse])
def get_meeting_speakers(
    meeting_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """업로드 회의의 화자 라벨과 지정 상태. 그 워크스페이스 PM 만 본다."""
    meeting = _get_meeting(db, meeting_id)
    require_pm(db, user, meeting.workspace_id)
    view = speaker_assignment.get_speaker_view(db, meeting)
    return success(SpeakerViewResponse.model_validate(view).model_dump(mode="json"))


@router.put("/{meeting_id}/speakers", response_model=Envelope[SpeakerAssignResponse])
def assign_meeting_speakers(
    meeting_id: str,
    payload: SpeakerAssignRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """PM 이 라벨마다 팀원(또는 null)을 지정하고 처리를 이어 가게 한다. 같은 지정을 다시 보내도 성공한다."""
    meeting = _get_meeting(db, meeting_id)
    require_pm(db, user, meeting.workspace_id)
    updated = speaker_assignment.assign_speakers(db, meeting, payload.mapping)
    return success(
        SpeakerAssignResponse(meeting_id=updated.meeting_id, status=updated.status).model_dump(mode="json")
    )


@router.get(
    "/{meeting_id}/audio",
    response_class=FileResponse,
    responses={200: {"content": {"audio/*": {}}, "description": "업로드한 녹음 원본(Range 지원)"}},
)
def get_meeting_audio(
    meeting_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    """PM 이 화자를 가리려고 듣는 원본. 폴더가 있는 동안 상태와 무관하게 준다. Range 는 starlette 가 처리한다."""
    meeting = _get_meeting(db, meeting_id)
    require_pm(db, user, meeting.workspace_id)
    path, content_type = speaker_assignment.get_audio_for_playback(db, meeting)
    # get_db 정리는 응답을 다 보낸 뒤라, 닫지 않으면 파일을 보내는 동안(브라우저가 요청을 열어 둔 동안) DB 연결을 잡고 있다
    db.close()
    return FileResponse(
        path,
        media_type=content_type,
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"},
    )
