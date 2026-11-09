"""FK가 켜진 기존 공동 기록을 손상시키지 않고 익명 주체 제약을 설치·제거한다."""

import importlib.util
import os
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.exc import IntegrityError


@pytest.fixture(params=[
    "sqlite",
    pytest.param("postgresql", marks=pytest.mark.skipif(
        not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL(PostgreSQL)이 없습니다.",
    )),
])
def old_schema(request):
    engine = create_engine(
        "sqlite:///:memory:" if request.param == "sqlite" else os.environ["TEST_DATABASE_URL"]
    )
    if request.param == "sqlite":
        @event.listens_for(engine, "connect")
        def foreign_keys_on(connection, _record):
            connection.execute("PRAGMA foreign_keys=ON")

    from app.core.database import Base
    import app.models  # noqa: F401

    Base.metadata.drop_all(engine)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE member (member_id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36), "
                          "discord_user_id VARCHAR(64), notion_name VARCHAR(100), display_name VARCHAR(100) NOT NULL, "
                          "role VARCHAR(16) NOT NULL, is_deleted BOOLEAN NOT NULL, deleted_at TIMESTAMP)"))
        conn.execute(text("CREATE TABLE actor_record (record_id VARCHAR(36) PRIMARY KEY, "
                          "member_id VARCHAR(36) REFERENCES member(member_id) ON DELETE CASCADE, body TEXT)"))
        conn.execute(text("INSERT INTO member (member_id, user_id, display_name, role, is_deleted) "
                          "VALUES ('member-1', 'user-1', '기존 이름', 'pm', false)"))
        conn.execute(text("INSERT INTO actor_record VALUES ('record-1', 'member-1', '공동 기록 본문')"))
    try:
        yield engine
    finally:
        with engine.begin() as conn:
            conn.execute(text("DROP TABLE actor_record"))
            conn.execute(text("DROP TABLE member"))
        engine.dispose()


def _migrate(engine, direction):
    path = Path(__file__).resolve().parents[1] / "migrations/versions/e575a01c9d42_account_withdrawal_actor.py"
    spec = importlib.util.spec_from_file_location("withdrawn_actor_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
        getattr(migration, direction)()


def test_upgrade_and_downgrade_preserve_foreign_key_children_and_enforce_erasure(old_schema):
    _migrate(old_schema, "upgrade")
    assert "withdrawn_at" in {column["name"] for column in inspect(old_schema).get_columns("member")}
    with old_schema.connect() as conn:
        assert conn.execute(text("SELECT * FROM actor_record")).all() == [
            ("record-1", "member-1", "공동 기록 본문"),
        ]
    with pytest.raises(IntegrityError), old_schema.begin() as conn:
        conn.execute(text("UPDATE member SET withdrawn_at = CURRENT_TIMESTAMP"))
    with old_schema.begin() as conn:
        conn.execute(text("UPDATE member SET user_id=NULL, discord_user_id=NULL, notion_name=NULL, "
                          "display_name='탈퇴한 사용자', role='member', is_deleted=true, "
                          "deleted_at=CURRENT_TIMESTAMP, withdrawn_at=CURRENT_TIMESTAMP"))
    with pytest.raises(IntegrityError), old_schema.begin() as conn:
        conn.execute(text("UPDATE member SET discord_user_id='revived-private-id'"))
    _migrate(old_schema, "downgrade")
    assert "withdrawn_at" not in {column["name"] for column in inspect(old_schema).get_columns("member")}
    with old_schema.connect() as conn:
        assert conn.execute(text("SELECT * FROM actor_record")).all() == [
            ("record-1", "member-1", "공동 기록 본문"),
        ]
        assert conn.scalar(text("SELECT display_name FROM member")) == "탈퇴한 사용자"
