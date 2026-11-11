"""계정·공간 종료와 같은 트랜잭션에서 권한·늦은 쓰기를 판정한다."""

import hashlib

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import User, Workspace

WORKER_GATE = 575_20261109


def worker_gate(db: Session) -> None:
    """여러 공간을 순회하는 메시지 작업과 계정 종료는 공간 행을 잡기 전에 줄을 선다."""
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": WORKER_GATE})


def email_identity(email: str) -> str:
    return "email:" + email


def kakao_identity(provider_id: str) -> str:
    return "kakao:" + provider_id


def user_identities(user: User) -> list[str]:
    """가입·탈퇴가 같은 줄에 서는 계정의 신원. 새 계정은 이메일이나 카카오 하나뿐이지만(#610) 예전 계정은 둘 다 가질 수 있다.
    둘을 잡는 탈퇴끼리 서로 기다리지 않게 정렬한 순서로 잡는다."""
    identities = [email_identity(user.email)] if user.email else []
    if user.provider_id:
        identities.append(kakao_identity(user.provider_id))
    return sorted(identities)


def identity_lock(db: Session, identity: str) -> None:
    """identity 는 email_identity·kakao_identity 의 값이다. 같은 신원의 가입·탈퇴가 한 줄로 선다."""
    if db.get_bind().dialect.name == "postgresql":
        key = int.from_bytes(hashlib.sha256(identity.encode()).digest()[:8], "big", signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def user(db: Session, user_id: str, *, exclusive: bool = False) -> User:
    stmt = select(User).where(User.user_id == user_id).execution_options(populate_existing=True)
    if exclusive or not db.info.get("read_only_request"):
        stmt = stmt.with_for_update(read=not exclusive)
    row = db.scalar(stmt)
    if row is None:
        raise AppError(ErrorCode.UNAUTHENTICATED)
    return row


def workspace(db: Session, workspace_id: str, *, check_epoch: bool = True) -> Workspace:
    stmt = select(Workspace).where(Workspace.workspace_id == workspace_id).execution_options(populate_existing=True)
    if not db.info.get("read_only_request"):
        stmt = stmt.with_for_update()
    row = db.scalar(stmt)
    if row is None or row.deleted_at is not None:
        raise AppError(ErrorCode.WORKSPACE_NOT_FOUND, details={"workspace_id": workspace_id})
    if check_epoch and row.identity_epoch and db.info.get("service_write"):
        if db.info.get("privacy_epoch") != str(row.identity_epoch):
            raise AppError(ErrorCode.PRIVACY_VERSION_CHANGED, details={"identity_epoch": row.identity_epoch})
    return row
