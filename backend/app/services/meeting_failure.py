"""회의를 failed 로 끝내는 조건부 UPDATE. AI 의 /fail 보고와 업로드 sweeper 가 같이 쓴다."""
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import Meeting, MeetingSource, MeetingStatus
from app.services import meeting_deletion, upload_storage


def fail_meeting_if(
    db: Session,
    meeting_id: str,
    failed_stage: str,
    *extra_where,
    now: datetime | None = None,
) -> bool:
    """아직 끝나지 않은(done·failed 가 아닌) 회의를 failed 로 바꾼다. 바꿨으면 True, 졌으면 롤백하고 False.

    claim·진행 보고와 같은 공간→회의 잠금을 먼저 얻고, 새 UPDATE 문장에서 조건을 판단한다.
    잠금을 기다리는 동안 MeetingUpload에 반영된 claim도 읽어야 한다. 조건부 UPDATE만 먼저 시작하면
    PostgreSQL의 이전 snapshot이 claim을 놓칠 수 있다. 추출 등록의 done 상태도 덮지 않는다.
    True는 처리 상태 전환을 뜻한다. 업로드 파일 삭제는 커밋 뒤 시도하며 실패하면 sweeper가 재시도한다.
    """
    meeting_deletion.require_live_meeting(db, meeting_id, lock=True)
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
        .execution_options(synchronize_session="fetch")
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
