"""로그인 세션. 쿠키에는 원문을 주고 DB 에는 sha256 해시만 둔다(#437)."""
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Session as SessionModel
from app.services.password_reset import hash_token

SESSION_TTL = timedelta(days=7)


def hash_session_token(raw: str) -> str:
    return hash_token(raw)


def create_session(db: Session, user_id: str, *, now: datetime | None = None) -> str:
    """세션 행을 추가하고 쿠키에 줄 원문을 돌려준다. commit 은 호출자가 한다."""
    raw = secrets.token_urlsafe(32)
    now = now or datetime.now(timezone.utc)
    db.add(SessionModel(user_id=user_id, token_hash=hash_session_token(raw), expires_at=now + SESSION_TTL))
    return raw


def find_session(db: Session, raw: str) -> SessionModel | None:
    """원문의 해시로 찾는다. 만료는 검사하지 않는다."""
    return db.scalars(select(SessionModel).where(SessionModel.token_hash == hash_session_token(raw))).first()


def delete_session(db: Session, raw: str) -> None:
    """원문의 해시와 맞는 행만 지운다. commit 은 호출자가 한다."""
    db.execute(delete(SessionModel).where(SessionModel.token_hash == hash_session_token(raw)))
