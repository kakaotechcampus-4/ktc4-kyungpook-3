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


# 추출 등록은 봇 경로라 서비스 토큰을 요구한다.
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
def client(db, monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
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
    }, headers=SERVICE_HEADERS)


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


def test_update_without_any_change_creates_no_approval(client, db, seed):
    """이미 반영된 값만 왔고 담당자 언급도 없으면 승인 요청을 만들지 않는다."""
    login = seed["login"]
    r = _post(client, seed, [_update(login, due_date="2026-09-28", status="in_progress",
                                     doc_text="로그인 시안 마감 재확인")])

    assert r.status_code == 201
    assert r.json()["data"]["item_count"] == 1
    assert _approvals(db, "task_update") == []

    item = db.execute(select(ExtractionItem)).scalar_one()
    # 승인은 없어도 어떤 task 얘기였는지, doc_text·근거는 항목에 남는다.
    assert item.task_id == login.task_id
    assert item.approval_id is None
    assert item.doc_text == "로그인 시안 마감 재확인"


def test_update_with_scope_category_creates_approval_even_without_changes(client, db, seed):
    """scope 결정은 대응하는 task 필드가 없어서, 변경이 없어도 승인 요청을 만든다."""
    search = seed["search"]
    r = _post(client, seed, [_update(
        search, category="scope", doc_text="이번 스프린트에서는 소셜 로그인은 빼기로 함",
    )])

    assert r.status_code == 201
    [approval] = _approvals(db, "task_update")
    payload = _payload(approval)
    assert payload["category"] == "scope"
    assert payload["doc_text"] == "이번 스프린트에서는 소셜 로그인은 빼기로 함"
    assert {"due_date", "status", "assignee_member_id"}.isdisjoint(payload)


def test_update_with_matching_assignee_excludes_it_and_skips_approval(client, db, seed):
    """담당자가 이미 대상 task와 같으면 변경안에서 빼고, 다른 변경이 없으면 승인도 만들지 않는다."""
    search = seed["search"]
    search.assignee_member_id = seed["jimin"].member_id
    db.commit()

    r = _post(client, seed, [_update(search, assignee_raw="지민님", assignee_type="thirdname")])

    assert r.status_code == 201
    assert _approvals(db, "task_update") == []
    item = db.execute(select(ExtractionItem)).scalar_one()
    assert item.task_id == search.task_id
    assert item.approval_id is None


def test_update_with_matching_assignee_but_other_change_still_creates_approval(client, db, seed):
    search = seed["search"]
    search.assignee_member_id = seed["jimin"].member_id
    db.commit()

    r = _post(client, seed, [_update(
        search, assignee_raw="지민님", assignee_type="thirdname", status="done",
    )])

    assert r.status_code == 201
    payload = _payload(_approvals(db, "task_update")[0])
    assert payload["status"] == "done"
    assert "assignee_member_id" not in payload


@pytest.mark.parametrize("raw", ["민수님", "없는사람"], ids=["ambiguous", "not-found"])
def test_update_with_unresolved_assignee_always_creates_approval(client, db, seed, raw):
    """담당자를 하나로 못 찾았으면 다른 변경이 없어도 PM이 보도록 승인 요청을 만든다."""
    r = _post(client, seed, [_update(seed["search"], assignee_raw=raw, assignee_type="thirdname")])

    assert r.status_code == 201
    [approval] = _approvals(db, "task_update")
    payload = _payload(approval)
    assert "assignee_member_id" not in payload
    assert payload["assignee_raw"] == raw
    assert payload["assignee_needs_check"] is True


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
    "bad_item",
    [
        {"action": "update", "due_date": "2026-10-01"},
        {"action": "create", "due_date": "2026-10-01"},
        {"task_title": "   ", "task_confidence": 0.9},
    ],
    ids=["update-without-target", "create-without-title", "blank-title"],
)
def test_item_missing_required_value_is_skipped(client, db, seed, bad_item):
    r = _post(client, seed, [bad_item, {"task_title": "결제 환불 기능 구현", "task_confidence": 0.6}])

    assert r.status_code == 201
    assert r.json()["data"]["item_count"] == 1
    assert len(_approvals(db, "task_create")) == 1
    assert db.query(Task).count() == 3


def test_unknown_action_is_400(client, db, seed):
    r = _post(client, seed, [{"action": "delete", "task_title": "무언가"}])

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


