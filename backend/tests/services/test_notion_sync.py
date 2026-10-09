import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.errors import AppError
from app.models import Integration, NotionSyncJob, Task, Workspace
from app.services import notion, notion_sync
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
        self.bodies: list[dict | None] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append((request.method, request.url.path))
        self.bodies.append(json.loads(request.content) if request.content else None)
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
    assert task.notion_database_id == "db_123"
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


def _stale_last_attempt(db, task: Task) -> datetime:
    """마지막(MAX_ATTEMPTS번째) 시도를 처리하던 중 워커가 죽은 상태를 만든다."""
    now = datetime.now(timezone.utc)
    db.execute(
        update(NotionSyncJob)
        .where(NotionSyncJob.task_id == task.task_id, NotionSyncJob.task_version == 1)
        .values(status="in_progress", attempts=notion_sync.MAX_ATTEMPTS, locked_at=now)
    )
    db.commit()
    return now + timedelta(seconds=notion_sync.LEASE_SECONDS + 1)


def test_stale_job_over_max_attempts_marks_task_failed(db):
    task = _create(db, _workspace(db))
    after_lease = _stale_last_attempt(db, task)

    fake = FakeNotion()
    notion_sync.process_due_jobs(db, transport=fake.transport, now=after_lease)

    db.refresh(task)
    assert [j.status for j in _jobs(db, task)] == ["failed"]
    assert task.notion_sync_status == "failed"
    assert fake.requests == []


def test_stale_job_over_max_attempts_waits_for_newer_job(db):
    task = _create(db, _workspace(db))
    apply_task_updates(db, task, {"title": "제목 변경"}, change_source="manual")
    db.commit()
    # 더 최신 작업(v2)은 아직 시도할 때가 안 됐다.
    db.execute(
        update(NotionSyncJob)
        .where(NotionSyncJob.task_id == task.task_id, NotionSyncJob.task_version == 2)
        .values(next_attempt_at=_later(60 * 24))
    )
    db.commit()
    after_lease = _stale_last_attempt(db, task)

    notion_sync.process_due_jobs(db, transport=FakeNotion().transport, now=after_lease)

    db.refresh(task)
    assert [(j.task_version, j.status) for j in _jobs(db, task)] == [(1, "failed"), (2, "pending")]
    assert task.notion_sync_status == "pending"


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


# ---------- 대상 DB가 바뀐 경우 ----------


def _switch_database(db, workspace: Workspace, database_id: str) -> None:
    """PM이 다시 연결해 연결 행이 새 DB를 가리키게 됐다."""
    db.execute(
        update(Integration)
        .where(Integration.workspace_id == workspace.workspace_id, Integration.provider == "notion")
        .values(provider_channel_id=database_id)
    )
    db.commit()


def _synced_task(db, workspace: Workspace) -> Task:
    """db_123에 page-1로 반영된 Task."""
    task = _create(db, workspace)
    notion_sync.process_due_jobs(db, transport=FakeNotion(_page()).transport)
    db.refresh(task)
    assert (task.notion_page_id, task.notion_database_id, task.notion_synced_version) == ("page-1", "db_123", 1)
    return task


def test_changed_database_creates_new_page_instead_of_updating_old_one(db):
    workspace = _workspace(db)
    task = _synced_task(db, workspace)
    _switch_database(db, workspace, "db_456")
    apply_task_updates(db, task, {"progress": 10}, change_source="manual")
    db.commit()

    fake = FakeNotion(_page("page-2"))
    notion_sync.process_due_jobs(db, transport=fake.transport)

    db.refresh(task)
    # 옛 DB의 page-1을 고치지 않고 새 DB에 만든다
    assert fake.requests == [("POST", "/v1/pages")]
    assert fake.bodies[0]["parent"] == {"database_id": "db_456"}
    assert (task.notion_page_id, task.notion_database_id, task.notion_synced_version) == ("page-2", "db_456", 2)
    assert task.notion_sync_status == "synced"


