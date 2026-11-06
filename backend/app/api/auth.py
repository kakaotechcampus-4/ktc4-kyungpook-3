import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import and_, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Invitation, InvitationStatus, Member, Session as SessionModel, User
from app.schemas.auth import (
    AuthResponse,
    KakaoPendingResponse,
    LoginRequest,
    PasswordResetConfirmRequest,
    PasswordResetRequest,
    PasswordResetVerifyRequest,
    PasswordResetVerifyResponse,
    SignupCodeConfirmRequest,
    SignupCodeConfirmResponse,
    SignupCodeRequest,
    SignupCodeResponse,
    SignupRequest,
    UserResponse,
)
from app.services import kakao_oauth, mailer, oauth_state, password_reset, signup_codes
from app.services.kakao_oauth import KakaoIdentity, KakaoOAuthError
from app.services.passwords import hash_password, verify_password

logger = logging.getLogger(__name__)

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

@router.post("/signup/code", response_model=Envelope[SignupCodeResponse])
def request_signup_code(payload: SignupCodeRequest, db: Session = Depends(get_db)):
    if not mailer.is_configured():
        raise AppError(ErrorCode.MAIL_UNAVAILABLE)
    mail = signup_codes.request_code(db, payload.email, now=datetime.now(timezone.utc))
    db.commit()
    mailer.send_in_background(mail.to, mail.subject, mail.text, log_label="signup_code")
    return success(
        SignupCodeResponse(
            expires_in=int(signup_codes.CODE_TTL.total_seconds()),
            resend_after=int(signup_codes.COOLDOWN.total_seconds()),
        ).model_dump(mode="json")
    )


@router.post("/signup/code/confirm", response_model=Envelope[SignupCodeConfirmResponse])
def confirm_signup_code(payload: SignupCodeConfirmRequest, db: Session = Depends(get_db)):
    token = signup_codes.confirm_code(db, payload.email, payload.code, now=datetime.now(timezone.utc))
    return success(
        SignupCodeConfirmResponse(
            verification_token=token, expires_in=signup_codes.PROOF_TTL_SECONDS
        ).model_dump(mode="json")
    )


def _kakao_user_stmt(provider_id: str):
    return select(User).where(User.provider == kakao_oauth.PROVIDER, User.provider_id == provider_id)


def _signup_conflict(db: Session, email: str, kakao: KakaoIdentity | None) -> ErrorCode | None:
    if db.scalars(by_email_stmt(email)).first() is not None:
        return ErrorCode.EMAIL_ALREADY_EXISTS
    if kakao is not None and db.scalars(_kakao_user_stmt(kakao.provider_id)).first() is not None:
        return ErrorCode.KAKAO_ALREADY_LINKED
    return None


