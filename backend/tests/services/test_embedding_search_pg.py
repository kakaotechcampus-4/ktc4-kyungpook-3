"""pgvector 코사인 검색 테스트. PostgreSQL이 필요해서 TEST_DATABASE_URL이 있을 때만 돈다.

    docker compose up -d db
    docker compose exec db createdb -U mm mm_test
    TEST_DATABASE_URL=postgresql+psycopg://mm:mm@localhost:5432/mm_test pytest tests/services/test_embedding_search_pg.py

테이블을 모두 지웠다 다시 만드므로 개발용 DB(mm)를 가리키면 안 된다.
"""
import math
import os

import pytest
from sqlalchemy import create_engine, text, update
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models import (
    EMBEDDING_DIMENSIONS,
    ApprovalRequest,
    ApprovalStatus,
    ApprovalType,
    Task,
    Workspace,
)
from app.services import embedding

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없어 pgvector 검색 테스트를 건너뜁니다."
)


@pytest.fixture
def db():
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def _vector(similarity: float) -> list[float]:
    """QUERY와의 코사인 유사도가 정확히 similarity인 단위 벡터."""
    angle = math.acos(similarity)
    return [math.cos(angle), math.sin(angle)] + [0.0] * (EMBEDDING_DIMENSIONS - 2)


QUERY = _vector(1.0)


def _workspace(db, name: str = "A") -> Workspace:
    workspace = Workspace(name=name)
    db.add(workspace)
    db.flush()
    return workspace


def _task(db, workspace: Workspace, title: str, similarity: float | None, status: str = "todo") -> Task:
    task = Task(workspace_id=workspace.workspace_id, title=title, status=status)
    db.add(task)
    db.flush()
    if similarity is not None:
        db.execute(update(Task).where(Task.task_id == task.task_id).values(embedding=_vector(similarity)))
    return task


def _titles(results) -> list[str]:
    return [task.title for task, _ in results]


def test_returns_top_k_in_similarity_order(db):
    ws = _workspace(db)
    _task(db, ws, "0.5", 0.5)
    _task(db, ws, "0.9", 0.9)
    _task(db, ws, "0.7", 0.7)
    _task(db, ws, "0.6", 0.6)
    db.commit()

    results = embedding.search_similar_tasks(db, ws.workspace_id, QUERY, k=3)

    assert _titles(results) == ["0.9", "0.7", "0.6"]
    assert [round(s, 3) for _, s in results] == [0.9, 0.7, 0.6]


def test_drops_candidates_below_min_similarity(db):
    ws = _workspace(db)
    _task(db, ws, "0.91", 0.91)
    _task(db, ws, "0.42", 0.42)
    _task(db, ws, "0.38", 0.38)
    db.commit()

    assert _titles(embedding.search_similar_tasks(db, ws.workspace_id, QUERY)) == ["0.91", "0.42"]
    assert embedding.search_similar_tasks(db, ws.workspace_id, QUERY, min_similarity=0.95) == []


def test_includes_all_statuses_but_excludes_missing_embeddings_and_other_workspaces(db):
    ws, other = _workspace(db, "A"), _workspace(db, "B")
    _task(db, ws, "todo", 0.8, status="todo")
    _task(db, ws, "in_progress", 0.8, status="in_progress")
    _task(db, ws, "blocked", 0.8, status="blocked")
    _task(db, ws, "done", 0.8, status="done")
    _task(db, ws, "임베딩 없음", None)
    _task(db, other, "다른 워크스페이스", 0.99)
    db.commit()

    results = embedding.search_similar_tasks(db, ws.workspace_id, QUERY, k=10)

    assert sorted(_titles(results)) == ["blocked", "done", "in_progress", "todo"]


def test_excludes_deleted_tasks(db):
    ws = _workspace(db)
    _task(db, ws, "남은 task", 0.8)
    deleted = _task(db, ws, "지운 task", 0.95)
    deleted.is_deleted = True
    db.commit()

    assert _titles(embedding.search_similar_tasks(db, ws.workspace_id, QUERY)) == ["남은 task"]


def _approval(
    db,
    workspace: Workspace,
    title: str,
    similarity: float | None,
    *,
    type: str = ApprovalType.TASK_CREATE,
    status: str = ApprovalStatus.PENDING,
) -> ApprovalRequest:
    request = ApprovalRequest(
        workspace_id=workspace.workspace_id,
        type=type,
        status=status,
        payload=f'{{"task_title": "{title}"}}',
    )
    db.add(request)
    db.flush()
    if similarity is not None:
        db.execute(
            update(ApprovalRequest)
            .where(ApprovalRequest.approval_id == request.approval_id)
            .values(embedding=_vector(similarity))
        )
    return request


def _pending_ids(results) -> list[str]:
    return [request.approval_id for request, _ in results]


def test_pending_search_returns_at_most_two_by_similarity(db):
    ws = _workspace(db)
    low = _approval(db, ws, "0.6", 0.6)
    top = _approval(db, ws, "0.9", 0.9)
    mid = _approval(db, ws, "0.7", 0.7)
    db.commit()

    results = embedding.search_similar_pending_approvals(db, ws.workspace_id, QUERY)

    assert embedding.MAX_PENDING_CANDIDATES == 2
    assert _pending_ids(results) == [top.approval_id, mid.approval_id]
    assert [round(s, 3) for _, s in results] == [0.9, 0.7]
    assert low.approval_id not in _pending_ids(results)


def test_pending_search_excludes_other_workspace_resolved_update_and_unembedded(db):
    ws, other = _workspace(db, "A"), _workspace(db, "B")
    keep = _approval(db, ws, "대기", 0.8)
    _approval(db, other, "다른 워크스페이스", 0.99)
    _approval(db, ws, "승인됨", 0.99, status=ApprovalStatus.APPROVED)
    _approval(db, ws, "거절됨", 0.99, status=ApprovalStatus.REJECTED)
    _approval(db, ws, "수정 요청", 0.99, type=ApprovalType.TASK_UPDATE)
    _approval(db, ws, "임베딩 없음", None)
    db.commit()

    results = embedding.search_similar_pending_approvals(db, ws.workspace_id, QUERY, limit=10)

    assert _pending_ids(results) == [keep.approval_id]


def test_pending_search_respects_min_similarity(db):
    ws = _workspace(db)
    above = _approval(db, ws, "0.42", 0.42)
    _approval(db, ws, "0.38", 0.38)
    db.commit()

    assert _pending_ids(embedding.search_similar_pending_approvals(db, ws.workspace_id, QUERY)) == [
        above.approval_id
    ]
    assert (
        embedding.search_similar_pending_approvals(db, ws.workspace_id, QUERY, min_similarity=0.95)
        == []
    )
