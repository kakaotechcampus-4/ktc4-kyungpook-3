import os
import secrets
from datetime import datetime, timezone
from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.errors import AppError, ErrorCode
from app.models import Session as SessionModel, Task, User, Member, MemberRole

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

def require_member(db: Session, user: User, workspace_id: str) -> Member:
    """workspace_id가 경로·쿼리에 없고 리소스나 요청 바디에서 나오는 경로용 멤버십 확인."""
    member = db.query(Member).filter(
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


def require_service_token(x_service_token: str | None = Header(None)) -> None:
    """디스코드 봇처럼 사용자 세션 없이 부르는 경로용. X-Service-Token을 SERVICE_TOKEN과 비교한다.

    SERVICE_TOKEN이 설정되지 않은 서버는 모든 요청을 거절한다. 바이트로 바꿔 비교한다. 문자열 그대로 넘기면
    secrets.compare_digest가 ASCII가 아닌 헤더 값에 TypeError를 던져 401 대신 500이 난다.
    """
    expected = os.getenv("SERVICE_TOKEN")
    if not expected or not x_service_token or not secrets.compare_digest(
        x_service_token.encode(), expected.encode()
    ):
        raise AppError(ErrorCode.UNAUTHENTICATED, message="서비스 토큰이 없거나 올바르지 않습니다.")
