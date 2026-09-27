import json

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models import EMBEDDING_DIMENSIONS, Task, TaskHistory, Workspace
from app.services import embedding
from app.services.tasks import apply_task_updates, create_task, rollback_task_history


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setenv("EMBEDDING_API_KEY", "test-key")
    monkeypatch.setenv("EMBEDDING_BASE_URL", "https://embed.example.com/v1/")


def _vector(seed: float) -> list[float]:
    return [seed] * EMBEDDING_DIMENSIONS


class FakeEmbeddingApi:
    """받은 요청을 기록하고, 입력 문장마다 벡터를 돌려준다(일부러 index 역순으로)."""

    def __init__(self, *, status_code: int = 200, error: Exception | None = None):
        self.status_code = status_code
        self.error = error
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        if self.status_code != 200:
            return httpx.Response(self.status_code, json={"error": "boom"})
        texts = json.loads(request.content)["input"]
        data = [{"index": i, "embedding": _vector(float(i + 1))} for i in range(len(texts))]
        return httpx.Response(200, json={"data": list(reversed(data))})

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self)

    def inputs(self) -> list[list[str]]:
        return [json.loads(r.content)["input"] for r in self.requests]


def _workspace(db) -> Workspace:
    workspace = Workspace(name="워크스페이스")
    db.add(workspace)
    db.commit()
    return workspace


def _task(db, workspace: Workspace, title: str) -> Task:
    task = create_task(db, workspace_id=workspace.workspace_id, title=title, change_source="manual")
    db.commit()
    return task


def _embedding_of(db, task: Task) -> list[float] | None:
    return db.execute(select(Task.embedding).where(Task.task_id == task.task_id)).scalar_one()


# ── embed_texts ──

def test_embed_texts_sends_openai_compatible_request_and_keeps_order():
    api = FakeEmbeddingApi()

    vectors = embedding.embed_texts(["첫째", "둘째"], transport=api.transport)

    request = api.requests[0]
    assert str(request.url) == "https://embed.example.com/v1/embeddings"
    assert request.headers["Authorization"] == "Bearer test-key"
    assert json.loads(request.content) == {"model": "text-embedding-3-small", "input": ["첫째", "둘째"]}
    # 응답을 index 역순으로 줘도 입력 순서대로 돌려준다
    assert [v[0] for v in vectors] == [1.0, 2.0]


def test_embed_texts_without_config_raises(monkeypatch):
    monkeypatch.delenv("EMBEDDING_API_KEY")

    with pytest.raises(embedding.EmbeddingError):
        embedding.embed_texts(["문장"], transport=FakeEmbeddingApi().transport)


@pytest.mark.parametrize(
    "api",
    [FakeEmbeddingApi(status_code=500), FakeEmbeddingApi(error=httpx.ConnectError("refused"))],
    ids=["http-error", "network-error"],
)
def test_embed_texts_failure_raises(api):
    with pytest.raises(embedding.EmbeddingError):
        embedding.embed_texts(["문장"], transport=api.transport)


def test_embed_texts_rejects_wrong_dimension():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.1, 0.2]}]})

    with pytest.raises(embedding.EmbeddingError):
        embedding.embed_texts(["문장"], transport=httpx.MockTransport(handler))


# ── 워커: 임베딩이 없는 task 채우기 ──

def test_new_task_has_no_embedding_until_worker_fills_it(db):
    workspace = _workspace(db)
    first = _task(db, workspace, "로그인 API 구현")
    second = _task(db, workspace, "결제 API 리팩토링")
    assert _embedding_of(db, first) is None

    api = FakeEmbeddingApi()
    assert embedding.process_missing_embeddings(db, transport=api.transport) == 2

    # 한 번의 API 호출로 묶어서 보낸다
    assert api.inputs() == [["로그인 API 구현", "결제 API 리팩토링"]]
    assert _embedding_of(db, first)[0] == pytest.approx(1.0)
    assert _embedding_of(db, second)[0] == pytest.approx(2.0)
    # 다 채웠으면 다음 주기에는 호출하지 않는다
    assert embedding.process_missing_embeddings(db, transport=api.transport) == 0
    assert len(api.requests) == 1


def test_worker_does_not_touch_updated_at(db):
    task = _task(db, _workspace(db), "로그인 API 구현")
    before = task.updated_at

    embedding.process_missing_embeddings(db, transport=FakeEmbeddingApi().transport)

    db.refresh(task)
    assert task.updated_at == before


def test_worker_failure_leaves_embedding_empty_for_retry(db):
    task = _task(db, _workspace(db), "로그인 API 구현")

    with pytest.raises(embedding.EmbeddingError):
        embedding.process_missing_embeddings(db, transport=FakeEmbeddingApi(status_code=503).transport)
    assert _embedding_of(db, task) is None

    assert embedding.process_missing_embeddings(db, transport=FakeEmbeddingApi().transport) == 1
    assert _embedding_of(db, task) is not None


def test_worker_skips_task_whose_title_changed_while_embedding(db):
    task = _task(db, _workspace(db), "옛 제목")

    def handler(request: httpx.Request) -> httpx.Response:
        # 임베딩을 계산하는 사이에 제목이 바뀐다
        apply_task_updates(db, task, {"title": "새 제목"}, change_source="manual")
        db.commit()
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": _vector(1.0)}]})

    assert embedding.process_missing_embeddings(db, transport=httpx.MockTransport(handler)) == 0
    assert _embedding_of(db, task) is None

    api = FakeEmbeddingApi()
    assert embedding.process_missing_embeddings(db, transport=api.transport) == 1
    assert api.inputs() == [["새 제목"]]


# ── 제목이 바뀌면 임베딩을 비운다 ──

def _embedded_task(db) -> Task:
    task = _task(db, _workspace(db), "로그인 API 구현")
    embedding.process_missing_embeddings(db, transport=FakeEmbeddingApi().transport)
    assert _embedding_of(db, task) is not None
    return task


def test_title_change_clears_embedding(db):
    task = _embedded_task(db)

    apply_task_updates(db, task, {"title": "소셜 로그인 API 구현"}, change_source="manual")
    db.commit()

    assert _embedding_of(db, task) is None


def test_other_field_changes_keep_embedding(db):
    task = _embedded_task(db)

    apply_task_updates(
        db, task, {"status": "in_progress", "progress": 30, "title": task.title},
        change_source="manual",
    )
    db.commit()

    assert _embedding_of(db, task) is not None


def test_title_rollback_clears_embedding(db):
    task = _embedded_task(db)
    [history] = apply_task_updates(db, task, {"title": "바뀐 제목"}, change_source="manual")
    db.commit()
    embedding.process_missing_embeddings(db, transport=FakeEmbeddingApi().transport)
    assert _embedding_of(db, task) is not None

    rollback_task_history(db, task, db.get(TaskHistory, history.history_id))
    db.commit()

    assert task.title == "로그인 API 구현"
    assert _embedding_of(db, task) is None
