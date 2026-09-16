"""DB 연결 및 세션 관리.

SQLite(MVP) → PostgreSQL(확장) 이관을 고려해 방언 차이는 SQLAlchemy가 흡수한다.
DATABASE_URL 환경변수만 바꾸면 PostgreSQL로 전환된다.
"""
import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.schema import MetaData

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./mm.db")

# SQLite는 기본적으로 같은 커넥션을 다른 스레드에서 못 쓰므로 옵션 추가
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, echo=False)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

# SQLite는 ALTER TABLE로 제약조건을 못 바꿔서 Alembic batch mode(복사-후-교체)로
# 처리해야 하는데, 그러려면 제약조건에 이름이 있어야 한다. 이름을 명시하지 않은
# 제약조건은 매 스키마마다 이름이 정해지도록 규칙을 둔다.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """모든 모델의 베이스."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def get_db() -> Generator[Session, None, None]:
    """FastAPI 의존성 주입용 DB 세션."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
