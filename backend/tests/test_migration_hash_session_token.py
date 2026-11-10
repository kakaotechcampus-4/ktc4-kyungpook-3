"""세션 토큰 해시 마이그레이션(#437)의 값 변환과 downgrade 를 확인한다. 컬럼·인덱스는 바뀌지 않는다. sqlite in-memory, TEST_DATABASE_URL 이 있으면 PostgreSQL 도 돈다."""
import hashlib
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
from tests.usernames import username_for

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
        conn.execute(User.__table__.insert().values(username=username_for("a@x.com"), user_id="user-0", email="a@x.com", name="n"))
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


def _schema(engine):
    insp = inspect(engine)
    cols = {c["name"]: (getattr(c["type"], "length", None), c["nullable"]) for c in insp.get_columns("session")}
    indexes = {i["name"]: (i["unique"], i["column_names"]) for i in insp.get_indexes("session")}
    return cols, indexes


def test_upgrade_hashes_existing_tokens(engine):
    ids = _insert_old(engine, RAW_A, RAW_B)
    before = _rows(engine, "session_token")
    _run(engine, "upgrade")
    after = _rows(engine, "session_token")
    assert [r[0] for r in after] == ids
    assert [r[1] for r in after] == [hash_session_token(RAW_A), hash_session_token(RAW_B)]
    assert [r[1] for r in after] == [hashlib.sha256(r.encode()).hexdigest() for r in (RAW_A, RAW_B)]
    assert [r[2] for r in after] == [r[2] for r in before]


def test_raw_cookie_still_finds_session_after_upgrade(engine):
    ids = _insert_old(engine, RAW_A, RAW_B)
    _run(engine, "upgrade")
    with sessionmaker(bind=engine)() as db:
        found = find_session(db, RAW_B)
        assert found is not None and found.session_id == ids[1]
        assert find_session(db, "nope") is None


def test_upgrade_leaves_schema_unchanged(engine):
    _insert_old(engine, RAW_A)
    before = _schema(engine)
    _run(engine, "upgrade")
    assert _schema(engine) == before
    cols, indexes = before
    assert "session_token" in cols and "token_hash" not in cols
    assert indexes["ix_session_session_token"] == (True, ["session_token"])
    assert cols["session_token"] == (255, False)


def test_downgrade_deletes_sessions_and_keeps_schema(engine):
    _insert_old(engine, RAW_A, RAW_B)
    before = _schema(engine)
    _run(engine, "upgrade")
    _run(engine, "downgrade")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM session")).scalar() == 0
    assert _schema(engine) == before
