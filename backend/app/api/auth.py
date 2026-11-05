import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Invitation, InvitationStatus, Member, Session as SessionModel, User
from app.schemas.auth import (
    AuthResponse,
    LoginRequest,
    PasswordResetConfirmRequest,
    PasswordResetRequest,
    PasswordResetVerifyRequest,
    PasswordResetVerifyResponse,
    SignupRequest,
    UserResponse,
)
from app.services import mailer, password_reset
from app.services.passwords import hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

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
    # 초대로 들어온 팀원 행은 PM 이 예전에 만든 것이라 수락 시각을 들어온 시각으로 본다.
    joined_at = func.coalesce(Invitation.responded_at, Member.created_at)
    last_workspace = (
        db.query(Member)
        .outerjoin(
            Invitation,
            and_(
                Invitation.member_id == Member.member_id,
                Invitation.accepted_user_id == user.user_id,
                Invitation.status == str(InvitationStatus.ACCEPTED),
            ),
        )
        .filter(Member.user_id == user.user_id, Member.is_deleted.is_(False))
        .order_by(joined_at.desc())
        .first()
    )

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
        password_hash=hash_password(payload.password),
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
    if not user or not user.password_hash or not verify_password(payload.password, user.password_hash):
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


@router.post("/password-reset/request", response_model=Envelope[dict])
def request_password_reset(
    payload: PasswordResetRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)
):
    if not mailer.is_configured():
        raise AppError(ErrorCode.MAIL_UNAVAILABLE)
    mail = password_reset.request_reset(
        db, payload.email, now=datetime.now(timezone.utc), base_url=mailer.app_base_url()
    )
    db.commit()
    # 가입 여부와 쿨다운 여부가 응답으로 드러나지 않게 항상 같은 응답을 준다.
    if mail is not None:
        background_tasks.add_task(mailer.send_with_retry, mail.to, mail.subject, mail.text, log_label=mail.user_id)
    return success({})


@router.post("/password-reset/verify", response_model=Envelope[PasswordResetVerifyResponse])
def verify_password_reset(payload: PasswordResetVerifyRequest, db: Session = Depends(get_db)):
    expires_at, email_masked = password_reset.verify_token(db, payload.token, now=datetime.now(timezone.utc))
    return success(
        PasswordResetVerifyResponse(expires_at=expires_at, email_masked=email_masked).model_dump(mode="json")
    )


@router.post("/password-reset/confirm", response_model=Envelope[dict])
def confirm_password_reset(payload: PasswordResetConfirmRequest, db: Session = Depends(get_db)):
    password_reset.confirm_reset(db, payload.token, payload.new_password, now=datetime.now(timezone.utc))
    db.commit()
    return success({})
