from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.errors import AppError
from app.models import Integration, NotionSyncJob, Task, Workspace
from app.services import notion_sync
from app.services.tasks import apply_task_updates, create_task


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


class FakeNotion:
    """요청을 기록하고, 미리 정해 둔 응답(또는 예외)을 순서대로 돌려준다."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests: list[tuple[str, str]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append((request.method, request.url.path))
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self)


def _page(page_id: str = "page-1") -> httpx.Response:
    return httpx.Response(200, json={"id": page_id})


def _later(minutes: int = 60) -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=minutes)


def _workspace(db, *, with_integration: bool = True) -> Workspace:
    workspace = Workspace(name="워크스페이스")
    db.add(workspace)
    db.flush()
    if with_integration:
        db.add(
            Integration(
                workspace_id=workspace.workspace_id,
                provider="notion",
                access_token="secret_token",
                provider_channel_id="db_123",
            )
        )
    db.commit()
    return workspace


def _create(db, workspace: Workspace) -> Task:
    task = create_task(
        db, workspace_id=workspace.workspace_id, title="설계 문서 작성", change_source="manual"
    )
    db.commit()
    return task


def _jobs(db, task: Task) -> list[NotionSyncJob]:
    return db.execute(
        select(NotionSyncJob)
        .where(NotionSyncJob.task_id == task.task_id)
        .order_by(NotionSyncJob.task_version)
    ).scalars().all()


def test_no_job_without_integration(db):
    task = _create(db, _workspace(db, with_integration=False))

    assert _jobs(db, task) == []
    assert task.notion_sync_status is None


def test_task_change_commits_job_without_calling_notion(db):
    task = _create(db, _workspace(db))

    jobs = _jobs(db, task)
    assert [(j.task_version, j.status) for j in jobs] == [(1, "pending")]
    assert task.notion_sync_status == "pending"


def test_rolled_back_task_change_leaves_no_job(db):
    workspace = _workspace(db)
    create_task(db, workspace_id=workspace.workspace_id, title="롤백될 Task", change_source="manual")
    db.rollback()

    assert db.execute(select(NotionSyncJob)).scalars().all() == []


def test_worker_creates_page_and_marks_synced(db):
    task = _create(db, _workspace(db))
    fake = FakeNotion(_page())

    assert notion_sync.process_due_jobs(db, transport=fake.transport) == 1

    db.refresh(task)
    assert fake.requests == [("POST", "/v1/pages")]
    assert task.notion_page_id == "page-1"
    assert task.notion_synced_version == 1
    assert task.notion_sync_status == "synced"
    assert task.notion_create_attempted_at is None
    assert _jobs(db, task)[0].status == "done"


def test_sync_does_not_touch_task_updated_at(db):
    task = _create(db, _workspace(db))
    before = task.updated_at

    notion_sync.process_due_jobs(db, transport=FakeNotion(_page()).transport)

    db.refresh(task)
    assert task.updated_at == before


def test_older_versions_are_not_sent_twice(db):
    task = _create(db, _workspace(db))
    notion_sync.process_due_jobs(db, transport=FakeNotion(_page()).transport)

    apply_task_updates(db, task, {"progress": 10}, change_source="manual")
    db.commit()
    apply_task_updates(db, task, {"progress": 20}, change_source="manual")
    db.commit()
    assert task.version == 3

    fake = FakeNotion(_page())
    notion_sync.process_due_jobs(db, transport=fake.transport)

    db.refresh(task)
    # v2 작업이 v3 값 전체를 보냈으므로 v3 작업은 보내지 않고 건너뛴다.
    assert fake.requests == [("PATCH", "/v1/pages/page-1")]
    assert [(j.task_version, j.status) for j in _jobs(db, task)] == [
        (1, "done"), (2, "done"), (3, "skipped"),
    ]
    assert task.notion_synced_version == 3
    assert task.notion_sync_status == "synced"


def test_retryable_error_is_retried_later(db):
    task = _create(db, _workspace(db))
    fake = FakeNotion(httpx.Response(429, json={"message": "rate limited"}), _page())

    notion_sync.process_due_jobs(db, transport=fake.transport)
    job = _jobs(db, task)[0]
    assert (job.status, job.attempts) == ("pending", 1)
    assert "rate limited" in job.last_error

    # 백오프 전에는 다시 시도하지 않는다.
    assert notion_sync.process_due_jobs(db, transport=fake.transport) == 0

    notion_sync.process_due_jobs(db, transport=fake.transport, now=_later())
    db.refresh(task)
    assert fake.requests == [("POST", "/v1/pages"), ("POST", "/v1/pages")]
    assert task.notion_sync_status == "synced"
    assert _jobs(db, task)[0].attempts == 2


def test_gives_up_after_max_attempts(db):
    task = _create(db, _workspace(db))
    fake = FakeNotion(*[httpx.ConnectError("refused")] * notion_sync.MAX_ATTEMPTS)

    for i in range(notion_sync.MAX_ATTEMPTS):
        notion_sync.process_due_jobs(db, transport=fake.transport, now=_later(60 * (i + 1)))

    db.refresh(task)
    job = _jobs(db, task)[0]
    assert (job.status, job.attempts) == ("failed", notion_sync.MAX_ATTEMPTS)
    assert task.notion_sync_status == "failed"


def test_permanent_error_fails_immediately_and_can_be_retried(db):
    task = _create(db, _workspace(db))
    fake = FakeNotion(httpx.Response(400, json={"message": "Task ID is not a property"}), _page())

    notion_sync.process_due_jobs(db, transport=fake.transport)
    db.refresh(task)
    job = _jobs(db, task)[0]
    assert (job.status, job.attempts) == ("failed", 1)
    assert job.last_error == "[400] Task ID is not a property"
    assert task.notion_sync_status == "failed"
    # 거부가 확실하므로 다음 시도는 조회 없이 바로 POST해도 된다.
    assert task.notion_create_attempted_at is None

    notion_sync.retry_failed_sync(db, task)
    db.commit()
    db.refresh(task)
    assert task.notion_sync_status == "pending"

    notion_sync.process_due_jobs(db, transport=fake.transport, now=_later())
    db.refresh(task)
    assert fake.requests == [("POST", "/v1/pages"), ("POST", "/v1/pages")]
    assert task.notion_sync_status == "synced"


def test_retry_rejected_when_nothing_failed(db):
    task = _create(db, _workspace(db))

    with pytest.raises(AppError):
        notion_sync.retry_failed_sync(db, task)


def test_timeout_on_create_looks_up_page_instead_of_posting_again(db):
    task = _create(db, _workspace(db))
    fake = FakeNotion(
        httpx.ReadTimeout("timed out"),
        # 조회해 보니 앞선 POST가 실제로 페이지를 만들어 뒀다.
        httpx.Response(200, json={"results": [{"id": "page-1"}]}),
        _page(),
    )

    notion_sync.process_due_jobs(db, transport=fake.transport)
    db.refresh(task)
    assert task.notion_page_id is None
    assert task.notion_create_attempted_at is not None

    notion_sync.process_due_jobs(db, transport=fake.transport, now=_later())
    db.refresh(task)
    assert fake.requests == [
        ("POST", "/v1/pages"),
        ("POST", "/v1/databases/db_123/query"),
        ("PATCH", "/v1/pages/page-1"),
    ]
    assert task.notion_page_id == "page-1"
    assert task.notion_sync_status == "synced"


def test_timeout_on_create_posts_again_only_if_lookup_finds_nothing(db):
    task = _create(db, _workspace(db))
    fake = FakeNotion(
        httpx.ReadTimeout("timed out"),
        httpx.Response(200, json={"results": []}),
        _page("page-2"),
    )

    notion_sync.process_due_jobs(db, transport=fake.transport)
    notion_sync.process_due_jobs(db, transport=fake.transport, now=_later())

    db.refresh(task)
    assert fake.requests == [
        ("POST", "/v1/pages"),
        ("POST", "/v1/databases/db_123/query"),
        ("POST", "/v1/pages"),
    ]
    assert task.notion_page_id == "page-2"


def test_stale_in_progress_job_is_reclaimed_and_reconciled(db):
    """POST 도중 워커가 죽은 경우: 리스가 지나면 다시 잡고, POST 대신 조회부터 한다."""
    task = _create(db, _workspace(db))
    now = datetime.now(timezone.utc)
    db.execute(
        update(NotionSyncJob)
        .where(NotionSyncJob.task_id == task.task_id)
        .values(status="in_progress", attempts=1, locked_at=now)
    )
    db.execute(
        update(Task).where(Task.task_id == task.task_id).values(notion_create_attempted_at=now)
    )
    db.commit()

    fake = FakeNotion(httpx.Response(200, json={"results": [{"id": "page-1"}]}), _page())
    assert notion_sync.process_due_jobs(db, transport=fake.transport) == 0

    notion_sync.process_due_jobs(
        db, transport=fake.transport,
        now=now + timedelta(seconds=notion_sync.LEASE_SECONDS + 1),
    )
    db.refresh(task)
    assert fake.requests == [("POST", "/v1/databases/db_123/query"), ("PATCH", "/v1/pages/page-1")]
    assert task.notion_sync_status == "synced"


def test_removed_integration_skips_pending_jobs(db):
    workspace = _workspace(db)
    task = _create(db, workspace)
    db.query(Integration).filter(Integration.workspace_id == workspace.workspace_id).delete()
    db.commit()

    fake = FakeNotion()
    notion_sync.process_due_jobs(db, transport=fake.transport)

    db.refresh(task)
    assert fake.requests == []
    assert _jobs(db, task)[0].status == "skipped"
    assert task.notion_sync_status is None
