from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.api.deps import require_service_token
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.schemas.message import (
    BotReplyRequest,
    BotReplyResponse,
    ClaimResponse,
    DmResultRequest,
)
from app.services import messages as svc

router = APIRouter(prefix="/bot", tags=["bot-messages"], dependencies=[Depends(require_service_token)])


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.post("/messages/claim", response_model=Envelope[ClaimResponse])
def claim_messages(db: Session = Depends(get_db)) -> dict:
    """봇이 보낼 메시지를 가져간다. 발송 시각이 된 리마인드를 먼저 메시지로 묶는다. 한 메시지는 한 번만 준다."""
    claimed = svc.claim_for_bot(db, _now())
    db.commit()
    items = [
        {
            "message_id": c.message.message_id,
            "workspace_id": c.workspace_id,
            "member_id": c.member_id,
            "discord_user_id": c.discord_user_id,
            "body": c.message.body,
            "scheduled_at": c.message.scheduled_at and svc.utc(c.message.scheduled_at),
        }
        for c in claimed
    ]
    return success({"items": items, "total": len(items)})


@router.post("/messages/{message_id}/result", response_model=Envelope[None])
def report_result(message_id: str, payload: DmResultRequest, db: Session = Depends(get_db)) -> dict:
    delivered = payload.status == "delivered"
    if not delivered and payload.failure_reason is None:
        raise AppError(ErrorCode.INVALID_REQUEST, message="실패 보고에는 failure_reason 이 필요합니다.")
    svc.report_result(
        db, message_id, delivered=delivered, failure_reason=payload.failure_reason, now=_now()
    )
    db.commit()
    return success(None)


@router.post("/replies", status_code=201, response_model=Envelope[BotReplyResponse])
def ingest_reply(payload: BotReplyRequest, response: Response, db: Session = Depends(get_db)) -> dict:
    """봇 DM 창에 온 팀원의 글. 같은 디스코드 메시지 id 는 한 번만 저장하고 두 번째부터 200 으로 기존 메시지를 돌려준다."""
    message, created = svc.ingest_discord_reply(
        db, discord_user_id=payload.discord_user_id, discord_message_id=payload.discord_message_id,
        body=payload.body, sent_at=payload.sent_at, now=_now(),
    )
    db.commit()
    if not created:
        response.status_code = 200
    thread = message.thread
    return success({
        "message_id": message.message_id, "thread_id": thread.thread_id,
        "workspace_id": thread.workspace_id, "member_id": thread.member_id,
    })
