"""실제 AI 출력으로 본 judge 근거 상태(Jev) 연결 — AI 가 보낸 상태를 그대로 저장하고 그 값으로 auto·review 를 가른다.

items 는 AI judge 파이프라인을 실제 LLM·Jev 로 돌린 출력을 그대로 둔 것이다(tests/api/data, 2026-11-07).
AI 쪽 재현: ai/ 에서 judge.eval_pipeline 의 meeting_jev_evidence_status fixture.
"""
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import Meeting, Member, Session as SessionModel, Task, User, Workspace
from app.services.sessions import hash_session_token

SERVICE_TOKEN = "test-service-token"
ITEMS = json.loads((Path(__file__).parent / "data" / "ai_judge_items_jev_evidence.json").read_text(encoding="utf-8"))[
    "items"
]


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
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
def items_by_title(db, monkeypatch):
    """AI 출력을 BE 에 넣고 추출 결과 조회의 항목을 제목으로 돌려준다. 화자 uid 는 각 팀원의 디스코드 id 다."""
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    pm_user = User(email="pm@example.com", name="pm")
    db.add(pm_user)
    db.flush()
    db.add(SessionModel(user_id=pm_user.user_id, session_token=hash_session_token("pm-token"),
                        expires_at=datetime.now(timezone.utc) + timedelta(days=1)))
    db.add_all([
        Member(workspace_id=ws.workspace_id, user_id=pm_user.user_id, display_name="PM", role="pm",
               discord_user_id="uid_pm"),
        Member(workspace_id=ws.workspace_id, display_name="하은", role="member", discord_user_id="uid_haeun"),
        Member(workspace_id=ws.workspace_id, display_name="민수", role="member", discord_user_id="uid_minsu"),
    ])
    meeting = Meeting(workspace_id=ws.workspace_id, status="processing")
    db.add(meeting)
    db.commit()

    client = TestClient(app, base_url="https://testserver")
    client.cookies.set("session_token", "pm-token")
    r = client.post("/api/v1/extractions", json={
        "meeting_id": meeting.meeting_id, "workspace_id": ws.workspace_id, "items": ITEMS,
    }, headers={"X-Service-Token": SERVICE_TOKEN})
    assert r.status_code == 201, r.text
    got = client.get(f"/api/v1/extractions/{r.json()['data']['extraction_id']}")
    assert got.status_code == 200, got.text
    return {i["task"]["title"]: i for i in got.json()["data"]["items"]}


def test_evidence_status_from_ai_is_stored_as_sent(items_by_title):
    for sent in ITEMS:
        item = items_by_title[sent["task_title"]]
        assert item["task"]["evidence_status"] == sent["task_status"]
        assert item["due_date"]["evidence_status"] == sent["due_status"]


def test_certain_task_and_due_becomes_task_automatically(items_by_title, db):
    item = items_by_title["로그인 API 연동"]
    assert item["gate"] == "auto"
    task = db.get(Task, item["task_id"])
    # 1인칭 담당자는 근거 화자(uid_haeun)로 찾는다
    assert (task.title, task.due_date) == ("로그인 API 연동", date(2026, 11, 13))
    haeun = db.execute(select(Member).where(Member.discord_user_id == "uid_haeun")).scalar_one()
    assert task.assignee_member_id == haeun.member_id


def test_inferred_due_goes_to_pm_review(items_by_title):
    item = items_by_title["검색 성능 개선 검토"]
    assert item["due_date"]["evidence_status"] == "inferred"
    assert item["gate"] == "review" and item["task_id"] is None


def test_item_after_an_auto_task_in_the_same_meeting_is_reviewed(items_by_title):
    # 마감이 없어(missing) 그 자체로는 auto 조건을 만족하지만, 같은 회의에서 앞서 auto 로 만든 태스크가 아직 임베딩 전이라
    # 중복인지 확인할 수 없어 PM 이 본다(unsearched_task_exists)
    item = items_by_title["알림 설정 페이지 개발"]
    assert item["due_date"]["evidence_status"] == "missing"
    assert item["gate"] == "review"