# ── 추출 경로별 게이트(#201) ──


def _judge_create(title: str, **fields) -> dict:
    """judge 경로의 새 항목. ai/judge/pipeline.py to_item처럼 값이 없어도 키를 보내고 확신도는 보내지 않는다."""
    return {
        "action": "create", "target_task_id": None, "category": "decision", "task_title": title,
        "due_date": None, "status": None, "assignee_type": None, "assignee_raw": None,
        "doc_text": f"{title}을 하기로 함", "evidence_quote": "이거 해야 해요",
        "evidence_speaker": "discord_uid_haeun", "evidence_at_ms": 1000, **fields,
    }


def _legacy(title: str, task_confidence: float, **fields) -> dict:
    """legacy 경로의 항목. ai/capture/handoff.py to_extraction_items처럼 확신도 둘을 항상 보낸다."""
    return {
        "task_title": title, "task_confidence": task_confidence, "assignee_raw": None,
        "assignee_type": None, "due_date": None, "due_raw": None, "due_confidence": 0.0,
        "evidence_quote": None, "evidence_speaker": None, "evidence_at_ms": None, **fields,
    }


def _item(db, title: str) -> ExtractionItem:
    return db.execute(select(ExtractionItem).where(ExtractionItem.task_title == title)).scalar_one()


def _extraction(db) -> Extraction:
    return db.execute(select(Extraction)).scalar_one()


@pytest.mark.parametrize(
    ("assignee", "gate"),
    [
        ({"assignee_type": "thirdname", "assignee_raw": "지민님"}, "review"),  # 한 명으로 확정
        # 특정 개인을 가리키지 않으면 언급 없음으로 보고 계산에서 뺀다
        ({"assignee_type": "none", "assignee_raw": None}, "review"),
        ({"assignee_type": "group", "assignee_raw": None}, "review"),
        ({"assignee_type": None, "assignee_raw": None}, "review"),
        ({"assignee_type": "thirdname", "assignee_raw": "민수님"}, "hold"),  # 두 명이라 미확정
        ({"assignee_type": "thirdname", "assignee_raw": "하은님"}, "hold"),  # 등록된 별칭 없음
        ({"assignee_type": "first", "assignee_raw": None}, "hold"),  # 화자 uid의 팀원 없음
        ({"assignee_type": "first", "assignee_raw": None, "evidence_speaker": None}, "hold"),  # 화자 없음
        # 사람을 지목했지만 AI가 이름으로 풀지 못해 호칭 없이 종류만 왔다
        ({"assignee_type": "second", "assignee_raw": None}, "hold"),
        ({"assignee_type": "thirdpronoun", "assignee_raw": None}, "hold"),
        ({"assignee_type": "thirdrole", "assignee_raw": None}, "hold"),
    ],
    ids=[
        "resolved", "none", "group", "type-missing", "ambiguous", "not-found",
        "first-unknown-speaker", "first-without-speaker", "second-unresolved",
        "thirdpronoun-unresolved", "thirdrole-unresolved",
    ],
)
def test_judge_create_gate_follows_assignee_without_measured_confidence(client, db, seed, assignee, gate):
    """judge는 할 일 확신도를 보내지 않는다. 0.0으로 보지 않고, BE가 계산한 담당자 확신도로만 정한다.

    담당자를 한 명으로 찾았거나 언급이 없으면 review, 언급했는데 찾지 못했으면 PM이 채워야 하므로 hold다.
    """
    r = _post(client, seed, [_judge_create("결제 환불 기능 구현", due_date="2026-10-05", **assignee)])

    assert r.status_code == 201
    item = _item(db, "결제 환불 기능 구현")
    assert item.gate == gate
    assert (item.task_confidence, item.due_confidence, item.confidence) == (None, None, None)
    [approval] = _approvals(db, "task_create")
    assert _payload(approval)["gate"] == gate
    assert db.query(Task).count() == 3
    assert _extraction(db).extraction_path == "judge"


def test_judge_create_with_first_person_resolved_by_speaker_goes_to_review(client, db, seed):
    """1인칭은 assignee_raw 없이 오고 화자 uid로 찾는다. 찾았으면 호칭이 없어도 hold가 아니다."""
    seed["jimin"].discord_user_id = "discord_uid_jimin"
    db.commit()
    _post(client, seed, [_judge_create(
        "결제 환불 기능 구현", assignee_type="first", assignee_raw=None, evidence_speaker="discord_uid_jimin",
    )])

    item = _item(db, "결제 환불 기능 구현")
    assert (item.gate, item.assignee_member_id) == ("review", seed["jimin"].member_id)


