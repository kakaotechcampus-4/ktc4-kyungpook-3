from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, Response
from fastapi.responses import FileResponse
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_member, require_pm, require_service_token
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Extraction, Meeting, MeetingProcessingStage, MeetingStatus, Member, Source, User
from app.schemas.meeting import (
    MeetingCreateRequest,
    MeetingCreateResponse,
    MeetingDetailResponse,
    MeetingEndResponse,
    MeetingFailRequest,
    MeetingMinutesResponse,
    MeetingProcessing,
    MeetingProgress,
    MeetingStageRequest,
    MeetingStageResponse,
    MeetingSttProgress,
)
from app.schemas.record_edit import LineEditRequest, LineEditResponse, TitleEditRequest, TitleEditResponse
from app.schemas.upload import SpeakerAssignRequest, SpeakerAssignResponse, SpeakerViewResponse
from app.services import meeting_failure, meeting_stage, speaker_assignment, summary, transcript
from app.services import meeting_deletion
from app.schemas.meeting_deletion import MeetingDeletionReceipt

router = APIRouter(prefix="/meetings", tags=["meetings"])

_ENDED_STATUSES = {
    MeetingStatus.PROCESSING,
    MeetingStatus.AWAITING_SPEAKERS,
    MeetingStatus.DONE,
    MeetingStatus.FAILED,
}


def _get_meeting(db: Session, meeting_id: str) -> Meeting:
    return meeting_deletion.require_live_meeting(db, meeting_id, lock=True)


@router.delete('/{meeting_id}', response_model=Envelope[MeetingDeletionReceipt])
def delete_meeting(meeting_id: str, response: Response, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> dict:
    meeting = db.get(Meeting, meeting_id)
    if meeting is None:
        raise AppError(ErrorCode.MEETING_NOT_FOUND)
    require_pm(db, user, meeting.workspace_id)
    result = meeting_deletion.delete_meeting(db, meeting_id)
    response.status_code = 200 if result.cleanup_status == 'complete' else 202
    return success(result.model_dump(mode='json'))


@router.get('/{meeting_id}/deletion', response_model=Envelope[MeetingDeletionReceipt])
def get_deletion(meeting_id: str, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)) -> dict:
    meeting = db.get(Meeting, meeting_id)
    if meeting is None:
        raise AppError(ErrorCode.MEETING_NOT_FOUND)
    require_pm(db, user, meeting.workspace_id)
    return success(meeting_deletion.receipt(db, meeting).model_dump(mode='json'))


def _compute_progress(db: Session, meeting: Meeting) -> MeetingProgress:
    extraction = (
        db.query(Extraction)
        .filter(Extraction.meeting_id == meeting.meeting_id)
        .order_by(Extraction.created_at.desc())
        .first()
    )
    has_source = bool(
        db.scalar(select(exists().where(Source.meeting_id == meeting.meeting_id)))
    )
    # AI 가 알린 단계가 기본이고, 발화·추출 항목이 이미 있으면 단계가 늦거나 빠져도 그쪽을 믿는다
    rank = meeting_stage.stage_rank(meeting.processing_stage)
    audio_merged = rank >= 1 or has_source
    transcribed = rank >= 2 or has_source
    extracted = rank >= 4 or bool(extraction and extraction.items)
    return MeetingProgress(
        audio_merged=audio_merged, transcribed=transcribed, extracted=extracted
    )


def _stt_progress(meeting: Meeting) -> MeetingSttProgress | None:
    """stt 단계이고 두 값이 모두 있을 때만 전사 진행을 돌려준다."""
    if (
        meeting.processing_stage == MeetingProcessingStage.STT
        and meeting.processing_stt_done is not None
        and meeting.processing_stt_total is not None
    ):
        return MeetingSttProgress(
            done=meeting.processing_stt_done, total=meeting.processing_stt_total
        )
    return None


