"""회의 발화 저장. AI가 STT 전사(Transcript)를 끝내면 부른다.

디스코드 봇이 사용자 세션 없이 부르는 경로라 세션 대신 서비스 토큰(X-Service-Token)으로 막는다.
"""
from datetime import datetime, timezone
import logging

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.api.deps import require_service_token
from app.core.database import get_db
from app.services.meeting_deletion import require_live_meeting
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import MeetingAudio, MeetingSource, MeetingStatus, Source
from app.schemas.meeting import RecordingUploadResponse
from app.schemas.source import TranscriptCreateRequest, TranscriptCreateResponse
from app.services import meeting_audio, upload_storage
from app.services.matching import active_members_by_id, resolve_speaker

logger = logging.getLogger(__name__)

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
    meeting = require_live_meeting(db, meeting_id, lock=True)
    if payload.source == "chat" and meeting.source != MeetingSource.CHAT:
        # 24시간 상한은 초·ms 를 잘못 보낸 버그를 막는 장치다. 요청 필드 하나로 우회하지 못하게 한다
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="source 'chat' 은 채팅 회의에만 보낼 수 있습니다.",
            details={"meeting_id": meeting_id, "meeting_source": meeting.source},
        )
    if meeting.status == MeetingStatus.FAILED:
        # MEETING_ALREADY_ENDED가 아니다. 봇은 그 코드를 "이미 처리됨"으로 보고 넘어가는데,
        # 여기서는 발화가 저장되지 않았으니 새 회의로 다시 올려야 한다.
        raise AppError(
            ErrorCode.MEETING_FAILED,
            details={"meeting_id": meeting_id, "status": meeting.status},
        )

    # 요청에 처음 나온 순서로, 중복 없이. 틀린 ID 가 하나라도 있으면 아무것도 저장하지 않는다.
    requested_member_ids = list(
        dict.fromkeys(seg.speaker_member_id for seg in payload.segments if seg.speaker_member_id)
    )
    active = active_members_by_id(db, meeting.workspace_id, requested_member_ids)
    unknown_ids = [mid for mid in requested_member_ids if mid not in active]
    if unknown_ids:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="이 워크스페이스 팀원이 아닌 speaker_member_id 가 있습니다.",
            details={"member_ids": unknown_ids},
        )
    member_ids = _member_ids_by_speaker(
        db,
        meeting.workspace_id,
        {seg.speaker for seg in payload.segments if seg.speaker and not seg.speaker_member_id},
    )
    # seq 순으로 넣는다. 겹치는 seq를 담은 요청들이 같은 행을 다른 순서로 잡아 서로 기다리지 않게 한다.
    rows = [
        {
            "meeting_id": meeting_id,
            "seq": seg.seq,
            "speaker_discord_user_id": seg.speaker,
            "speaker_name": _speaker_name(payload.speaker_names, seg.speaker),
            "member_id": seg.speaker_member_id or (member_ids.get(seg.speaker) if seg.speaker else None),
            "start_ms": _to_ms(seg.start),
            "end_ms": _to_ms(seg.end),
            "text": seg.text,
        }
        for seg in sorted(payload.segments, key=lambda s: s.seq)
    ]
    from app.services import lifecycle
    if lifecycle.workspace(db, meeting.workspace_id).identity_epoch:
        for row in rows:
            if row["member_id"] is None:
                row["speaker_discord_user_id"] = None
                row["speaker_name"] = None
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


# AI 가 올리는 섞은 녹음의 저장 이름·형식. 재생 쪽이 이 값으로 파일을 찾고 Content-Type 을 정한다.
RECORDING_FILENAME = "audio.m4a"
RECORDING_CONTENT_TYPE = "audio/mp4"


def _recording_response(row: MeetingAudio, *, stored: bool) -> dict:
    return success(
        RecordingUploadResponse(
            meeting_id=row.meeting_id,
            size_bytes=row.size_bytes,
            expires_at=meeting_audio.expires_at(row),
            stored=stored,
        ).model_dump(mode="json")
    )


@router.put(
    "/{meeting_id}/recording",
    response_model=Envelope[RecordingUploadResponse],
)
def upload_recording(
    meeting_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    """AI 가 끝난 디스코드 회의의 섞은 녹음(m4a)을 올린다. 팀원이 보관 기간 동안 원문을 듣게 된다.

    같은 회의에 다시 올리면 파일만 바꾸고 보관 기준 시각(`retention_from`)은 처음 값을 유지한다.
    이미 정리된(`deleted_at`) 녹음에는 저장하지 않고 `stored=false` 로 성공한다. AI 가 다시 보내도 깨지지 않게 한다.
    """
    meeting = require_live_meeting(db, meeting_id, lock=True)
    if meeting.source != MeetingSource.DISCORD:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="디스코드 회의에만 녹음을 올릴 수 있습니다.",
            details={"meeting_id": meeting_id, "source": meeting.source},
        )
    if meeting.status != MeetingStatus.DONE:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="처리가 끝난 회의에만 녹음을 올릴 수 있습니다.",
            details={"meeting_id": meeting_id, "status": meeting.status},
        )
    if not upload_storage.is_supported_audio(RECORDING_FILENAME, file.file):
        raise AppError(
            ErrorCode.AUDIO_FORMAT_UNSUPPORTED,
            details={"filename": file.filename, "supported": ["m4a"]},
        )
    size_bytes = upload_storage.file_size(file.file)
    max_bytes = upload_storage.max_bytes()
    if size_bytes > max_bytes:
        raise AppError(
            ErrorCode.AUDIO_TOO_LARGE,
            details={"size_bytes": size_bytes, "max_bytes": max_bytes},
        )
    now = datetime.now(timezone.utc)
    # 보관 기간은 회의가 끝난 시각부터 센다. AI 가 늦게 올려도 팀원이 듣는 기간이 길어지지 않는다
    retention_from = meeting.ended_at or now
    existing = db.get(MeetingAudio, meeting_id)
    if existing is not None and existing.deleted_at is not None:
        return _recording_response(existing, stored=False)
    if existing is None and meeting_audio.deadline(retention_from) <= now:
        # 보관 기간이 이미 지났다. 저장해도 바로 정리될 녹음이라 받지 않는다
        return success(
            RecordingUploadResponse(
                meeting_id=meeting_id,
                size_bytes=size_bytes,
                expires_at=meeting_audio.deadline(retention_from),
                stored=False,
            ).model_dump(mode="json")
        )

    # 녹음을 복사하는 동안 DB 연결을 붙잡지 않도록 읽기 트랜잭션과 회의 잠금을 끝낸다.
    # 그 사이 바뀐 것은 아래 커밋 직전 잠금과 재확인이 잡는다
    db.rollback()
    try:
        saved_size = upload_storage.save_audio(
            meeting_id, file.file, RECORDING_FILENAME, overwrite=True
        )
    except OSError:
        logger.exception("디스코드 회의 녹음을 저장하지 못했습니다: meeting_id=%s", meeting_id)
        raise AppError(ErrorCode.AUDIO_UPLOAD_FAILED)

    try:
        require_live_meeting(db, meeting_id, lock=True)
    except AppError:
        # 복사하는 사이 회의가 지워졌다. 삭제 경로는 이미 지나갔으니 방금 저장한 파일은 여기서 치운다
        upload_storage.remove_audio(meeting_id)
        raise
    try:
        row = meeting_audio.record(
            db, meeting_id, RECORDING_FILENAME, RECORDING_CONTENT_TYPE,
            saved_size, retention_from,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _recording_response(row, stored=True)
