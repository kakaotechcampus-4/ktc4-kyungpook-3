"""범위 변경(category=scope) 승인을 태스크 이력에 남기는지 API로 확인한다(#205)."""
import os
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import (
    Meeting,
    Member,
    NotionSyncJob,
    Session as SessionModel,
    Task,
    TaskHistory,
    User,
    Workspace,
)
from app.services.sessions import hash_session_token

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
SENTENCE = "소셜 로그인은 이번 범위에서 뺀다"


def _sqlite_engine():
    return create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )


def _pg_engine():
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.drop_all(engine)
    return engine


@pytest.fixture(
    params=[
        "sqlite",
        pytest.param(
            "postgresql",
            marks=pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없습니다."),
        ),
    ]
)
def db(request):
    engine = _pg_engine() if request.param == "postgresql" else _sqlite_engine()
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
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture
def seed(db):
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    pm_user = User(email="pm@example.com", name="pm")
    db.add(pm_user)
    db.flush()
    db.add(SessionModel(
        user_id=pm_user.user_id, session_token=hash_session_token("pm-token"),
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    pm = Member(workspace_id=ws.workspace_id, user_id=pm_user.user_id, display_name="PM", role="pm")
    db.add(pm)
    db.flush()
    login = Task(workspace_id=ws.workspace_id, title="로그인 화면 시안", status="in_progress",
                 due_date=date(2026, 10, 3))
    meeting = Meeting(workspace_id=ws.workspace_id, status="processing", source="discord")
    chat_meeting = Meeting(workspace_id=ws.workspace_id, status="processing", source="chat")
    db.add_all([login, meeting, chat_meeting])
    db.commit()
    return {"ws": ws, "pm": pm, "login": login, "meeting": meeting, "chat_meeting": chat_meeting}


@pytest.fixture
def client(seed):
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c


def _approval(client, seed, payload) -> str:
    r = client.post("/api/v1/approvals", json={
        "workspace_id": seed["ws"].workspace_id, "type": "task_update", "payload": payload,
        "related_task_id": seed["login"].task_id,
    })
    assert r.status_code == 201, r.text
    return r.json()["data"]["approval_id"]


def _resolve(client, approval_id, status="approved", **extra):
    return client.patch(f"/api/v1/approvals/{approval_id}", json={"status": status, **extra})


def _history(db, seed) -> list[TaskHistory]:
    db.expire_all()
    return list(db.execute(
        select(TaskHistory).where(TaskHistory.task_id == seed["login"].task_id).order_by(TaskHistory.created_at)
    ).scalars())


def _scope_rows(db, seed) -> list[TaskHistory]:
    return [h for h in _history(db, seed) if h.changed_field == "scope"]


def _task(db, seed) -> Task:
    db.expire_all()
    return db.get(Task, seed["login"].task_id)


def _sync_jobs(db) -> int:
    db.expire_all()
    return len(db.execute(select(NotionSyncJob)).scalars().all())


def _scope_payload(seed, **changes) -> dict:
    return {"category": "scope", "doc_text": SENTENCE, "meeting_id": seed["meeting"].meeting_id, **changes}


def test_scope_only_approval_logs_scope_history(client, db, seed):
    approval_id = _approval(client, seed, _scope_payload(seed))

    assert _resolve(client, approval_id).status_code == 200

    [row] = _history(db, seed)
    assert row.changed_field == "scope"
    assert row.old_value is None
    assert row.new_value == SENTENCE
    assert row.change_source == "meeting"
    assert row.changed_by == seed["pm"].member_id
    assert _task(db, seed).version == 1
    assert _sync_jobs(db) == 0


def test_scope_with_due_date_logs_both(client, db, seed):
    approval_id = _approval(client, seed, _scope_payload(seed, due_date="2026-10-20"))

    assert _resolve(client, approval_id).status_code == 200

    assert sorted(h.changed_field for h in _history(db, seed)) == ["due_date", "scope"]
    assert _task(db, seed).version == 2


def test_scope_with_pm_override_keeps_scope_source_from_proposal(client, db, seed):
    approval_id = _approval(client, seed, _scope_payload(seed, due_date="2026-10-20"))

    r = _resolve(client, approval_id, task_overrides={"due_date": "2026-10-25"})

    assert r.status_code == 200, r.text
    by_field = {h.changed_field: h for h in _history(db, seed)}
    assert by_field["due_date"].new_value == "2026-10-25"
    assert by_field["due_date"].change_source == "manual"
    assert by_field["scope"].change_source == "meeting"


def test_scope_on_chat_meeting_uses_chat_source(client, db, seed):
    payload = _scope_payload(seed, meeting_id=seed["chat_meeting"].meeting_id)
    approval_id = _approval(client, seed, payload)

    assert _resolve(client, approval_id).status_code == 200

    [row] = _scope_rows(db, seed)
    assert row.change_source == "chat"


@pytest.mark.parametrize("doc_text", [None, "", "   ", 123, "missing"])
def test_scope_blank_doc_text_logs_null(client, db, seed, doc_text):
    payload = _scope_payload(seed)
    if doc_text == "missing":
        del payload["doc_text"]
    else:
        payload["doc_text"] = doc_text
    approval_id = _approval(client, seed, payload)

    r = _resolve(client, approval_id)

    assert r.status_code == 200, r.text
    [row] = _scope_rows(db, seed)
    assert row.new_value is None


def test_scope_doc_text_is_stripped(client, db, seed):
    approval_id = _approval(client, seed, _scope_payload(seed, doc_text="  문장  "))

    assert _resolve(client, approval_id).status_code == 200

    [row] = _scope_rows(db, seed)
    assert row.new_value == "문장"


def test_rejected_scope_logs_nothing(client, db, seed):
    approval_id = _approval(client, seed, _scope_payload(seed))

    assert _resolve(client, approval_id, "rejected").status_code == 200

    assert _history(db, seed) == []


def test_scope_conflict_logs_nothing_then_confirm_logs(client, db, seed):
    approval_id = _approval(client, seed, _scope_payload(seed, base_title="다른 제목"))

    r = _resolve(client, approval_id)

    assert r.status_code == 409
    assert r.json()["error"]["code"] == "APPROVAL_CONFLICT"
    assert _history(db, seed) == []
    version = r.json()["error"]["details"]["task_version"]

    r = _resolve(client, approval_id, confirm_task_version=version)

    assert r.status_code == 200, r.text
    assert len(_scope_rows(db, seed)) == 1


def test_non_scope_update_has_no_scope_history(client, db, seed):
    payload = {"category": "schedule", "doc_text": "일정 변경", "due_date": "2026-10-20",
               "meeting_id": seed["meeting"].meeting_id}
    approval_id = _approval(client, seed, payload)

    assert _resolve(client, approval_id).status_code == 200

    assert [h.changed_field for h in _history(db, seed)] == ["due_date"]


def test_scope_history_rollback_is_rejected(client, db, seed):
    approval_id = _approval(client, seed, _scope_payload(seed))
    assert _resolve(client, approval_id).status_code == 200
    [row] = _scope_rows(db, seed)

    r = client.post(f"/api/v1/tasks/{seed['login'].task_id}/history/{row.history_id}/rollback")

    assert r.status_code == 400
    error = r.json()["error"]
    assert error["code"] == "INVALID_REQUEST"
    assert error["message"] == "되돌릴 수 없는 변경 항목입니다."
    assert len(_history(db, seed)) == 1
    assert _task(db, seed).version == 1


def test_scope_history_in_history_api(client, db, seed):
    approval_id = _approval(client, seed, _scope_payload(seed))
    assert _resolve(client, approval_id).status_code == 200

    r = client.get(f"/api/v1/tasks/{seed['login'].task_id}/history")

    items = r.json()["data"]["items"]
    assert [(i["changed_field"], i["new_value"]) for i in items] == [("scope", SENTENCE)]
