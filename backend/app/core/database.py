"""DB 연결 및 세션 관리.

SQLite(MVP) → PostgreSQL(확장) 이관을 고려해 방언 차이는 SQLAlchemy가 흡수한다.
DATABASE_URL 환경변수만 바꾸면 PostgreSQL로 전환된다.
"""
import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./mm.db")

# SQLite는 기본적으로 같은 커넥션을 다른 스레드에서 못 쓰므로 옵션 추가
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, echo=False)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    """모든 모델의 베이스."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI 의존성 주입용 DB 세션."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
