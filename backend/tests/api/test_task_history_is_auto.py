"""task 이력 응답의 is_auto는 저장값이 아니라 changed_by로 계산하고, 별칭 로그는 근거 문장 없이 남는다."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.services.matching import MatchResult, log_resolution
from app.services.tasks import create_task
from app.models import (
    ChangeSource,
    Member,
    Session as SessionModel,
    AliasResolutionLog,
    ResolutionResult,
    User,
    Workspace,
)


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


@pytest.fixture
def seed(db):
    """워크스페이스에 로그인한 PM(alice)과 다른 멤버(carol)가 있다."""
    alice = User(email="alice@example.com", name="alice")
    db.add(alice)
    db.flush()
    db.add(SessionModel(
        user_id=alice.user_id,
        session_token="alice-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))

    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    pm = Member(workspace_id=ws.workspace_id, user_id=alice.user_id, display_name="alice", role="pm")
    other = Member(workspace_id=ws.workspace_id, display_name="carol", role="member")
    db.add_all([pm, other])
    db.commit()
    return {"ws": ws.workspace_id, "pm": pm.member_id, "other": other.member_id}


@pytest.fixture
def client(db):
    return TestClient(app, cookies={"session_token": "alice-token"})


def _history(client, task_id):
    return client.get(f"/api/v1/tasks/{task_id}/history").json()["data"]["items"]


def test_history_is_auto_follows_changed_by(db, seed, client):
    # 자동 반영은 변경자가 없다
    task = create_task(
        db, workspace_id=seed["ws"], title="자동", change_source=str(ChangeSource.MEETING), changed_by=None
    )
    db.commit()
    [auto] = _history(client, task.task_id)
    assert (auto["changed_by"], auto["is_auto"]) == (None, True)

    # 수동 수정은 로그인 멤버가 기록된다
    client.patch(f"/api/v1/tasks/{task.task_id}", json={"title": "수동"})
    items = _history(client, task.task_id)
    assert len(items) == 2
    manual = next(i for i in items if i["changed_by"])
    assert (manual["changed_by"], manual["is_auto"]) == (seed["pm"], False)


def test_log_resolution_records_without_evidence_quote_column(db, seed):
    log = log_resolution(
        db, seed["ws"], "민수님", MatchResult(
            member_id=None, display_name=None, confidence=0.0, result=ResolutionResult.NOT_FOUND,
            needs_check=True, candidate_count=0,
        ),
    )
    db.commit()
    saved = db.execute(select(AliasResolutionLog)).scalar_one()
    assert saved.log_id == log.log_id
    assert (saved.alias_text, saved.source_id) == ("민수님", None)
    assert not hasattr(AliasResolutionLog, "evidence_quote")
