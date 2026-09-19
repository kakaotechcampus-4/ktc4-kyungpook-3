from datetime import datetime, timezone
from fastapi import Depends, Request
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.errors import AppError, ErrorCode
from app.models import Session as SessionModel, User, Member

def get_current_user(
    request: Request,
    db: Session = Depends(get_db)
) -> User:
    session_token = request.cookies.get("session_token")
    if not session_token:
        raise AppError(ErrorCode.UNAUTHENTICATED)

    session_record = db.query(SessionModel).filter(SessionModel.session_token == session_token).first()
    if not session_record:
        raise AppError(ErrorCode.UNAUTHENTICATED)

    expires_at = session_record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise AppError(ErrorCode.UNAUTHENTICATED)

    user = session_record.user
    if not user:
        raise AppError(ErrorCode.UNAUTHENTICATED)
    return user

def get_current_member(
    workspace_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Member:
    member = db.query(Member).filter(
        Member.workspace_id == workspace_id,
        Member.user_id == user.user_id,
        Member.is_deleted.is_(False)
    ).first()
    if not member:
        raise AppError(ErrorCode.FORBIDDEN)
    return member
