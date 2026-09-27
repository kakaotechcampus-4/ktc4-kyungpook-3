"""POST /extractions — AI Terra 2단계 판단 결과(action=create/update) 접수."""
import json
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import (
    ApprovalRequest,
    ExtractionItem,
    Meeting,
    Member,
    MemberAlias,
    Session as SessionModel,
    Task,
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
def client(db):
    return TestClient(app, base_url="https://testserver")


def _member(db, ws: Workspace, name: str, aliases: list[str], user_id: str | None = None) -> Member:
    member = Member(workspace_id=ws.workspace_id, display_name=name, user_id=user_id, role="pm")
    db.add(member)
    db.flush()
    for alias in aliases:
        db.add(MemberAlias(
            member_id=member.member_id, workspace_id=ws.workspace_id, alias_text=alias,
            alias_type="nickname", source="manual", confidence=1.0, verified=True,
        ))
    return member


@pytest.fixture
def seed(db):
    ws = Workspace(name="A")
    other_ws = Workspace(name="B")
    db.add_all([ws, other_ws])
    db.flush()

    pm_user = User(email="pm@example.com", name="pm")
    db.add(pm_user)
    db.flush()
    db.add(SessionModel(
        user_id=pm_user.user_id, session_token="pm-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))

    pm = _member(db, ws, "PM", [], user_id=pm_user.user_id)
    jimin = _member(db, ws, "지민", ["지민님"])
    # "민수님"은 두 명이라 담당자가 하나로 정해지지 않는다
    _member(db, ws, "김민수", ["민수님"])
    _member(db, ws, "이민수", ["민수님"])

    login = Task(workspace_id=ws.workspace_id, title="로그인 화면 시안", status="in_progress",
                 due_date=date(2026, 9, 28))
    search = Task(workspace_id=ws.workspace_id, title="검색 성능 개선", status="in_progress")
    foreign = Task(workspace_id=other_ws.workspace_id, title="다른 팀 task", status="todo")
    meeting = Meeting(workspace_id=ws.workspace_id, status="processing")
    db.add_all([login, search, foreign, meeting])
    db.commit()
    return {
        "ws": ws, "pm": pm, "jimin": jimin, "login": login, "search": search,
        "foreign": foreign, "meeting": meeting,
    }


def _post(client, seed, items: list[dict]):
    return client.post("/api/v1/extractions", json={
        "meeting_id": seed["meeting"].meeting_id,
        "workspace_id": seed["ws"].workspace_id,
        "items": items,
    })


def _approvals(db, type_: str) -> list[ApprovalRequest]:
    return db.execute(select(ApprovalRequest).where(ApprovalRequest.type == type_)).scalars().all()


def _payload(approval: ApprovalRequest) -> dict:
    return json.loads(approval.payload)


def _update(target: Task, **fields) -> dict:
    return {"action": "update", "target_task_id": target.task_id, **fields}


def test_item_without_action_is_handled_as_create(client, db, seed):
    """지금 봇은 action 없이 보낸다. 예전과 똑같이 새 task 경로를 탄다."""
    r = _post(client, seed, [
        {"task_title": "결제 환불 기능 구현", "task_confidence": 0.95, "assignee_raw": "지민님",
         "assignee_type": "thirdname"},
        {"task_title": "디자인 검토", "task_confidence": 0.6},
    ])

    assert r.status_code == 201
    assert r.json()["data"]["item_count"] == 2
    auto = db.execute(select(Task).where(Task.title == "결제 환불 기능 구현")).scalar_one()
    assert auto.assignee_member_id == seed["jimin"].member_id
    [approval] = _approvals(db, "task_create")
    assert _payload(approval)["task_title"] == "디자인 검토"
    assert {i.action for i in db.execute(select(ExtractionItem)).scalars()} == {"create"}


def test_create_item_keeps_judge_fields(client, db, seed):
    r = _post(client, seed, [{
        "action": "create", "task_title": "결제 환불 기능 구현", "task_confidence": 0.6,
        "category": "decision", "status": "in_progress",
        "doc_text": "결제 환불 기능을 지민님이 10/5까지 구현하기로 함",
    }])

    assert r.status_code == 201
    [approval] = _approvals(db, "task_create")
    payload = _payload(approval)
    assert payload["doc_text"] == "결제 환불 기능을 지민님이 10/5까지 구현하기로 함"
    assert payload["category"] == "decision"
    assert payload["status"] == "in_progress"
    item = db.execute(select(ExtractionItem)).scalar_one()
    assert (item.category, item.status, item.doc_text) == (
        "decision", "in_progress", "결제 환불 기능을 지민님이 10/5까지 구현하기로 함"
    )


def test_update_creates_task_update_approval_instead_of_new_task(client, db, seed):
    login = seed["login"]
    r = _post(client, seed, [_update(
        login, category="schedule", due_date="2026-09-30", due_raw="화요일",
        task_confidence=0.99, doc_text="로그인 화면 시안 마감 9/28 → 9/30 연기",
        evidence_quote="네, 알겠습니다.", evidence_speaker="discord_uid_haeun",
    )])

    assert r.status_code == 201
    assert r.json()["data"]["item_count"] == 1
    # 신뢰도가 높아도 새 task를 만들거나 바로 반영하지 않는다
    assert db.query(Task).count() == 3
    db.refresh(login)
    assert login.due_date == date(2026, 9, 28)

    [approval] = _approvals(db, "task_update")
    assert approval.related_task_id == login.task_id
    payload = _payload(approval)
    assert payload["due_date"] == "2026-09-30"
    assert payload["task_title"] == "로그인 화면 시안"
    assert payload["doc_text"] == "로그인 화면 시안 마감 9/28 → 9/30 연기"
    assert payload["evidence_quote"] == "네, 알겠습니다."
    # 제목·상태·담당자는 들어오지 않았으니 변경안에 없다
    assert {"title", "status", "assignee_member_id"}.isdisjoint(payload)

    item = db.execute(select(ExtractionItem)).scalar_one()
    assert item.action == "update"
    assert item.task_title == "로그인 화면 시안"
    assert item.task_id == login.task_id
    assert item.approval_id == approval.approval_id
    assert item.gate == "review"


def test_update_only_includes_values_that_differ(client, db, seed):
    search = seed["search"]
    r = _post(client, seed, [_update(search, status="done", doc_text="검색 성능 개선 작업 완료")])

    assert r.status_code == 201
    payload = _payload(_approvals(db, "task_update")[0])
    assert payload["status"] == "done"
    assert "due_date" not in payload


def test_update_without_changes_still_requests_approval(client, db, seed):
    """이미 반영된 값만 왔어도 결정(doc_text, 근거)이 사라지지 않게 승인 요청은 만든다."""
    login = seed["login"]
    r = _post(client, seed, [_update(login, due_date="2026-09-28", status="in_progress",
                                     doc_text="로그인 시안 마감 재확인")])

    assert r.status_code == 201
    [approval] = _approvals(db, "task_update")
    payload = _payload(approval)
    assert {"due_date", "status", "assignee_member_id"}.isdisjoint(payload)
    assert payload["doc_text"] == "로그인 시안 마감 재확인"


def test_update_ignores_task_title_even_if_sent(client, db, seed):
    login = seed["login"]
    r = _post(client, seed, [_update(login, task_title="로그인 시안 마감 연기", due_date="2026-09-30")])

    assert r.status_code == 201
    payload = _payload(_approvals(db, "task_update")[0])
    assert "title" not in payload
    assert payload["task_title"] == "로그인 화면 시안"


def test_update_with_resolved_assignee_proposes_member(client, db, seed):
    r = _post(client, seed, [_update(seed["search"], assignee_raw="지민님", assignee_type="thirdname")])

    assert r.status_code == 201
    payload = _payload(_approvals(db, "task_update")[0])
    assert payload["assignee_member_id"] == seed["jimin"].member_id
    assert payload["assignee_needs_check"] is False


@pytest.mark.parametrize("raw", ["민수님", "없는사람"], ids=["ambiguous", "not-found"])
def test_update_with_unresolved_assignee_keeps_raw_text_only(client, db, seed, raw):
    r = _post(client, seed, [_update(seed["search"], assignee_raw=raw, assignee_type="thirdname",
                                     doc_text=f"검색 성능 개선을 {raw}이 맡기로 함")])

    assert r.status_code == 201
    [approval] = _approvals(db, "task_update")
    payload = _payload(approval)
    assert "assignee_member_id" not in payload
    assert payload["assignee_raw"] == raw
    assert payload["assignee_needs_check"] is True


@pytest.mark.parametrize("target_key", ["missing", "foreign"])
def test_invalid_target_skips_only_that_item(client, db, seed, target_key):
    target_id = "no-such-task" if target_key == "missing" else seed["foreign"].task_id
    r = _post(client, seed, [
        {"action": "update", "target_task_id": target_id, "due_date": "2026-10-01"},
        {"action": "create", "task_title": "결제 환불 기능 구현", "task_confidence": 0.6},
        _update(seed["search"], status="done"),
    ])

    assert r.status_code == 201
    assert r.json()["data"]["item_count"] == 2
    assert len(_approvals(db, "task_create")) == 1
    [update_approval] = _approvals(db, "task_update")
    assert update_approval.related_task_id == seed["search"].task_id
    db.refresh(seed["meeting"])
    assert seed["meeting"].status == "done"


@pytest.mark.parametrize(
    "item",
    [
        {"action": "update", "due_date": "2026-10-01"},
        {"action": "create", "due_date": "2026-10-01"},
        {"action": "delete", "task_title": "무언가"},
    ],
    ids=["update-without-target", "create-without-title", "unknown-action"],
)
def test_malformed_item_is_400(client, db, seed, item):
    r = _post(client, seed, [item])

    assert r.status_code == 400
    db.refresh(seed["meeting"])
    assert seed["meeting"].status == "processing"


def test_approving_update_applies_only_proposed_changes(client, db, seed):
    login = seed["login"]
    _post(client, seed, [_update(login, due_date="2026-09-30", task_title="엉뚱한 제목",
                                 assignee_raw="지민님", assignee_type="thirdname")])
    [approval] = _approvals(db, "task_update")

    client.cookies.set("session_token", "pm-token")
    r = client.patch(
        f"/api/v1/approvals/{approval.approval_id}",
        json={"status": "approved", "resolved_by": seed["pm"].member_id},
    )

    assert r.status_code == 200, r.text
    db.refresh(login)
    assert login.due_date == date(2026, 9, 30)
    assert login.assignee_member_id == seed["jimin"].member_id
    assert login.title == "로그인 화면 시안"
