"""워크스페이스 용어 목록과 승인 제목 큐(#532).

AI 가 새 할 일 제목의 명사 중 용어 목록에 없는 말을 전사 오인식 의심 단어로 본다. 목록은 AI 가 올리고(POST),
PM 이 task_create 승인으로 만든 태스크의 최종 제목은 BE 가 큐에 쌓아 AI 가 받아 간다(GET).

TEST_DATABASE_URL이 있으면 PostgreSQL에서도 돈다.
"""
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
    AsrTitleQueue,
    Member,
    Session as SessionModel,
    Task,
    User,
    Workspace,
    WorkspaceAsrTerm,
)
from app.services.sessions import hash_session_token
from tests.usernames import username_for

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
TOKEN = "test-token"
HEADERS = {"X-Service-Token": TOKEN}
T0 = datetime(2026, 11, 8, 10, 0, tzinfo=timezone.utc)


def _engine(kind: str):
    if kind == "sqlite":
        return create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
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
def db(request, monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", TOKEN)
    engine = _engine(request.param)
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
    """워크스페이스 A(PM 세션·팀원·task), 다른 워크스페이스 B(팀원 하나)."""
    user = User(username=username_for("pm@example.com"), email="pm@example.com", name="pm")
    db.add_all([user, Workspace(workspace_id="wsa", name="A"), Workspace(workspace_id="wsb", name="B")])
    db.flush()
    db.add_all([
        SessionModel(
            user_id=user.user_id, session_token=hash_session_token("pm-session"),
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        ),
        Member(member_id="pm", workspace_id="wsa", user_id=user.user_id, display_name="PM", role="pm"),
        Member(member_id="m1", workspace_id="wsa", display_name="지민"),
        Member(member_id="m9", workspace_id="wsb", display_name="외부"),
        Task(task_id="t1", workspace_id="wsa", title="로그인 화면 시안", status="todo"),
    ])
    db.commit()


def _url(workspace_id: str = "wsa") -> str:
    return f"/api/v1/workspaces/{workspace_id}/asr-terms"


def _queue(db, workspace_id: str = "wsa") -> list[str]:
    db.expire_all()
    return list(db.execute(
        select(AsrTitleQueue.title).where(AsrTitleQueue.workspace_id == workspace_id)
    ).scalars())


def _terms(db, workspace_id: str = "wsa") -> list[str]:
    db.expire_all()
    return sorted(db.execute(
        select(WorkspaceAsrTerm.word).where(WorkspaceAsrTerm.workspace_id == workspace_id)
    ).scalars())


# ---------- 인증과 없는 워크스페이스 ----------

@pytest.mark.parametrize("method", ["get", "post"])
@pytest.mark.parametrize(
    "client_kwargs",
    [{}, {"headers": {"X-Service-Token": "wrong"}}, {"cookies": {"session_token": "pm-session"}}],
    ids=["missing-token", "wrong-token", "member-session-only"],
)
def test_rejects_requests_without_valid_service_token(seed, client_kwargs, method):
    client = TestClient(app, **client_kwargs)
    r = client.get(_url()) if method == "get" else client.post(_url(), json={"words": ["결제"]})

    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "UNAUTHENTICATED"


@pytest.mark.parametrize("method", ["get", "post"])
def test_unknown_workspace_is_404(seed, method):
    client = TestClient(app, headers=HEADERS)
    r = client.get(_url("nope")) if method == "get" else client.post(_url("nope"), json={"words": ["결제"]})

    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] == "WORKSPACE_NOT_FOUND"
    assert r.json()["error"]["details"] == {"workspace_id": "nope"}


# ---------- 조회 ----------

def test_empty_workspace_returns_empty_lists(seed):
    r = TestClient(app, headers=HEADERS).get(_url())

    assert r.status_code == 200, r.text
    assert r.json() == {"data": {"words": [], "pending_titles": []}, "error": None}


