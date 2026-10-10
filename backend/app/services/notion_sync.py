"""Task 변경을 Notion에 반영하는 outbox 큐와 워커.

로컬 DB와 Notion은 하나의 트랜잭션으로 묶을 수 없다. 예전처럼 요청 안에서 Notion을
호출하면 "Notion엔 페이지가 생겼는데 로컬 커밋은 실패" 또는 "타임아웃이라 롤백했는데
실제로는 페이지가 생김" 같은 어긋남을 막을 방법이 없다. 그래서 두 단계로 나눈다.

1. `enqueue_task_sync()` — Task 변경과 같은 트랜잭션에 확인 요청(`NotionSyncJob`)을 한 줄 넣는다.
   Task가 커밋되면 요청도 반드시 같이 커밋되고, 롤백되면 같이 사라진다. 연결 상태와 상관없이 항상 넣는다.
2. `process_due_jobs()` — 워커가 대기 중인 요청을 꺼내 Task와 지금 연결을 보고 Notion에 보낸다. 실패하면
   재시도 횟수(`attempts`)와 다음 시도 시각(`next_attempt_at`)을 남기고, 한도를 넘거나
   다시 보내도 소용없는 오류면 `failed`로 둔다.

요청은 "이 Task를 확인해 달라"는 뜻이라 같은 Task에 여러 줄 있어도 된다. 할 일이 없으면 Notion을 부르지 않고
건너뛴다. 그래서 요청을 넣는 쪽은 언제 넣어도 되고, Task의 Notion 기록은 워커만 고친다.

순서·중복: Notion에는 항상 Task의 "현재 값 전체"를 보내고, 보낸 시점의 `Task.version`을
`notion_synced_version`에 기록한다. Task의 지금 버전이 이미 반영됐으면 요청을 건너뛴다.
오래된 요청이 늦게 처리돼도 최신 값을 덮어쓰지 않는다.

대상 DB: 페이지를 보낸 DB를 `Task.notion_database_id`에 함께 기록한다. 연결된 DB가 이와 다르면
기록된 페이지와 반영 버전은 옛 DB의 것이므로 쓰지 않고, 지금 DB에 페이지를 새로 만든다. 새 DB가 붙으면
`enqueue_workspace_sync()`가 워크스페이스의 모든 Task에 요청을 넣는다.

연결 행은 있는데 DB가 없는 워크스페이스(DB를 찾는 중이거나 연결이 실패함)의 요청은 꺼내지 않고 둔다.
DB가 붙으면 그때 처리된다. 연결 행이 없는 워크스페이스(연동 안 함·끊음)의 요청은 건너뛴다.

페이지 생성 타임아웃: POST 직전에 `Task.notion_create_attempted_at`을 먼저 커밋한다.
POST 결과를 모르는 채로 끝나면(타임아웃·5xx·워커 중단) 이 값이 남아 있으므로, 다음 시도는
POST를 반복하지 않고 `Task ID` 속성으로 이미 생긴 페이지가 있는지부터 조회한다.

워커는 프로세스당 하나만 도는 것을 전제로 한다(`app/main.py` lifespan).
"""
import logging
import threading
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import exists, insert, select, update
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.errors import AppError, ErrorCode
from app.models import Integration, NotionSyncJob, NotionSyncJobStatus, NotionSyncStatus, Task
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


def enqueue_task_sync(db: Session, task: Task) -> NotionSyncJob:
    """Task를 확인해 달라는 요청을 같은 트랜잭션에 쌓는다.

    연결 상태와 상관없이 항상 쌓는다. 쌓는 순간 연결을 보고 거르면, 새 DB가 붙는 순간과 겹친 Task를 DB를 붙이는
    쪽(아직 커밋 전이라 못 봄)과 여기(아직 DB가 없다고 봄) 어느 쪽도 줄 세우지 않는다. 보낼지는 워커가 정한다.
    """
    job = NotionSyncJob(task_id=task.task_id, task_version=task.version)
    db.add(job)
    # 화면 표시만 정한다. 연동이 없는 워크스페이스의 Task는 반영 대기로 보이지 않게 한다.
    if notion.get_notion_integration(db, task.workspace_id) is not None:
        task.notion_sync_status = str(NotionSyncStatus.PENDING)
    return job


