import os
import secrets
from datetime import datetime, timezone
from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.errors import AppError, ErrorCode
from app.models import Task, User, Member, MemberRole
from app.services.sessions import find_session
from app.services import lifecycle

def authenticate(db: Session, session_token: str | None) -> tuple[User, datetime] | None:
    """쿠키 토큰이 살아 있는 세션이면 사용자와 만료 시각(UTC)을 돌려준다. HTTP 의존성과 소켓이 같이 쓴다."""
    if not session_token:
        return None

    session_record = find_session(db, session_token)
    if not session_record:
        return None

    expires_at = session_record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        return None

    user = session_record.user
    if not user:
        return None
    try:
        return lifecycle.user(db, user.user_id), expires_at
    except AppError:
        return None


def get_current_user(
    request: Request,
    db: Session = Depends(get_db)
) -> User:
    db.info["service_write"] = False
    db.info["read_only_request"] = request.method in ("GET", "HEAD") and not request.url.path.endswith("/callback")
    session = authenticate(db, request.cookies.get("session_token"))
    if session is None:
        raise AppError(ErrorCode.UNAUTHENTICATED)
    return session[0]

def require_member(db: Session, user: User, workspace_id: str) -> Member:
    """workspace_id가 경로·쿼리에 없고 리소스나 요청 바디에서 나오는 경로용 멤버십 확인."""
    lifecycle.user(db, user.user_id)
    lifecycle.workspace(db, workspace_id)
    member = db.query(Member).populate_existing().filter(
        Member.workspace_id == workspace_id,
        Member.user_id == user.user_id,
        Member.is_deleted.is_(False)
    ).first()
    if not member:
        raise AppError(ErrorCode.FORBIDDEN, details={"workspace_id": workspace_id})
    return member


def get_current_member(
    workspace_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Member:
    return require_member(db, user, workspace_id)


def require_pm(db: Session, user: User, workspace_id: str) -> Member:
    """require_member에 더해 PM인지 확인한다. 할일·팀원·연동을 바꾸는 쓰기 경로용.

    비소속은 require_member가 403으로 막는다. 소속이지만 PM이 아니어도 403이다.
    """
    member = require_member(db, user, workspace_id)
    if member.role != MemberRole.PM:
        raise AppError(
            ErrorCode.FORBIDDEN,
            message="PM만 할 수 있는 작업입니다.",
            details={"workspace_id": workspace_id},
        )
    return member


def get_current_pm(
    workspace_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Member:
    return require_pm(db, user, workspace_id)


def require_task_member(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> None:
    """라우터 단위로 걸어 이후 추가되는 /tasks/{task_id}/... 경로도 보호한다. Task가 없으면 404는 엔드포인트가 낸다."""
    task_id = request.path_params.get("task_id")
    if task_id is None:
        return
    task = db.get(Task, task_id)
    if task is not None:
        require_member(db, user, task.workspace_id)


def require_service_token(request: Request, x_service_token: str | None = Header(None), db: Session = Depends(get_db)) -> None:
    """디스코드 봇처럼 사용자 세션 없이 부르는 경로용. X-Service-Token을 SERVICE_TOKEN과 비교한다.

    SERVICE_TOKEN이 설정되지 않은 서버는 모든 요청을 거절한다. 바이트로 바꿔 비교한다. 문자열 그대로 넘기면
    secrets.compare_digest가 ASCII가 아닌 헤더 값에 TypeError를 던져 401 대신 500이 난다.
    """
    expected = os.getenv("SERVICE_TOKEN")
    if not expected or not x_service_token or not secrets.compare_digest(
        x_service_token.encode(), expected.encode()
    ):
        raise AppError(ErrorCode.UNAUTHENTICATED, message="서비스 토큰이 없거나 올바르지 않습니다.")
    db.info["service_write"] = request.method not in ("GET", "HEAD")
    db.info["read_only_request"] = request.method in ("GET", "HEAD")
    db.info["privacy_epoch"] = request.headers.get("X-Privacy-Epoch")
