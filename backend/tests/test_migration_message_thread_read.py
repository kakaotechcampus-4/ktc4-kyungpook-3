"""대화별 읽은 위치 표 마이그레이션(#480)의 채우기와 되돌리기를 확인한다.

sqlite in-memory, TEST_DATABASE_URL 이 있으면 PostgreSQL 도 돈다.
"""
import importlib.util
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models import Member, MessageThread, ThreadMessage, Workspace

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
VERSIONS = Path(__file__).resolve().parents[1] / "migrations" / "versions"
WORKSPACE = "ws-1"
OTHER_WORKSPACE = "ws-2"


def _load_migration():
    paths = list(VERSIONS.glob("*_add_message_thread_read.py"))
    assert len(paths) == 1
    spec = importlib.util.spec_from_file_location("add_message_thread_read_migration", paths[0])
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
        # 마이그레이션 전 스키마를 만들려고 읽은 위치 표를 뺀다.
        conn.execute(text("DROP TABLE IF EXISTS message_thread_read"))
        for workspace_id in (WORKSPACE, OTHER_WORKSPACE):
            conn.execute(Workspace.__table__.insert().values(workspace_id=workspace_id, name=workspace_id))
    try:
        yield eng
    finally:
        with eng.begin() as conn:
            conn.execute(text("DROP TABLE IF EXISTS message_thread_read"))
        Base.metadata.drop_all(eng)
        eng.dispose()


def _run(engine, fn_name: str):
    module = _load_migration()
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, fn_name)()


def _member(conn, member_id, role, *, workspace_id=WORKSPACE, is_deleted=False):
    conn.execute(
        Member.__table__.insert().values(
            member_id=member_id, workspace_id=workspace_id, display_name=member_id, role=role, is_deleted=is_deleted
        )
    )


def _thread(conn, thread_id, member_id, *, workspace_id=WORKSPACE):
    conn.execute(
        MessageThread.__table__.insert().values(thread_id=thread_id, workspace_id=workspace_id, member_id=member_id)
    )


def _message(conn, message_id, thread_id, created_at):
    conn.execute(
        ThreadMessage.__table__.insert().values(
            message_id=message_id, thread_id=thread_id, sender="member", body="안녕", created_at=created_at
        )
    )


def _as_utc(value) -> datetime:
    # sqlite 는 문자열·naive 로, PostgreSQL 은 aware datetime 으로 돌려준다.
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def test_upgrade_marks_existing_threads_read_for_active_members(engine):
    latest = datetime.now(timezone.utc) - timedelta(minutes=5)
    with engine.begin() as conn:
        _member(conn, "pm1", "pm")
        _member(conn, "pm-gone", "pm", is_deleted=True)
        _member(conn, "pm-other", "pm", workspace_id=OTHER_WORKSPACE)
        _member(conn, "m1", "member")
        _member(conn, "m-gone", "member", is_deleted=True)
        for thread_id, member_id in (
            ("t-pm1", "pm1"),
            ("t-pm-gone", "pm-gone"),
            ("t-m1", "m1"),
            ("t-m-gone", "m-gone"),
        ):
            _thread(conn, thread_id, member_id)
        _thread(conn, "t-other", "pm-other", workspace_id=OTHER_WORKSPACE)
        _message(conn, "msg-1", "t-m1", latest - timedelta(days=1))
        _message(conn, "msg-2", "t-pm1", latest)
        _message(conn, "msg-3", "t-m-gone", latest - timedelta(hours=2))
    before = datetime.now(timezone.utc)

    _run(engine, "upgrade")

    with engine.connect() as conn:
        rows = conn.execute(text("SELECT thread_id, member_id, last_read_at FROM message_thread_read")).all()
    pairs = sorted((thread_id, member_id) for thread_id, member_id, _ in rows)
    assert pairs == sorted(
        [
            # 탈퇴하지 않은 팀원은 자기 대화만.
            ("t-m1", "m1"),
            # 탈퇴하지 않은 PM 은 워크스페이스의 모든 대화(자기 대화는 한 행만).
            ("t-pm1", "pm1"),
            ("t-pm-gone", "pm1"),
            ("t-m1", "pm1"),
            ("t-m-gone", "pm1"),
            # 다른 워크스페이스 PM 은 자기 워크스페이스 대화만.
            ("t-other", "pm-other"),
        ]
    )
    for _, _, last_read_at in rows:
        assert _as_utc(last_read_at) >= before
    # 기존 메시지는 전부 읽은 것으로 쳐서 읽지 않은 수가 0 에서 시작한다.
    assert all(_as_utc(last_read_at) >= _as_utc(latest) for _, _, last_read_at in rows)


def test_downgrade_drops_table(engine):
    _run(engine, "upgrade")
    assert "message_thread_read" in inspect(engine).get_table_names()

    _run(engine, "downgrade")

    assert "message_thread_read" not in inspect(engine).get_table_names()
