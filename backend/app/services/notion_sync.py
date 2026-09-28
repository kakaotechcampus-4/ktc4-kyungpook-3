"""Task 변경을 Notion에 반영하는 outbox 큐와 워커.

로컬 DB와 Notion은 하나의 트랜잭션으로 묶을 수 없다. 예전처럼 요청 안에서 Notion을
호출하면 "Notion엔 페이지가 생겼는데 로컬 커밋은 실패" 또는 "타임아웃이라 롤백했는데
실제로는 페이지가 생김" 같은 어긋남을 막을 방법이 없다. 그래서 두 단계로 나눈다.

1. `enqueue_task_sync()` — Task 변경과 같은 트랜잭션에 `NotionSyncJob`을 한 줄 넣는다.
   Task가 커밋되면 반영 작업도 반드시 같이 커밋되고, 롤백되면 같이 사라진다.
2. `process_due_jobs()` — 워커가 대기 중인 작업을 꺼내 Notion에 보낸다. 실패하면
   재시도 횟수(`attempts`)와 다음 시도 시각(`next_attempt_at`)을 남기고, 한도를 넘거나
   다시 보내도 소용없는 오류면 `failed`로 둔다.

순서·중복: Notion에는 항상 Task의 "현재 값 전체"를 보내고, 보낸 시점의 `Task.version`을
`notion_synced_version`에 기록한다. 그 이하 버전의 작업은 이미 반영된 것이라 건너뛴다.
오래된 작업이 늦게 처리돼도 최신 값을 덮어쓰지 않는다.

페이지 생성 타임아웃: POST 직전에 `Task.notion_create_attempted_at`을 먼저 커밋한다.
POST 결과를 모르는 채로 끝나면(타임아웃·5xx·워커 중단) 이 값이 남아 있으므로, 다음 시도는
POST를 반복하지 않고 `Task ID` 속성으로 이미 생긴 페이지가 있는지부터 조회한다.

워커는 프로세스당 하나만 도는 것을 전제로 한다(`app/main.py` lifespan).
"""
import logging
import threading
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import exists, select, update
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.errors import AppError, ErrorCode
from app.models import NotionSyncJob, NotionSyncJobStatus, NotionSyncStatus, Task
from app.services import notion

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5
BASE_BACKOFF_SECONDS = 10
MAX_BACKOFF_SECONDS = 600
# in_progress로 이 시간 넘게 남아 있으면 워커가 처리 중 죽은 것으로 보고 다시 대기열에 넣는다.
LEASE_SECONDS = 300

_ACTIVE_STATUSES = (str(NotionSyncJobStatus.PENDING), str(NotionSyncJobStatus.IN_PROGRESS))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def enqueue_task_sync(db: Session, task: Task) -> NotionSyncJob | None:
    """현재 `task.version`을 Notion에 반영하는 작업을 같은 트랜잭션에 쌓는다.

    Notion 연동이 없는 워크스페이스면 아무것도 쌓지 않는다 — 연동은 선택 사항이다.
    """
    if not notion.is_configured(notion.get_notion_integration(db, task.workspace_id)):
        return None
    job = NotionSyncJob(task_id=task.task_id, task_version=task.version)
    db.add(job)
    task.notion_sync_status = str(NotionSyncStatus.PENDING)
    return job


def retry_failed_sync(db: Session, task: Task) -> NotionSyncJob:
    """`failed`로 끝난 가장 최근 작업을 다시 대기열에 넣는다 (재시도 횟수 초기화)."""
    if not notion.is_configured(notion.get_notion_integration(db, task.workspace_id)):
        raise AppError(ErrorCode.INTEGRATION_NOT_CONNECTED, details={"provider": "notion"})

    job = db.execute(
        select(NotionSyncJob)
        .where(
            NotionSyncJob.task_id == task.task_id,
            NotionSyncJob.status == str(NotionSyncJobStatus.FAILED),
        )
        .order_by(NotionSyncJob.task_version.desc())
        .limit(1)
    ).scalar_one_or_none()
    if job is None or job.task_version <= (task.notion_synced_version or 0):
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="재시도할 Notion 반영 실패 건이 없습니다.",
            details={"task_id": task.task_id},
        )

    job.status = str(NotionSyncJobStatus.PENDING)
    job.attempts = 0
    job.next_attempt_at = _now()
    job.locked_at = None
    job.last_error = None
    _update_task_sync(db, task.task_id, notion_sync_status=str(NotionSyncStatus.PENDING))
    return job


