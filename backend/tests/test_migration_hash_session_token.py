"""세션 토큰 해시 마이그레이션(#437)의 변환·인덱스·downgrade 를 확인한다. sqlite in-memory, TEST_DATABASE_URL 이 있으면 PostgreSQL 도 돈다."""
import importlib.util
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models import User
from app.services.sessions import find_session, hash_session_token

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
VERSIONS = Path(__file__).resolve().parents[1] / "migrations" / "versions"
EXPIRES = datetime(2030, 1, 1, tzinfo=timezone.utc)
RAW_A = "a" * 43
RAW_B = "b-" + "c" * 41


def _load_migration():
    paths = list(VERSIONS.glob("*_hash_session_token.py"))
    assert len(paths) == 1
    spec = importlib.util.spec_from_file_location("hash_session_token_migration", paths[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _make_old_session_table(conn):
    """마이그레이션 전 모양(session_token String(255), ix_session_session_token)으로 session 표를 다시 만든다."""
    conn.execute(text("DROP TABLE session"))
    conn.execute(
        text(
            "CREATE TABLE session ("
            "session_id VARCHAR(36) NOT NULL, "
            "user_id VARCHAR(36) NOT NULL, "
            "session_token VARCHAR(255) NOT NULL, "
            "expires_at TIMESTAMP WITH TIME ZONE NOT NULL, "
            "created_at TIMESTAMP WITH TIME ZONE NOT NULL, "
            "CONSTRAINT pk_session PRIMARY KEY (session_id), "
            'CONSTRAINT fk_session_user_id_user FOREIGN KEY (user_id) REFERENCES "user" (user_id) ON DELETE CASCADE)'
        )
    )
    conn.execute(text("CREATE UNIQUE INDEX ix_session_session_token ON session (session_token)"))
    conn.execute(text("CREATE INDEX ix_session_user_id ON session (user_id)"))


@pytest.fixture(
    params=[
        "sqlite",
        pytest.param(
            "postgresql",
            marks=pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없습니다."),
        ),
    ]
)
def engine(request):
    if request.param == "postgresql":
        eng = create_engine(TEST_DATABASE_URL)
        with eng.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        Base.metadata.drop_all(eng)
    else:
        eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    with eng.begin() as conn:
        _make_old_session_table(conn)
        conn.execute(User.__table__.insert().values(user_id="user-0", email="a@x.com", name="n"))
    try:
        yield eng
    finally:
        Base.metadata.drop_all(eng)
        eng.dispose()


def _insert_old(engine, *raws) -> list[str]:
    ids = []
    with engine.begin() as conn:
        for i, raw in enumerate(raws):
            sid = f"sess-{i}"
            conn.execute(
                text(
                    "INSERT INTO session (session_id, user_id, session_token, expires_at, created_at) "
                    "VALUES (:sid, 'user-0', :raw, :exp, :exp)"
                ),
                {"sid": sid, "raw": raw, "exp": EXPIRES},
            )
            ids.append(sid)
    return ids


def _run(engine, fn_name: str):
    module = _load_migration()
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, fn_name)()


def _rows(engine, column):
    with engine.connect() as conn:
        return conn.execute(text(f"SELECT session_id, {column}, expires_at FROM session ORDER BY session_id")).all()


def test_upgrade_hashes_existing_tokens(engine):
    ids = _insert_old(engine, RAW_A, RAW_B)
    before = _rows(engine, "session_token")
    _run(engine, "upgrade")
    after = _rows(engine, "token_hash")
    assert [r[0] for r in after] == ids
    assert [r[1] for r in after] == [hash_session_token(RAW_A), hash_session_token(RAW_B)]
    assert [r[2] for r in after] == [r[2] for r in before]
    assert "session_token" not in {c["name"] for c in inspect(engine).get_columns("session")}


def test_raw_cookie_still_finds_session_after_upgrade(engine):
    ids = _insert_old(engine, RAW_A, RAW_B)
    _run(engine, "upgrade")
    with sessionmaker(bind=engine)() as db:
        found = find_session(db, RAW_B)
        assert found is not None and found.session_id == ids[1]
        assert find_session(db, "nope") is None


def test_upgrade_creates_unique_token_hash_index(engine):
    _run(engine, "upgrade")
    insp = inspect(engine)
    indexes = {i["name"]: i for i in insp.get_indexes("session")}
    assert indexes["ix_session_token_hash"]["unique"]
    assert indexes["ix_session_token_hash"]["column_names"] == ["token_hash"]
    assert "ix_session_session_token" not in indexes
    col = next(c for c in insp.get_columns("session") if c["name"] == "token_hash")
    assert col["type"].length == 64 and not col["nullable"]


def test_downgrade_deletes_sessions_and_restores_column(engine):
    _insert_old(engine, RAW_A, RAW_B)
    _run(engine, "upgrade")
    _run(engine, "downgrade")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM session")).scalar() == 0
    insp = inspect(engine)
    col = next(c for c in insp.get_columns("session") if c["name"] == "session_token")
    assert col["type"].length == 255 and not col["nullable"]
    indexes = {i["name"]: i for i in insp.get_indexes("session")}
    assert indexes["ix_session_session_token"]["unique"]
    assert "ix_session_token_hash" not in indexes
