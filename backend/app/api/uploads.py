"""AI가 웹 업로드 회의를 가져가는 경로. 사용자 세션 없이 부르므로 서비스 토큰(X-Service-Token)으로 막는다.

AI는 대기 목록을 주기적으로 읽고 → 한 회의를 가져가고(claim) → 녹음을 받아 처리한 뒤,
결과는 Discord 회의와 같은 `/meetings/{id}/sources`, `/extractions`, `/fail`로 보낸다.

업로드 회의는 처음부터 `processing`이다. AI가 가져갔는지는 `meeting_upload.claimed_at`으로 가린다.
업로드 정보는 `meeting_upload`에 있고 디스크에는 녹음만 있다. 대기 목록은 DB만 읽는다.
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy import exists, select, update
from sqlalchemy.orm import Session

from app.api.deps import require_service_token
from app.core.database import get_db
from app.services.meeting_deletion import require_live_meeting
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Meeting, MeetingSource, MeetingStatus, MeetingUpload
from app.schemas.upload import (
    AssignedUpload,
    AssignedUploadListResponse,
    PendingUpload,
    PendingUploadListResponse,
    ResumeResponse,
    SpeakersReportRequest,
    SpeakersReportResponse,
    UploadClaimResponse,
)
from app.services import speaker_assignment, upload_storage

router = APIRouter(
    prefix="/uploads", tags=["uploads"], dependencies=[Depends(require_service_token)]
)


def _not_found(meeting_id: str) -> AppError:
    return AppError(ErrorCode.MEETING_NOT_FOUND, details={"meeting_id": meeting_id})


@router.get("/pending", response_model=Envelope[PendingUploadListResponse])
def list_pending_uploads(db: Session = Depends(get_db)) -> dict:
    """아직 아무도 가져가지 않은 업로드 회의. 먼저 올라온 순서다.

    `processing`이고 `claimed_at`이 비어 있는 것만 준다. 업로드 API가 공간마다 처리 중 회의를 하나로
    막으므로, 한 공간에서 둘이 나오지 않는다.
    """
    rows = db.execute(
        select(Meeting, MeetingUpload)
        .join(MeetingUpload, MeetingUpload.meeting_id == Meeting.meeting_id)
        .where(
            Meeting.source == str(MeetingSource.MANUAL_UPLOAD),
            Meeting.status == str(MeetingStatus.PROCESSING),
            MeetingUpload.claimed_at.is_(None),
        )
        .order_by(MeetingUpload.uploaded_at, Meeting.meeting_id)
    ).all()
    items = [
        PendingUpload(
            meeting_id=meeting.meeting_id,
            workspace_id=meeting.workspace_id,
            title=meeting.title,
            started_at=meeting.started_at,
            attendees=json.loads(upload.attendees),
            original_filename=upload.original_filename,
            stored_filename=upload.stored_filename,
            size_bytes=upload.size_bytes,
            content_type=upload.content_type,
            uploaded_at=upload.uploaded_at,
        )
        for meeting, upload in rows
    ]
    return success(PendingUploadListResponse(items=items).model_dump(mode="json"))


@router.patch("/{meeting_id}/claim", response_model=Envelope[UploadClaimResponse])
def claim_upload(meeting_id: str, db: Session = Depends(get_db)) -> dict:
    """처리 중인 업로드 회의를 가져간다(`claimed_at` 기록). 두 번 불러도 한 번만 성공한다."""
    # 읽고 나서 쓰면 동시에 부른 둘이 모두 가져갈 수 있다. 판정과 쓰기를 한 문장으로 묶는다
    result = db.execute(
        update(MeetingUpload)
        .where(
            MeetingUpload.meeting_id == meeting_id,
            MeetingUpload.claimed_at.is_(None),
            exists().where(
                Meeting.meeting_id == MeetingUpload.meeting_id,
                Meeting.status == str(MeetingStatus.PROCESSING),
            ),
        )
        .values(claimed_at=datetime.now(timezone.utc))
    )
    if result.rowcount == 1:
        db.commit()
        return success(
            UploadClaimResponse(meeting_id=meeting_id, status=MeetingStatus.PROCESSING).model_dump()
        )

    db.rollback()
    meeting = require_live_meeting(db, meeting_id, lock=True)
    upload = db.get(MeetingUpload, meeting_id)
    if upload is None:
        raise _not_found(meeting_id)
    if meeting.status != MeetingStatus.PROCESSING:
        raise AppError(
            ErrorCode.MEETING_ALREADY_ENDED,
            details={"meeting_id": meeting_id, "status": meeting.status},
        )
    # 이미 가져갔다. 앞선 claim 응답을 못 받은 재시도일 수도 있다(계약 참고)
    raise AppError(ErrorCode.MEETING_PROCESSING_IN_PROGRESS, details={"meeting_id": meeting_id})


@router.post("/{meeting_id}/speakers", response_model=Envelope[SpeakersReportResponse])
def report_speakers(
    meeting_id: str, body: SpeakersReportRequest, db: Session = Depends(get_db)
) -> dict:
    """AI 가 화자 라벨을 보내면 회의가 지정 대기(awaiting_speakers)가 된다. 같은 내용 재전송은 200."""
    meeting = speaker_assignment.report_speakers(db, meeting_id, body.speakers)
    return success(
        SpeakersReportResponse(meeting_id=meeting_id, status=meeting.status).model_dump()
    )


@router.get("/assigned", response_model=Envelope[AssignedUploadListResponse])
def list_assigned_uploads(db: Session = Depends(get_db)) -> dict:
    """PM 이 지정을 끝냈고 AI 가 아직 다시 가져가지 않은 업로드 회의. 지정 시각 순이다."""
    items = [
        AssignedUpload(
            meeting_id=meeting.meeting_id,
            workspace_id=meeting.workspace_id,
            title=meeting.title,
            started_at=meeting.started_at,
            mapping=json.loads(upload.speaker_mapping or "{}"),
            assigned_at=upload.speakers_assigned_at,
        )
        for meeting, upload in speaker_assignment.list_assigned(db)
    ]
    return success(AssignedUploadListResponse(items=items).model_dump(mode="json"))


@router.patch("/{meeting_id}/resume", response_model=Envelope[ResumeResponse])
def resume_upload(meeting_id: str, db: Session = Depends(get_db)) -> dict:
    """지정 결과를 가져간다(`resumed_at`은 처음 한 번만 기록). 다시 불러도 같은 mapping 으로 200 이다."""
    meeting, upload = speaker_assignment.resume_upload(db, meeting_id)
    return success(
        ResumeResponse(
            meeting_id=meeting_id,
            status=meeting.status,
            mapping=json.loads(upload.speaker_mapping or "{}"),
        ).model_dump()
    )


@router.get(
    "/{meeting_id}/file",
    response_class=FileResponse,
    responses={200: {"content": {"application/octet-stream": {}}, "description": "업로드한 녹음 원본"}},
)
def download_upload(meeting_id: str, db: Session = Depends(get_db)) -> FileResponse:
    """업로드한 녹음 원본. 상태는 보지 않는다(가져가기 전후 모두 받을 수 있다)."""
    require_live_meeting(db, meeting_id, lock=True)
    upload = db.get(MeetingUpload, meeting_id)
    if upload is None:
        raise _not_found(meeting_id)
    path = upload_storage.audio_path(meeting_id, upload.stored_filename)
    if not path.is_file():
        raise _not_found(meeting_id)
    media_type = upload.content_type or "application/octet-stream"
    filename = upload.stored_filename
    # get_db 정리는 응답을 다 보낸 뒤라, 닫지 않으면 파일을 보내는 동안 DB 연결을 잡고 있다
    db.close()
    return FileResponse(path, media_type=media_type, filename=filename)
