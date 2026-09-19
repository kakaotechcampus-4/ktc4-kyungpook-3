from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.errors import Envelope, success
from app.models import Integration
from app.api.deps import get_current_member

router = APIRouter(prefix="/workspaces", tags=["integrations"])

@router.get("/{workspace_id}/integrations", response_model=Envelope[dict])
def get_integrations(
    workspace_id: str,
    member = Depends(get_current_member),
    db: Session = Depends(get_db)
) -> dict:
    integrations = db.query(Integration).filter(Integration.workspace_id == workspace_id).all()
    
    resp = {
        "discord": {"status": "not_connected", "display_name": None, "connected_at": None},
        "notion": {"status": "not_connected", "display_name": None, "connected_at": None}
    }
    
    for i in integrations:
        if i.provider in resp:
            resp[i.provider] = {
                "status": "connected",
                "display_name": f"{i.provider.capitalize()} 연결됨",
                "connected_at": i.created_at.isoformat() if i.created_at else None
            }
            
    return success(resp)

@router.delete("/{workspace_id}/integrations/{provider}", status_code=204)
def delete_integration(
    workspace_id: str,
    provider: str,
    member = Depends(get_current_member),
    db: Session = Depends(get_db)
) -> None:
    integration = db.query(Integration).filter(
        Integration.workspace_id == workspace_id,
        Integration.provider == provider
    ).first()
    
    if integration:
        db.delete(integration)
        db.commit()
    return


@router.get("/{workspace_id}/discord/members", response_model=Envelope[dict])
def list_discord_members(
    workspace_id: str,
    member = Depends(get_current_member),
    db: Session = Depends(get_db)
) -> dict:
    # 향후 Discord API 연동 시 실제 멤버 목록 반환
    return success({
        "items": [
            {"discord_user_id": "disc_01", "username": "discordUser1", "display_name": "Discord User 1"},
            {"discord_user_id": "disc_02", "username": "discordUser2", "display_name": "Discord User 2"}
        ]
    })
