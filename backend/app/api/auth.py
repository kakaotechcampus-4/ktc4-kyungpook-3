import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Response, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Member, Session as SessionModel, User
from app.schemas.auth import AuthResponse, LoginRequest, SignupRequest, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])

def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def _create_session(db: Session, user: User, response: Response):
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=7)
    db_session = SessionModel(user_id=user.user_id, session_token=token, expires_at=expires)
    db.add(db_session)
    db.commit()
    response.set_cookie(
        key="session_token", 
        value=token, 
        httponly=True, 
        samesite="lax",
        secure=True
    )

def _build_auth_response(db: Session, user: User) -> AuthResponse:
    workspace_count = db.query(Member).filter(Member.user_id == user.user_id, Member.is_deleted == False).count()
    last_workspace = db.query(Member).filter(Member.user_id == user.user_id, Member.is_deleted == False).order_by(Member.created_at.desc()).first()
    
    return AuthResponse(
        user=UserResponse(
            user_id=user.user_id, 
            email=user.email, 
            name=user.name, 
            avatar_url=user.profile_image_url
        ),
        workspace_count=workspace_count,
        last_workspace_id=last_workspace.workspace_id if last_workspace else None
    )

@router.post("/signup", status_code=201, response_model=Envelope[AuthResponse])
def signup(payload: SignupRequest, response: Response, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise AppError(ErrorCode.INVALID_REQUEST, details={"msg": "Email already in use"})
    
    user = User(
        email=payload.email,
        password_hash=_hash_password(payload.password),
        name=payload.name,
        provider="local"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    _create_session(db, user, response)
    return success(_build_auth_response(db, user).model_dump(mode="json"))

@router.post("/login", response_model=Envelope[AuthResponse])
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or user.password_hash != _hash_password(payload.password):
        raise HTTPException(status_code=401, detail="UNAUTHENTICATED")
    
    _create_session(db, user, response)
    return success(_build_auth_response(db, user).model_dump(mode="json"))

@router.post("/logout", response_model=Envelope[dict])
def logout(response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(SessionModel).filter(SessionModel.user_id == user.user_id).delete()
    db.commit()
    response.delete_cookie("session_token")
    return success({})

@router.get("/me", response_model=Envelope[AuthResponse])
def get_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return success(_build_auth_response(db, user).model_dump(mode="json"))
