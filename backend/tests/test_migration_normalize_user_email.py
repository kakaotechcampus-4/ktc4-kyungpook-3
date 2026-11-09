"""user.email 정규화 마이그레이션(#434)의 변환·중복 중단·규칙 일치를 확인한다. sqlite in-memory, TEST_DATABASE_URL 이 있으면 PostgreSQL 도 돈다."""
import importlib.util
import os
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, event, text
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models import User
from app.schemas.email import normalize_email
from tests.usernames import username_for

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
VERSIONS = Path(__file__).resolve().parents[1] / "migrations" / "versions"


def _load_migration():
    paths = list(VERSIONS.glob("*_normalize_user_email.py"))
    assert len(paths) == 1
    spec = importlib.util.spec_from_file_location("normalize_user_email_migration", paths[0])
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
    try:
        yield eng
    finally:
        Base.metadata.drop_all(eng)
        eng.dispose()


def _insert(engine, *emails) -> list[str]:
    ids = []
    with engine.begin() as conn:
        for i, email in enumerate(emails):
            user_id = f"user-{i}"
            conn.execute(
                User.__table__.insert().values(username=username_for(email), user_id=user_id, email=email, name=f"n{i}")
            )
            ids.append(user_id)
    return ids


def _emails(engine) -> dict[str, str]:
    with engine.connect() as conn:
        return dict(conn.execute(text('SELECT user_id, email FROM "user"')).all())


def _run(engine, fn_name: str):
    module = _load_migration()
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, fn_name)()


def test_mixed_case_emails_become_lowercase(engine):
    a, b, c = _insert(engine, "A@X.com", "b@y.com", "  C@Z.com")
    _run(engine, "upgrade")
    assert _emails(engine) == {a: "a@x.com", b: "b@y.com", c: "c@z.com"}


def test_running_twice_changes_nothing_more(engine):
    _insert(engine, "A@X.com", "b@y.com")
    _run(engine, "upgrade")
    first = _emails(engine)
    _run(engine, "upgrade")
    assert _emails(engine) == first


def test_duplicates_abort_without_changing_rows(engine):
    a, b, c = _insert(engine, "dup@x.com", "DUP@x.com", "Other@x.com")
    # PostgreSQL 은 유일 인덱스가 대소문자를 구분하므로 이 입력은 그대로 들어간다.
    # _run 은 실패 시 롤백하므로 행 값만으로는 "UPDATE 전에 멈췄는지" 알 수 없다. 실행된 UPDATE 문 수로 고정한다.
    updates = []

    def count_update(conn, cursor, statement, *args):
        if statement.lstrip().upper().startswith("UPDATE"):
            updates.append(statement)

    event.listen(engine, "before_cursor_execute", count_update)
    try:
        with pytest.raises(RuntimeError) as exc:
            _run(engine, "upgrade")
    finally:
        event.remove(engine, "before_cursor_execute", count_update)
    assert updates == []
    message = str(exc.value)
    assert a in message and b in message
    assert c not in message
    for leaked in ("dup@x.com", "DUP@x.com", "other"):
        assert leaked not in message
    assert _emails(engine) == {a: "dup@x.com", b: "DUP@x.com", c: "Other@x.com"}


@pytest.mark.parametrize("value", ["  A@X.com ", "UPPER@X.COM", "lower@x.com", "É@x.com", "Mixed.Case+Tag@Ex.Com"])
def test_migration_rule_matches_normalize_email(value):
    assert _load_migration()._normalize(value) == normalize_email(value)


def test_downgrade_is_a_no_op(engine):
    a, b = _insert(engine, "A@X.com", "b@y.com")
    _run(engine, "downgrade")
    assert _emails(engine) == {a: "A@X.com", b: "b@y.com"}
