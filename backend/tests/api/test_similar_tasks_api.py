"""POST /workspaces/{id}/tasks/similar — 인증, 오류, 응답 형식.

pgvector 검색 자체는 tests/services/test_embedding_search_pg.py가 PostgreSQL에서 본다.
여기서는 임베딩 호출과 검색을 바꿔 끼워 sqlite로 돌린다.
"""
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import Task, Workspace
from app.services import embedding

TOKEN = "test-service-token"
HEADERS = {"X-Service-Token": TOKEN}


@pytest.fixture
def db(monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", TOKEN)
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
    return TestClient(app)


@pytest.fixture
def workspace(db) -> Workspace:
    ws = Workspace(name="A")
    db.add(ws)
    db.commit()
    return ws


@pytest.fixture
def search_calls(monkeypatch):
    """임베딩 호출과 검색을 가짜로 바꾸고, 검색에 넘어간 인자를 기록한다."""
    calls: list[dict] = []
    monkeypatch.setattr(embedding, "embed_texts", lambda texts: [[0.1] * 3 for _ in texts])

    def fake_search(db, workspace_id, query_vector, *, k, min_similarity):
        calls.append({"workspace_id": workspace_id, "k": k, "min_similarity": min_similarity})
        tasks = db.query(Task).filter(Task.workspace_id == workspace_id).order_by(Task.title).all()
        return [(task, 0.912345) for task in tasks]

    monkeypatch.setattr(embedding, "search_similar_tasks", fake_search)
    return calls


def _url(workspace_id: str) -> str:
    return f"/api/v1/workspaces/{workspace_id}/tasks/similar"


@pytest.mark.parametrize(
    "headers", [{}, {"X-Service-Token": "wrong"}], ids=["missing-token", "wrong-token"]
)
def test_rejects_requests_without_valid_service_token(client, workspace, search_calls, headers):
    r = client.post(_url(workspace.workspace_id), json={"text": "로그인"}, headers=headers)

    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHENTICATED"
    assert search_calls == []


def test_rejects_everything_when_server_has_no_service_token(client, workspace, search_calls, monkeypatch):
    monkeypatch.delenv("SERVICE_TOKEN")

    r = client.post(_url(workspace.workspace_id), json={"text": "로그인"}, headers=HEADERS)

    assert r.status_code == 401


def test_unknown_workspace_is_404(client, search_calls):
    r = client.post(_url("no-such-workspace"), json={"text": "로그인"}, headers=HEADERS)

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "WORKSPACE_NOT_FOUND"


def test_returns_candidates_in_notion_candidate_shape(client, db, workspace, search_calls):
    db.add(Task(
        workspace_id=workspace.workspace_id, title="로그인 API 구현", status="in_progress",
        due_date=date(2026, 9, 25), notion_page_id="page-1",
    ))
    db.commit()

    r = client.post(_url(workspace.workspace_id), json={"text": "로그인 마감 연기"}, headers=HEADERS)

    assert r.status_code == 200
    [item] = r.json()["data"]["items"]
    assert set(item) == {
        "task_id", "notion_page_id", "title", "content_snippet", "assignee_member_id",
        "due_date", "status", "similarity", "updated_at",
    }
    assert item["title"] == "로그인 API 구현"
    assert item["notion_page_id"] == "page-1"
    assert item["content_snippet"] == ""
    assert item["due_date"] == "2026-09-25"
    assert item["status"] == "in_progress"
    assert item["similarity"] == 0.9123
    # 기본값: k=3, min_similarity=0.4 (decision_log 0010)
    assert search_calls == [{"workspace_id": workspace.workspace_id, "k": 3, "min_similarity": 0.4}]


def test_passes_k_and_min_similarity(client, workspace, search_calls):
    r = client.post(
        _url(workspace.workspace_id),
        json={"text": "로그인", "k": 5, "min_similarity": 0.3},
        headers=HEADERS,
    )

    assert r.status_code == 200
    assert search_calls[0]["k"] == 5
    assert search_calls[0]["min_similarity"] == 0.3


def test_embedding_failure_is_error_not_empty_list(client, workspace, search_calls, monkeypatch):
    def fail(texts):
        raise embedding.EmbeddingError("timeout")

    monkeypatch.setattr(embedding, "embed_texts", fail)

    r = client.post(_url(workspace.workspace_id), json={"text": "로그인"}, headers=HEADERS)

    assert r.status_code == 502
    assert r.json()["error"]["code"] == "EMBEDDING_UNAVAILABLE"
    assert search_calls == []


def test_embedding_failure_is_logged_without_request_text(
    client, workspace, search_calls, monkeypatch, caplog
):
    def fail(texts):
        raise embedding.EmbeddingError("임베딩 API 오류 [401] invalid key")

    monkeypatch.setattr(embedding, "embed_texts", fail)

    with caplog.at_level("WARNING", logger="app.api.similar_tasks"):
        client.post(
            _url(workspace.workspace_id), json={"text": "민감한 회의 발화"}, headers=HEADERS
        )

    [record] = [r for r in caplog.records if r.name == "app.api.similar_tasks"]
    assert record.levelname == "WARNING"
    message = record.getMessage()
    # BE에서도 원인과 워크스페이스를 알 수 있고, 발화 내용은 남기지 않는다
    assert workspace.workspace_id in message
    assert "invalid key" in message
    assert "민감한 회의 발화" not in message


@pytest.mark.parametrize(
    "body", [{"text": ""}, {"text": "로그인", "k": 0}, {"text": "로그인", "min_similarity": 1.5}],
    ids=["empty-text", "k-zero", "similarity-over-1"],
)
def test_invalid_request_is_400(client, workspace, search_calls, body):
    r = client.post(_url(workspace.workspace_id), json=body, headers=HEADERS)

    assert r.status_code == 400
