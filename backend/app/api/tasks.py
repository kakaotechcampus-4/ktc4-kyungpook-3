from collections.abc import Sequence
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_member, get_current_user, require_member, require_pm, require_task_member
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import ChangeSource, Member, Task, TaskHistory, TaskStatus, User, Workspace
from app.schemas.reply import TaskTimelineResponse
from app.schemas.task import (
    TaskCreateRequest,
    TaskHistoryListResponse,
    TaskHistoryResponse,
    TaskListResponse,
    TaskFields,
    TaskResponse,
    TaskUpdateRequest,
)
from app.services import replies, scheduler
from app.services.notion_sync import retry_failed_sync
from app.services.tasks import apply_task_updates, create_task, rollback_task_history

router = APIRouter(prefix="/tasks", tags=["tasks"], dependencies=[Depends(require_task_member)])


def _get_task(db: Session, task_id: str, *, lock: bool = False, include_deleted: bool = False) -> Task:
    """task를 찾는다. 지운 task(auto로 만들었다가 되돌린 task)는 없는 task로 본다.

    task를 바꾸는 경로는 lock=True로 커밋까지 행을 잠근다. 잠그지 않으면 auto 되돌리기(revert_auto_item)가
    지운 뒤에 수정이 반영되어, 200을 받고도 그 수정이 아무 데도 보이지 않는다. 잠근 뒤 다시 읽어 지웠는지 본다.
    include_deleted는 지운 task에도 해야 할 일이 있는 경로(Notion 페이지 보관 재시도)만 쓴다.
    """
    if lock:
        task = db.execute(
            select(Task)
            .where(Task.task_id == task_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
    else:
        task = db.get(Task, task_id)
    if task is None or (task.is_deleted and not include_deleted):
        raise AppError(ErrorCode.TASK_NOT_FOUND, details={"task_id": task_id})
    return task


def _task_responses(db: Session, tasks: Sequence[Task]) -> list[TaskResponse]:
    """auto_blocked 는 감시 기록을 봐야 알 수 있어 목록 전체를 한 번에 판정한다."""
    blocked = scheduler.auto_blocked_ids(db, tasks)
    return [
        TaskResponse(**TaskFields.model_validate(t).model_dump(), auto_blocked=t.task_id in blocked)
        for t in tasks
    ]


def _task_response(db: Session, task: Task) -> dict:
    return _task_responses(db, [task])[0].model_dump(mode="json")


@router.post("", status_code=201, response_model=Envelope[TaskResponse])
def create_task_endpoint(
    payload: TaskCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if db.get(Workspace, payload.workspace_id) is None:
        raise AppError(
            ErrorCode.WORKSPACE_NOT_FOUND, details={"workspace_id": payload.workspace_id}
        )
    member = require_pm(db, user, payload.workspace_id)

    task = create_task(
        db,
        workspace_id=payload.workspace_id,
        title=payload.title,
        meeting_id=payload.meeting_id,
        assignee_member_id=payload.assignee_member_id,
        start_date=payload.start_date,
        due_date=payload.due_date,
        status=str(payload.status),
        blocker=payload.blocker,
        change_source=str(ChangeSource.MANUAL),
        changed_by=member.member_id,
    )
    db.commit()
    db.refresh(task)
    return success(_task_response(db, task))


@router.get("", response_model=Envelope[TaskListResponse])
def list_tasks(
    workspace_id: str = Query(..., description="워크스페이스 ID"),
    status: TaskStatus | None = Query(None, description="라이프사이클 상태 필터"),
    assignee_member_id: str | None = Query(None, description="담당자 필터"),
    due_before: date | None = Query(None, description="마감일 상한 (캘린더 뷰)"),
    due_after: date | None = Query(None, description="마감일 하한 (캘린더 뷰)"),
    _member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> dict:
    filters = [Task.workspace_id == workspace_id, Task.is_deleted.is_(False)]
    if status is not None:
        filters.append(Task.status == str(status))
    if assignee_member_id is not None:
        filters.append(Task.assignee_member_id == assignee_member_id)
    if due_before is not None:
        filters.append(Task.due_date <= due_before)
    if due_after is not None:
        filters.append(Task.due_date >= due_after)

    stmt = select(Task).where(*filters).order_by(Task.due_date, Task.created_at.desc())
    rows = db.execute(stmt).scalars().all()

    count_stmt = select(func.count()).select_from(Task).where(*filters)
    total = db.execute(count_stmt).scalar() or 0

    return success(
        TaskListResponse(
            items=_task_responses(db, rows), total=total
        ).model_dump(mode="json")
    )


@router.get("/{task_id}", response_model=Envelope[TaskResponse])
def get_task(task_id: str, db: Session = Depends(get_db)) -> dict:
    task = _get_task(db, task_id)
    return success(_task_response(db, task))


@router.patch("/{task_id}", response_model=Envelope[TaskResponse])
def update_task(
    task_id: str,
    payload: TaskUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    member = require_pm(db, user, _get_task(db, task_id).workspace_id)
    # PM인지 먼저 확인한다. 권한 없는 요청이 행을 잠가 승인·되돌리기를 기다리게 하지 않는다
    task = _get_task(db, task_id, lock=True)

    updates = payload.model_dump(
        exclude_unset=True, exclude={"changed_by"}
    )
    if "status" in updates:
        updates["status"] = str(updates["status"])
    if not updates:
        raise AppError(ErrorCode.INVALID_REQUEST, message="변경할 값이 없습니다.")

    apply_task_updates(
        db,
        task,
        updates,
        change_source=str(ChangeSource.MANUAL),
        changed_by=member.member_id,
    )
    db.commit()
    db.refresh(task)
    return success(_task_response(db, task))


@router.get("/{task_id}/history", response_model=Envelope[TaskHistoryListResponse])
def list_task_history(task_id: str, db: Session = Depends(get_db)) -> dict:
    _get_task(db, task_id)
    stmt = (
        select(TaskHistory)
        .where(TaskHistory.task_id == task_id)
        .order_by(TaskHistory.created_at.desc())
    )
    rows = db.execute(stmt).scalars().all()
    return success(
        TaskHistoryListResponse(
            items=[TaskHistoryResponse.model_validate(r) for r in rows],
            total=len(rows),
        ).model_dump(mode="json")
    )


@router.post(
    "/{task_id}/history/{history_id}/rollback", response_model=Envelope[TaskResponse]
)
def rollback_history_endpoint(
    task_id: str,
    history_id: str,
    changed_by: str | None = Query(
        None, description="하위 호환용. 되돌린 사람은 이 값 대신 로그인한 멤버(세션)로 기록한다."
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    member = require_pm(db, user, _get_task(db, task_id).workspace_id)
    # PM인지 먼저 확인한다. 권한 없는 요청이 행을 잠가 승인·되돌리기를 기다리게 하지 않는다
    task = _get_task(db, task_id, lock=True)
    history = db.get(TaskHistory, history_id)
    if history is None or history.task_id != task_id:
        raise AppError(
            ErrorCode.TASK_HISTORY_NOT_FOUND, details={"history_id": history_id}
        )

    rollback_task_history(db, task, history, changed_by=member.member_id)
    db.commit()
    db.refresh(task)
    return success(_task_response(db, task))


@router.post("/{task_id}/auto-block/undo", response_model=Envelope[TaskResponse])
def undo_auto_block(
    task_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """리마인드 무응답으로 스케줄러가 건 막힘을 막기 전 상태·사유로 되돌린다. 그 뒤 바뀌었으면 409."""
    member = require_pm(db, user, _get_task(db, task_id).workspace_id)
    task = _get_task(db, task_id, lock=True)
    scheduler.undo_auto_block(db, task, changed_by=member.member_id, now=datetime.now(timezone.utc))
    db.commit()
    db.refresh(task)
    return success(_task_response(db, task))


@router.get("/{task_id}/timeline", response_model=Envelope[TaskTimelineResponse])
def task_timeline(
    task_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """답장과 변경을 한 줄로 묶은 태스크 기록. 같은 변경이 두 줄로 나오지 않는다. 기존 /history 는 그대로다."""
    task = _get_task(db, task_id)
    items = replies.timeline(db, task, require_member(db, user, task.workspace_id))
    return success(TaskTimelineResponse(items=items, total=len(items)).model_dump(mode="json"))


@router.post("/{task_id}/reply-changes/{change_id}/undo", response_model=Envelope[TaskResponse])
def undo_reply_change(
    task_id: str,
    change_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """답장으로 자동 반영한 변경을 되돌린다. 그 뒤 바뀌었으면 409."""
    member = require_pm(db, user, _get_task(db, task_id).workspace_id)
    task = _get_task(db, task_id, lock=True)
    replies.undo_change(db, task, change_id, changed_by=member.member_id)
    db.commit()
    db.refresh(task)
    return success(_task_response(db, task))


@router.post("/{task_id}/notion-sync/retry", response_model=Envelope[TaskResponse])
def retry_notion_sync(
    task_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Notion 반영이 failed로 끝난 Task를 다시 대기열에 넣는다. 실제 전송은 워커가 한다.

    지운 Task도 받는다. 페이지 보관이 실패했으면 다시 시도할 곳이 여기뿐이다.
    """
    task = _get_task(db, task_id, include_deleted=True)
    require_pm(db, user, task.workspace_id)
    retry_failed_sync(db, task)
    db.commit()
    db.refresh(task)
    return success(_task_response(db, task))
