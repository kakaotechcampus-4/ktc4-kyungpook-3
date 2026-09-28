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
from app.models import EMBEDDING_DIMENSIONS, Task, Workspace
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