@router.post("/signup", status_code=201, response_model=Envelope[AuthResponse])
def signup(payload: SignupRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    kakao = None
    if payload.link_kakao:
        kakao = kakao_oauth.read_pending(request.cookies.get(kakao_oauth.PENDING_COOKIE, ""))
        if kakao is None:
            raise AppError(ErrorCode.KAKAO_LINK_EXPIRED)
    email = (kakao.email if kakao else None) or signup_codes.read_proof(payload.verification_token or "")
    if email is None:
        raise AppError(ErrorCode.SIGNUP_VERIFICATION_INVALID)

    conflict = _signup_conflict(db, email, kakao)
    if conflict is not None:
        raise AppError(conflict)

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        name=payload.name,
        provider=kakao_oauth.PROVIDER if kakao else "local",
        provider_id=kakao.provider_id if kakao else None,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # PostgreSQL 은 실패한 트랜잭션에서 다시 읽지 못하므로 되돌린 뒤 어느 쪽과 겹쳤는지 찾는다.
        db.rollback()
        raise AppError(_signup_conflict(db, email, kakao) or ErrorCode.EMAIL_ALREADY_EXISTS) from None
    db.refresh(user)

    _create_session(db, user, response)
    response.delete_cookie(
        kakao_oauth.PENDING_COOKIE, path=kakao_oauth.PENDING_PATH, httponly=True, secure=True, samesite="lax"
    )
    return success(_build_auth_response(db, user).model_dump(mode="json"))

def _login_user_stmt(email: str):
    # 비밀번호 검사(PBKDF2, 약 0.2초)는 잠금 없이 한다. 검사 내내 공유 잠금을 잡으면 로그인이 계속 겹칠 때
    # 재설정 confirm 의 FOR UPDATE 가 끝없이 밀린다(PostgreSQL 은 대기 중인 배타 잠금이 있어도 새 공유 잠금을 준다).
    return select(User).where(User.email == email)


def _password_hash_lock_stmt(user_id: str):
    # 세션을 넣기 직전에만 사용자 행을 공유 잠금으로 다시 읽는다. confirm 은 이 행을 잠근 채 비밀번호를 바꾸고
    # 옛 세션을 지우므로, 그 사이에 비밀번호가 바뀌었으면 해시가 달라 옛 비밀번호 세션을 7일 동안 남기지 않는다.
    return select(User.password_hash).where(User.user_id == user_id).with_for_update(read=True)


@router.post("/login", response_model=Envelope[AuthResponse])
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.scalars(_login_user_stmt(payload.email)).first()
    if not user or not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise AppError(ErrorCode.INVALID_CREDENTIALS)
    if db.scalar(_password_hash_lock_stmt(user.user_id)) != user.password_hash:
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


# ---------- 카카오 로그인 (start → 카카오 동의 화면 → callback) ----------
#
# 페이지 이동으로 들어오므로 start·callback 은 항상 302 다. 계정을 만드는 곳은 signup 하나뿐이다.


def _kakao_redirect(return_path: str, result: str, reason: str | None = None) -> RedirectResponse:
    return RedirectResponse(kakao_oauth.frontend_return_url(return_path, result, reason), status_code=302)


def _kakao_session_user_stmt(provider_id: str):
    # 로그인과 같은 이유로 공유 잠금으로 읽는다(`_login_user_stmt`).
    return _kakao_user_stmt(provider_id).with_for_update(read=True)


def _link_kakao(db: Session, owner: User, provider_id: str) -> User | Literal["email_exists"]:
    """비어 있는 계정에만 카카오를 잇는다. 겹친 요청이 먼저 이었으면 그 결과를 따른다. commit 은 호출자가 한다."""
    try:
        linked = db.execute(
            update(User)
            .where(User.user_id == owner.user_id, User.provider_id.is_(None))
            .values(provider=kakao_oauth.PROVIDER, provider_id=provider_id)
            .execution_options(synchronize_session=False)
        ).rowcount
    except IntegrityError:
        linked = 0
    if linked == 1:
        return owner
    db.rollback()
    return db.scalars(_kakao_session_user_stmt(provider_id)).first() or "email_exists"


def _kakao_outcome(db: Session, identity: KakaoIdentity) -> User | Literal["email_exists", "needs_signup"]:
    """검증을 마친 카카오 신원의 결과. 위에서 아래로 먼저 맞는 것을 따른다."""
    known = db.scalars(_kakao_session_user_stmt(identity.provider_id)).first()
    if known is not None:
        return known
    owner = db.scalars(by_email_stmt(identity.email)).first() if identity.email else None
    if owner is None:
        return "needs_signup"
    if not identity.email_verified:
        return "email_exists"
    return _link_kakao(db, owner, identity.provider_id)


def _finish_kakao_login(request: Request, code: str, state: str, error: str, db: Session) -> RedirectResponse:
    login = kakao_oauth.verify_state(state)
    return_path = login.return_path if login else "/"
    if error:
        # 카카오 문서의 취소 예시에 state 가 없어서 state 검사보다 먼저 본다.
        logger.info("카카오 로그인 callback 취소 또는 오류")
        return _kakao_redirect(return_path, "cancelled" if error == "access_denied" else "failed")
    cookie_nonce = request.cookies.get(kakao_oauth.NONCE_COOKIE, "")
    if login is None or not hmac.compare_digest(cookie_nonce.encode(), login.nonce.encode()):
        logger.warning("카카오 로그인 callback 실패 reason=state")
        return _kakao_redirect(return_path, "failed")
    try:
        identity = kakao_oauth.fetch_identity(code)
    except KakaoOAuthError as exc:
        logger.warning("카카오 로그인 callback 실패 reason=%s", exc)
        return _kakao_redirect(return_path, "failed")

    outcome = _kakao_outcome(db, identity)
    if outcome == "needs_signup":
        response = RedirectResponse(kakao_oauth.signup_url(return_path), status_code=302)
        response.set_cookie(
            kakao_oauth.PENDING_COOKIE,
            kakao_oauth.seal_pending(identity),
            max_age=kakao_oauth.PENDING_TTL_SECONDS,
            path=kakao_oauth.PENDING_PATH,
            httponly=True,
            secure=True,
            samesite="lax",
        )
        return response
    if outcome == "email_exists":
        return _kakao_redirect(return_path, "failed", "email_exists")
    response = _kakao_redirect(return_path, "success")
    # 주입받은 Response 의 쿠키는 RedirectResponse 를 돌려주면 사라지므로 redirect 에 직접 싣는다.
    _create_session(db, outcome, response)
    return response


@router.get("/kakao/start")
def kakao_start(next_path: str = Query("", alias="next")) -> RedirectResponse:
    return_path = oauth_state.safe_return_path(next_path)
    try:
        state, nonce = kakao_oauth.sign_state(return_path)
        location = kakao_oauth.authorize_url(state)
    except oauth_state.OAuthConfigError as exc:
        logger.error("카카오 로그인 시작 실패 reason=config: %s", exc)
        return _kakao_redirect(return_path, "failed")
    response = RedirectResponse(location, status_code=302)
    response.set_cookie(
        kakao_oauth.NONCE_COOKIE,
        nonce,
        max_age=oauth_state.STATE_TTL_SECONDS,
        path=kakao_oauth.CALLBACK_PATH,
        httponly=True,
        secure=True,
        samesite="lax",
    )
    return response


@router.get("/kakao/callback")
def kakao_callback(
    request: Request, code: str = "", state: str = "", error: str = "", db: Session = Depends(get_db)
) -> RedirectResponse:
    try:
        response = _finish_kakao_login(request, code, state, error, db)
    except oauth_state.OAuthConfigError as exc:
        logger.error("카카오 로그인 callback 실패 reason=config: %s", exc)
        response = _kakao_redirect("/", "failed")
    # 같은 state 로 다시 들어와도 통과하지 못하게 결과와 상관없이 지운다.
    response.delete_cookie(
        kakao_oauth.NONCE_COOKIE, path=kakao_oauth.CALLBACK_PATH, httponly=True, secure=True, samesite="lax"
    )
    return response


@router.get("/kakao/pending", response_model=Envelope[KakaoPendingResponse])
def kakao_pending(request: Request):
    kakao = kakao_oauth.read_pending(request.cookies.get(kakao_oauth.PENDING_COOKIE, ""))
    if kakao is None:
        raise AppError(ErrorCode.KAKAO_LINK_EXPIRED)
    return success(KakaoPendingResponse(email=kakao.email, nickname=kakao.nickname).model_dump(mode="json"))


@router.post("/password-reset/request", response_model=Envelope[dict])
def request_password_reset(payload: PasswordResetRequest, db: Session = Depends(get_db)):
    if not mailer.is_configured():
        raise AppError(ErrorCode.MAIL_UNAVAILABLE)
    mail = password_reset.request_reset(
        db, payload.email, now=datetime.now(timezone.utc), base_url=mailer.app_base_url()
    )
    db.commit()
    # 가입 여부와 쿨다운 여부가 응답으로 드러나지 않게 항상 같은 응답을 준다.
    if mail is not None:
        mailer.send_in_background(mail.to, mail.subject, mail.text, log_label=mail.user_id)
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
