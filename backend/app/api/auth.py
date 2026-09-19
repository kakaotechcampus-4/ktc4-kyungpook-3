import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Member, Session as SessionModel, User
from app.schemas.auth import AuthResponse, LoginRequest, SignupRequest, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])

_PBKDF2_ITERATIONS = 260_000

def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ITERATIONS)
    return f"{salt}${digest.hex()}"

def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, digest_hex = stored_hash.split("$", 1)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ITERATIONS)
    return hmac.compare_digest(digest.hex(), digest_hex)

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
    workspace_count = db.query(Member).filter(Member.user_id == user.user_id, Member.is_deleted.is_(False)).count()
    last_workspace = db.query(Member).filter(Member.user_id == user.user_id, Member.is_deleted.is_(False)).order_by(Member.created_at.desc()).first()

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
        raise AppError(ErrorCode.EMAIL_ALREADY_EXISTS)

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
    if not user or not user.password_hash or not _verify_password(payload.password, user.password_hash):
        raise AppError(ErrorCode.INVALID_CREDENTIALS)

    _create_session(db, user, response)
    return success(_build_auth_response(db, user).model_dump(mode="json"))

@router.post("/logout", response_model=Envelope[dict])
def logout(request: Request, response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session_token = request.cookies.get("session_token")
    if session_token:
        db.query(SessionModel).filter(SessionModel.session_token == session_token).delete()
        db.commit()
    response.delete_cookie("session_token")
    return success({})

@router.get("/me", response_model=Envelope[AuthResponse])
def get_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return success(_build_auth_response(db, user).model_dump(mode="json"))
