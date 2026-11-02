"""수동 업로드 화자 지정에서 AI 가 쓰는 전이: 라벨 전달, 지정 결과 조회, 다시 가져가기(#266).

상태 전이는 모두 조건부 UPDATE 한 문장으로 판정하고 rowcount 로 가른다(읽고 나서 쓰지 않는다).
실패하면(rowcount 0) 롤백한 뒤 다시 읽어 원인을 가른다. 실패 응답은 상태를 바꾸지 않는다.
"""
import json
from datetime import datetime, timezone

from sqlalchemy import exists, select, update
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import Meeting, MeetingSource, MeetingStatus, MeetingUpload
from app.schemas.upload import SpeakerLabel

_ENDED = (str(MeetingStatus.DONE), str(MeetingStatus.FAILED))


def _not_found(meeting_id: str) -> AppError:
    return AppError(ErrorCode.MEETING_NOT_FOUND, details={"meeting_id": meeting_id})


def _with_status(code: ErrorCode, meeting_id: str, status: str) -> AppError:
    return AppError(code, details={"meeting_id": meeting_id, "status": status})


def normalize_speakers(speakers: list[SpeakerLabel] | list[dict]) -> list[dict]:
    """라벨과 샘플의 순서, 숫자 표기(1 과 1.0)에 상관없이 같은 내용이면 같게 만든다. 저장과 비교에 쓴다."""
    items = [s.model_dump() if isinstance(s, SpeakerLabel) else s for s in speakers]
    return sorted(
        (
            {
                "label": item["label"],
                "total_sec": float(item["total_sec"]),
                "samples": sorted(
                    (
                        {"start": float(x["start"]), "end": float(x["end"])}
                        for x in item["samples"]
                    ),
                    key=lambda x: (x["start"], x["end"]),
                ),
            }
            for item in items
        ),
        key=lambda item: item["label"],
    )


def _read_upload_meeting(db: Session, meeting_id: str) -> tuple[Meeting, MeetingUpload]:
    """업로드 회의와 업로드 정보를 읽는다. 없거나 업로드 회의가 아니면 404."""
    meeting = db.get(Meeting, meeting_id)
    upload = db.get(MeetingUpload, meeting_id)
    if meeting is None or upload is None or meeting.source != str(MeetingSource.MANUAL_UPLOAD):
        raise _not_found(meeting_id)
    return meeting, upload


def report_speakers(
    db: Session, meeting_id: str, speakers: list[SpeakerLabel], now: datetime | None = None
) -> Meeting:
    """AI 가 낸 화자 라벨을 저장하고 processing -> awaiting_speakers 로 옮긴다.

    판정은 meeting 행의 조건부 UPDATE 한 문장이다. meeting_upload 의 조건(가져감, 아직 안 보고함)은
    EXISTS 로 같은 문장에 넣는다. meeting 행을 먼저 바꾸므로 PostgreSQL 에서 동시에 온 둘째 요청은 그 행
    잠금에서 기다렸다가 status 조건에 걸려 rowcount 0 이 된다. 이긴 쪽만 같은 트랜잭션에서
    meeting_upload 에 라벨을 쓰고 한 번에 커밋한다. 같은 내용을 다시 보내면 멱등으로 성공한다.
    """
    now = now or datetime.now(timezone.utc)
    normalized = normalize_speakers(speakers)
    result = db.execute(
        update(Meeting)
        .where(
            Meeting.meeting_id == meeting_id,
            Meeting.source == str(MeetingSource.MANUAL_UPLOAD),
            Meeting.status == str(MeetingStatus.PROCESSING),
            exists().where(
                MeetingUpload.meeting_id == Meeting.meeting_id,
                MeetingUpload.claimed_at.is_not(None),
                MeetingUpload.speakers_reported_at.is_(None),
            ),
        )
        .values(status=str(MeetingStatus.AWAITING_SPEAKERS))
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 1:
        db.execute(
            update(MeetingUpload)
            .where(MeetingUpload.meeting_id == meeting_id)
            .values(speakers=json.dumps(normalized, ensure_ascii=False), speakers_reported_at=now)
        )
        db.commit()
        db.expire_all()
        return db.get(Meeting, meeting_id)

    db.rollback()
    meeting, upload = _read_upload_meeting(db, meeting_id)
    if meeting.status in _ENDED:
        raise _with_status(ErrorCode.MEETING_ALREADY_ENDED, meeting_id, meeting.status)
    if upload.claimed_at is None:
        raise _with_status(ErrorCode.UPLOAD_NOT_CLAIMED, meeting_id, meeting.status)
    if upload.speakers_reported_at is not None and upload.speakers is not None:
        if normalize_speakers(json.loads(upload.speakers)) == normalized:
            return meeting
    raise _with_status(ErrorCode.SPEAKERS_ALREADY_REPORTED, meeting_id, meeting.status)


def list_assigned(db: Session) -> list[tuple[Meeting, MeetingUpload]]:
    """지정이 끝났고 아직 다시 가져가지 않은 processing 업로드 회의. 지정 시각 오름차순."""
    rows = db.execute(
        select(Meeting, MeetingUpload)
        .join(MeetingUpload, MeetingUpload.meeting_id == Meeting.meeting_id)
        .where(
            Meeting.source == str(MeetingSource.MANUAL_UPLOAD),
            Meeting.status == str(MeetingStatus.PROCESSING),
            MeetingUpload.speakers_assigned_at.is_not(None),
            MeetingUpload.resumed_at.is_(None),
        )
        .order_by(MeetingUpload.speakers_assigned_at, Meeting.meeting_id)
    ).all()
    return [(meeting, upload) for meeting, upload in rows]


def resume_upload(
    db: Session, meeting_id: str, now: datetime | None = None
) -> tuple[Meeting, MeetingUpload]:
    """지정 결과를 한 번만 가져가게 한다(resumed_at 기록). 둘째 호출은 409."""
    now = now or datetime.now(timezone.utc)
    result = db.execute(
        update(MeetingUpload)
        .where(
            MeetingUpload.meeting_id == meeting_id,
            MeetingUpload.resumed_at.is_(None),
            MeetingUpload.speakers_assigned_at.is_not(None),
            exists().where(
                Meeting.meeting_id == MeetingUpload.meeting_id,
                Meeting.source == str(MeetingSource.MANUAL_UPLOAD),
                Meeting.status == str(MeetingStatus.PROCESSING),
            ),
        )
        .values(resumed_at=now)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 1:
        db.commit()
        db.expire_all()
        return _read_upload_meeting(db, meeting_id)

    db.rollback()
    meeting, upload = _read_upload_meeting(db, meeting_id)
    if meeting.status in _ENDED:
        raise _with_status(ErrorCode.MEETING_ALREADY_ENDED, meeting_id, meeting.status)
    if upload.resumed_at is not None:
        raise AppError(ErrorCode.MEETING_PROCESSING_IN_PROGRESS, details={"meeting_id": meeting_id})
    raise _with_status(ErrorCode.SPEAKERS_NOT_ASSIGNED, meeting_id, meeting.status)
