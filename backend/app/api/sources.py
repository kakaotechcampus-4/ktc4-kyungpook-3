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

# INSERT 한 문장에 넣는 행 수. 한 행이 바인드 변수 10개라, 전부 한 번에 넣으면 긴 회의에서
# DB의 바인드 변수 한도(SQLite 32766, PostgreSQL 65535)를 넘는다.
INSERT_BATCH_SIZE = 1000


def _to_ms(seconds: float) -> int:
    return int(round(seconds * 1000))


def _member_ids_by_speaker(db: Session, workspace_id: str, speakers: set[str]) -> dict[str, str | None]:
    """화자 Discord uid → 이 워크스페이스 팀원 ID. 한 회의에 화자는 몇 명뿐이라 화자마다 한 번만 찾는다."""
    return {uid: resolve_speaker(db, workspace_id, uid).member_id for uid in speakers}


def _speaker_name(speaker_names: dict[str, str] | None, uid: str | None) -> str | None:
    """화자 uid의 표시 이름. 봇은 이름을 못 찾으면 uid를 이름 자리에 넣으므로 그 값은 버린다."""
    if uid is None or not speaker_names:
        return None
    name = (speaker_names.get(uid) or "").strip()
    return name if name and name != uid else None


def _insert_skipping_existing(db: Session, rows: list[dict]) -> int:
    """(meeting_id, seq)가 이미 있는 행은 건너뛰고 넣는다. 새로 넣은 행 수를 돌려준다.

    재전송은 지우고 다시 넣지 않는다. 발화를 지우면 그 발화를 가리키는 근거(evidence)도 CASCADE로 지워진다.
    넣은 행 수는 rowcount 대신 RETURNING으로 센다. PostgreSQL에서는 여러 행 INSERT의 rowcount가 -1로 온다.
    """
    insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    inserted = 0
    for start in range(0, len(rows), INSERT_BATCH_SIZE):
        stmt = (
            insert(Source)
            .values(rows[start:start + INSERT_BATCH_SIZE])
            .on_conflict_do_nothing(index_elements=["meeting_id", "seq"])
            .returning(Source.source_id)
        )
        inserted += len(db.execute(stmt).all())
    return inserted


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
    # 회의 행을 커밋까지 잠근다. 같은 회의로 동시에 온 요청은 차례로 처리되어 duration_ms를 서로
    # 덮어쓰지 않고, 상태를 확인한 뒤 PATCH /fail이 끼어들어 failed 회의에 발화가 저장되지도 않는다.
    meeting = db.execute(
        select(Meeting)
        .where(Meeting.meeting_id == meeting_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if meeting is None:
        raise AppError(ErrorCode.MEETING_NOT_FOUND, details={"meeting_id": meeting_id})
    if meeting.status == MeetingStatus.FAILED:
        # MEETING_ALREADY_ENDED가 아니다. 봇은 그 코드를 "이미 처리됨"으로 보고 넘어가는데,
        # 여기서는 발화가 저장되지 않았으니 새 회의로 다시 올려야 한다.
        raise AppError(
            ErrorCode.MEETING_FAILED,
            details={"meeting_id": meeting_id, "status": meeting.status},
        )

    member_ids = _member_ids_by_speaker(
        db, meeting.workspace_id, {seg.speaker for seg in payload.segments if seg.speaker}
    )
    # seq 순으로 넣는다. 겹치는 seq를 담은 요청들이 같은 행을 다른 순서로 잡아 서로 기다리지 않게 한다.
    rows = [
        {
            "meeting_id": meeting_id,
            "seq": seg.seq,
            "speaker_discord_user_id": seg.speaker,
            "speaker_name": _speaker_name(payload.speaker_names, seg.speaker),
            "member_id": member_ids.get(seg.speaker) if seg.speaker else None,
            "start_ms": _to_ms(seg.start),
            "end_ms": _to_ms(seg.end),
            "text": seg.text,
        }
        for seg in sorted(payload.segments, key=lambda s: s.seq)
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
