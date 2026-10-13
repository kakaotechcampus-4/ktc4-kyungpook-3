"""추출 조회의 approval_status — 수정 항목은 승인 전에도 task_id가 있어서 반영 여부를 승인 상태로 가린다(#211).

추출 등록 → 승인·반려·충돌 → 추출 조회 순서를 API로 그대로 밟는다.
"""
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import (
    Meeting,
    Member,
    MemberAlias,
    Session as SessionModel,
    Task,
    User,
    Workspace,
)

SERVICE_TOKEN = "test-service-token"
SERVICE_HEADERS = {"X-Service-Token": SERVICE_TOKEN}


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def db(engine):
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
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()

    expires = datetime.now(timezone.utc) + timedelta(days=1)
    pm_user = User(email="pm@example.com", name="pm")
    member_user = User(email="member@example.com", name="member")
    db.add_all([pm_user, member_user])
    db.flush()
    db.add_all([
        SessionModel(user_id=pm_user.user_id, session_token="pm-token", expires_at=expires),
        SessionModel(user_id=member_user.user_id, session_token="member-token", expires_at=expires),
    ])
    pm = Member(workspace_id=ws.workspace_id, user_id=pm_user.user_id, display_name="PM", role="pm")
    jimin = Member(
        workspace_id=ws.workspace_id, user_id=member_user.user_id, display_name="지민", role="member"
    )
    db.add_all([pm, jimin])
    db.flush()
    db.add(MemberAlias(
        member_id=jimin.member_id, workspace_id=ws.workspace_id, alias_text="지민님",
        alias_type="nickname", source="manual", confidence=1.0, verified=True,
    ))

    login = Task(workspace_id=ws.workspace_id, title="로그인 화면 시안", status="in_progress",
                 due_date=date(2026, 10, 3))
    meeting = Meeting(workspace_id=ws.workspace_id, status="processing")
    db.add_all([login, meeting])
    db.commit()
    return {"ws": ws, "pm": pm, "jimin": jimin, "login": login, "meeting": meeting}


