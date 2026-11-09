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


def identity_lock(db: Session, email: str) -> None:
    if db.get_bind().dialect.name == "postgresql":
        key = int.from_bytes(hashlib.sha256(("email:" + email).encode()).digest()[:8], "big", signed=True)
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
