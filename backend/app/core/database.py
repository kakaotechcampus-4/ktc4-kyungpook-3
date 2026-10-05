"""DB 연결 및 세션 관리.

기본 DB는 PostgreSQL이다(로컬은 docker-compose.yml의 db 서비스).
테스트는 sqlite in-memory 엔진을 따로 만들어 쓰므로 SQLite 분기는 남겨 둔다.
"""
import os
from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.schema import MetaData

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://mm:mm@localhost:5432/mm")

# SQLite는 기본적으로 같은 커넥션을 다른 스레드에서 못 쓰므로 옵션 추가
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, echo=False, pool_pre_ping=True)

if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
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
