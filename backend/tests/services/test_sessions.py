"""세션 토큰은 sha256 해시로만 저장하고, 쿠키 원문의 해시로 찾는다(#437)."""
import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models import Session as SessionModel, User
from app.services import sessions
from tests.usernames import username_for

NOW = datetime(2026, 11, 6, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def user_id(db):
    user = User(username=username_for("a@example.com"), email="a@example.com", name="a")
    db.add(user)
    db.commit()
    return user.user_id


def test_create_session_stores_only_hash(db, user_id):
    raw = sessions.create_session(db, user_id, now=NOW)
    db.commit()

    row = db.scalars(select(SessionModel)).one()
    assert row.session_token == hashlib.sha256(raw.encode()).hexdigest()
    for column in SessionModel.__table__.columns:
        assert getattr(row, column.key) != raw
    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    assert expires_at == NOW + timedelta(days=7)


def test_find_session_by_raw_returns_row(db, user_id):
    raw = sessions.create_session(db, user_id)
    db.commit()

    row = sessions.find_session(db, raw)
    assert row is not None
    assert row.user_id == user_id


def test_find_session_by_hash_value_fails(db, user_id):
    raw = sessions.create_session(db, user_id)
    db.commit()
    row = sessions.find_session(db, raw)

    assert sessions.find_session(db, row.session_token) is None


def test_find_session_with_lone_surrogate_returns_none(db):
    assert sessions.find_session(db, "\ud800") is None


def test_delete_session_removes_only_that_row(db, user_id):
    first = sessions.create_session(db, user_id)
    second = sessions.create_session(db, user_id)
    db.commit()

    sessions.delete_session(db, first)
    db.commit()

    assert sessions.find_session(db, first) is None
    assert sessions.find_session(db, second) is not None
    assert len(db.scalars(select(SessionModel)).all()) == 1


def _add_session(db, user_id, session_token, expires_at):
    db.add(SessionModel(user_id=user_id, session_token=session_token, expires_at=expires_at))


def _remaining_expiries(db):
    values = []
    for row in db.scalars(select(SessionModel)).all():
        expires_at = row.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        values.append(expires_at)
    return sorted(values)


def test_sweep_deletes_only_expired(db, user_id):
    _add_session(db, user_id, "a" * 64, NOW - timedelta(hours=1))
    _add_session(db, user_id, "b" * 64, NOW)
    _add_session(db, user_id, "c" * 64, NOW + timedelta(hours=1))
    db.commit()

    assert sessions.sweep_expired_sessions(db, now=NOW) == 1

    assert _remaining_expiries(db) == [NOW, NOW + timedelta(hours=1)]


def test_sweep_with_nothing_expired_returns_zero(db, user_id):
    _add_session(db, user_id, "a" * 64, NOW + timedelta(hours=1))
    db.commit()

    assert sessions.sweep_expired_sessions(db, now=NOW) == 0
    assert len(db.scalars(select(SessionModel)).all()) == 1
