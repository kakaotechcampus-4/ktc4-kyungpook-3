"""승인 때 별칭 학습(#459)을 API로 확인한다.

서비스 토큰으로 `POST /extractions`(봇 경로)를 부르는 `client`와, PM 세션 쿠키로 승인 API를 부르는
`pm_client`를 둘 다 쓸 수 있다. 같은 `db`·`seed`를 공유한다.
"""
import json
import logging
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
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
    TaskHistory,
    User,
    Workspace,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

# 추출 등록은 봇 경로라 서비스 토큰을 요구한다.
SERVICE_TOKEN = "test-service-token"
SERVICE_HEADERS = {"X-Service-Token": SERVICE_TOKEN}


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


def _member(
    db, ws: Workspace, name: str, aliases: list[tuple[str, float]], *, user_id: str | None = None, role: str = "member"
) -> Member:
    member = Member(workspace_id=ws.workspace_id, display_name=name, user_id=user_id, role=role)
    db.add(member)
    db.flush()
    for alias_text, confidence in aliases:
        db.add(MemberAlias(
            member_id=member.member_id, workspace_id=ws.workspace_id, alias_text=alias_text,
            alias_type="nickname", source="manual", confidence=confidence, verified=True,
        ))
    return member


@pytest.fixture
def seed(db):
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()

    pm_user = User(email="pm@example.com", name="pm")
    db.add(pm_user)
    db.flush()
    db.add(SessionModel(
        user_id=pm_user.user_id, session_token="pm-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    pm = _member(db, ws, "PM", [], user_id=pm_user.user_id, role="pm")
    # 확인된 별칭이지만 확신도 0.95라 legacy 확신도가 auto 기준(0.8)을 넘는다
    haeun = _member(db, ws, "하은", [("하은", 0.95)])
    leader = _member(db, ws, "지민", [("BE 리더", 0.95)])
    meeting = Meeting(workspace_id=ws.workspace_id, status="processing")
    db.add(meeting)
    db.commit()
    return {"ws": ws, "pm": pm, "haeun": haeun, "leader": leader, "meeting": meeting}


@pytest.fixture
def client(db, monkeypatch):
    """서비스 토큰 경로(POST /extractions)용."""
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
    return TestClient(app, base_url="https://testserver")


@pytest.fixture
def pm_client(seed):
    """PM 세션 쿠키 경로(승인 API)용."""
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c


def _post(client, seed, items: list[dict]):
    return client.post("/api/v1/extractions", json={
        "meeting_id": seed["meeting"].meeting_id,
        "workspace_id": seed["ws"].workspace_id,
        "items": items,
    }, headers=SERVICE_HEADERS)


def _legacy(title: str, task_confidence: float, **fields) -> dict:
    """legacy 경로의 항목. ai/capture/handoff.py to_extraction_items처럼 확신도 둘을 항상 보낸다."""
    return {
        "task_title": title, "task_confidence": task_confidence, "assignee_raw": None,
        "assignee_type": None, "due_date": None, "due_raw": None, "due_confidence": 0.0,
        "evidence_quote": None, "evidence_speaker": None, "evidence_at_ms": None, **fields,
    }


def _item(db, title: str) -> ExtractionItem:
    return db.execute(select(ExtractionItem).where(ExtractionItem.task_title == title)).scalar_one()


def _approvals(db, type_: str) -> list[ApprovalRequest]:
    return db.execute(select(ApprovalRequest).where(ApprovalRequest.type == type_)).scalars().all()


def test_extraction_saves_assignee_type(client, db, seed):
    r = _post(client, seed, [_legacy("결제 환불", 0.6, assignee_type="thirdname", assignee_raw="하은이가")])

    assert r.status_code == 201
    assert _item(db, "결제 환불").assignee_type == "thirdname"


@pytest.mark.parametrize("unknown", ["unknown", "x" * 20])
def test_extraction_unknown_assignee_type_saved_as_null(client, db, seed, unknown, caplog):
    with caplog.at_level(logging.WARNING):
        r = _post(client, seed, [_legacy("결제 환불", 0.6, assignee_type=unknown, assignee_raw="하은이가")])

    assert r.status_code == 201
    assert _item(db, "결제 환불").assignee_type is None
    assert "assignee_type" in caplog.text


def test_first_person_still_uses_speaker_and_saves_type(client, db, seed):
    r = _post(client, seed, [_legacy(
        "결제 환불", 0.6, assignee_type="first", assignee_raw="제가",
        evidence_speaker="discord_uid_haeun",
    )])

    assert r.status_code == 201
    item = _item(db, "결제 환불")
    assert item.assignee_type == "first"
    # 1인칭은 assignee_raw("제가")를 별칭으로 찾지 않는다
    assert item.assignee_member_id is None


def test_legacy_thirdrole_item_is_not_auto(client, db, seed):
    """AI 가 thirdrole 로 추측한 이름이 확인된 별칭에 걸려 legacy 확신도가 높아져도 역할 지목은 PM 이 본다(#459)."""
    r = _post(client, seed, [_legacy("백엔드 배포", 0.95, assignee_type="thirdrole", assignee_raw="BE 리더")])

    assert r.status_code == 201
    item = _item(db, "백엔드 배포")
    assert item.assignee_member_id == seed["leader"].member_id
    assert item.gate == "review"
    assert db.execute(select(Task).where(Task.title == "백엔드 배포")).scalar_one_or_none() is None
    assert len(_approvals(db, "task_create")) == 1


def test_legacy_thirdname_item_with_same_conditions_is_auto(client, db, seed):
    """대조군: 같은 조건에서 종류만 thirdname 이면 auto 라 task 가 바로 생긴다."""
    r = _post(client, seed, [_legacy("결제 환불", 0.95, assignee_type="thirdname", assignee_raw="하은")])

    assert r.status_code == 201
    assert _item(db, "결제 환불").gate == "auto"
    assert db.execute(select(Task).where(Task.title == "결제 환불")).scalar_one().assignee_member_id == (
        seed["haeun"].member_id
    )


def _hold_item(client, seed, title="결제 환불", raw="화은이가", type_="thirdname") -> str:
    """담당자를 못 찾은 이름 지목 항목을 등록하고 extraction_id 를 돌려준다. 승인 요청이 pending 으로 생긴다.

    기본 표현은 STT 오인식 "화은이가"(→ 별칭 "화은")다. 아무도 갖지 않은 글자여야 학습 후보가 된다.
    """
    r = _post(client, seed, [_legacy(title, 0.6, assignee_type=type_, assignee_raw=raw)])
    assert r.status_code == 201
    return r.json()["data"]["extraction_id"]


def _extraction_item(pm_client, extraction_id: str) -> dict:
    return pm_client.get(f"/api/v1/extractions/{extraction_id}").json()["data"]["items"][0]


def test_extraction_detail_marks_alias_candidate(client, pm_client, db, seed):
    extraction_id = _hold_item(client, seed)

    item = _extraction_item(pm_client, extraction_id)

    assert item["assignee"]["member_id"] is None
    assert item["alias_candidate"] is True
    assert item["alias_text"] == "화은"


def test_approval_list_and_detail_mark_alias_candidate(client, pm_client, db, seed):
    _hold_item(client, seed)
    approval = _approvals(db, "task_create")[0]

    listed = pm_client.get(
        "/api/v1/approvals", params={"workspace_id": seed["ws"].workspace_id}
    ).json()["data"]["items"]
    detail = pm_client.get(f"/api/v1/approvals/{approval.approval_id}").json()["data"]

    assert [(a["alias_candidate"], a["alias_text"]) for a in listed] == [(True, "화은")]
    assert (detail["alias_candidate"], detail["alias_text"]) == (True, "화은")


def test_rejected_approval_is_no_longer_alias_candidate(client, pm_client, db, seed):
    extraction_id = _hold_item(client, seed)
    approval = _approvals(db, "task_create")[0]

    r = pm_client.patch(f"/api/v1/approvals/{approval.approval_id}", json={"status": "rejected"})

    assert r.status_code == 200
    assert r.json()["data"]["alias_candidate"] is False
    assert r.json()["data"]["alias_text"] is None
    item = _extraction_item(pm_client, extraction_id)
    assert item["alias_candidate"] is False
    assert item["alias_text"] is None


def test_matched_assignee_is_not_alias_candidate(client, pm_client, db, seed):
    """별칭이 일치해 담당자를 찾은 항목은 학습할 것이 없다."""
    extraction_id = _hold_item(client, seed, raw="하은")

    item = _extraction_item(pm_client, extraction_id)
    approval = _approvals(db, "task_create")[0]
    detail = pm_client.get(f"/api/v1/approvals/{approval.approval_id}").json()["data"]

    assert item["assignee"]["member_id"] == seed["haeun"].member_id
    assert item["alias_candidate"] is False
    assert item["alias_text"] is None
    assert detail["alias_candidate"] is False
    assert detail["alias_text"] is None


def test_manual_task_create_approval_is_not_alias_candidate(pm_client, seed):
    r = pm_client.post("/api/v1/approvals", json={
        "workspace_id": seed["ws"].workspace_id,
        "type": "task_create",
        "payload": {"title": "수동 요청"},
    })

    assert r.status_code == 201
    assert r.json()["data"]["alias_candidate"] is False
    assert r.json()["data"]["alias_text"] is None


def _aliases(db) -> list[MemberAlias]:
    return db.execute(select(MemberAlias)).scalars().all()


def _approve(pm_client, db, *, assignee: str | None, save_alias=True, status="approved") -> object:
    """pending task_create 승인을 PM 이 담당자를 골라 처리한다. save_alias 가 None 이면 필드를 보내지 않는다."""
    approval = _approvals(db, "task_create")[0]
    body: dict = {"status": status, "task_overrides": {"assignee_member_id": assignee}}
    if save_alias is not None:
        body["save_alias"] = save_alias
    return pm_client.patch(f"/api/v1/approvals/{approval.approval_id}", json=body)


def _assert_approved_with_task(db, r, title="결제 환불") -> None:
    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "approved"
    assert db.execute(select(Task).where(Task.title == title)).scalar_one() is not None


def test_save_alias_creates_learned_alias(client, pm_client, db, seed):
    _hold_item(client, seed)
    before = len(_aliases(db))

    r = _approve(pm_client, db, assignee=seed["leader"].member_id)

    _assert_approved_with_task(db, r)
    learned = [a for a in _aliases(db) if a.source == "learned"]
    assert len(_aliases(db)) == before + 1
    assert len(learned) == 1
    alias = learned[0]
    assert alias.member_id == seed["leader"].member_id
    assert alias.workspace_id == seed["ws"].workspace_id
    assert alias.alias_text == "화은"
    assert alias.alias_type == "nickname"
    assert alias.verified is True
    assert alias.confidence == 0.9
    assert r.json()["data"]["alias_candidate"] is False


def test_thirdrole_item_is_not_alias_candidate_and_not_saved(client, pm_client, db, seed):
    """역할 지목은 AI 가 원문 대신 문맥으로 추측한 이름("환")을 assignee_raw 로 보낼 수 있다. BE 는 둘을 구분할 수 없어
    AI 가 역할 원문을 보낼 때까지 묻지도 배우지도 않는다(#464 리뷰)."""
    extraction_id = _hold_item(client, seed, title="백엔드 배포", raw="환", type_="thirdrole")
    item = _extraction_item(pm_client, extraction_id)
    before = len(_aliases(db))

    r = _approve(pm_client, db, assignee=seed["haeun"].member_id)

    assert (item["alias_candidate"], item["alias_text"]) == (False, None)
    _assert_approved_with_task(db, r, "백엔드 배포")
    assert len(_aliases(db)) == before


@pytest.mark.parametrize("save_alias", [None, False])
def test_approve_without_save_alias_saves_nothing(client, pm_client, db, seed, save_alias):
    _hold_item(client, seed)
    before = len(_aliases(db))

    r = _approve(pm_client, db, assignee=seed["leader"].member_id, save_alias=save_alias)

    _assert_approved_with_task(db, r)
    assert len(_aliases(db)) == before


def test_save_alias_skips_existing_alias(client, pm_client, db, seed):
    _hold_item(client, seed)
    db.add(MemberAlias(
        member_id=seed["leader"].member_id, workspace_id=seed["ws"].workspace_id, alias_text="화은",
        alias_type="nickname", source="manual", confidence=0.5, verified=False,
    ))
    db.commit()
    before = len(_aliases(db))

    r = _approve(pm_client, db, assignee=seed["leader"].member_id)

    _assert_approved_with_task(db, r)
    aliases = _aliases(db)
    assert len(aliases) == before
    # 이미 있던 별칭을 학습 값으로 덮어쓰지 않는다
    existing = [a for a in aliases if a.member_id == seed["leader"].member_id and a.alias_text == "화은"]
    assert [(a.source, a.confidence) for a in existing] == [("manual", 0.5)]


def test_save_alias_skips_item_that_already_had_assignee(client, pm_client, db, seed):
    """추출 때 담당자를 찾은 항목을 다른 팀원으로 바꿔 승인해도 별칭은 배우지 않는다."""
    _hold_item(client, seed, raw="하은")
    assert _item(db, "결제 환불").assignee_member_id == seed["haeun"].member_id
    before = len(_aliases(db))

    r = _approve(pm_client, db, assignee=seed["leader"].member_id)

    _assert_approved_with_task(db, r)
    assert len(_aliases(db)) == before


@pytest.mark.parametrize("type_", ["first", "second", "thirdpronoun", "group", "none"])
def test_save_alias_skips_non_learnable_types(client, pm_client, db, seed, type_):
    _hold_item(client, seed, raw="그 사람", type_=type_)
    before = len(_aliases(db))

    r = _approve(pm_client, db, assignee=seed["leader"].member_id)

    _assert_approved_with_task(db, r)
    assert len(_aliases(db)) == before


def test_save_alias_skips_legacy_item_without_type(client, pm_client, db, seed):
    _hold_item(client, seed)
    item = _item(db, "결제 환불")
    item.assignee_type = None
    db.commit()
    before = len(_aliases(db))

    r = _approve(pm_client, db, assignee=seed["leader"].member_id)

    _assert_approved_with_task(db, r)
    assert len(_aliases(db)) == before


def test_save_alias_skips_when_final_assignee_is_null(client, pm_client, db, seed):
    _hold_item(client, seed)
    before = len(_aliases(db))

    r = _approve(pm_client, db, assignee=None)

    _assert_approved_with_task(db, r)
    assert len(_aliases(db)) == before


def test_save_alias_ignored_on_manual_task_create(pm_client, db, seed):
    created = pm_client.post("/api/v1/approvals", json={
        "workspace_id": seed["ws"].workspace_id, "type": "task_create", "payload": {"title": "수동 요청"},
    })
    assert created.status_code == 201
    before = len(_aliases(db))

    r = pm_client.patch(f"/api/v1/approvals/{created.json()['data']['approval_id']}", json={
        "status": "approved", "save_alias": True,
        "task_overrides": {"assignee_member_id": seed["leader"].member_id},
    })

    _assert_approved_with_task(db, r, "수동 요청")
    assert len(_aliases(db)) == before


def test_save_alias_ignored_when_rejected(client, pm_client, db, seed):
    _hold_item(client, seed)
    before = len(_aliases(db))
    approval = _approvals(db, "task_create")[0]

    r = pm_client.patch(
        f"/api/v1/approvals/{approval.approval_id}", json={"status": "rejected", "save_alias": True}
    )

    assert r.status_code == 200
    assert r.json()["data"]["status"] == "rejected"
    assert len(_aliases(db)) == before


def test_save_alias_ignores_unique_conflict(client, pm_client, db, seed, monkeypatch):
    """미리 조회를 지나친 동시 승인이 유니크 제약에 걸려도 승인은 그대로 커밋된다."""
    _hold_item(client, seed)
    db.add(MemberAlias(
        member_id=seed["leader"].member_id, workspace_id=seed["ws"].workspace_id, alias_text="화은",
        alias_type="nickname", source="manual", confidence=0.5, verified=False,
    ))
    db.commit()
    before = len(_aliases(db))
    monkeypatch.setattr("app.services.alias_learning._alias_taken", lambda *a, **k: False)

    r = _approve(pm_client, db, assignee=seed["leader"].member_id)

    _assert_approved_with_task(db, r)
    assert len(_aliases(db)) == before
    db.expire_all()
    approval = _approvals(db, "task_create")[0]
    assert approval.status == "approved"
    # savepoint 가 되돌린 것은 별칭뿐이다. 승인 반영(task 연결, PM 이 고친 값, 이력)은 그대로 남아야 한다
    task = db.execute(select(Task).where(Task.title == "결제 환불")).scalar_one()
    assert approval.related_task_id == task.task_id
    assert _item(db, "결제 환불").task_id == task.task_id
    assert json.loads(approval.payload)["task_overrides"] == {"assignee_member_id": seed["leader"].member_id}
    histories = db.execute(select(TaskHistory).where(TaskHistory.task_id == task.task_id)).scalars().all()
    # 생성 이력과 PM 이 담당자를 고친 이력(manual) 둘 다 남는다
    assert sorted((h.changed_field, h.new_value, h.change_source) for h in histories) == [
        ("assignee", seed["leader"].member_id, "manual"),
        ("title", "결제 환불", "meeting"),
    ]


def _give_alias(db, member: Member, alias_text: str) -> None:
    db.add(MemberAlias(
        member_id=member.member_id, workspace_id=member.workspace_id, alias_text=alias_text,
        alias_type="nickname", source="manual", confidence=0.5, verified=False,
    ))
    db.commit()


def _assert_not_candidate_everywhere(pm_client, db, extraction_id: str) -> None:
    approval = _approvals(db, "task_create")[0]
    item = _extraction_item(pm_client, extraction_id)
    detail = pm_client.get(f"/api/v1/approvals/{approval.approval_id}").json()["data"]
    listed = pm_client.get(
        "/api/v1/approvals", params={"workspace_id": approval.workspace_id}
    ).json()["data"]["items"]
    assert (item["alias_candidate"], item["alias_text"]) == (False, None)
    assert (detail["alias_candidate"], detail["alias_text"]) == (False, None)
    assert [(a["alias_candidate"], a["alias_text"]) for a in listed] == [(False, None)]


def test_alias_held_by_another_member_is_not_candidate_and_not_saved(client, pm_client, db, seed):
    """다른 팀원이 가진 글자를 또 붙이면 다음 매칭이 AMBIGUOUS 가 되어 원래 팀원 항목까지 hold 로 떨어진다."""
    _give_alias(db, seed["haeun"], "화은")
    extraction_id = _hold_item(client, seed)
    _assert_not_candidate_everywhere(pm_client, db, extraction_id)
    before = len(_aliases(db))

    r = _approve(pm_client, db, assignee=seed["leader"].member_id)

    _assert_approved_with_task(db, r)
    assert r.json()["data"]["alias_candidate"] is False
    assert len(_aliases(db)) == before
    assert [a for a in _aliases(db) if a.member_id == seed["leader"].member_id and a.alias_text == "화은"] == []


def test_alias_held_only_by_departed_member_is_still_candidate_and_saved(client, pm_client, db, seed):
    """탈퇴 팀원의 별칭은 세지 않는다. 담당자를 찾을 때도(#463 resolve_assignee) 탈퇴자 별칭은 보지 않으므로,
    세면 그 글자는 PM 이 탈퇴자 별칭을 지울 때까지 배울 수 없다(#464 리뷰). 탈퇴자 별칭은 지우지 않고 그대로 둔다."""
    gone = _member(db, seed["ws"], "탈퇴자", [("화은", 0.5)])
    gone.is_deleted = True
    db.commit()
    extraction_id = _hold_item(client, seed)

    item = _extraction_item(pm_client, extraction_id)
    r = _approve(pm_client, db, assignee=seed["leader"].member_id)

    assert (item["alias_candidate"], item["alias_text"]) == (True, "화은")
    _assert_approved_with_task(db, r)
    held = sorted((a.member_id, a.alias_text, a.source) for a in _aliases(db) if a.alias_text == "화은")
    assert held == sorted([
        (gone.member_id, "화은", "manual"),
        (seed["leader"].member_id, "화은", "learned"),
    ])


def test_alias_held_in_other_workspace_is_still_candidate_and_saved(client, pm_client, db, seed):
    other_ws = Workspace(name="B")
    db.add(other_ws)
    db.flush()
    _member(db, other_ws, "타팀", [("화은", 0.95)])
    db.commit()
    extraction_id = _hold_item(client, seed)

    item = _extraction_item(pm_client, extraction_id)
    r = _approve(pm_client, db, assignee=seed["leader"].member_id)

    assert (item["alias_candidate"], item["alias_text"]) == (True, "화은")
    _assert_approved_with_task(db, r)
    learned = [a for a in _aliases(db) if a.source == "learned"]
    assert [(a.workspace_id, a.member_id, a.alias_text) for a in learned] == [
        (seed["ws"].workspace_id, seed["leader"].member_id, "화은")
    ]


def test_save_alias_ignored_on_task_update_approval(pm_client, db, seed):
    task = Task(workspace_id=seed["ws"].workspace_id, title="로그인", status="todo")
    db.add(task)
    db.commit()
    created = pm_client.post("/api/v1/approvals", json={
        "workspace_id": seed["ws"].workspace_id, "type": "task_update",
        "payload": {"status": "done"}, "related_task_id": task.task_id,
    })
    assert created.status_code == 201
    before = len(_aliases(db))

    r = pm_client.patch(f"/api/v1/approvals/{created.json()['data']['approval_id']}", json={
        "status": "approved", "save_alias": True,
    })

    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "approved"
    assert len(_aliases(db)) == before


@pytest.mark.parametrize("kind, code", [("departed", "MEMBER_NOT_FOUND"), ("other_workspace", "WORKSPACE_MISMATCH")])
def test_save_alias_with_invalid_assignee_fails_approval_and_can_be_retried(
    client, pm_client, db, seed, kind, code
):
    """탈퇴했거나 다른 공간의 담당자를 골라 승인하면 오류이고, 승인은 pending 으로 남고 별칭도 없다. 다시 처리할 수 있다."""
    _hold_item(client, seed)
    if kind == "departed":
        bad = _member(db, seed["ws"], "탈퇴", [])
        bad.is_deleted = True
    else:
        other_ws = Workspace(name="B")
        db.add(other_ws)
        db.flush()
        bad = _member(db, other_ws, "타팀", [])
    db.commit()
    before = len(_aliases(db))

    r = _approve(pm_client, db, assignee=bad.member_id)

    assert r.status_code >= 400
    assert r.json()["error"]["code"] == code
    db.expire_all()
    approval = _approvals(db, "task_create")[0]
    assert approval.status == "pending"
    assert approval.related_task_id is None
    assert db.execute(select(Task).where(Task.title == "결제 환불")).scalar_one_or_none() is None
    assert len(_aliases(db)) == before

    retried = _approve(pm_client, db, assignee=seed["leader"].member_id)

    _assert_approved_with_task(db, retried)
    learned = [a for a in _aliases(db) if a.source == "learned"]
    assert [(a.member_id, a.alias_text) for a in learned] == [(seed["leader"].member_id, "화은")]


def test_resolving_the_same_approval_again_does_not_add_alias(client, pm_client, db, seed):
    _hold_item(client, seed)
    first = _approve(pm_client, db, assignee=seed["leader"].member_id)
    _assert_approved_with_task(db, first)
    after_first = len(_aliases(db))

    again = _approve(pm_client, db, assignee=seed["haeun"].member_id)

    assert again.status_code == 409
    assert again.json()["error"]["code"] == "APPROVAL_ALREADY_RESOLVED"
    assert len(_aliases(db)) == after_first
    assert [a for a in _aliases(db) if a.source == "learned" and a.member_id == seed["haeun"].member_id] == []


def test_chat_meeting_log_does_not_count_thirdrole_item_as_would_have_been_auto(client, db, seed, caplog):
    """채팅 강등 로그는 chat 이 아니었으면 auto 였을 항목 수의 근거다(결정 기록 0042). 어차피 review 인 역할 항목은 세지 않는다."""
    seed["meeting"].source = "chat"
    db.commit()
    items = [
        _legacy("백엔드 배포", 0.95, assignee_type="thirdrole", assignee_raw="BE 리더"),
        _legacy("결제 환불", 0.95, assignee_type="thirdname", assignee_raw="하은"),
    ]

    with caplog.at_level(logging.INFO):
        r = _post(client, seed, items)

    assert r.status_code == 201
    assert _item(db, "백엔드 배포").gate == "review"
    assert _item(db, "결제 환불").gate == "review"
    chat_lines = [m for m in caplog.messages if "chat 회의라 auto 항목을 review로 내립니다" in m]
    assert len(chat_lines) == 1
    assert "title=결제 환불" in chat_lines[0]
    # 역할 강등 로그는 역할 항목에만 찍힌다. 채팅 강등 블록에 들어가 채팅의 auto 항목마다 찍히면 안 된다(#464 리뷰)
    role_lines = [m for m in caplog.messages if "역할 지목 항목이라 auto를 review로 내립니다" in m]
    assert len(role_lines) == 1
    assert "title=백엔드 배포" in role_lines[0]


@pytest.mark.parametrize("raw", ["제가", "저는", "우리가", "본인이", "저도", "나도", "저희들이"])
def test_first_person_word_misclassified_as_thirdname_is_not_alias_candidate_and_not_saved(
    client, pm_client, db, seed, raw
):
    """AI 가 1인칭을 thirdname 으로 잘못 분류해도 묻지도 저장하지도 않는다. 저장되면 오분류된 "제가"·"우리"가
    그 팀원으로 채워진다(#502)."""
    extraction_id = _hold_item(client, seed, raw=raw, type_="thirdname")
    item = _extraction_item(pm_client, extraction_id)
    before = len(_aliases(db))

    r = _approve(pm_client, db, assignee=seed["leader"].member_id)

    assert (item["alias_candidate"], item["alias_text"]) == (False, None)
    _assert_approved_with_task(db, r)
    assert len(_aliases(db)) == before