def test_changed_database_is_sent_even_if_version_was_synced_to_old_one(db):
    workspace = _workspace(db)
    task = _synced_task(db, workspace)
    _switch_database(db, workspace, "db_456")
    # 같은 버전(v1)을 다시 확인하게 한다. 옛 DB 기준으로는 이미 반영된 버전이다
    db.execute(update(NotionSyncJob).where(NotionSyncJob.task_id == task.task_id).values(status="pending"))
    db.commit()

    fake = FakeNotion(_page("page-2"))
    notion_sync.process_due_jobs(db, transport=fake.transport)

    db.refresh(task)
    assert fake.requests == [("POST", "/v1/pages")]
    assert (task.notion_page_id, task.notion_database_id, task.notion_synced_version) == ("page-2", "db_456", 1)


def test_unknown_create_result_in_changed_database_looks_up_new_database(db):
    workspace = _workspace(db)
    task = _synced_task(db, workspace)
    _switch_database(db, workspace, "db_456")
    apply_task_updates(db, task, {"progress": 10}, change_source="manual")
    db.commit()
    fake = FakeNotion(
        httpx.ReadTimeout("timed out"),
        httpx.Response(200, json={"results": []}),
        _page("page-2"),
    )

    notion_sync.process_due_jobs(db, transport=fake.transport)
    notion_sync.process_due_jobs(db, transport=fake.transport, now=_later())

    db.refresh(task)
    # 옛 DB의 page-1은 쓰지 않는다. 앞선 POST가 새 DB에 만들어 뒀는지 새 DB에서 찾고, 없으면 만든다
    assert fake.requests == [
        ("POST", "/v1/pages"),
        ("POST", "/v1/databases/db_456/query"),
        ("POST", "/v1/pages"),
    ]
    assert fake.bodies[2]["parent"] == {"database_id": "db_456"}
    assert (task.notion_page_id, task.notion_database_id) == ("page-2", "db_456")


def test_records_database_it_actually_sent_to_even_if_connection_changes_meanwhile(db, monkeypatch):
    workspace = _workspace(db)
    task = _create(db, workspace)
    create_page = notion.create_page

    def change_connection_then_create(*args, **kwargs):
        # 워커가 POST 전에 커밋한 직후, 다시 연결이 끝나 새 DB가 붙었다
        _switch_database(db, workspace, "db_456")
        return create_page(*args, **kwargs)

    monkeypatch.setattr(notion, "create_page", change_connection_then_create)
    fake = FakeNotion(_page())

    notion_sync.process_due_jobs(db, transport=fake.transport)

    db.refresh(task)
    # 처리 시작 때 읽은 DB로 보내고, 기록도 그 DB로 남는다
    assert fake.bodies[0]["parent"] == {"database_id": "db_123"}
    assert (task.notion_page_id, task.notion_database_id) == ("page-1", "db_123")


def test_retry_is_allowed_when_database_changed_even_if_version_was_synced(db):
    workspace = _workspace(db)
    task = _create(db, workspace)
    fake = FakeNotion(httpx.Response(400, json={"message": "invalid"}), _page(), _page("page-2"))
    notion_sync.process_due_jobs(db, transport=fake.transport)  # v1은 실패
    apply_task_updates(db, task, {"progress": 10}, change_source="manual")
    db.commit()
    notion_sync.process_due_jobs(db, transport=fake.transport)  # v2가 page-1로 반영
    db.refresh(task)
    assert (task.notion_synced_version, task.notion_database_id) == (2, "db_123")

    # 같은 DB에는 v1 이후가 이미 반영돼 재시도할 것이 없다
    with pytest.raises(AppError):
        notion_sync.retry_failed_sync(db, task)

    _switch_database(db, workspace, "db_456")
    notion_sync.retry_failed_sync(db, task)
    db.commit()
    notion_sync.process_due_jobs(db, transport=fake.transport, now=_later())

    db.refresh(task)
    assert fake.requests[-1] == ("POST", "/v1/pages")
    assert fake.bodies[-1]["parent"] == {"database_id": "db_456"}
    assert (task.notion_page_id, task.notion_database_id) == ("page-2", "db_456")
