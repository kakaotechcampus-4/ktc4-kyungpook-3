"""user.username 추가·백필과 email nullable 마이그레이션(#610). sqlite in-memory, TEST_DATABASE_URL 이 있으면 PostgreSQL 도 돈다."""
import importlib.util
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.schemas.username import validate_username

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
VERSIONS = Path(__file__).resolve().parents[1] / "migrations" / "versions"


def _load_migration():
    paths = list(VERSIONS.glob("*_add_user_username.py"))
    assert len(paths) == 1
    spec = importlib.util.spec_from_file_location("add_user_username_migration", paths[0])
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
    """마이그레이션 직전 모양의 user 테이블. 지금 모델로 만든 뒤 이 마이그레이션의 downgrade 로 되돌린다."""
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


def _insert(engine, *emails: str) -> list[str]:
    """emails 순서대로 가입한 것으로 둔다(created_at 이 1초씩 늦다)."""
    ids = []
    with engine.begin() as conn:
        for i, email in enumerate(emails):
            user_id = f"user-{i:02d}"
            conn.execute(
                text('INSERT INTO "user" (user_id, email, name, provider, created_at, updated_at) '
                     "VALUES (:id, :email, :name, 'local', :at, :at)"),
                {"id": user_id, "email": email, "name": f"n{i}", "at": datetime(2026, 1, 1, 0, 0, i, tzinfo=timezone.utc)},
            )
            ids.append(user_id)
    return ids


def _insert_kakao(engine, user_id: str, username: str) -> None:
    """마이그레이션 뒤 카카오만으로 가입한 계정. 이메일이 없다."""
    with engine.begin() as conn:
        conn.execute(
            text('INSERT INTO "user" (user_id, email, username, name, provider, created_at, updated_at) '
                 "VALUES (:id, NULL, :username, 'k', 'kakao', :at, :at)"),
            {"id": user_id, "username": username, "at": datetime(2026, 2, 1, tzinfo=timezone.utc)},
        )


def _usernames(engine) -> dict[str, str]:
    with engine.connect() as conn:
        return dict(conn.execute(text('SELECT user_id, username FROM "user"')).all())


def _columns(engine) -> dict[str, dict]:
    return {c["name"]: c for c in inspect(engine).get_columns("user")}


def test_backfill_uses_the_email_local_part_and_numbers_duplicates(engine):
    ids = _insert(
        engine,
        "Kim.Dong-Woo@example.com",
        "kimdongwoo@other.com",
        "kimdongwoo@third.com",
        "kimdongwoo2@example.com",
        "ab@example.com",
        "!!@example.com",
        "x" * 25 + "@example.com",
        "x" * 25 + "@other.com",
    )

    _run(engine, "upgrade")

    assert _usernames(engine) == dict(zip(ids, [
        "kimdongwoo",
        "kimdongwoo2",
        "kimdongwoo3",
        # 자기 앞부분이 이미 앞 사람의 번호 붙은 값이라 다음 빈 번호를 받는다.
        "kimdongwoo22",
        "userab",
        "user",
        "x" * 20,
        "x" * 19 + "2",
    ]))


def test_every_backfilled_username_follows_the_signup_rule(engine):
    _insert(engine, "a@x.com", "A.B@y.com", "123@z.com", "한글@x.com", "x" * 30 + "@x.com", "user@x.com", "u-s-e-r@y.com")

    _run(engine, "upgrade")

    names = list(_usernames(engine).values())
    assert len(set(names)) == len(names)
    assert all(validate_username(name) == name for name in names)


def test_earlier_signup_keeps_the_plain_name_and_ties_break_by_user_id(engine):
    with engine.begin() as conn:
        for user_id in ("user-b", "user-a"):
            conn.execute(
                text('INSERT INTO "user" (user_id, email, name, provider, created_at, updated_at) '
                     "VALUES (:id, :email, 'n', 'local', :at, :at)"),
                {"id": user_id, "email": f"same@{user_id}.com", "at": datetime(2026, 1, 1, tzinfo=timezone.utc)},
            )

    _run(engine, "upgrade")

    assert _usernames(engine) == {"user-a": "same", "user-b": "same2"}


def test_upgrade_makes_username_required_and_unique_and_email_optional(engine):
    _insert(engine, "a@x.com")

    _run(engine, "upgrade")

    columns = _columns(engine)
    assert columns["username"]["nullable"] is False
    assert columns["email"]["nullable"] is True
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text('UPDATE "user" SET username = NULL'))
    _insert_kakao(engine, "k", "kakao1")
    with pytest.raises(IntegrityError):
        _insert_kakao(engine, "k2", "kakao1")


def test_downgrade_drops_username_and_requires_email_again(engine):
    _insert(engine, "a@x.com")
    _run(engine, "upgrade")

    _run(engine, "downgrade")

    columns = _columns(engine)
    assert "username" not in columns
    assert columns["email"]["nullable"] is False


def test_downgrade_with_an_email_less_account_stops_and_changes_nothing(engine):
    _insert(engine, "a@x.com")
    _run(engine, "upgrade")
    _insert_kakao(engine, "k", "kakao1")

    with pytest.raises(RuntimeError, match="이메일 없는 계정"):
        _run(engine, "downgrade")

    assert _usernames(engine) == {"user-00": "usera", "k": "kakao1"}
    assert _columns(engine)["email"]["nullable"] is True
