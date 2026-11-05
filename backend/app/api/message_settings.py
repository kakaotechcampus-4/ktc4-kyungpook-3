"""워크스페이스 메시지·알림 설정 조회(팀원)와 변경(PM)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_member, get_current_pm
from app.core.database import get_db
from app.core.errors import Envelope, success
from app.models import Member
from app.schemas.message_settings import MessageSettingsPatch, MessageSettingsResponse
from app.services import message_settings as svc

router = APIRouter(prefix="/workspaces/{workspace_id}/message-settings", tags=["message-settings"])


def _data(db: Session, workspace_id: str, s: svc.MessageSettings) -> dict:
    return MessageSettingsResponse(
        due_reminder=s.due_reminder, minutes_summary=s.minutes_summary, silence_alert=s.silence_alert,
        nudge_rule={"days_before": s.nudge_days_before, "hour": s.nudge_hour},
        pm_alert_method=s.pm_alert_method, reminder_auto_approve=s.reminder_auto_approve,
        saved=s.saved, updated_at=s.updated_at, updated_by=s.updated_by,
        pms=svc.pm_contacts(db, workspace_id),
    ).model_dump(mode="json")


@router.get("", response_model=Envelope[MessageSettingsResponse])
def get_message_settings(
    workspace_id: str, _member: Member = Depends(get_current_member), db: Session = Depends(get_db)
) -> dict:
    return success(_data(db, workspace_id, svc.get_settings(db, workspace_id)))


@router.patch("", response_model=Envelope[MessageSettingsResponse])
def update_message_settings(
    workspace_id: str,
    payload: MessageSettingsPatch,
    pm: Member = Depends(get_current_pm),
    db: Session = Depends(get_db),
) -> dict:
    settings = svc.update_settings(
        db, workspace_id, payload.changes(), updated_by=pm.member_id, now=datetime.now(timezone.utc)
    )
    db.commit()
    return success(_data(db, workspace_id, settings))
