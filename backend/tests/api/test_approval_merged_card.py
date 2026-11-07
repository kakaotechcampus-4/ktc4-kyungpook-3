"""합쳐진 승인 대기 task_create 카드(#141 PR 2)를 승인·반려할 때의 동작.

합쳐진 항목은 action="merge", approval_id=카드, task_id=None 으로 저장된다. 승인하면 카드가 만든 task 를 그 항목들도
가리켜야 하고, task 는 합쳐진 최신 payload 값으로 만들어져야 한다.
"""
import json
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import approvals as approvals_api
from app.core.database import Base, get_db
from app.main import app
from app.models import (
    EMBEDDING_DIMENSIONS,
    ApprovalRequest,
    Extraction,
    ExtractionItem,
    Meeting,
    Member,
    MemberAlias,
    Session as SessionModel,
    Task,
    User,
    Workspace,
)
from app.services.sessions import hash_session_token

EMBEDDED = [0.1] * EMBEDDING_DIMENSIONS

SERVICE_TOKEN = "test-service-token"
SERVICE_HEADERS = {"X-Service-Token": SERVICE_TOKEN}


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
    jimin = Member(workspace_id=ws.workspace_id, display_name="지민", role="member")
    sua = Member(workspace_id=ws.workspace_id, display_name="수아", role="member")
    db.add_all([pm, jimin, sua])
    db.flush()
    for member, text in ((jimin, "지민님"), (sua, "수아님")):
        db.add(MemberAlias(
            member_id=member.member_id, workspace_id=ws.workspace_id, alias_text=text,
            alias_type="nickname", source="manual", confidence=1.0, verified=True,
        ))
    # 유사 task 가 있어야 첫 항목이 auto 가 아니라 review 카드가 된다
    db.add(Task(workspace_id=ws.workspace_id, title="로그인 화면 시안", status="in_progress",
                due_date=date(2026, 10, 3), embedding=EMBEDDED))
    meetings = [Meeting(workspace_id=ws.workspace_id, status="processing") for _ in range(3)]
    db.add_all(meetings)
    db.commit()
    return {"ws": ws, "jimin": jimin, "sua": sua, "meetings": meetings}


@pytest.fixture
def client(seed, monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c


def _judge(**fields) -> dict:
    return {
        "action": "create",
        "category": "decision",
        "task_title": "결제 API 연동",
        "doc_text": "결제 API 연동을 지민님이 10/20까지 하기로 함",
        "assignee_type": "thirdname",
        "assignee_raw": "지민님",
        "due_date": "2026-10-20",
        "evidence_quote": "지민님이 20일까지 결제 API 붙여 주세요",
        "evidence_speaker": "uid-pm",
        "task_status": "certain",
        "due_status": "certain",
        "similar_count": 0,
        "top_similarity": None,
        **fields,
    }


def _extract(client, seed, meeting_index: int, items: list[dict]) -> dict:
    r = client.post("/api/v1/extractions", json={
        "meeting_id": seed["meetings"][meeting_index].meeting_id,
        "workspace_id": seed["ws"].workspace_id,
        "items": items,
    }, headers=SERVICE_HEADERS)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _pending_card(client, db, seed) -> str:
    _extract(client, seed, 0, [_judge(similar_count=1, top_similarity=0.8)])
    [card] = db.execute(select(ApprovalRequest)).scalars().all()
    card.embedding = EMBEDDED
    db.commit()
    return card.approval_id


def _merge_item(card_id: str, **fields) -> dict:
    return _judge(**{"action": "merge", "target_approval_id": card_id, "category": "due",
                     "due_date": "2026-10-25", **fields})


def _items_of(db, card_id: str) -> list[ExtractionItem]:
    db.expire_all()
    return list(db.execute(
        select(ExtractionItem).where(ExtractionItem.approval_id == card_id).order_by(ExtractionItem.created_at)
    ).scalars().all())


def _patch(client, card_id: str, body: dict):
    return client.patch(f"/api/v1/approvals/{card_id}", json=body)


def _merged_card(client, db, seed) -> str:
    card_id = _pending_card(client, db, seed)
    _extract(client, seed, 1, [_merge_item(card_id)])
    return card_id


def test_approving_merged_card_links_task_to_every_item(client, db, seed):
    card_id = _merged_card(client, db, seed)

    r = _patch(client, card_id, {"status": "approved"})

    assert r.status_code == 200, r.text
    task_id = r.json()["data"]["related_task_id"]
    items = _items_of(db, card_id)
    assert sorted(i.action for i in items) == ["create", "merge"]
    assert [i.task_id for i in items] == [task_id, task_id]


def test_task_uses_merged_value_unless_pm_edits_it(client, db, seed):
    card_id = _merged_card(client, db, seed)

    r = _patch(client, card_id, {"status": "approved", "task_overrides": {"task_title": "PM 제목"}})

    assert r.status_code == 200, r.text
    task = db.get(Task, r.json()["data"]["related_task_id"])
    assert task.title == "PM 제목"
    # 고치지 않은 마감은 합친 값이다
    assert task.due_date == date(2026, 10, 25)


def test_pm_override_wins_over_merged_value(client, db, seed):
    card_id = _merged_card(client, db, seed)

    r = _patch(client, card_id, {"status": "approved", "task_overrides": {"due_date": "2026-11-02"}})

    assert r.status_code == 200, r.text
    assert db.get(Task, r.json()["data"]["related_task_id"]).due_date == date(2026, 11, 2)


def test_rejecting_merged_card_rejects_every_item(client, db, seed):
    card_id = _merged_card(client, db, seed)

    r = _patch(client, card_id, {"status": "rejected"})

    assert r.status_code == 200, r.text
    for meeting in seed["meetings"][:2]:
        extraction_id = db.execute(
            select(Extraction.extraction_id).where(Extraction.meeting_id == meeting.meeting_id)
        ).scalar_one()
        [item] = client.get(f"/api/v1/extractions/{extraction_id}").json()["data"]["items"]
        assert item["approval_status"] == "rejected"
    assert all(i.task_id is None for i in _items_of(db, card_id))


def test_approval_reads_payload_changed_after_the_pending_check(client, db, seed, monkeypatch):
    """조건부 UPDATE 뒤에는 DB 의 최신 payload 로 task 를 만든다.

    합치기가 승인 직전에 카드 payload 를 바꿔도 identity map 의 이전 값이 아니라 새 값을 써야 한다.
    승인 경로는 _normalize_overrides 이후에 UPDATE 를 하므로 거기서 payload 를 core UPDATE 로 바꿔 재현한다.
    """
    card_id = _pending_card(client, db, seed)
    original = approvals_api._normalize_overrides

    def normalize_then_merge_elsewhere(db_, approval, status, overrides):
        result = original(db_, approval, status, overrides)
        payload = json.loads(approval.payload)
        payload["due_date"] = "2026-12-24"
        # 테이블 단위 UPDATE 라 세션의 approval 객체는 이전 payload 를 그대로 가진다
        db_.execute(
            update(ApprovalRequest.__table__)
            .where(ApprovalRequest.__table__.c.approval_id == card_id)
            .values(payload=json.dumps(payload, ensure_ascii=False))
        )
        return result

    monkeypatch.setattr(approvals_api, "_normalize_overrides", normalize_then_merge_elsewhere)

    r = _patch(client, card_id, {"status": "approved"})

    assert r.status_code == 200, r.text
    assert db.get(Task, r.json()["data"]["related_task_id"]).due_date == date(2026, 12, 24)
