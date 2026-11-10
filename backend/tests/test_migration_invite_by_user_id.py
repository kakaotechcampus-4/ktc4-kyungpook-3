"""초대를 이메일 대신 사용자에게 묶는 마이그레이션(#628). sqlite in-memory, TEST_DATABASE_URL 이 있으면 PostgreSQL 도 돈다."""
import importlib.util
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models import Member, User, Workspace

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
VERSIONS = Path(__file__).resolve().parents[1] / "migrations" / "versions"
AT = datetime(2026, 11, 1, tzinfo=timezone.utc)


def _load_migration():
    paths = list(VERSIONS.glob("*_invite_by_user_id.py"))
    assert len(paths) == 1
    spec = importlib.util.spec_from_file_location("invite_by_user_id_migration", paths[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, fn_name: str):
    module = _load_migration()
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, fn_name)()


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
    """마이그레이션 직전 모양의 invitation 테이블. 지금 모델로 만든 뒤 이 마이그레이션의 downgrade 로 되돌린다."""
    if request.param == "postgresql":
        eng = create_engine(TEST_DATABASE_URL)
        with eng.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        Base.metadata.drop_all(eng)
    else:
        eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    _run(eng, "downgrade")
    try:
        yield eng
    finally:
        Base.metadata.drop_all(eng)
        eng.dispose()


@pytest.fixture
def world(engine):
    """워크스페이스 하나, 계정 없는 팀원 넷, 이메일 계정 a·b."""
    with Session(engine) as db:
        ws = Workspace(name="A")
        a = User(username="usera", email="a@x.com", name="에이")
        b = User(username="userb", email="b@x.com", name="비")
        db.add_all([ws, a, b])
        db.flush()
        members = [Member(workspace_id=ws.workspace_id, display_name=f"m{i}", role="member") for i in range(4)]
        db.add_all(members)
        db.commit()
        return {"ws": ws.workspace_id, "a": a.user_id, "b": b.user_id, "m": [m.member_id for m in members]}


def _old_invite(engine, world, invitation_id: str, member: int, email: str, status: str, accepted: str | None = None):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO invitation (invitation_id, workspace_id, member_id, email, status, accepted_user_id, created_at) "
                 "VALUES (:id, :ws, :m, :email, :status, :accepted, :at)"),
            {"id": invitation_id, "ws": world["ws"], "m": world["m"][member], "email": email, "status": status,
             "accepted": accepted, "at": AT},
        )


def _new_invite(engine, world, invitation_id: str, member: int, user_id: str, status: str = "pending"):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO invitation (invitation_id, workspace_id, member_id, invited_user_id, status, created_at) "
                 "VALUES (:id, :ws, :m, :u, :status, :at)"),
            {"id": invitation_id, "ws": world["ws"], "m": world["m"][member], "u": user_id, "status": status, "at": AT},
        )


def _rows(engine, column: str) -> dict[str, tuple]:
    with engine.connect() as conn:
        rows = conn.execute(text(f"SELECT invitation_id, {column}, status, responded_at FROM invitation")).all()
    return {row[0]: tuple(row[1:]) for row in rows}


def _columns(engine) -> dict[str, dict]:
    return {c["name"]: c for c in inspect(engine).get_columns("invitation")}


def _pending_indexes(engine) -> dict[str, str]:
    with engine.connect() as conn:
        return dict(conn.execute(text(
            "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE 'uq_invitation_pending_%'"
        )).all())


def test_upgrade_cancels_pending_invites_and_ties_closed_ones_to_an_account(engine, world):
    a, b = world["a"], world["b"]
    _old_invite(engine, world, "pending-a", 0, "a@x.com", "pending")
    _old_invite(engine, world, "accepted-b", 1, "typo@x.com", "accepted", accepted=b)
    _old_invite(engine, world, "declined-a", 2, "a@x.com", "declined")
    _old_invite(engine, world, "canceled-nobody", 3, "nobody@x.com", "canceled")
    _old_invite(engine, world, "pending-nobody", 3, "ghost@x.com", "pending")

    _run(engine, "upgrade")

    rows = _rows(engine, "invited_user_id")
    assert {key: value[:2] for key, value in rows.items()} == {
        "pending-a": (a, "canceled"),
        "accepted-b": (b, "accepted"),
        "declined-a": (a, "declined"),
    }
    assert rows["pending-a"][2] is not None
    assert rows["declined-a"][2] is None
    columns = _columns(engine)
    assert "email" not in columns
    assert columns["invited_user_id"]["nullable"] is False


def test_upgrade_allows_one_pending_invite_per_user_in_a_workspace(engine, world):
    _run(engine, "upgrade")
    _new_invite(engine, world, "first", 0, world["a"])
    _new_invite(engine, world, "closed", 1, world["a"], status="canceled")

    with pytest.raises(IntegrityError):
        _new_invite(engine, world, "second", 2, world["a"])
    with pytest.raises(IntegrityError):
        _new_invite(engine, world, "same-member", 0, world["b"])
    with pytest.raises(IntegrityError):
        _new_invite(engine, world, "no-user", 2, None)
    if engine.dialect.name == "sqlite":
        indexes = _pending_indexes(engine)
        assert set(indexes) == {"uq_invitation_pending_member", "uq_invitation_pending_user"}
        assert all("WHERE status = 'pending'" in sql for sql in indexes.values())


def test_downgrade_fills_the_email_from_the_invited_account(engine, world):
    _run(engine, "upgrade")
    _new_invite(engine, world, "to-a", 0, world["a"])
    _new_invite(engine, world, "to-b", 1, world["b"], status="declined")

    _run(engine, "downgrade")

    assert {key: value[:2] for key, value in _rows(engine, "email").items()} == {
        "to-a": ("a@x.com", "pending"),
        "to-b": ("b@x.com", "declined"),
    }
    columns = _columns(engine)
    assert "invited_user_id" not in columns
    assert columns["email"]["nullable"] is False
    with pytest.raises(IntegrityError):
        _old_invite(engine, world, "same-email", 2, "a@x.com", "pending")
    if engine.dialect.name == "sqlite":
        indexes = _pending_indexes(engine)
        assert set(indexes) == {"uq_invitation_pending_member", "uq_invitation_pending_email"}
        assert all("WHERE status = 'pending'" in sql for sql in indexes.values())


def test_downgrade_with_an_email_less_invitee_stops_and_changes_nothing(engine, world):
    _run(engine, "upgrade")
    with Session(engine) as db:
        kakao = User(username="kakao1", email=None, name="카", provider="kakao", provider_id="77")
        db.add(kakao)
        db.commit()
        kakao_id = kakao.user_id
    _new_invite(engine, world, "to-kakao", 0, kakao_id)

    with pytest.raises(RuntimeError, match="이메일 없는 계정"):
        _run(engine, "downgrade")

    assert {key: value[:2] for key, value in _rows(engine, "invited_user_id").items()} == {
        "to-kakao": (kakao_id, "pending"),
    }
    assert "email" not in _columns(engine)