def process_due_jobs(
    db: Session,
    *,
    transport: httpx.BaseTransport | None = None,
    now: datetime | None = None,
    limit: int = 20,
) -> int:
    """시도할 때가 된 작업을 최대 `limit`개 처리하고, 실제로 처리한 개수를 돌려준다."""
    now = now or _now()
    _release_stale_jobs(db, now)

    busy_tasks = select(NotionSyncJob.task_id).where(
        NotionSyncJob.status == str(NotionSyncJobStatus.IN_PROGRESS)
    )
    job_ids = db.execute(
        select(NotionSyncJob.job_id)
        .where(
            NotionSyncJob.status == str(NotionSyncJobStatus.PENDING),
            NotionSyncJob.next_attempt_at <= now,
            # 같은 Task를 두 작업이 동시에 보내면 늦게 도착한 쪽이 옛 값으로 덮어쓸 수 있다.
            NotionSyncJob.task_id.not_in(busy_tasks),
        )
        .order_by(NotionSyncJob.created_at)
        .limit(limit)
    ).scalars().all()

    processed = 0
    for job_id in job_ids:
        if not _claim(db, job_id, now):
            continue
        _process(db, job_id, transport=transport, now=now)
        processed += 1
    return processed


def _claim(db: Session, job_id: str, now: datetime) -> bool:
    """pending → in_progress 조건부 UPDATE. rowcount=1인 쪽만 처리를 이어간다."""
    result = db.execute(
        update(NotionSyncJob)
        .where(
            NotionSyncJob.job_id == job_id,
            NotionSyncJob.status == str(NotionSyncJobStatus.PENDING),
        )
        .values(
            status=str(NotionSyncJobStatus.IN_PROGRESS),
            locked_at=now,
            attempts=NotionSyncJob.attempts + 1,
            updated_at=now,
        )
    )
    db.commit()
    return result.rowcount == 1


def _release_stale_jobs(db: Session, now: datetime) -> None:
    stale = (
        NotionSyncJob.status == str(NotionSyncJobStatus.IN_PROGRESS),
        NotionSyncJob.locked_at < now - timedelta(seconds=LEASE_SECONDS),
    )
    db.execute(
        update(NotionSyncJob)
        .where(*stale, NotionSyncJob.attempts < MAX_ATTEMPTS)
        .values(
            status=str(NotionSyncJobStatus.PENDING),
            locked_at=None,
            next_attempt_at=now,
            last_error="처리 중 중단돼 다시 대기열에 넣었습니다.",
            updated_at=now,
        )
    )
    db.execute(
        update(NotionSyncJob)
        .where(*stale, NotionSyncJob.attempts >= MAX_ATTEMPTS)
        .values(
            status=str(NotionSyncJobStatus.FAILED),
            locked_at=None,
            last_error="처리 중 중단된 채 재시도 한도를 넘었습니다.",
            updated_at=now,
        )
    )
    db.commit()


def _update_task_sync(db: Session, task_id: str, **values: object) -> None:
    """Task의 동기화 컬럼만 바꾼다. 사용자 변경이 아니므로 updated_at은 그대로 둔다."""
    db.execute(
        update(Task)
        .where(Task.task_id == task_id)
        .values(**values, updated_at=Task.updated_at)
    )


def _has_newer_active_job(db: Session, task_id: str, version: int) -> bool:
    return db.execute(
        select(
            exists().where(
                NotionSyncJob.task_id == task_id,
                NotionSyncJob.task_version > version,
                NotionSyncJob.status.in_(_ACTIVE_STATUSES),
            )
        )
    ).scalar()


def _finish(job: NotionSyncJob, status: NotionSyncJobStatus, now: datetime,
            error: str | None = None) -> None:
    job.status = str(status)
    job.locked_at = None
    job.last_error = error
    job.updated_at = now


