"""태스크끼리의 유사도 선. pgvector 쿼리라 TEST_DATABASE_URL 이 있을 때만 돈다."""
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
    not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없어 pgvector 쌍 테스트를 건너뜁니다."
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


def _vector(degrees: float) -> list[float]:
    """기준 벡터에서 degrees 만큼 돌린 단위 벡터. 두 벡터의 코사인 유사도는 각도 차이의 코사인이다."""
    angle = math.radians(degrees)
    return [math.cos(angle), math.sin(angle)] + [0.0] * (EMBEDDING_DIMENSIONS - 2)


def _workspace(db, name="A"):
    workspace = Workspace(name=name)
    db.add(workspace)
    db.flush()
    return workspace


def _task(db, workspace, degrees, *, deleted=False):
    task = Task(workspace_id=workspace.workspace_id, title=str(degrees), status="todo", is_deleted=deleted)
    db.add(task)
    db.flush()
    if degrees is not None:
        db.execute(update(Task).where(Task.task_id == task.task_id).values(embedding=_vector(degrees)))
    return task


def _pairs(db, workspace, *, k=2, min_similarity=0.55):
    db.commit()
    return embedding.related_task_pairs(db, workspace.workspace_id, k=k, min_similarity=min_similarity)


def _pair(a, b):
    return (min(a.task_id, b.task_id), max(a.task_id, b.task_id))


def test_near_tasks_pair_once_with_the_smaller_id_first(db):
    ws = _workspace(db)
    a, b = _task(db, ws, 0), _task(db, ws, 10)

    assert _pairs(db, ws) == [_pair(a, b)]


def test_pairs_below_the_threshold_are_dropped(db):
    ws = _workspace(db)
    a, b = _task(db, ws, 0), _task(db, ws, 10)
    _task(db, ws, 80)

    assert _pairs(db, ws, min_similarity=0.9) == [_pair(a, b)]


def test_each_task_keeps_only_its_k_nearest(db):
    ws = _workspace(db)
    a, b, c, d = _task(db, ws, 0), _task(db, ws, 1), _task(db, ws, 3), _task(db, ws, 40)

    assert set(_pairs(db, ws, k=1, min_similarity=0.5)) == {_pair(a, b), _pair(b, c), _pair(c, d)}


def test_excludes_missing_embeddings_deleted_tasks_and_other_workspaces(db):
    ws, other = _workspace(db, "A"), _workspace(db, "B")
    a, b = _task(db, ws, 0), _task(db, ws, 10)
    _task(db, ws, None)
    _task(db, ws, 1, deleted=True)
    _task(db, other, 2)

    assert _pairs(db, ws) == [_pair(a, b)]


def test_no_embeddings_gives_no_pairs(db):
    ws = _workspace(db)
    _task(db, ws, None)

    assert _pairs(db, ws) == []