def test_words_are_sorted_and_titles_oldest_first_without_other_workspaces(db, seed):
    db.add_all([
        WorkspaceAsrTerm(workspace_id="wsa", word="회의록"),
        WorkspaceAsrTerm(workspace_id="wsa", word="결제"),
        WorkspaceAsrTerm(workspace_id="wsa", word="API"),
        WorkspaceAsrTerm(workspace_id="wsb", word="남의말"),
        AsrTitleQueue(title_id="q2", workspace_id="wsa", title="나중 제목", created_at=T0 + timedelta(minutes=5)),
        AsrTitleQueue(title_id="q1", workspace_id="wsa", title="먼저 제목", created_at=T0),
        AsrTitleQueue(title_id="q9", workspace_id="wsb", title="남의 제목", created_at=T0),
    ])
    db.commit()

    data = TestClient(app, headers=HEADERS).get(_url()).json()["data"]

    assert data == {
        "words": ["API", "결제", "회의록"],
        "pending_titles": [{"title_id": "q1", "title": "먼저 제목"}, {"title_id": "q2", "title": "나중 제목"}],
    }


def test_pending_titles_are_capped_at_200_oldest(db, seed):
    db.add_all([
        AsrTitleQueue(title_id=f"q{i:03d}", workspace_id="wsa", title=f"제목{i}", created_at=T0 + timedelta(seconds=i))
        for i in range(205)
    ])
    db.commit()

    titles = TestClient(app, headers=HEADERS).get(_url()).json()["data"]["pending_titles"]

    assert len(titles) == 200
    assert (titles[0]["title_id"], titles[-1]["title_id"]) == ("q000", "q199")


# ---------- 단어 추가와 큐 비우기 ----------

def test_post_adds_new_words_strips_and_dedupes(db, seed):
    db.add(WorkspaceAsrTerm(workspace_id="wsa", word="결제"))
    db.commit()

    r = TestClient(app, headers=HEADERS).post(_url(), json={"words": [" 결제 ", "정산", "정산 ", "API"]})

    assert r.status_code == 200, r.text
    assert r.json() == {"data": {"added": 2, "absorbed": 0}, "error": None}
    assert _terms(db) == ["API", "결제", "정산"]


def test_post_is_idempotent(db, seed):
    client = TestClient(app, headers=HEADERS)
    client.post(_url(), json={"words": ["결제", "정산"]})

    r = client.post(_url(), json={"words": ["결제", "정산"]})

    assert r.json()["data"] == {"added": 0, "absorbed": 0}
    assert _terms(db) == ["결제", "정산"]


def test_same_word_in_other_workspace_is_separate(db, seed):
    db.add(WorkspaceAsrTerm(workspace_id="wsb", word="결제"))
    db.commit()

    r = TestClient(app, headers=HEADERS).post(_url(), json={"words": ["결제"]})

    assert r.json()["data"]["added"] == 1
    assert _terms(db, "wsa") == _terms(db, "wsb") == ["결제"]


def test_absorbed_ids_delete_only_this_workspace_rows(db, seed):
    db.add_all([
        AsrTitleQueue(title_id="q1", workspace_id="wsa", title="가"),
        AsrTitleQueue(title_id="q2", workspace_id="wsa", title="나"),
        AsrTitleQueue(title_id="q9", workspace_id="wsb", title="남의 제목"),
    ])
    db.commit()

    r = TestClient(app, headers=HEADERS).post(
        _url(), json={"words": [], "absorbed_title_ids": ["q1", "q9", "no-such-id"]}
    )

    assert r.status_code == 200, r.text
    assert r.json()["data"] == {"added": 0, "absorbed": 1}
    assert _queue(db, "wsa") == ["나"]
    assert _queue(db, "wsb") == ["남의 제목"]


def test_empty_body_is_ok(seed):
    r = TestClient(app, headers=HEADERS).post(_url(), json={})

    assert r.status_code == 200, r.text
    assert r.json()["data"] == {"added": 0, "absorbed": 0}


def test_max_words_are_accepted(db, seed):
    r = TestClient(app, headers=HEADERS).post(_url(), json={"words": [f"단어{i}" for i in range(2000)]})

    assert r.status_code == 200, r.text
    assert r.json()["data"]["added"] == 2000


