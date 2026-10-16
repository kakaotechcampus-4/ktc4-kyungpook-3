"""judge 새 항목의 auto 게이트와 auto로 만든 태스크 되돌리기(#232)."""
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


def _alias(db, ws: Workspace, member: Member, text: str, *, verified: bool = True) -> None:
    db.add(MemberAlias(
        member_id=member.member_id, workspace_id=ws.workspace_id, alias_text=text,
        alias_type="nickname", source="manual", confidence=1.0, verified=verified,
    ))


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
        workspace_id=ws.workspace_id, user_id=member_user.user_id, display_name="지민", role="member",
        discord_user_id="uid-jimin",
    )
    sua = Member(workspace_id=ws.workspace_id, display_name="수아", role="member")
    db.add_all([pm, jimin, sua])
    db.flush()
    _alias(db, ws, jimin, "지민님")
    # 검증하지 않은 별칭 — 한 명으로 찾아도 PM이 확인해야 한다
    _alias(db, ws, sua, "수아님", verified=False)

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


def _judge(**fields) -> dict:
    """auto 조건을 모두 만족하는 judge 새 항목. 바꿀 필드만 넘긴다."""
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


def _extract(client, seed, items: list[dict]) -> str:
    r = client.post("/api/v1/extractions", json={
        "meeting_id": seed["meeting"].meeting_id,
        "workspace_id": seed["ws"].workspace_id,
        "items": items,
    }, headers=SERVICE_HEADERS)
    assert r.status_code == 201, r.text
    return r.json()["data"]["extraction_id"]


def _only_item(client, extraction_id: str) -> dict:
    r = client.get(f"/api/v1/extractions/{extraction_id}")
    assert r.status_code == 200, r.text
    [item] = r.json()["data"]["items"]
    return item


def _gate(client, seed, **fields) -> str:
    return _only_item(client, _extract(client, seed, [_judge(**fields)]))["gate"]


def _revert(client, extraction_id: str, item_id: str):
    return client.post(f"/api/v1/extractions/{extraction_id}/items/{item_id}/revert")


def _auto_item(client, seed) -> tuple[str, dict]:
    extraction_id = _extract(client, seed, [_judge()])
    item = _only_item(client, extraction_id)
    assert item["gate"] == "auto"
    return extraction_id, item


def _approvals(db) -> list[ApprovalRequest]:
    db.expire_all()
    return db.execute(select(ApprovalRequest)).scalars().all()


# ── auto 게이트 ────────────────────────────────────────────────────────────


def test_judge_item_meeting_every_condition_is_created_automatically(client, db, seed):
    item = _only_item(client, _extract(client, seed, [_judge(top_similarity=None)]))

    assert item["gate"] == "auto"
    assert item["approval_id"] is None
    task = db.get(Task, item["task_id"])
    assert (task.title, task.assignee_member_id, task.due_date) == (
        "결제 API 연동", seed["jimin"].member_id, date(2026, 10, 20)
    )
    # PM 화면에서 판단 근거를 볼 수 있다
    assert item["task"]["evidence_status"] == "certain"
    assert item["due_date"]["evidence_status"] == "certain"
    assert (item["similar_count"], item["top_similarity"], item["reverted_at"]) == (0, None, None)


def test_judge_item_without_assignee_or_due_mention_is_auto(client, seed):
    gate = _gate(
        client, seed, assignee_type="none", assignee_raw=None, due_date=None, due_status="missing"
    )
    assert gate == "auto"


def test_first_person_assignee_resolved_by_speaker_is_auto(client, seed):
    gate = _gate(client, seed, assignee_type="first", assignee_raw=None, evidence_speaker="uid-jimin")
    assert gate == "auto"


