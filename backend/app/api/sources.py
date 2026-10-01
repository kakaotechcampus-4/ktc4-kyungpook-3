"""회의 발화 저장. AI가 STT 전사(Transcript)를 끝내면 부른다.

디스코드 봇이 사용자 세션 없이 부르는 경로라 세션 대신 서비스 토큰(X-Service-Token)으로 막는다.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.api.deps import require_service_token
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Meeting, MeetingStatus, Source
from app.schemas.source import TranscriptCreateRequest, TranscriptCreateResponse
from app.services.matching import resolve_speaker

router = APIRouter(
    prefix="/meetings", tags=["meetings"], dependencies=[Depends(require_service_token)]
)


def _to_ms(seconds: float) -> int:
    return int(round(seconds * 1000))


def _member_ids_by_speaker(db: Session, workspace_id: str, speakers: set[str]) -> dict[str, str | None]:
    """화자 Discord uid → 이 워크스페이스 팀원 ID. 한 회의에 화자는 몇 명뿐이라 화자마다 한 번만 찾는다."""
    return {uid: resolve_speaker(db, workspace_id, uid).member_id for uid in speakers}


def _insert_skipping_existing(db: Session, rows: list[dict]) -> int:
    """(meeting_id, seq)가 이미 있는 행은 건너뛰고 넣는다. 새로 넣은 행 수를 돌려준다.

    재전송은 지우고 다시 넣지 않는다. 발화를 지우면 그 발화를 가리키는 근거(evidence)도 CASCADE로 지워진다.
    넣은 행 수는 rowcount 대신 RETURNING으로 센다. PostgreSQL에서는 여러 행 INSERT의 rowcount가 -1로 온다.
    """
    insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    stmt = (
        insert(Source)
        .values(rows)
        .on_conflict_do_nothing(index_elements=["meeting_id", "seq"])
        .returning(Source.source_id)
    )
    return len(db.execute(stmt).all())


@router.post(
    "/{meeting_id}/sources",
    status_code=201,
    response_model=Envelope[TranscriptCreateResponse],
)
def create_sources(
    meeting_id: str,
    payload: TranscriptCreateRequest,
    db: Session = Depends(get_db),
) -> dict:
    """전사 발화를 source에 저장한다. 같은 seq를 다시 보내면 덮어쓰지 않고 건너뛴다.

    done 회의도 받는다. 봇이 추출 결과를 다시 보내기 전에 전사를 한 번 더 올려도 깨지지 않게 하려는 것이다.
    """
    meeting = db.get(Meeting, meeting_id)
    if meeting is None:
        raise AppError(ErrorCode.MEETING_NOT_FOUND, details={"meeting_id": meeting_id})
    if meeting.status == MeetingStatus.FAILED:
        raise AppError(
            ErrorCode.MEETING_ALREADY_ENDED,
            details={"meeting_id": meeting_id, "status": meeting.status},
        )

    member_ids = _member_ids_by_speaker(
        db, meeting.workspace_id, {seg.speaker for seg in payload.segments if seg.speaker}
    )
    rows = [
        {
            "meeting_id": meeting_id,
            "seq": seg.seq,
            "speaker_discord_user_id": seg.speaker,
            "member_id": member_ids.get(seg.speaker) if seg.speaker else None,
            "start_ms": _to_ms(seg.start),
            "end_ms": _to_ms(seg.end),
            "text": seg.text,
        }
        for seg in payload.segments
    ]
    inserted = _insert_skipping_existing(db, rows) if rows else 0
    # 이번 요청이 아니라 저장된 발화 전체로 센다. 나눠 보내도 맞고, 재전송으로 줄어들지 않는다.
    # 마지막 seq가 아니라 최댓값인 이유는 겹쳐 말하면 앞 발화가 더 늦게 끝날 수 있어서다.
    meeting.duration_ms = db.scalar(
        select(func.max(Source.end_ms)).where(Source.meeting_id == meeting_id)
    )
    db.commit()

    return success(
        TranscriptCreateResponse(
            meeting_id=meeting_id,
            inserted=inserted,
            skipped=len(rows) - inserted,
            duration_ms=meeting.duration_ms,
        ).model_dump(mode="json")
    )