def _process(
    db: Session,
    job_id: str,
    *,
    transport: httpx.BaseTransport | None,
    now: datetime,
) -> None:
    job = db.get(NotionSyncJob, job_id)
    task = db.get(Task, job.task_id)
    if task is None:
        _finish(job, NotionSyncJobStatus.SKIPPED, now, "Task가 삭제됐습니다.")
        db.commit()
        return

    # 이 버전(또는 그 이후 버전)이 이미 반영됐다 — 중복 전송하지 않는다.
    if task.notion_synced_version is not None and job.task_version <= task.notion_synced_version:
        _finish(job, NotionSyncJobStatus.SKIPPED, now)
        db.commit()
        return

    integration = notion.get_notion_integration(db, task.workspace_id)
    if not notion.is_configured(integration):
        _finish(job, NotionSyncJobStatus.SKIPPED, now, "Notion 연동이 해제됐습니다.")
        _update_task_sync(db, task.task_id, notion_sync_status=None)
        db.commit()
        return

    task_id = task.task_id
    creating = False
    try:
        page_id = task.notion_page_id
        if page_id is None and task.notion_create_attempted_at is not None:
            # 이전 POST의 결과를 모른다 — 다시 만들기 전에 이미 생긴 페이지가 있는지 본다.
            page_id = notion.find_page_by_task_id(integration, task_id, transport=transport)
            if page_id is not None:
                _update_task_sync(db, task_id, notion_page_id=page_id)

        if page_id is not None:
            synced_version = task.version
            notion.update_page(db, integration, task, page_id, transport=transport)
        else:
            creating = True
            # POST 전에 먼저 커밋해 둬야, 응답을 못 받은 채 워커가 죽어도 흔적이 남는다.
            _update_task_sync(db, task_id, notion_create_attempted_at=now)
            db.commit()
            synced_version = task.version
            page_id = notion.create_page(db, integration, task, transport=transport)
            _update_task_sync(db, task_id, notion_page_id=page_id)
    except notion.NotionWriteError as exc:
        _handle_failure(db, job, task_id, exc, creating=creating, now=now)
        return

    _finish(job, NotionSyncJobStatus.DONE, now)
    # 방금 보낸 값이 이 버전까지를 다 담고 있으므로, 남은 옛 작업은 보낼 필요가 없다.
    db.execute(
        update(NotionSyncJob)
        .where(
            NotionSyncJob.task_id == task_id,
            NotionSyncJob.status == str(NotionSyncJobStatus.PENDING),
            NotionSyncJob.task_version <= synced_version,
        )
        .values(status=str(NotionSyncJobStatus.SKIPPED), updated_at=now)
    )
    remaining = _has_newer_active_job(db, task_id, synced_version)
    _update_task_sync(
        db,
        task_id,
        notion_synced_version=synced_version,
        notion_sync_status=str(
            NotionSyncStatus.PENDING if remaining else NotionSyncStatus.SYNCED
        ),
        notion_create_attempted_at=None,
    )
    db.commit()


def _handle_failure(
    db: Session,
    job: NotionSyncJob,
    task_id: str,
    exc: notion.NotionWriteError,
    *,
    creating: bool,
    now: datetime,
) -> None:
    error = f"[{exc.status_code}] {exc.reason}" if exc.status_code else exc.reason
    if creating and not exc.outcome_uncertain:
        # 요청이 거부됐거나 도달하지 않은 게 확실하다 — 다음엔 조회 없이 바로 POST해도 된다.
        _update_task_sync(db, task_id, notion_create_attempted_at=None)

    if exc.retryable and job.attempts < MAX_ATTEMPTS:
        delay = exc.retry_after or min(
            BASE_BACKOFF_SECONDS * 2 ** (job.attempts - 1), MAX_BACKOFF_SECONDS
        )
        _finish(job, NotionSyncJobStatus.PENDING, now, error)
        job.next_attempt_at = now + timedelta(seconds=delay)
    else:
        _finish(job, NotionSyncJobStatus.FAILED, now, error)
        # 더 최신 변경이 대기 중이면 그쪽 결과를 기다린다.
        if not _has_newer_active_job(db, task_id, job.task_version):
            _update_task_sync(db, task_id, notion_sync_status=str(NotionSyncStatus.FAILED))
        logger.warning("Notion 반영 실패 task_id=%s version=%s: %s", task_id, job.task_version, error)
    db.commit()


def run_worker(stop_event: threading.Event, interval: float) -> None:
    while not stop_event.is_set():
        db = SessionLocal()
        try:
            process_due_jobs(db)
        except Exception:
            logger.exception("Notion 동기화 워커 오류")
            db.rollback()
        finally:
            db.close()
        stop_event.wait(interval)


def start_worker(interval: float) -> tuple[threading.Thread, threading.Event]:
    stop_event = threading.Event()
    thread = threading.Thread(
        target=run_worker, args=(stop_event, interval), name="notion-sync", daemon=True
    )
    thread.start()
    return thread, stop_event
