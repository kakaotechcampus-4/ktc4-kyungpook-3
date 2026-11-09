import hmac
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Invitation, InvitationStatus, Member, User
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
    UsernameAvailabilityResponse,
)
from app.schemas.username import validate_username
from app.services import kakao_oauth, login_limit, mailer, oauth_state, password_reset, password_reset_limit, sessions, signup_codes
from app.services.kakao_oauth import KakaoOAuthError
from app.services.passwords import DUMMY_PASSWORD_HASH, hash_password, verify_password
from app.services import lifecycle

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

def _create_session(db: Session, user: User, response: Response):
    token = sessions.create_session(db, user.user_id)
    db.commit()
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=True
    )

def user_response(user: User) -> UserResponse:
    return UserResponse(
        user_id=user.user_id,
        username=user.username,
        email=user.email,
        name=user.name,
        avatar_url=user.profile_image_url
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
        user=user_response(user),
        workspace_count=workspace_count,
        last_workspace_id=last_workspace.workspace_id if last_workspace else None
    )

@router.get("/username-availability", response_model=Envelope[UsernameAvailabilityResponse])
def username_availability(username: str = Query(...), db: Session = Depends(get_db)):
    # 규칙 밖의 값도 400 이 아니라 결과로 알려 준다. 가입 화면이 입력하는 동안 묻는다.
    try:
        username = validate_username(username)
    except ValueError:
        return success(UsernameAvailabilityResponse(available=False, reason="invalid").model_dump(mode="json"))
    taken = db.scalar(select(User.user_id).where(User.username == username)) is not None
    result = UsernameAvailabilityResponse(available=not taken, reason="taken" if taken else None)
    return success(result.model_dump(mode="json"))


@router.post("/signup/code", response_model=Envelope[SignupCodeResponse])
def request_signup_code(payload: SignupCodeRequest, db: Session = Depends(get_db)):
    if not mailer.is_configured():
        raise AppError(ErrorCode.MAIL_UNAVAILABLE)
    mail = signup_codes.request_code(db, payload.email, now=datetime.now(timezone.utc))
    db.commit()
    mailer.send_in_background(mail.to, mail.subject, mail.text, log_label="signup_code", html=mail.html)
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


def _clear_pending(response: Response) -> None:
    response.delete_cookie(
        kakao_oauth.PENDING_COOKIE, path=kakao_oauth.PENDING_PATH, httponly=True, secure=True, samesite="lax"
    )


def _signup_conflict(db: Session, user: User) -> ErrorCode | None:
    if user.email is not None and db.scalars(_login_user_stmt(user.email)).first() is not None:
        return ErrorCode.EMAIL_ALREADY_EXISTS
    if user.provider_id is not None and db.scalars(_kakao_user_stmt(user.provider_id)).first() is not None:
        return ErrorCode.KAKAO_ALREADY_LINKED
    if db.scalar(select(User.user_id).where(User.username == user.username)) is not None:
        return ErrorCode.USERNAME_TAKEN
    return None


def _new_user(payload: SignupRequest, request: Request) -> User:
    """요청이 증명한 신원으로 만들 계정. 카카오 가입은 카카오가 이메일을 줘도 저장하지 않는다(#610)."""
    if payload.link_kakao:
        kakao = kakao_oauth.read_pending(request.cookies.get(kakao_oauth.PENDING_COOKIE, ""))
        if kakao is None:
            raise AppError(ErrorCode.KAKAO_LINK_EXPIRED)
        return User(
            email=None, username=payload.username, password_hash=None, name=payload.name,
            provider=kakao_oauth.PROVIDER, provider_id=kakao.provider_id,
        )
    email = signup_codes.read_proof(payload.verification_token or "")
    if email is None:
        raise AppError(ErrorCode.SIGNUP_VERIFICATION_INVALID)
    return User(
        email=email, username=payload.username, password_hash=hash_password(payload.password), name=payload.name,
        provider="local",
    )


