"""회의를 failed 로 끝내는 조건부 UPDATE. AI 의 /fail 보고와 업로드 sweeper 가 같이 쓴다."""
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import Meeting, MeetingSource, MeetingStatus
from app.services import upload_storage


def fail_meeting_if(
    db: Session,
    meeting_id: str,
    failed_stage: str,
    *extra_where,
    now: datetime | None = None,
) -> bool:
    """아직 끝나지 않은(done·failed 가 아닌) 회의를 failed 로 바꾼다. 바꿨으면 True, 졌으면 롤백하고 False.

    상태를 읽고 나서 쓰면, 그 사이 추출 등록이 processing → done 으로 선점한 결과를 늦게 도착한 실패가 덮을 수 있다.
    판정과 쓰기를 한 문장으로 묶고, 호출자가 더 걸 조건(`extra_where`)도 같은 문장에 넣는다.
    이겼을 때만 커밋하고, 업로드 회의면 커밋 뒤에 녹음 폴더를 지운다.
    """
    result = db.execute(
        update(Meeting)
        .where(
            Meeting.meeting_id == meeting_id,
            Meeting.deleted_at.is_(None),
            Meeting.status.not_in([str(MeetingStatus.DONE), str(MeetingStatus.FAILED)]),
            *extra_where,
        )
        .values(
            status=str(MeetingStatus.FAILED),
            failed_stage=failed_stage,
            ended_at=now or datetime.now(timezone.utc),
        )
    )
    if result.rowcount == 0:
        db.rollback()
        return False

    db.commit()
    # 실패한 업로드 회의의 녹음은 다시 쓰지 않는다(처리 중에만 보관). 커밋이 성공한 뒤에 지운다
    source = db.scalar(select(Meeting.source).where(Meeting.meeting_id == meeting_id))
    if source == MeetingSource.MANUAL_UPLOAD:
        upload_storage.remove_upload(meeting_id)
    return True
