"""AI 가 알린 처리 단계를 회의에 저장하는 조건부 UPDATE. 단계는 앞으로만 간다."""
from datetime import datetime, timezone

from sqlalchemy import or_, update
from sqlalchemy.orm import Session

from app.models import Meeting, MeetingProcessingStage, MeetingStatus
from app.schemas.meeting import MeetingSttProgress

_ORDER = [
    MeetingProcessingStage.STT,
    MeetingProcessingStage.SOURCES,
    MeetingProcessingStage.EXTRACT,
    MeetingProcessingStage.HANDOFF,
]


def stage_rank(stage: str | None) -> int:
    """알리지 않았거나 모르는 값은 0, 그 뒤로 stt 1 ~ handoff 4."""
    try:
        return _ORDER.index(MeetingProcessingStage(stage)) + 1
    except ValueError:
        return 0


def report_stage(
    db: Session,
    meeting_id: str,
    stage: MeetingProcessingStage,
    stt: MeetingSttProgress | None = None,
) -> bool:
    """processing 인 회의에 단계를 기록한다. 반영했으면 True.

    같은 단계 재전송·역행·processing 이 아닌 회의는 무시한다. 같은 stt 단계에 진행(stt)만 달라졌으면 진행만 고치고
    단계 시작 시각은 그대로 둔다. 앞 단계로 넘어갈 때는 진행을 요청 값으로 덮고, 없으면 NULL 로 비운다. 읽고 쓰면 늦게 도착한 보고가 앞선 단계를 덮을 수
    있어, 판정과 쓰기를 한 문장으로 묶는다.
    """
    earlier = [s.value for s in _ORDER if stage_rank(s) < stage_rank(stage)]
    result = db.execute(
        update(Meeting)
        .where(
            Meeting.meeting_id == meeting_id,
            Meeting.status == str(MeetingStatus.PROCESSING),
            or_(
                Meeting.processing_stage.is_(None),
                Meeting.processing_stage.in_(earlier),
            ),
        )
        .values(
            processing_stage=stage.value,
            processing_stage_at=datetime.now(timezone.utc),
            processing_stt_done=stt.done if stt else None,
            processing_stt_total=stt.total if stt else None,
        )
    )
    if result.rowcount == 0:
        if stt is None or stage != MeetingProcessingStage.STT:
            db.rollback()
            return False
        result = db.execute(
            update(Meeting)
            .where(
                Meeting.meeting_id == meeting_id,
                Meeting.status == str(MeetingStatus.PROCESSING),
                Meeting.processing_stage == stage.value,
                or_(
                    Meeting.processing_stt_done.is_(None),
                    Meeting.processing_stt_total.is_(None),
                    Meeting.processing_stt_done != stt.done,
                    Meeting.processing_stt_total != stt.total,
                ),
            )
            .values(processing_stt_done=stt.done, processing_stt_total=stt.total)
        )
        if result.rowcount == 0:
            db.rollback()
            return False
    db.commit()
    return True
