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

    def __init__(
        self,
        *,
        status_code: int = 200,
        error: Exception | None = None,
        headers: dict[str, str] | None = None,
        reject: set[str] | None = None,
    ):
        self.status_code = status_code
        self.error = error
        self.headers = headers or {}
        # 이 문장이 하나라도 들어 있는 요청은 400으로 거절한다(요청 전체가 실패한다).
        self.reject = reject or set()
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        if self.status_code != 200:
            return httpx.Response(self.status_code, json={"error": "boom"}, headers=self.headers)
        texts = json.loads(request.content)["input"]
        if self.reject & set(texts):
            return httpx.Response(400, json={"error": "invalid input"})
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


def test_embed_texts_http_error_carries_status_and_retry_after():
    api = FakeEmbeddingApi(status_code=429, headers={"Retry-After": "30"})

    with pytest.raises(embedding.EmbeddingError) as info:
        embedding.embed_texts(["문장"], transport=api.transport)

    assert info.value.status_code == 429
    assert info.value.retry_after == 30.0
    assert not info.value.is_input_error


def test_embed_texts_network_error_has_no_status():
    api = FakeEmbeddingApi(error=httpx.ConnectError("refused"))

    with pytest.raises(embedding.EmbeddingError) as info:
        embedding.embed_texts(["문장"], transport=api.transport)

    assert info.value.status_code is None
    assert info.value.retry_after is None


def test_embed_texts_ignores_date_retry_after():
    api = FakeEmbeddingApi(status_code=503, headers={"Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT"})

    with pytest.raises(embedding.EmbeddingError) as info:
        embedding.embed_texts(["문장"], transport=api.transport)

    assert info.value.retry_after is None


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


def _raw_task(db, workspace: Workspace, title: str) -> Task:
    """제목 검증(create_task)을 거치지 않고 넣은 task. 직접 넣은 데이터 등을 흉내 낸다."""
    task = Task(workspace_id=workspace.workspace_id, title=title)
    db.add(task)
    db.commit()
    return task


def test_worker_excludes_blank_titles(db):
    workspace = _workspace(db)
    blank = _raw_task(db, workspace, "")
    spaces = _raw_task(db, workspace, "   ")
    task = _task(db, workspace, "로그인 API 구현")

    api = FakeEmbeddingApi(reject={"", "   "})
    assert embedding.process_missing_embeddings(db, transport=api.transport) == 1

    # 빈 제목은 보내지 않으므로 나머지 task가 막히지 않는다
    assert api.inputs() == [["로그인 API 구현"]]
    assert _embedding_of(db, task) is not None
    assert _embedding_of(db, blank) is None
    assert _embedding_of(db, spaces) is None


def test_worker_input_error_retries_one_by_one_and_skips_rejected_task(db):
    workspace = _workspace(db)
    first = _task(db, workspace, "로그인 API 구현")
    bad = _task(db, workspace, "거절되는 제목")
    last = _task(db, workspace, "결제 API 리팩토링")

    api = FakeEmbeddingApi(reject={"거절되는 제목"})
    assert embedding.process_missing_embeddings(db, transport=api.transport) == 2

    # 배치 한 번 실패 → 하나씩 세 번
    assert api.inputs() == [
        ["로그인 API 구현", "거절되는 제목", "결제 API 리팩토링"],
        ["로그인 API 구현"],
        ["거절되는 제목"],
        ["결제 API 리팩토링"],
    ]
    assert _embedding_of(db, first) is not None
    assert _embedding_of(db, bad) is None
    assert _embedding_of(db, last) is not None


def test_worker_single_rejected_task_is_not_sent_twice(db):
    task = _task(db, _workspace(db), "거절되는 제목")

    api = FakeEmbeddingApi(reject={"거절되는 제목"})
    assert embedding.process_missing_embeddings(db, transport=api.transport) == 0

    assert len(api.requests) == 1
    assert _embedding_of(db, task) is None


