from datetime import datetime, timezone
from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models import Session as SessionModel, User, Member

def get_current_user(
    request: Request,
    db: Session = Depends(get_db)
) -> User:
    session_token = request.cookies.get("session_token")
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="UNAUTHENTICATED")
    
    session_record = db.query(SessionModel).filter(SessionModel.session_token == session_token).first()
    if not session_record or session_record.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="UNAUTHENTICATED")
        
    user = session_record.user
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="UNAUTHENTICATED")
    return user

def get_current_member(
    workspace_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Member:
    member = db.query(Member).filter(
        Member.workspace_id == workspace_id,
        Member.user_id == user.user_id,
        Member.is_deleted == False
    ).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="FORBIDDEN")
    return member