@router.post("/signup", status_code=201, response_model=Envelope[AuthResponse])
def signup(payload: SignupRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    user = _new_user(payload, request)
    lifecycle.identity_lock(db, lifecycle.user_identity(user))
    conflict = _signup_conflict(db, user)
    if conflict is not None:
        raise AppError(conflict)

    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        # PostgreSQL 은 실패한 트랜잭션에서 다시 읽지 못하므로 되돌린 뒤 어느 쪽과 겹쳤는지 찾는다.
        # 되돌리면 user 는 세션에서 빠지지만 넣으려던 값은 그대로 남는다.
        # 다시 찾아도 없으면 이긴 쪽이 그 사이 아이디를 바꾼 것이다. 아이디는 identity_lock 밖이라 이 경합만 여기까지 온다.
        db.rollback()
        username_lost = "username" in str(exc.orig)
        fallback = ErrorCode.USERNAME_TAKEN if username_lost else ErrorCode.EMAIL_ALREADY_EXISTS
        raise AppError(_signup_conflict(db, user) or fallback) from None
    db.refresh(user)

    _create_session(db, user, response)
    _clear_pending(response)
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
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    # 시도를 사용자 조회보다 먼저 센다. 해시 뒤에 세면 0.2초 사이의 동시 요청이 모두 검사를 통과하고,
    # 조회 뒤에 하면 막힌 요청도 DB 연결을 잡는다. 클라이언트 주소는 uvicorn 이 해석한 request.client 만 읽는다.
    ip_key = login_limit.client_ip_key(request.client.host if request.client else None)
    try:
        reservation = login_limit.reserve(payload.email, ip_key, now=login_limit.clock())
    except login_limit.LoginBlocked as blocked:
        seconds = blocked.retry_after_seconds
        raise AppError(
            ErrorCode.TOO_MANY_LOGIN_ATTEMPTS,
            details={"retry_after_seconds": seconds},
            headers={"Retry-After": str(seconds)},
        ) from None
    try:
        user = db.scalars(_login_user_stmt(payload.email)).first()
        # 없는 이메일·비밀번호 없는 계정도 같은 해시 계산을 거치게 해 응답 시간으로 가입 여부가 드러나지 않게 한다.
        stored = user.password_hash if user and user.password_hash else DUMMY_PASSWORD_HASH
        ok = verify_password(payload.password, stored)
        if not user or not user.password_hash or not ok:
            raise AppError(ErrorCode.INVALID_CREDENTIALS)
        if db.scalar(_password_hash_lock_stmt(user.user_id)) != user.password_hash:
            raise AppError(ErrorCode.INVALID_CREDENTIALS)

        _create_session(db, user, response)
    except AppError as exc:
        # 틀린 자격 증명만 시도로 센다. 그 밖의 오류는 사용자 잘못이 아니므로 예약을 되돌린다.
        if exc.code != ErrorCode.INVALID_CREDENTIALS:
            login_limit.cancel(reservation)
        raise
    except Exception:
        login_limit.cancel(reservation)
        raise
    # 세션이 commit 된 순간 인증은 끝났다. 응답 조립이 DB 오류로 실패해도 맞는 비밀번호의 이전 실패 횟수는 지운다.
    login_limit.succeed(reservation)
    return success(_build_auth_response(db, user).model_dump(mode="json"))

@router.post("/logout", response_model=Envelope[dict])
def logout(request: Request, response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session_token = request.cookies.get("session_token")
    if session_token:
        sessions.delete_session(db, session_token)
        db.commit()
    response.delete_cookie("session_token")
    return success({})

@router.get("/me", response_model=Envelope[AuthResponse])
def get_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return success(_build_auth_response(db, user).model_dump(mode="json"))


# ---------- 카카오 로그인 (start → 카카오 동의 화면 → callback) ----------
#
# 페이지 이동으로 들어오므로 start·callback 은 항상 302 다. 계정을 만드는 곳은 signup 하나뿐이다.


def _kakao_redirect(return_path: str, result: str) -> RedirectResponse:
    return RedirectResponse(kakao_oauth.frontend_return_url(return_path, result), status_code=302)


def _kakao_session_user_stmt(provider_id: str):
    # 로그인과 같은 이유로 공유 잠금으로 읽는다(`_login_user_stmt`).
    return _kakao_user_stmt(provider_id).with_for_update(read=True)


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

    # 카카오 신원으로 이어진 계정만 로그인한다. 같은 이메일의 기존 계정이 있어도 병합하지 않고 가입으로 보낸다(#610).
    user = db.scalars(_kakao_session_user_stmt(identity.provider_id)).first()
    if user is None:
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
    response = _kakao_redirect(return_path, "success")
    # 앞서 다른 카카오로 가입하다 멈춘 대기 쿠키가 남아 있으면 이 브라우저의 다음 가입에 이어지지 않게 지운다.
    _clear_pending(response)
    # 주입받은 Response 의 쿠키는 RedirectResponse 를 돌려주면 사라지므로 redirect 에 직접 싣는다.
    _create_session(db, user, response)
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
def request_password_reset(request: Request, payload: PasswordResetRequest, db: Session = Depends(get_db)):
    if not mailer.is_configured():
        raise AppError(ErrorCode.MAIL_UNAVAILABLE)
    # 첫 DB 쿼리 전에 막는다. 가입 여부가 드러나지 않게 막혀도 같은 응답을 준다.
    ip_key = login_limit.client_ip_key(request.client.host if request.client else None)
    if not password_reset_limit.allow(ip_key, login_limit.clock()):
        logger.warning("password reset request blocked: reason=ip key=%s", ip_key)
        return success({})
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
    email = password_reset.confirm_reset(db, payload.token, payload.new_password, now=datetime.now(timezone.utc))
    db.commit()
    # commit 이 성공한 뒤에만 막힘을 푼다. 새 비밀번호로 바로 로그인할 수 있어야 한다.
    login_limit.clear_email(email)
    return success({})