@pytest.mark.parametrize(
    "body",
    [
        {"words": ["   "]},
        {"words": [""]},
        {"words": ["가" * 31]},
        {"words": [1]},
        {"words": "결제"},
        {"words": ["가"] * 2001},
        {"absorbed_title_ids": ["q"] * 201},
    ],
    ids=["blank", "empty", "too-long", "not-string", "not-list", "too-many-words", "too-many-ids"],
)
def test_invalid_body_is_400(db, seed, body):
    r = TestClient(app, headers=HEADERS).post(_url(), json=body)

    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    assert _terms(db) == []


def test_thirty_chars_after_strip_is_ok(db, seed):
    r = TestClient(app, headers=HEADERS).post(_url(), json={"words": ["  " + "가" * 30 + "  "]})

    assert r.status_code == 200, r.text
    assert _terms(db) == ["가" * 30]


def test_workspace_delete_cascades(db, seed):
    db.add_all([
        WorkspaceAsrTerm(workspace_id="wsb", word="결제"),
        AsrTitleQueue(title_id="q9", workspace_id="wsb", title="남의 제목"),
    ])
    db.commit()
    if db.get_bind().dialect.name == "sqlite":
        pytest.skip("SQLite 는 외래 키 CASCADE 를 켜지 않는다")

    db.execute(text("DELETE FROM member WHERE workspace_id = 'wsb'"))
    db.execute(text("DELETE FROM workspace WHERE workspace_id = 'wsb'"))
    db.commit()

    assert _terms(db, "wsb") == [] and _queue(db, "wsb") == []


# ---------- 승인 때 제목 큐 ----------

def _pm_client() -> TestClient:
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-session")
    return c


def _approval(client, type="task_create", payload=None, related_task_id=None) -> dict:
    r = client.post("/api/v1/approvals", json={
        "workspace_id": "wsa", "type": type, "related_task_id": related_task_id,
        "payload": payload or {"task_title": "결제 API 연동", "assignee_member_id": "m1", "due_date": "2026-11-20"},
    })
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _resolve(client, approval_id, status="approved", **extra):
    return client.patch(f"/api/v1/approvals/{approval_id}", json={"status": status, **extra})


def test_approved_task_create_queues_final_title(db, seed):
    client = _pm_client()

    r = _resolve(client, _approval(client)["approval_id"])

    assert r.status_code == 200, r.text
    assert _queue(db) == ["결제 API 연동"]
    assert _queue(db, "wsb") == []


def test_pm_edited_title_is_queued_instead_of_proposal(db, seed):
    client = _pm_client()

    r = _resolve(client, _approval(client)["approval_id"], task_overrides={"task_title": "정산 API 연동"})

    assert r.status_code == 200, r.text
    assert _queue(db) == ["정산 API 연동"]


def test_rejected_task_create_queues_nothing(db, seed):
    client = _pm_client()

    _resolve(client, _approval(client)["approval_id"], "rejected")

    assert _queue(db) == []


def test_failed_task_create_queues_nothing(db, seed):
    client = _pm_client()
    approval_id = _approval(client)["approval_id"]

    # 다른 워크스페이스 팀원을 담당자로 고치면 태스크를 만들지 못하고 승인이 되돌려진다
    r = _resolve(client, approval_id, task_overrides={"assignee_member_id": "m9"})

    assert r.status_code >= 400, r.text
    assert _queue(db) == []


def test_changed_payload_409_queues_nothing(db, seed):
    client = _pm_client()
    approval_id = _approval(client)["approval_id"]

    r = _resolve(client, approval_id, payload_version="stale-version")

    assert r.status_code == 409, r.text
    assert _queue(db) == []


def test_approved_task_update_queues_nothing(db, seed):
    client = _pm_client()
    approval = _approval(client, "task_update", {"status": "done"}, related_task_id="t1")

    r = _resolve(client, approval["approval_id"])

    assert r.status_code == 200, r.text
    assert _queue(db) == []