def _processing(meeting: Meeting) -> MeetingProcessing | None:
    if meeting.status != MeetingStatus.PROCESSING:
        return None
    return MeetingProcessing(
        stage=meeting.processing_stage,
        stage_at=meeting.processing_stage_at,
        stt=_stt_progress(meeting),
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
    x_meeting_lineage_version: str | None = Header(None),
) -> dict:
    from app.services import lifecycle
    lifecycle.workspace(db, payload.workspace_id)
    versioned = x_meeting_lineage_version == "1"
    if payload.source == "discord" and meeting_deletion.enabled() and not versioned:
        raise AppError(ErrorCode.MEETING_CLIENT_UPDATE_REQUIRED)
    meeting = Meeting(
        workspace_id=payload.workspace_id,
        title=payload.title,
        source=str(payload.source),
        status=str(MeetingStatus.CREATED),
        deletion_ready=payload.source != "discord" or versioned,
    )
    if payload.replaces_meeting_id is not None:
        predecessor = meeting_deletion.require_live_meeting(db, payload.replaces_meeting_id)
        root_id = predecessor.recording_root_id or predecessor.meeting_id
        meeting_deletion.require_live_meeting(db, root_id, lock=True)
        db.refresh(predecessor)
        meeting_deletion.assert_live(predecessor)
        if predecessor.workspace_id != payload.workspace_id:
            raise AppError(ErrorCode.WORKSPACE_MISMATCH)
        if predecessor.source != str(payload.source) or predecessor.source == 'manual_upload' or predecessor.status != 'failed':
            raise AppError(ErrorCode.INVALID_REQUEST, message='failed 상태의 같은 출처 회의만 교체할 수 있습니다.')
        existing = db.scalar(select(Meeting).where(Meeting.replaces_meeting_id == predecessor.meeting_id))
        if existing is not None:
            return success(MeetingCreateResponse.model_validate(existing).model_dump(mode='json'))
        meeting.recording_root_id = root_id
        meeting.replaces_meeting_id = predecessor.meeting_id
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
    "/{meeting_id}/stage",
    status_code=200,
    response_model=Envelope[MeetingStageResponse],
    dependencies=[Depends(require_service_token)],
)
def report_meeting_stage(
    meeting_id: str,
    payload: MeetingStageRequest,
    db: Session = Depends(get_db),
) -> dict:
    """봇이 처리 단계를 시작할 때 알린다. 같은 단계·역행·processing 이 아닌 회의는 오류 없이 applied=false 다."""
    _get_meeting(db, meeting_id)
    applied = meeting_stage.report_stage(db, meeting_id, payload.stage, payload.stt)
    meeting = _get_meeting(db, meeting_id)
    db.refresh(meeting)
    return success(
        MeetingStageResponse(
            meeting_id=meeting.meeting_id,
            status=meeting.status,
            processing_stage=meeting.processing_stage,
            stt=_stt_progress(meeting),
            applied=applied,
        ).model_dump(mode="json")
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
        deletion_available=meeting_deletion.deletion_available(db, meeting),
        workspace_id=meeting.workspace_id,
        title=meeting.title,
        status=meeting.status,
        started_at=meeting.started_at,
        ended_at=meeting.ended_at,
        extraction_id=None,
        failed_stage=meeting.failed_stage,
        progress=_compute_progress(db, meeting),
        processing=_processing(meeting),
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
        deletion_available=meeting_deletion.deletion_available(db, meeting),
        workspace_id=meeting.workspace_id,
        title=meeting.title,
        status=meeting.status,
        started_at=meeting.started_at,
        ended_at=meeting.ended_at,
        extraction_id=extraction_id,
        failed_stage=meeting.failed_stage,
        progress=_compute_progress(db, meeting),
        processing=_processing(meeting),
    )
    return success(detail.model_dump(mode="json"))


@router.get("/{meeting_id}/minutes", response_model=Envelope[MeetingMinutesResponse])
def get_meeting_minutes(
    meeting_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> dict:
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
            "seq": src.seq,
            "text": src.shown_text,
            "edited": src.text_edit is not None,
            "original_text": src.text if src.text_edit is not None else None,
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

    extraction = db.query(Extraction).filter(Extraction.meeting_id == meeting_id).order_by(Extraction.created_at.desc()).first()
    state = summary.summary_state(db, meeting, extraction)

    return success(MeetingMinutesResponse(
        meeting_id=meeting.meeting_id,
        title=meeting.title,
        title_edited=meeting.title_edited_at is not None,
        title_original=meeting.title_original,
        started_at=meeting.started_at,
        duration_ms=meeting.duration_ms or 0,
        source=meeting.source,
        attendees=attendees,
        summary=summary.documents(db, [(meeting, extraction)]).get(meeting.meeting_id),
        summary_status=state.status,
        summary_waiting_count=state.waiting_cards if state.status == "awaiting_approval" and member.role == "pm" else None,
        transcript=transcript,
        permissions={"can_review": member.role == "pm", "can_undo": member.role == "pm"}
    ).model_dump(mode="json"))


def _meeting_of_member(db: Session, user: User, meeting_id: str) -> None:
    meeting = db.get(Meeting, meeting_id)
    if meeting is None:
        raise AppError(ErrorCode.MEETING_NOT_FOUND, details={"meeting_id": meeting_id})
    require_member(db, user, meeting.workspace_id)


@router.patch("/{meeting_id}/title", response_model=Envelope[TitleEditResponse])
def edit_meeting_title(
    meeting_id: str,
    payload: TitleEditRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """팀원 누구나 제목을 고친다. 처음 제목은 title_original 로 남는다."""
    _meeting_of_member(db, user, meeting_id)
    meeting = transcript.edit_title(db, meeting_id, payload.title)
    data = TitleEditResponse(
        meeting_id=meeting.meeting_id, title=meeting.title, title_original=meeting.title_original,
        edited=meeting.title_edited_at is not None,
    ).model_dump(mode="json")
    db.commit()
    return success(data)


@router.patch("/{meeting_id}/transcript/{seq}", response_model=Envelope[LineEditResponse])
def edit_transcript_line(
    meeting_id: str,
    seq: int,
    payload: LineEditRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """팀원 누구나 발화 한 줄을 고친다. 원문은 남고 승인 근거 인용은 원문을 쓴다."""
    _meeting_of_member(db, user, meeting_id)
    source = transcript.edit_line(db, meeting_id, seq, payload.text)
    data = LineEditResponse(
        seq=source.seq, text=source.shown_text,
        original_text=source.text if source.text_edit is not None else None, edited=source.text_edit is not None,
    ).model_dump(mode="json")
    db.commit()
    return success(data)


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
