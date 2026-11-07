"""POST /extractions 의 merge 항목 — 승인 대기 task_create 카드에 합치기(#141 PR 2).

합칠 수 있으면 새 카드·task 없이 대상 카드 payload 만 바뀌고, 쓸 수 없는 대상이면 create 로 처리하되 auto 로 보내지 않는다.
"""
import json
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import (
    EMBEDDING_DIMENSIONS,
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
from app.services.sessions import hash_session_token

# 임베딩 워커가 이미 채운 task. 임베딩이 없는 task가 있으면 auto로 보내지 않으므로 시드 task에 넣는다
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
    other_ws = Workspace(name="B")
    db.add_all([ws, other_ws])
    db.flush()

    expires = datetime.now(timezone.utc) + timedelta(days=1)
    pm_user = User(email="pm@example.com", name="pm")
    db.add(pm_user)
    db.flush()
    db.add(SessionModel(user_id=pm_user.user_id, session_token=hash_session_token("pm-token"), expires_at=expires))
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

    login = Task(workspace_id=ws.workspace_id, title="로그인 화면 시안", status="in_progress",
                 due_date=date(2026, 10, 3), embedding=EMBEDDED)
    meetings = [Meeting(workspace_id=ws.workspace_id, status="processing") for _ in range(3)]
    db.add_all([login, *meetings])
    db.commit()
    return {"ws": ws, "other_ws": other_ws, "jimin": jimin, "sua": sua, "meetings": meetings}


@pytest.fixture
def client(seed, monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c


def _judge(**fields) -> dict:
    """auto 조건을 모두 만족하는 judge 항목. 바꿀 필드만 넘긴다."""
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
    """첫 회의에서 review 카드 하나를 만들어 approval_id 를 돌려준다(유사 task 가 있어 auto 가 아니다)."""
    _extract(client, seed, 0, [_judge(similar_count=1, top_similarity=0.8)])
    [card] = db.execute(select(ApprovalRequest)).scalars().all()
    assert json.loads(card.payload)["gate"] == "review"
    return card.approval_id


def _merge_item(card_id: str | None, **fields) -> dict:
    values = {"action": "merge", "target_approval_id": card_id, "category": "due", "due_date": "2026-10-25", **fields}
    return _judge(**values)


def _items(db, meeting_id: str) -> list[ExtractionItem]:
    from app.models import Extraction

    return list(db.execute(
        select(ExtractionItem)
        .join(Extraction, Extraction.extraction_id == ExtractionItem.extraction_id)
        .where(Extraction.meeting_id == meeting_id)
        .order_by(ExtractionItem.created_at)
    ).scalars().all())


def _card_payload(db, card_id: str) -> dict:
    db.expire_all()
    return json.loads(db.get(ApprovalRequest, card_id).payload)


def _count(db, model) -> int:
    return db.execute(select(func.count()).select_from(model)).scalar_one()


# --- 합쳐지는 경우 ---


def test_merge_into_pending_adds_no_card_and_links_item(client, db, seed):
    card_id = _pending_card(client, db, seed)
    cards_before, tasks_before = _count(db, ApprovalRequest), _count(db, Task)

    data = _extract(client, seed, 1, [_merge_item(card_id)])

    assert data["item_count"] == 1
    assert _count(db, ApprovalRequest) == cards_before
    assert _count(db, Task) == tasks_before
    [item] = _items(db, seed["meetings"][1].meeting_id)
    assert item.action == "merge"
    assert item.approval_id == card_id
    assert item.task_id is None
    assert item.gate == "review"
    payload = _card_payload(db, card_id)
    assert payload["due_date"] == "2026-10-25"
    assert [m["extraction_item_id"] for m in payload["merged_items"]] == [item.item_id]
    assert payload["merged_items"][0]["meeting_id"] == seed["meetings"][1].meeting_id
    # 대표 근거와 제목은 첫 회의 것 그대로
    assert payload["task_title"] == "결제 API 연동"
    assert payload["meeting_id"] == seed["meetings"][0].meeting_id


def test_merged_item_never_goes_auto_even_when_judge_conditions_all_hold(client, db, seed):
    card_id = _pending_card(client, db, seed)

    _extract(client, seed, 1, [_merge_item(card_id)])

    [item] = _items(db, seed["meetings"][1].meeting_id)
    assert item.gate != "auto"


def test_merge_keeps_card_embedding(client, db, seed):
    card_id = _pending_card(client, db, seed)
    db.get(ApprovalRequest, card_id).embedding = EMBEDDED
    db.commit()

    _extract(client, seed, 1, [_merge_item(card_id)])

    db.expire_all()
    assert list(db.get(ApprovalRequest, card_id).embedding) == EMBEDDED


def test_merge_item_with_empty_title_is_skipped(client, db, seed):
    card_id = _pending_card(client, db, seed)

    data = _extract(client, seed, 1, [_merge_item(card_id, task_title="  ")])

    assert data["item_count"] == 0
    assert "merged_items" not in _card_payload(db, card_id)


def test_assignee_category_merge_overwrites_card_assignee(client, db, seed):
    card_id = _pending_card(client, db, seed)

    _extract(client, seed, 1, [_merge_item(card_id, category="assignee", assignee_raw="수아님")])

    [item] = _items(db, seed["meetings"][1].meeting_id)
    payload = _card_payload(db, card_id)
    assert payload["assignee_member_id"] == seed["sua"].member_id
    assert payload["assignee_item_id"] == item.item_id


def test_two_merges_into_same_card_in_one_request_apply_in_order(client, db, seed):
    card_id = _pending_card(client, db, seed)

    data = _extract(client, seed, 1, [
        _merge_item(card_id, due_date="2026-10-25", doc_text="첫 설명"),
        _merge_item(card_id, due_date="2026-10-28", doc_text="둘째 설명"),
    ])

    assert data["item_count"] == 2
    payload = _card_payload(db, card_id)
    assert payload["due_date"] == "2026-10-28"
    assert len(payload["merged_items"]) == 2
    assert payload["doc_text"].endswith("첫 설명 / 둘째 설명")


def test_update_create_and_merge_in_one_request(client, db, seed):
    card_id = _pending_card(client, db, seed)
    login = db.execute(select(Task).where(Task.title == "로그인 화면 시안")).scalar_one()

    data = _extract(client, seed, 1, [
        {
            "action": "update", "target_task_id": login.task_id, "task_title": "로그인 화면 시안",
            "assignee_type": "none", "due_date": "2026-10-09", "evidence_quote": "로그인 시안 10일로",
        },
        _judge(task_title="다른 일", similar_count=1, top_similarity=0.5),
        _merge_item(card_id),
    ])

    assert data["item_count"] == 3
    actions = [i.action for i in _items(db, seed["meetings"][1].meeting_id)]
    assert sorted(actions) == ["create", "merge", "update"]
    # 카드는 처음 것 + update 요청 + create 새 카드
    assert len(_card_payload(db, card_id)["merged_items"]) == 1


def test_idempotent_resend_does_not_merge_again(client, db, seed):
    card_id = _pending_card(client, db, seed)
    first = _extract(client, seed, 1, [_merge_item(card_id)])

    second = _extract(client, seed, 1, [_merge_item(card_id)])

    assert second == first
    assert len(_card_payload(db, card_id)["merged_items"]) == 1
    assert len(_items(db, seed["meetings"][1].meeting_id)) == 1


def test_extraction_view_shows_same_approval_status_for_both_meetings(client, db, seed):
    card_id = _pending_card(client, db, seed)
    first = _items(db, seed["meetings"][0].meeting_id)
    extraction_ids = [_extract(client, seed, 1, [_merge_item(card_id)])["extraction_id"]]
    db.expire_all()
    [first_extraction_id] = {i.extraction_id for i in first}

    statuses = []
    for extraction_id in (first_extraction_id, *extraction_ids):
        r = client.get(f"/api/v1/extractions/{extraction_id}")
        assert r.status_code == 200, r.text
        [item] = r.json()["data"]["items"]
        assert item["approval_id"] == card_id
        statuses.append(item["approval_status"])
    assert statuses == ["pending", "pending"]


# --- 합칠 수 없는 대상 ---


def _unavailable_target(reason: str, client, db, seed) -> str | None:
    card_id = _pending_card(client, db, seed)
    if reason == "missing":
        return None
    if reason == "not_found":
        return "no-such-approval"
    card = db.get(ApprovalRequest, card_id)
    if reason == "other_workspace":
        card.workspace_id = seed["other_ws"].workspace_id
    elif reason == "not_task_create":
        card.type = "task_update"
    elif reason == "not_pending":
        card.status = "approved"
    elif reason == "bad_payload":
        card.payload = json.dumps([1, 2])
    db.commit()
    return card_id


@pytest.mark.parametrize(
    "reason", ["missing", "not_found", "other_workspace", "not_task_create", "not_pending", "bad_payload"]
)
def test_unavailable_target_is_created_as_review_card_not_auto(reason, client, db, seed, caplog):
    target_id = _unavailable_target(reason, client, db, seed)
    cards_before, tasks_before = _count(db, ApprovalRequest), _count(db, Task)

    with caplog.at_level("INFO", logger="app.api.extractions"):
        data = _extract(client, seed, 1, [_merge_item(target_id)])

    assert data["item_count"] == 1
    [item] = _items(db, seed["meetings"][1].meeting_id)
    assert item.action == "create"
    assert item.gate == "review"
    assert item.task_id is None
    assert item.approval_id is not None and item.approval_id != target_id
    assert _count(db, ApprovalRequest) == cards_before + 1
    assert _count(db, Task) == tasks_before
    assert any("merge_target_unavailable" in m and reason in m for m in caplog.messages)


def test_unavailable_target_keeps_hold_gate(client, db, seed):
    _extract(client, seed, 1, [_merge_item("no-such-approval", assignee_raw="모르는사람")])

    [item] = _items(db, seed["meetings"][1].meeting_id)
    assert item.action == "create"
    assert item.gate == "hold"