def test_judge_create_never_auto_even_if_confidence_is_sent(client, db, seed):
    """judge의 키가 있으면 확신도를 함께 보내도 judge 정책을 따른다. 정책을 바꾸기 전에는 바로 생성하지 않는다."""
    _post(client, seed, [_judge_create(
        "결제 환불 기능 구현", task_confidence=0.99, assignee_type="thirdname", assignee_raw="지민님",
    )])

    item = _item(db, "결제 환불 기능 구현")
    assert item.gate == "review"
    assert item.task_confidence == 0.99
    assert db.query(Task).count() == 3


def test_legacy_items_keep_confidence_gate(client, db, seed):
    _post(client, seed, [
        _legacy("결제 환불 기능 구현", 1.0, assignee_type="thirdname", assignee_raw="지민님"),
        _legacy("디자인 검토", 0.6),
        _legacy("배포 점검", 1.0, due_date="2026-10-05", due_raw="언젠가", due_confidence=0.0),
    ])

    assert _item(db, "결제 환불 기능 구현").gate == "auto"
    assert _item(db, "디자인 검토").gate == "review"
    hold = _item(db, "배포 점검")
    assert (hold.gate, hold.confidence) == ("hold", 0.0)
    assert _extraction(db).extraction_path == "legacy"


def test_measured_zero_confidence_is_not_treated_as_unmeasured(client, db, seed):
    """0.0을 보냈으면 측정값 0이다. 보내지 않은 것(null)과 달리 hold다."""
    _post(client, seed, [_legacy("디자인 검토", 0.0)])

    item = _item(db, "디자인 검토")
    assert (item.task_confidence, item.confidence, item.gate) == (0.0, 0.0, "hold")


@pytest.mark.parametrize(
    ("assignee", "gate"),
    [
        ({"assignee_raw": "지민님"}, "review"),
        ({}, "review"),
        ({"assignee_raw": "민수님"}, "hold"),
        ({"assignee_type": "thirdpronoun"}, "hold"),
    ],
    ids=["resolved", "no-assignee", "ambiguous", "thirdpronoun-unresolved"],
)
def test_item_of_unknown_path_without_confidence_follows_assignee(client, db, seed, assignee, gate):
    """경로를 가릴 수 없어도 확신도를 측정하지 않았으면 judge와 같이 담당자로만 정한다."""
    _post(client, seed, [{"task_title": "디자인 검토", **assignee}])

    item = _item(db, "디자인 검토")
    assert (item.gate, item.task_confidence, item.confidence) == (gate, None, None)
    assert _extraction(db).extraction_path is None


@pytest.mark.parametrize(
    "items",
    [
        [],
        [_judge_create("결제 환불 기능 구현"), _legacy("디자인 검토", 0.6)],
        [_judge_create("결제 환불 기능 구현"), {"task_title": "디자인 검토"}],
    ],
    ids=["empty", "mixed", "with-unknown-item"],
)
def test_extraction_path_is_null_when_items_do_not_agree(client, db, seed, items):
    r = _post(client, seed, items)

    assert r.status_code == 201
    assert _extraction(db).extraction_path is None


def test_mixed_request_still_gates_each_item_by_its_own_path(client, db, seed):
    _post(client, seed, [_judge_create("결제 환불 기능 구현"), _legacy("디자인 검토", 0.0)])

    assert _item(db, "결제 환불 기능 구현").gate == "review"
    assert _item(db, "디자인 검토").gate == "hold"


def test_extraction_detail_returns_path_and_unmeasured_confidence_as_null(client, db, seed):
    extraction_id = _post(client, seed, [
        _judge_create("결제 환불 기능 구현", assignee_type="thirdname", assignee_raw="지민님"),
    ]).json()["data"]["extraction_id"]

    client.cookies.set("session_token", "pm-token")
    body = client.get(f"/api/v1/extractions/{extraction_id}").json()["data"]

    assert body["extraction_path"] == "judge"
    [item] = body["items"]
    assert item["task"]["confidence"] is None
    assert item["due_date"]["confidence"] is None
    assert item["confidence"] is None
    assert item["assignee"]["confidence"] == 1.0
    assert item["gate"] == "review"