@pytest.mark.parametrize(
    "fields",
    [
        pytest.param({"task_status": "inferred"}, id="task_inferred"),
        pytest.param({"due_status": "inferred"}, id="due_inferred"),
        pytest.param({"similar_count": 1, "top_similarity": 0.45}, id="similar_task_found"),
        # 이름은 한 명으로 찾았지만 AI가 대명사를 문맥으로 푼 것이다
        pytest.param({"assignee_type": "thirdpronoun"}, id="assignee_inferred"),
        pytest.param({"assignee_raw": "수아님"}, id="assignee_alias_unverified"),
        pytest.param({"due_status": "missing"}, id="due_missing_but_date_sent"),
        pytest.param({"due_date": None}, id="due_certain_but_no_date"),
    ],
)
def test_judge_item_failing_any_condition_goes_to_review(client, db, seed, fields):
    item = _only_item(client, _extract(client, seed, [_judge(**fields)]))

    assert item["gate"] == "review"
    assert item["task_id"] is None
    assert item["approval_status"] == "pending"


@pytest.mark.parametrize("missing", ["task_status", "due_status", "similar_count"])
def test_judge_item_without_signals_goes_to_review_as_before(client, seed, missing):
    item = _judge()
    del item[missing]

    assert _only_item(client, _extract(client, seed, [item]))["gate"] == "review"


def test_unresolved_assignee_still_goes_to_hold(client, seed):
    assert _gate(client, seed, assignee_raw="없는사람") == "hold"


def test_update_item_is_always_review_even_with_signals(client, db, seed):
    item = _only_item(client, _extract(client, seed, [_judge(
        action="update", target_task_id=seed["login"].task_id, due_date="2026-10-06",
    )]))

    assert item["gate"] == "review"
    assert db.get(Task, seed["login"].task_id).due_date == date(2026, 10, 3)


def test_unknown_evidence_status_is_rejected(client, seed):
    r = client.post("/api/v1/extractions", json={
        "meeting_id": seed["meeting"].meeting_id,
        "workspace_id": seed["ws"].workspace_id,
        "items": [_judge(task_status="sure")],
    }, headers=SERVICE_HEADERS)

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


def test_signals_are_stored_on_item(client, db, seed):
    _extract(client, seed, [_judge(task_status="inferred", similar_count=2, top_similarity=0.61)])

    item = db.execute(select(ExtractionItem)).scalar_one()
    assert (item.task_evidence_status, item.due_evidence_status, item.similar_count, item.top_similarity) == (
        "inferred", "certain", 2, 0.61
    )


# ── 되돌리기 ───────────────────────────────────────────────────────────────


def test_revert_deletes_task_and_turns_item_into_pending_review(client, db, seed):
    extraction_id, item = _auto_item(client, seed)
    task_id = item["task_id"]

    r = _revert(client, extraction_id, item["item_id"])

    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["reverted_task_id"] == task_id
    # 태스크는 목록·조회에서 사라진다
    assert client.get(f"/api/v1/tasks/{task_id}").status_code == 404
    listed = client.get("/api/v1/tasks", params={"workspace_id": seed["ws"].workspace_id}).json()["data"]
    assert task_id not in {t["task_id"] for t in listed["items"]}
    # 처음부터 review였던 것처럼 생성 승인 요청이 생긴다
    [approval] = _approvals(db)
    assert approval.approval_id == data["approval_id"]
    assert (approval.type, approval.status, approval.related_task_id) == ("task_create", "pending", None)
    payload = json.loads(approval.payload)
    assert payload["task_title"] == "결제 API 연동"
    assert payload["assignee_member_id"] == seed["jimin"].member_id
    assert payload["due_date"] == "2026-10-20"
    assert (payload["gate"], payload["reverted_task_id"]) == ("review", task_id)
    # 추출 항목은 처음 판단(auto)을 남기고, 되돌렸다는 것과 새 승인 요청을 가리킨다
    reverted = _only_item(client, extraction_id)
    assert reverted["gate"] == "auto"
    assert reverted["reverted_at"] is not None
    assert reverted["task_id"] is None
    assert (reverted["approval_id"], reverted["approval_status"]) == (data["approval_id"], "pending")


def test_approving_reverted_item_creates_new_task_for_it(client, db, seed):
    extraction_id, item = _auto_item(client, seed)
    approval_id = _revert(client, extraction_id, item["item_id"]).json()["data"]["approval_id"]

    r = client.patch(f"/api/v1/approvals/{approval_id}", json={"status": "approved"})

    assert r.status_code == 200, r.text
    approved = _only_item(client, extraction_id)
    assert approved["task_id"] not in (None, item["task_id"])
    assert approved["approval_status"] == "approved"


