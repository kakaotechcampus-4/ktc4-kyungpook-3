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
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Meeting, MeetingSource, MeetingStatus, MeetingUpload
from app.schemas.upload import PendingUpload, PendingUploadListResponse, UploadClaimResponse
from app.services import upload_storage

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
    meeting = db.get(Meeting, meeting_id)
    upload = db.get(MeetingUpload, meeting_id)
    if meeting is None or upload is None:
        raise _not_found(meeting_id)
    if meeting.status != MeetingStatus.PROCESSING:
        raise AppError(
            ErrorCode.MEETING_ALREADY_ENDED,
            details={"meeting_id": meeting_id, "status": meeting.status},
        )
    # 이미 가져갔다. 앞선 claim 응답을 못 받은 재시도일 수도 있다(계약 참고)
    raise AppError(ErrorCode.MEETING_PROCESSING_IN_PROGRESS, details={"meeting_id": meeting_id})


@router.get(
    "/{meeting_id}/file",
    response_class=FileResponse,
    responses={200: {"content": {"application/octet-stream": {}}, "description": "업로드한 녹음 원본"}},
)
def download_upload(meeting_id: str, db: Session = Depends(get_db)) -> FileResponse:
    """업로드한 녹음 원본. 상태는 보지 않는다(가져가기 전후 모두 받을 수 있다)."""
    upload = db.get(MeetingUpload, meeting_id)
    if upload is None:
        raise _not_found(meeting_id)
    path = upload_storage.audio_path(meeting_id, upload.stored_filename)
    if not path.is_file():
        raise _not_found(meeting_id)
    return FileResponse(
        path,
        media_type=upload.content_type or "application/octet-stream",
        filename=upload.stored_filename,
    )
