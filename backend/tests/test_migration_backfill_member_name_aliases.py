"""기존 팀원 이름 별칭 채우기 마이그레이션(#459)의 생성·건너뛰기·되돌리기·규칙 일치를 확인한다.

sqlite in-memory, TEST_DATABASE_URL 이 있으면 PostgreSQL 도 돈다.
"""
import importlib.util
import os
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models import Member, MemberAlias, Workspace
from app.services.member_aliases import name_alias_forms

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
VERSIONS = Path(__file__).resolve().parents[1] / "migrations" / "versions"
WORKSPACE = "ws-1"
OTHER_WORKSPACE = "ws-2"


def _load_migration():
    paths = list(VERSIONS.glob("*_backfill_member_name_aliases.py"))
    assert len(paths) == 1
    spec = importlib.util.spec_from_file_location("backfill_member_name_aliases_migration", paths[0])
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
        for workspace_id in (WORKSPACE, OTHER_WORKSPACE):
            conn.execute(Workspace.__table__.insert().values(workspace_id=workspace_id, name=workspace_id))
    try:
        yield eng
    finally:
        Base.metadata.drop_all(eng)
        eng.dispose()


def _member(engine, member_id, display_name, *, workspace_id=WORKSPACE, is_deleted=False):
    with engine.begin() as conn:
        conn.execute(
            Member.__table__.insert().values(
                member_id=member_id, workspace_id=workspace_id, display_name=display_name, is_deleted=is_deleted
            )
        )


def _alias(engine, member_id, alias_text, source, *, workspace_id=WORKSPACE):
    with engine.begin() as conn:
        conn.execute(
            MemberAlias.__table__.insert().values(
                alias_id=f"{member_id}-{alias_text}",
                member_id=member_id,
                workspace_id=workspace_id,
                alias_text=alias_text,
                alias_type="nickname",
                source=source,
                confidence=0.3,
                verified=False,
            )
        )


def _aliases(engine) -> list[tuple]:
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT member_id, alias_text, source FROM member_alias ORDER BY member_id, alias_text")
        ).all()
    return [tuple(row) for row in rows]


def _run(engine, fn_name: str):
    module = _load_migration()
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, fn_name)()


def test_active_korean_member_gets_full_and_given_name_aliases(engine):
    _member(engine, "m1", "김동우")
    _member(engine, "m2", "탈퇴한", is_deleted=True)
    _member(engine, "m3", "Alice")
    _run(engine, "upgrade")
    assert _aliases(engine) == [("m1", "김동우", "display_name"), ("m1", "동우", "display_name")]
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT alias_id, alias_type, verified, confidence, created_at, workspace_id FROM member_alias")
        ).all()
    assert len(rows) == 2
    for alias_id, alias_type, verified, confidence, created_at, workspace_id in rows:
        assert len(alias_id) == 36
        assert alias_type == "realname"
        assert verified in (True, 1)
        assert confidence == 1.0
        assert created_at is not None
        assert workspace_id == WORKSPACE


def test_text_the_member_already_has_is_kept_as_is(engine):
    _member(engine, "m1", "김동우")
    _alias(engine, "m1", "동우", "manual")
    _run(engine, "upgrade")
    assert _aliases(engine) == [("m1", "김동우", "display_name"), ("m1", "동우", "manual")]


def test_text_held_by_other_member_as_manual_is_skipped(engine):
    _member(engine, "m1", "이민수")
    _member(engine, "m2", "박철수")
    _alias(engine, "m2", "민수", "manual")
    _run(engine, "upgrade")
    assert ("m1", "민수", "display_name") not in _aliases(engine)
    assert ("m1", "이민수", "display_name") in _aliases(engine)


def test_text_held_by_other_member_as_learned_is_skipped(engine):
    _member(engine, "m1", "이민수")
    _member(engine, "m2", "박철수")
    _alias(engine, "m2", "민수", "learned")
    _run(engine, "upgrade")
    assert ("m1", "민수", "display_name") not in _aliases(engine)


def test_text_held_by_deleted_or_other_workspace_member_is_not_blocking(engine):
    _member(engine, "m1", "이민수")
    _member(engine, "m2", "박철수", is_deleted=True)
    _member(engine, "m3", "최영희", workspace_id=OTHER_WORKSPACE)
    _alias(engine, "m2", "민수", "manual")
    _alias(engine, "m3", "민수", "manual", workspace_id=OTHER_WORKSPACE)
    _run(engine, "upgrade")
    assert ("m1", "민수", "display_name") in _aliases(engine)


def test_text_held_by_other_member_as_nickname_does_not_block(engine):
    _member(engine, "m1", "이민수")
    _member(engine, "m2", "박철수")
    _alias(engine, "m2", "민수", "discord_profile")
    _run(engine, "upgrade")
    assert ("m1", "민수", "display_name") in _aliases(engine)


def test_two_auto_members_with_same_given_name_both_get_it(engine):
    _member(engine, "m1", "김민수")
    _member(engine, "m2", "이민수")
    _run(engine, "upgrade")
    aliases = _aliases(engine)
    assert ("m1", "민수", "display_name") in aliases
    assert ("m2", "민수", "display_name") in aliases


def test_running_twice_does_not_duplicate(engine):
    _member(engine, "m1", "김동우")
    _run(engine, "upgrade")
    first = _aliases(engine)
    _run(engine, "upgrade")
    assert _aliases(engine) == first == [("m1", "김동우", "display_name"), ("m1", "동우", "display_name")]


def test_downgrade_removes_only_display_name_aliases(engine):
    _member(engine, "m1", "김동우")
    _alias(engine, "m1", "동우", "manual")
    _run(engine, "upgrade")
    _run(engine, "downgrade")
    assert _aliases(engine) == [("m1", "동우", "manual")]


@pytest.mark.parametrize(
    "name",
    ["김동우", "김환", "남궁민수", " 김동우 ", "Alice", "새 팀원", "김", None, ""],
)
def test_migration_rule_matches_name_alias_forms(name):
    assert _load_migration()._forms(name) == name_alias_forms(name)
