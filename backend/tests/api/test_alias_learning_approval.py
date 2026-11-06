"""승인 때 별칭 학습(#459)을 API로 확인한다.

서비스 토큰으로 `POST /extractions`(봇 경로)를 부르는 `client`와, PM 세션 쿠키로 승인 API를 부르는
`pm_client`를 둘 다 쓸 수 있다. 같은 `db`·`seed`를 공유한다.
"""
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
    """학습한 역할 별칭으로 legacy 확신도가 높아져도 역할 지목은 PM 이 본다(#459)."""
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
