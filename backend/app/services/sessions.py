"""로그인 세션. 쿠키에는 원문을 주고 DB 에는 sha256 해시만 둔다(#437)."""
import logging
import secrets
import threading
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models import Session as SessionModel
from app.services.password_reset import hash_token

logger = logging.getLogger(__name__)

SESSION_TTL = timedelta(days=7)


def hash_session_token(raw: str) -> str:
    return hash_token(raw)


def create_session(db: Session, user_id: str, *, now: datetime | None = None) -> str:
    """세션 행을 추가하고 쿠키에 줄 원문을 돌려준다. commit 은 호출자가 한다."""
    raw = secrets.token_urlsafe(32)
    now = now or datetime.now(timezone.utc)
    db.add(SessionModel(user_id=user_id, session_token=hash_session_token(raw), expires_at=now + SESSION_TTL))
    return raw


def find_session(db: Session, raw: str) -> SessionModel | None:
    """원문의 해시로 찾는다. 만료는 검사하지 않는다."""
    return db.scalars(select(SessionModel).where(SessionModel.session_token == hash_session_token(raw))).first()


def delete_session(db: Session, raw: str) -> None:
    """원문의 해시와 맞는 행만 지운다. commit 은 호출자가 한다."""
    db.execute(delete(SessionModel).where(SessionModel.session_token == hash_session_token(raw)))


def sweep_expired_sessions(db: Session, now: datetime | None = None) -> int:
    """만료된 세션 행을 SQL 한 문장으로 지우고 commit 한 뒤 지운 수를 돌려준다."""
    now = now or datetime.now(timezone.utc)
    # synchronize_session=False: identity map 의 naive/aware 시각을 파이썬에서 비교하지 않게 한다.
    result = db.execute(
        delete(SessionModel).where(SessionModel.expires_at < now),
        execution_options={"synchronize_session": False},
    )
    db.commit()
    deleted = result.rowcount
    if deleted:
        logger.info("만료된 세션 %d건을 지움", deleted)
    return deleted


def run_worker(stop_event: threading.Event, interval: float) -> None:
    while not stop_event.is_set():
        db = SessionLocal()
        try:
            sweep_expired_sessions(db)
        except Exception:
            logger.exception("세션 sweeper 워커 오류")
            db.rollback()
        finally:
            db.close()
        stop_event.wait(interval)


def start_worker(interval: float) -> tuple[threading.Thread, threading.Event]:
    stop_event = threading.Event()
    thread = threading.Thread(
        target=run_worker, args=(stop_event, interval), name="session-sweeper", daemon=True
    )
    thread.start()
    return thread, stop_event
