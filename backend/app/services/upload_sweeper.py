"""멈춘 업로드 회의를 failed 로 정리한다(#266).

AI 가 업로드를 가져간 뒤 죽거나 PM 이 화자 지정을 하지 않으면 회의가 처리 중으로 남아, 그 워크스페이스는
새 업로드가 409 로 막힌다. 주기 워커가 아래 기준으로 failed 로 바꾸고 녹음 폴더를 지운다.

- 처리 중(processing)이고 AI 가 가져간 업로드: 마지막 진행 시각(가져감·지정·다시 가져감·마지막 발화 저장 중
  가장 늦은 것)에서 CLAIM_STALL_SECONDS 가 지나면 failed_stage=diarize
- 화자 지정 대기(awaiting_speakers): 라벨 보고 시각에서 SPEAKER_ASSIGNMENT_TTL_SECONDS 가 지나면
  failed_stage=speaker_assignment_expired. 3시간 규칙은 쓰지 않는다
- 채팅 회의가 /end 뒤 CHAT_STALL_SECONDS 가 지나도록 processing: failed_stage=chat_stalled
- 아직 가져가지 않은 업로드, Discord 회의, 끝난 회의는 대상이 아니다

회의마다 조건부 UPDATE 한 번으로 바꾼다. 후보를 고른 뒤 AI 의 보고나 PM 의 제출이 먼저 반영되면 UPDATE 가
져서 건너뛴다(같은 시각 조건을 UPDATE 에도 다시 건다).
"""
import logging
import threading
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, exists, or_, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models import Meeting, MeetingSource, MeetingStatus, MeetingUpload, Source
from app.services import meeting_failure

logger = logging.getLogger(__name__)

CLAIM_STALL_SECONDS = 3 * 3600
SPEAKER_ASSIGNMENT_TTL_SECONDS = 7 * 86400
CHAT_STALL_SECONDS = 7 * 3600   # 폴러 시간 제한을 6시간까지 올려도(#431) 살아 있는 폴러의 결과를 버리지 않게 더 길게 둔다
FAILED_STAGE_STALLED = "diarize"
FAILED_STAGE_CHAT = "chat_stalled"
FAILED_STAGE_EXPIRED = "speaker_assignment_expired"


def _is_upload():
    return and_(
        Meeting.source == str(MeetingSource.MANUAL_UPLOAD),
        exists().where(MeetingUpload.meeting_id == Meeting.meeting_id),
    )


def _stalled_condition(cutoff: datetime):
    """처리 중이고 가져간 업로드의 진행 시각이 모두 cutoff 이전(또는 없음)이다."""
    stale = [
        or_(column.is_(None), column < cutoff)
        for column in (
            MeetingUpload.claimed_at,
            MeetingUpload.speakers_assigned_at,
            MeetingUpload.resumed_at,
        )
    ]
    return and_(
        _is_upload(),
        Meeting.status == str(MeetingStatus.PROCESSING),
        exists().where(
            MeetingUpload.meeting_id == Meeting.meeting_id,
            MeetingUpload.claimed_at.is_not(None),
            *stale,
        ),
        ~exists().where(Source.meeting_id == Meeting.meeting_id, Source.created_at >= cutoff),
    )


def _expired_condition(cutoff: datetime):
    """화자 지정을 기다리는데 라벨 보고가 cutoff 이전이다."""
    return and_(
        _is_upload(),
        Meeting.status == str(MeetingStatus.AWAITING_SPEAKERS),
        exists().where(
            MeetingUpload.meeting_id == Meeting.meeting_id,
            MeetingUpload.speakers_reported_at.is_not(None),
            MeetingUpload.speakers_reported_at < cutoff,
        ),
    )


def _chat_stalled_condition(cutoff: datetime):
    """채팅 회의가 /end 뒤 cutoff 가 지나도록 processing 에 머문다(폴러가 /fail 도 못 보내고 죽은 경우)."""
    return and_(
        Meeting.source == str(MeetingSource.CHAT),
        Meeting.status == str(MeetingStatus.PROCESSING),
        Meeting.ended_at.is_not(None),
        Meeting.ended_at < cutoff,
    )


def sweep_stalled_uploads(db: Session, now: datetime | None = None) -> list[tuple[str, str]]:
    """멈춘 업로드 회의를 failed 로 바꾸고 (meeting_id, failed_stage) 목록을 돌려준다."""
    now = now or datetime.now(timezone.utc)
    rules = [
        (_stalled_condition, now - timedelta(seconds=CLAIM_STALL_SECONDS), FAILED_STAGE_STALLED),
        (_expired_condition, now - timedelta(seconds=SPEAKER_ASSIGNMENT_TTL_SECONDS), FAILED_STAGE_EXPIRED),
        (_chat_stalled_condition, now - timedelta(seconds=CHAT_STALL_SECONDS), FAILED_STAGE_CHAT),
    ]
    swept: list[tuple[str, str]] = []
    for condition, cutoff, failed_stage in rules:
        where = condition(cutoff)
        meeting_ids = db.scalars(select(Meeting.meeting_id).where(where)).all()
        for meeting_id in meeting_ids:
            try:
                won = meeting_failure.fail_meeting_if(db, meeting_id, failed_stage, where, now=now)
            except Exception:
                logger.exception("업로드 회의 정리 실패 meeting_id=%s", meeting_id)
                db.rollback()
                continue
            if won:
                logger.warning(
                    "멈춘 업로드 회의를 failed 로 정리함 meeting_id=%s failed_stage=%s 기준 시각=%s",
                    meeting_id, failed_stage, cutoff.isoformat(),
                )
                swept.append((meeting_id, failed_stage))
    return swept


def run_worker(stop_event: threading.Event, interval: float) -> None:
    while not stop_event.is_set():
        db = SessionLocal()
        try:
            sweep_stalled_uploads(db)
        except Exception:
            logger.exception("업로드 sweeper 워커 오류")
            db.rollback()
        finally:
            db.close()
        stop_event.wait(interval)


def start_worker(interval: float) -> tuple[threading.Thread, threading.Event]:
    stop_event = threading.Event()
    thread = threading.Thread(
        target=run_worker, args=(stop_event, interval), name="upload-sweeper", daemon=True
    )
    thread.start()
    return thread, stop_event
