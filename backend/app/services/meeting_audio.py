"""회의 녹음 보관 기록(`meeting_audio`)과 원문 듣기 가능 여부 판단(#659).

녹음은 보관 기준 시각(`retention_from`)부터 `UPLOAD_AUDIO_RETENTION_DAYS`(기본 7)일 동안 듣게 둔다.
처리 중(`done`·`failed` 가 아님)인 회의는 기간이 지나도 만료로 보지 않는다. 처리에 아직 필요한 녹음이라 지우지 않는다.
이 모듈은 DB 만 보고 판단하며 파일은 읽거나 지우지 않는다(파일은 `upload_storage` 담당).
"""
import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import Meeting, MeetingAudio, MeetingStatus, Workspace
from app.services import meeting_deletion, upload_storage

logger = logging.getLogger(__name__)

DEFAULT_RETENTION_DAYS = 7

REASON_EXPIRED = "expired"
REASON_NO_RECORDING = "no_recording"


def retention() -> timedelta:
    """녹음을 듣게 두는 기간. 환경변수 `UPLOAD_AUDIO_RETENTION_DAYS`(양의 정수)로 바꾼다.

    값이 잘못되면 경고를 남기고 기본값(7일)을 쓴다. 설정 실수로 녹음이 바로 지워지거나 요청이 죽지 않게 한다.
    """
    raw = os.getenv("UPLOAD_AUDIO_RETENTION_DAYS")
    if not raw:
        return timedelta(days=DEFAULT_RETENTION_DAYS)
    try:
        days = int(raw)
    except ValueError:
        days = 0
    if days <= 0:
        logger.warning(
            "UPLOAD_AUDIO_RETENTION_DAYS 는 양의 정수여야 합니다(받은 값=%r). 기본 %d일을 씁니다.",
            raw, DEFAULT_RETENTION_DAYS,
        )
        return timedelta(days=DEFAULT_RETENTION_DAYS)
    return timedelta(days=days)


def _aware(value: datetime) -> datetime:
    """SQLite 는 시간대 없는 값을 돌려주므로 UTC 로 본다."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def deadline(retention_from: datetime) -> datetime:
    """보관 기준 시각에서 보관 기간만큼 지난 시각. 이때부터 들을 수 없다."""
    return _aware(retention_from) + retention()


def expires_at(row: MeetingAudio) -> datetime:
    return deadline(row.retention_from)


def record(
    db: Session,
    meeting_id: str,
    filename: str,
    content_type: str,
    size_bytes: int,
    retention_from: datetime,
) -> MeetingAudio:
    """회의의 녹음 기록을 남긴다. 이미 있으면 파일 정보만 바꾸고 `retention_from` 은 처음 값을 그대로 둔다.

    `retention_from` 은 보관 기간을 세기 시작할 시각이다(업로드 회의는 받은 시각, 디스코드 회의는 회의 종료 시각).

    커밋은 호출한 쪽이 한다.
    """
    row = db.get(MeetingAudio, meeting_id)
    if row is None:
        row = MeetingAudio(
            meeting_id=meeting_id,
            filename=filename,
            content_type=content_type,
            size_bytes=size_bytes,
            retention_from=retention_from,
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


def sweep_expired_audio(db: Session, now: datetime | None = None) -> list[str]:
    """지울 때가 된 녹음을 지우고 `deleted_at` 을 채운다. 지운 회의 id 목록을 돌려준다.

    대상은 아직 지우지 않은 기록 중 회의·공간이 살아 있고, 회의가 failed 이거나(바로 지운다)
    done 이면서 보관 기간이 지난 것이다. 처리 중인 회의는 지나도 건드리지 않는다.
    파일(S3)은 트랜잭션·잠금 없이 먼저 지운다. 지울 조건(failed, 또는 done 이면서 보관 기간 지남)은 한 번 참이면
    계속 참이라, 잠그기 전에 지워도 들을 수 있는 녹음을 지우지 않는다. 지운 뒤 공간→회의를 짧게 잠가 조건을 다시
    확인하고 `deleted_at` 을 커밋한다. 그 사이 회의·공간이 지워졌으면 건너뛴다(삭제 경로가 정리를 맡는다).
    지우지 못하면 `deleted_at` 을 비워 두어 다음 바퀴에 다시 시도한다. 한 회의의 실패가 나머지를 막지 않는다.
    """
    now = now or datetime.now(timezone.utc)
    cutoff = now - retention()
    meeting_ids = db.scalars(
        select(MeetingAudio.meeting_id)
        .join(Meeting, Meeting.meeting_id == MeetingAudio.meeting_id)
        .join(Workspace, Workspace.workspace_id == Meeting.workspace_id)
        .where(
            MeetingAudio.deleted_at.is_(None),
            Meeting.deleted_at.is_(None),
            Workspace.deleted_at.is_(None),
            (Meeting.status == str(MeetingStatus.FAILED))
            | ((Meeting.status == str(MeetingStatus.DONE)) & (MeetingAudio.retention_from < cutoff)),
        )
    ).all()
    # 후보만 읽었다. 파일을 지우는 동안 트랜잭션(DB 연결)을 쥐지 않도록 끝낸다
    db.rollback()
    swept: list[str] = []
    for meeting_id in meeting_ids:
        try:
            upload_storage.remove_audio(meeting_id)
        except (OSError, ValueError):
            logger.exception("회의 녹음 정리 실패 meeting_id=%s. 다음 바퀴에 다시 시도합니다.", meeting_id)
            continue
        try:
            meeting = meeting_deletion.require_live_meeting(db, meeting_id, lock=True)
            row = db.get(MeetingAudio, meeting_id, populate_existing=True)
            if row is None or row.deleted_at is not None:
                continue
            # 고른 뒤 바뀐 것이 없는지 잠근 채로 다시 본다. 들을 수 있는 상태면 기록을 바꾸지 않는다
            if _row_and_reason(db, meeting, now)[1] is None:
                continue
            row.deleted_at = now
            db.commit()
            swept.append(meeting_id)
        except AppError:
            continue  # 그 사이 회의나 공간이 지워졌다. 삭제 경로가 파일을 정리한다.
        finally:
            db.rollback()
    return swept