@pytest.fixture
def client(seed, monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c


def _extract(client, seed, items: list[dict]) -> str:
    r = client.post("/api/v1/extractions", json={
        "meeting_id": seed["meeting"].meeting_id,
        "workspace_id": seed["ws"].workspace_id,
        "items": items,
    }, headers=SERVICE_HEADERS)
    assert r.status_code == 201, r.text
    return r.json()["data"]["extraction_id"]


def _update(seed, **fields) -> dict:
    return {"action": "update", "target_task_id": seed["login"].task_id, **fields}


def _create(title: str, task_confidence: float, **fields) -> dict:
    return {"task_title": title, "task_confidence": task_confidence, "due_confidence": 0.0, **fields}


def _items(client, extraction_id: str) -> list[dict]:
    r = client.get(f"/api/v1/extractions/{extraction_id}")
    assert r.status_code == 200, r.text
    return r.json()["data"]["items"]


def _only_item(client, extraction_id: str) -> dict:
    [item] = _items(client, extraction_id)
    return item


def _resolve(client, approval_id: str, status: str):
    return client.patch(f"/api/v1/approvals/{approval_id}", json={"status": status})


def _login(db, seed) -> Task:
    db.expire_all()
    return db.get(Task, seed["login"].task_id)


def test_pending_update_has_target_task_and_pending_status(client, db, seed):
    item = _only_item(client, _extract(client, seed, [_update(seed, due_date="2026-10-06")]))

    assert item["task_id"] == seed["login"].task_id
    assert item["approval_id"] is not None
    assert item["approval_status"] == "pending"
    assert _login(db, seed).due_date == date(2026, 10, 3)


def test_approved_update_is_applied(client, db, seed):
    extraction_id = _extract(client, seed, [_update(seed, due_date="2026-10-06")])
    approval_id = _only_item(client, extraction_id)["approval_id"]

    assert _resolve(client, approval_id, "approved").status_code == 200

    item = _only_item(client, extraction_id)
    assert (item["task_id"], item["approval_id"]) == (seed["login"].task_id, approval_id)
    assert item["approval_status"] == "approved"
    assert _login(db, seed).due_date == date(2026, 10, 6)


def test_rejected_update_is_not_applied(client, db, seed):
    extraction_id = _extract(client, seed, [_update(seed, due_date="2026-10-06")])
    approval_id = _only_item(client, extraction_id)["approval_id"]

    assert _resolve(client, approval_id, "rejected").status_code == 200

    item = _only_item(client, extraction_id)
    assert (item["task_id"], item["approval_id"]) == (seed["login"].task_id, approval_id)
    assert item["approval_status"] == "rejected"
    assert _login(db, seed).due_date == date(2026, 10, 3)


def test_conflicting_approval_stays_pending(client, db, seed):
    extraction_id = _extract(client, seed, [_update(seed, due_date="2026-10-06")])
    approval_id = _only_item(client, extraction_id)["approval_id"]
    r = client.patch(f"/api/v1/tasks/{seed['login'].task_id}", json={"due_date": "2026-10-10"})
    assert r.status_code == 200, r.text

    assert _resolve(client, approval_id, "approved").status_code == 409

    assert _only_item(client, extraction_id)["approval_status"] == "pending"
    assert _login(db, seed).due_date == date(2026, 10, 10)


def test_create_items_keep_their_meaning(client, db, seed):
    extraction_id = _extract(client, seed, [
        _create("결제 환불 기능 구현", 1.0, assignee_type="thirdname", assignee_raw="지민님"),
        _create("디자인 검토", 0.6),
        _create("배포 점검", 0.6),
    ])
    items = {i["task"]["title"]: i for i in _items(client, extraction_id)}

    auto = items["결제 환불 기능 구현"]
    assert auto["gate"] == "auto"
    assert auto["task_id"] is not None
    assert (auto["approval_id"], auto["approval_status"]) == (None, None)
    for title in ("디자인 검토", "배포 점검"):
        assert (items[title]["task_id"], items[title]["approval_status"]) == (None, "pending")

    assert _resolve(client, items["디자인 검토"]["approval_id"], "approved").status_code == 200
    assert _resolve(client, items["배포 점검"]["approval_id"], "rejected").status_code == 200

    items = {i["task"]["title"]: i for i in _items(client, extraction_id)}
    approved = items["디자인 검토"]
    assert approved["task_id"] is not None
    assert approved["approval_status"] == "approved"
    rejected = items["배포 점검"]
    assert (rejected["task_id"], rejected["approval_status"]) == (None, "rejected")


def test_update_without_change_has_target_task_and_null_status(client, db, seed):
    """바뀔 값이 없는 수정안은 승인 요청을 만들지 않는다. 대상 task만 이어지고 approval_status는 null이다."""
    item = _only_item(client, _extract(client, seed, [_update(seed, due_date="2026-10-03")]))

    assert item["task_id"] == seed["login"].task_id
    assert (item["approval_id"], item["approval_status"]) == (None, None)
    assert _login(db, seed).version == 1


def test_member_sees_the_same_status(client, db, seed):
    extraction_id = _extract(client, seed, [_update(seed, due_date="2026-10-06")])
    client.cookies.set("session_token", "member-token")

    item = _only_item(client, extraction_id)

    assert item["approval_status"] == "pending"


def test_statuses_are_read_in_one_query(client, db, seed, engine):
    extraction_id = _extract(client, seed, [
        _update(seed, due_date="2026-10-06"),
        _create("디자인 검토", 0.6),
        _create("배포 점검", 0.6),
    ])
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        items = _items(client, extraction_id)
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert [i["approval_status"] for i in items] == ["pending"] * 3
    approval_reads = [s for s in statements if "FROM approval_request" in s]
    assert len(approval_reads) == 1
