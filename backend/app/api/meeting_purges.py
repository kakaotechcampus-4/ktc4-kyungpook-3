from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_service_token
from app.core.database import get_db
from app.core.errors import Envelope, success
from app.schemas.meeting_deletion import MeetingDeletionReceipt, PurgeAck, PurgeClaim
from app.services import meeting_deletion

router = APIRouter(
    prefix="/bot/meeting-purges",
    tags=["meeting-purges"],
    dependencies=[Depends(require_service_token)],
)


@router.post("/claim", response_model=Envelope[PurgeClaim | None])
def claim(db: Session = Depends(get_db)) -> dict:
    return success(meeting_deletion.claim_purge(db))


@router.post("/{meeting_id}/ack", response_model=Envelope[MeetingDeletionReceipt])
def ack(meeting_id: str, payload: PurgeAck, db: Session = Depends(get_db)) -> dict:
    return success(
        meeting_deletion.ack_purge(db, meeting_id, payload.claim_token).model_dump(
            mode="json"
        )
    )