def test_rejecting_reverted_item_leaves_no_task(client, db, seed):
    extraction_id, item = _auto_item(client, seed)
    approval_id = _revert(client, extraction_id, item["item_id"]).json()["data"]["approval_id"]

    client.patch(f"/api/v1/approvals/{approval_id}", json={"status": "rejected"})

    rejected = _only_item(client, extraction_id)
    assert (rejected["task_id"], rejected["approval_status"]) == (None, "rejected")


def test_revert_twice_is_rejected(client, seed):
    extraction_id, item = _auto_item(client, seed)
    _revert(client, extraction_id, item["item_id"])

    r = _revert(client, extraction_id, item["item_id"])

    assert r.status_code == 409
    assert r.json()["error"]["details"]["reason"] == "already_reverted"


def test_review_item_cannot_be_reverted(client, seed):
    extraction_id = _extract(client, seed, [_judge(task_status="inferred")])
    item = _only_item(client, extraction_id)

    r = _revert(client, extraction_id, item["item_id"])

    assert r.status_code == 409
    assert r.json()["error"]["details"]["reason"] == "not_auto_created"


def test_changed_task_cannot_be_reverted(client, db, seed):
    extraction_id, item = _auto_item(client, seed)
    assert client.patch(f"/api/v1/tasks/{item['task_id']}", json={"status": "in_progress"}).status_code == 200

    r = _revert(client, extraction_id, item["item_id"])

    assert r.status_code == 409
    assert r.json()["error"]["details"]["reason"] == "task_changed"
    db.expire_all()
    assert db.get(Task, item["task_id"]).is_deleted is False


def test_task_with_pending_approval_cannot_be_reverted(client, db, seed):
    extraction_id, item = _auto_item(client, seed)
    r = client.post("/api/v1/approvals", json={
        "workspace_id": seed["ws"].workspace_id, "type": "task_update",
        "related_task_id": item["task_id"], "payload": {"due_date": "2026-10-25"},
    })
    assert r.status_code == 201, r.text

    r = _revert(client, extraction_id, item["item_id"])

    assert r.status_code == 409
    assert r.json()["error"]["details"]["reason"] == "pending_approval"


def test_only_pm_can_revert(client, seed):
    extraction_id, item = _auto_item(client, seed)
    client.cookies.set("session_token", "member-token")

    assert _revert(client, extraction_id, item["item_id"]).status_code == 403


def test_revert_unknown_item_is_not_found(client, seed):
    extraction_id, _ = _auto_item(client, seed)

    r = _revert(client, extraction_id, "no-such-item")

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "EXTRACTION_ITEM_NOT_FOUND"


# ── 지운 태스크 ────────────────────────────────────────────────────────────


def _reverted_task_id(client, seed) -> str:
    extraction_id, item = _auto_item(client, seed)
    _revert(client, extraction_id, item["item_id"])
    return item["task_id"]


def test_update_item_targeting_deleted_task_is_skipped(client, db, seed):
    task_id = _reverted_task_id(client, seed)
    meeting = Meeting(workspace_id=seed["ws"].workspace_id, status="processing")
    db.add(meeting)
    db.commit()

    r = client.post("/api/v1/extractions", json={
        "meeting_id": meeting.meeting_id,
        "workspace_id": seed["ws"].workspace_id,
        "items": [_judge(action="update", target_task_id=task_id, due_date="2026-10-25")],
    }, headers=SERVICE_HEADERS)

    assert r.status_code == 201, r.text
    assert r.json()["data"]["item_count"] == 0


def test_approval_cannot_target_deleted_task(client, seed):
    task_id = _reverted_task_id(client, seed)

    r = client.post("/api/v1/approvals", json={
        "workspace_id": seed["ws"].workspace_id, "type": "task_update",
        "related_task_id": task_id, "payload": {"due_date": "2026-10-25"},
    })

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "TASK_NOT_FOUND"
