"""회의 녹음 보관 기록(`meeting_audio`)과 원문 듣기 가능 여부 판단(#659).

녹음은 BE 에 들어온 시각(`received_at`)부터 `UPLOAD_AUDIO_RETENTION_DAYS`(기본 7)일 동안 듣게 둔다.
처리 중(`done`·`failed` 가 아님)인 회의는 기간이 지나도 만료로 보지 않는다. 처리에 아직 필요한 녹음이라 지우지 않는다.
이 모듈은 DB 만 보고 판단하며 파일은 읽거나 지우지 않는다(파일은 `upload_storage` 담당).
"""
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import Meeting, MeetingAudio, MeetingStatus

DEFAULT_RETENTION_DAYS = 7

REASON_EXPIRED = "expired"
REASON_NO_RECORDING = "no_recording"


def retention() -> timedelta:
    """녹음을 듣게 두는 기간. 환경변수 `UPLOAD_AUDIO_RETENTION_DAYS` 로 바꾼다."""
    return timedelta(days=int(os.getenv("UPLOAD_AUDIO_RETENTION_DAYS") or DEFAULT_RETENTION_DAYS))


def _aware(value: datetime) -> datetime:
    """SQLite 는 시간대 없는 값을 돌려주므로 UTC 로 본다."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def expires_at(row: MeetingAudio) -> datetime:
    return _aware(row.received_at) + retention()


def record(
    db: Session,
    meeting_id: str,
    filename: str,
    content_type: str,
    size_bytes: int,
    now: datetime,
) -> MeetingAudio:
    """회의의 녹음 기록을 남긴다. 이미 있으면 파일 정보만 바꾸고 `received_at` 은 그대로 둔다.

    커밋은 호출한 쪽이 한다.
    """
    row = db.get(MeetingAudio, meeting_id)
    if row is None:
        row = MeetingAudio(
            meeting_id=meeting_id,
            filename=filename,
            content_type=content_type,
            size_bytes=size_bytes,
            received_at=now,
        )
        db.add(row)
        return row
    row.filename = filename
    row.content_type = content_type
    row.size_bytes = size_bytes
    return row


def _row_and_reason(db: Session, meeting: Meeting, now: datetime) -> tuple[MeetingAudio | None, str | None]:
    row = db.get(MeetingAudio, meeting.meeting_id)
    if row is None or row.deleted_at is not None or meeting.status == MeetingStatus.FAILED:
        return row, REASON_NO_RECORDING
    if meeting.status == MeetingStatus.DONE and now >= expires_at(row):
        return row, REASON_EXPIRED
    return row, None


def unavailable_reason(db: Session, meeting: Meeting, now: datetime) -> str | None:
    """들을 수 없는 이유(`no_recording`·`expired`). 들을 수 있으면 None."""
    return _row_and_reason(db, meeting, now)[1]


def require_playable(db: Session, meeting: Meeting, now: datetime) -> MeetingAudio:
    """들을 수 있으면 기록을 돌려주고, 아니면 404 `AUDIO_NOT_AVAILABLE` 을 낸다."""
    row, reason = _row_and_reason(db, meeting, now)
    if reason is not None or row is None:
        raise AppError(
            ErrorCode.AUDIO_NOT_AVAILABLE,
            details={"meeting_id": meeting.meeting_id, "reason": reason or REASON_NO_RECORDING},
        )
    return row


def playback_info(db: Session, meeting: Meeting, now: datetime) -> dict | None:
    """응답에 실을 재생 정보. 들을 수 없으면 None."""
    row, reason = _row_and_reason(db, meeting, now)
    if reason is not None or row is None:
        return None
    return {
        "content_type": row.content_type,
        "expires_at": expires_at(row),
        "size_bytes": row.size_bytes,
    }