def enqueue_workspace_sync(db: Session, workspace_id: str) -> None:
    """워크스페이스의 모든 Task에 확인 요청을 하나씩 쌓는다. 새 대상 DB를 붙이는 트랜잭션에서 부른다.

    Task의 Notion 기록은 지우지 않는다. 워커가 기록된 DB와 새 DB가 다른 것을 보고 새 DB에 페이지를 만든다.
    여기서 못 본 Task(아직 커밋 전)는 자기 요청을 이미 갖고 있다(`enqueue_task_sync`).
    """
    tasks = db.execute(select(Task.task_id, Task.version).where(Task.workspace_id == workspace_id)).all()
    if not tasks:
        return
    # job_id·상태·시각은 모델의 기본값으로 채운다.
    db.execute(
        insert(NotionSyncJob),
        [{"task_id": task_id, "task_version": version} for task_id, version in tasks],
    )
    db.execute(
        update(Task)
        .where(Task.workspace_id == workspace_id)
        .values(notion_sync_status=str(NotionSyncStatus.PENDING), updated_at=Task.updated_at)
    )


def retry_failed_sync(db: Session, task: Task) -> NotionSyncJob:
    """`failed`로 끝난 가장 최근 작업을 다시 대기열에 넣는다 (재시도 횟수 초기화)."""
    integration = notion.get_notion_integration(db, task.workspace_id)
    if not notion.is_configured(integration):
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
    # Task의 지금 버전이 지금 DB에 이미 반영됐으면 재시도할 것이 없다(워커가 건너뛰는 기준과 같다).
    # DB가 바뀌었으면 새 DB에는 아직 없으므로 재시도한다.
    already_synced = (
        task.notion_database_id == integration.provider_channel_id
        and task.version <= (task.notion_synced_version or 0)
    )
    if job is None or already_synced:
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
    # 연결 행은 있는데 DB가 없는 워크스페이스(찾는 중·연결 실패)의 요청은 DB가 붙을 때까지 꺼내지 않는다.
    # 꺼냈다 되돌리기를 되풀이하면 이 요청들이 한 번에 꺼내는 자리를 차지해 다른 워크스페이스 반영이 밀린다.
    waiting_for_database = (
        select(Task.task_id)
        .join(Integration, Integration.workspace_id == Task.workspace_id)
        .where(Integration.provider == "notion", Integration.provider_channel_id.is_(None))
    )
    job_ids = db.execute(
        select(NotionSyncJob.job_id)
        .where(
            NotionSyncJob.status == str(NotionSyncJobStatus.PENDING),
            NotionSyncJob.next_attempt_at <= now,
            # 같은 Task를 두 작업이 동시에 보내면 늦게 도착한 쪽이 옛 값으로 덮어쓸 수 있다.
            NotionSyncJob.task_id.not_in(busy_tasks),
            NotionSyncJob.task_id.not_in(waiting_for_database),
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
    exhausted = db.execute(
        select(NotionSyncJob.job_id, NotionSyncJob.task_id, NotionSyncJob.task_version)
        .where(*stale, NotionSyncJob.attempts >= MAX_ATTEMPTS)
    ).all()
    if exhausted:
        db.execute(
            update(NotionSyncJob)
            .where(NotionSyncJob.job_id.in_([job_id for job_id, _, _ in exhausted]))
            .values(
                status=str(NotionSyncJobStatus.FAILED),
                locked_at=None,
                last_error="처리 중 중단된 채 재시도 한도를 넘었습니다.",
                updated_at=now,
            )
        )
        # _handle_failure와 같은 규칙: 이 Task의 다른 요청이 남아 있으면 그쪽 결과를 기다린다.
        # 그렇지 않으면 남은 요청이 없는데 Task만 pending으로 남는다.
        for job_id, task_id, task_version in exhausted:
            if not _has_other_active_job(db, task_id, job_id):
                _update_task_sync(db, task_id, notion_sync_status=str(NotionSyncStatus.FAILED))
            logger.warning(
                "Notion 반영 중단 후 재시도 한도 초과 task_id=%s version=%s", task_id, task_version
            )
    db.commit()


def _update_task_sync(db: Session, task_id: str, **values: object) -> None:
    """Task의 동기화 컬럼만 바꾼다. 사용자 변경이 아니므로 updated_at은 그대로 둔다."""
    db.execute(
        update(Task)
        .where(Task.task_id == task_id)
        .values(**values, updated_at=Task.updated_at)
    )


def _has_other_active_job(db: Session, task_id: str, job_id: str) -> bool:
    """이 Task에 아직 처리할 다른 요청이 있나. 같은 버전의 요청도 여러 줄일 수 있어 버전이 아니라 줄로 본다."""
    return db.execute(
        select(
            exists().where(
                NotionSyncJob.task_id == task_id,
                NotionSyncJob.job_id != job_id,
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

    stored = notion.get_notion_integration(db, task.workspace_id)
    if stored is None:
        # 연동을 안 했거나 끊었다. 나중에 DB가 붙으면 모든 Task에 요청이 다시 쌓이므로 이 요청은 끝낸다.
        _finish(job, NotionSyncJobStatus.SKIPPED, now, "Notion 연동이 없습니다.")
        _update_task_sync(db, task.task_id, notion_sync_status=None)
        db.commit()
        return
    if not notion.is_configured(stored):
        # 꺼낸 직후 DB가 비었다(다시 연결 시작 등). 시도로 세지 않고 대기로 되돌린다. DB가 붙을 때까지는 꺼내지 않는다.
        _finish(job, NotionSyncJobStatus.PENDING, now, "Notion 대상 DB 연결을 기다립니다.")
        job.attempts -= 1
        db.commit()
        return
    # 처리 시작 때의 연결 정보를 복사해 끝까지 이것으로만 보낸다. 세션의 객체는 커밋하면 다시 읽혀서, 그 사이 붙은
    # 새 DB를 가리킬 수 있다. 그러면 Task에 기록하는 DB와 실제로 보낸 DB가 달라진다.
    database_id = stored.provider_channel_id
    integration = Integration(
        workspace_id=task.workspace_id, provider="notion",
        access_token=stored.access_token, provider_channel_id=database_id,
    )
    # 기록된 페이지와 반영 버전은 그 페이지가 지금 DB에 있을 때만 쓴다. DB가 바뀌었으면 새 DB에는 아직 아무것도 없다.
    same_database = task.notion_database_id == database_id

    # Task의 지금 버전이 지금 DB에 이미 반영됐다 — 중복 전송하지 않는다. 요청의 버전이 아니라 Task를 본다.
    # 요청은 "확인해 달라"는 뜻이라, 옛 요청이라도 아직 안 보낸 변경이 있으면 보낸다.
    if (
        same_database
        and task.notion_synced_version is not None
        and task.version <= task.notion_synced_version
    ):
        _finish(job, NotionSyncJobStatus.SKIPPED, now)
        # 앞선 요청이 반영할 때 이 요청이 남아 있어 표시를 대기로 뒀다. 마지막 요청이면 완료로 맞춘다.
        if not _has_other_active_job(db, task.task_id, job_id):
            _update_task_sync(db, task.task_id, notion_sync_status=str(NotionSyncStatus.SYNCED))
        db.commit()
        return

    task_id = task.task_id
    creating = False
    try:
        page_id = task.notion_page_id if same_database else None
        if page_id is None and task.notion_create_attempted_at is not None:
            # 이전 POST의 결과를 모른다 — 다시 만들기 전에 이미 생긴 페이지가 있는지 지금 DB에서 본다.
            page_id = notion.find_page_by_task_id(integration, task_id, transport=transport)
            if page_id is not None:
                _update_task_sync(db, task_id, notion_page_id=page_id, notion_database_id=database_id)

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
            _update_task_sync(db, task_id, notion_page_id=page_id, notion_database_id=database_id)
    except notion.NotionWriteError as exc:
        _handle_failure(db, job, task_id, exc, creating=creating, now=now)
        return

    _finish(job, NotionSyncJobStatus.DONE, now)
    # 같은 Task의 다른 요청은 여기서 정리하지 않는다. 그 사이 새 DB가 붙으며 쌓인 요청까지 지울 수 있다.
    # 각 요청이 꺼내질 때 스스로 확인하고, 이미 반영됐으면 Notion을 부르지 않고 건너뛴다.
    remaining = _has_other_active_job(db, task_id, job_id)
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
        # 이 Task의 다른 요청이 남아 있으면 그쪽 결과를 기다린다.
        if not _has_other_active_job(db, task_id, job.job_id):
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
