"""GET /members/unresolved-aliases 가 님·조사를 뗀 후보로 해결 여부를 가른다 (#459)."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import AliasResolutionLog, Member, MemberAlias, Session as SessionModel, User, Workspace


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()

    def override_get_db():
        yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield session
    finally:
        app.dependency_overrides.pop(get_db, None)
        session.close()
        engine.dispose()


@pytest.fixture
def seed(db):
    user = User(email="pm@example.com", name="pm")
    db.add(user)
    db.flush()
    db.add(SessionModel(
        user_id=user.user_id, session_token="pm-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    db.add(Member(workspace_id=ws.workspace_id, user_id=user.user_id, display_name="PM", role="pm"))
    target = Member(workspace_id=ws.workspace_id, display_name="하은")
    db.add(target)
    db.flush()
    db.commit()
    return {"ws": ws.workspace_id, "member": target.member_id}


def _log(db, seed, text):
    db.add(AliasResolutionLog(
        workspace_id=seed["ws"], alias_text=text, result="not_found", candidate_count=0,
    ))
    db.commit()


def _alias(db, seed, text, *, verified):
    db.add(MemberAlias(
        member_id=seed["member"], workspace_id=seed["ws"], alias_text=text,
        alias_type="realname", source="manual", confidence=1.0 if verified else 0.3, verified=verified,
    ))
    db.commit()


def _unresolved(seed) -> list[str]:
    client = TestClient(app, base_url="https://testserver")
    client.cookies.set("session_token", "pm-token")
    r = client.get(f"/api/v1/members/unresolved-aliases?workspace_id={seed['ws']}")
    assert r.status_code == 200, r.text
    return [item["alias_text"] for item in r.json()["data"]["items"]]


def test_verified_alias_resolves_particle_form(db, seed):
    _log(db, seed, "하은이가")
    _log(db, seed, "철수")
    _alias(db, seed, "하은", verified=True)

    assert _unresolved(seed) == ["철수"]


def test_unverified_alias_keeps_particle_form_unresolved(db, seed):
    _log(db, seed, "하은이가")
    _alias(db, seed, "하은", verified=False)

    assert _unresolved(seed) == ["하은이가"]


def test_manual_one_letter_alias_removes_the_row_from_unresolved(db, seed):
    # 표기가 딱 한 글자인 행도 PM 이 별칭을 등록하면 목록에서 빠진다(#463 리뷰)
    _log(db, seed, "환")
    _log(db, seed, "환이가")
    assert sorted(_unresolved(seed)) == ["환", "환이가"]

    _alias(db, seed, "환", verified=True)

    assert _unresolved(seed) == []