@pytest.mark.parametrize("status_code", [429, 500, 503])
def test_worker_outage_does_not_retry_one_by_one(db, status_code):
    workspace = _workspace(db)
    _task(db, workspace, "로그인 API 구현")
    _task(db, workspace, "결제 API 리팩토링")

    api = FakeEmbeddingApi(status_code=status_code)
    with pytest.raises(embedding.EmbeddingError):
        embedding.process_missing_embeddings(db, transport=api.transport)

    # 장애라면 하나씩 보내도 전부 실패하므로 배치 한 번만 부른다
    assert len(api.requests) == 1


def test_worker_keeps_vectors_received_before_outage_during_one_by_one(db):
    workspace = _workspace(db)
    first = _task(db, workspace, "로그인 API 구현")
    _task(db, workspace, "거절되는 제목")
    last = _task(db, workspace, "결제 API 리팩토링")

    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        texts = json.loads(request.content)["input"]
        if calls == 1:
            return httpx.Response(400, json={"error": "invalid input"})
        if texts == ["로그인 API 구현"]:
            return httpx.Response(200, json={"data": [{"index": 0, "embedding": _vector(1.0)}]})
        # 하나씩 보내던 중에 서버가 죽는다
        return httpx.Response(503, json={"error": "down"})

    with pytest.raises(embedding.EmbeddingError) as info:
        embedding.process_missing_embeddings(db, transport=httpx.MockTransport(handler))

    assert info.value.status_code == 503
    # 장애 전에 받은 벡터는 저장하고, 장애 뒤 task는 보내지 않는다
    assert calls == 3
    assert _embedding_of(db, first) is not None
    assert _embedding_of(db, last) is None


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


# ── 워커 대기 간격 ──

def _error(status_code: int | None = None, retry_after: float | None = None) -> embedding.EmbeddingError:
    return embedding.EmbeddingError("실패", status_code=status_code, retry_after=retry_after)


@pytest.mark.parametrize("status_code", [None, 500, 503])
def test_retry_delay_doubles_on_each_failure_up_to_cap(status_code):
    delays = [embedding.retry_delay(5, failures, _error(status_code)) for failures in range(1, 9)]

    assert delays == [10, 20, 40, 80, 160, 300, 300, 300]


def test_retry_delay_does_not_overflow_after_many_failures():
    assert embedding.retry_delay(5, 10_000, _error(503)) == embedding.MAX_BACKOFF_SECONDS


@pytest.mark.parametrize("status_code", [401, 403])
def test_retry_delay_jumps_to_cap_on_auth_error(status_code):
    assert embedding.retry_delay(5, 1, _error(status_code)) == embedding.MAX_BACKOFF_SECONDS


def test_retry_delay_keeps_interval_on_input_error():
    assert embedding.retry_delay(5, 3, _error(400)) == 5


@pytest.mark.parametrize(
    ("retry_after", "expected"),
    [(30, 30), (1, 5), (3600, embedding.MAX_BACKOFF_SECONDS)],
    ids=["as-is", "not-below-interval", "not-above-cap"],
)
def test_retry_delay_follows_retry_after_within_bounds(retry_after, expected):
    assert embedding.retry_delay(5, 1, _error(429, retry_after)) == expected


def test_run_worker_backs_off_while_failing_and_resets_after_success(monkeypatch):
    outcomes = [_error(503), _error(503), None, _error(503)]
    waits: list[float] = []

    class FakeSession:
        def rollback(self):
            pass

        def close(self):
            pass

    def fake_process(db):
        outcome = outcomes.pop(0)
        if outcome is not None:
            raise outcome
        return 1

    class FakeStopEvent:
        def is_set(self):
            return not outcomes

        def wait(self, delay):
            waits.append(delay)

    monkeypatch.setattr(embedding, "SessionLocal", FakeSession)
    monkeypatch.setattr(embedding, "process_missing_embeddings", fake_process)

    embedding.run_worker(FakeStopEvent(), 5)

    # 실패 두 번에 10초·20초, 성공하면 5초로 돌아가고, 다시 실패하면 10초부터
    assert waits == [10, 20, 5, 10]
