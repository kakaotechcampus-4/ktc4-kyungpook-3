from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import ChangeSource, Task, TaskHistory, TaskStatus, Workspace
from app.schemas.task import (
    TaskCreateRequest,
    TaskHistoryListResponse,
    TaskHistoryResponse,
    TaskListResponse,
    TaskResponse,
    TaskUpdateRequest,
)
from app.services.tasks import apply_task_updates, create_task, rollback_task_history

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _get_task(db: Session, task_id: str) -> Task:
    task = db.get(Task, task_id)
    if task is None:
        raise AppError(ErrorCode.TASK_NOT_FOUND, details={"task_id": task_id})
    return task


@router.post("", status_code=201, response_model=Envelope[TaskResponse])
def create_task_endpoint(
    payload: TaskCreateRequest,
    db: Session = Depends(get_db),
) -> dict:
    if db.get(Workspace, payload.workspace_id) is None:
        raise AppError(
            ErrorCode.WORKSPACE_NOT_FOUND, details={"workspace_id": payload.workspace_id}
        )

    task = create_task(
        db,
        workspace_id=payload.workspace_id,
        title=payload.title,
        meeting_id=payload.meeting_id,
        assignee_member_id=payload.assignee_member_id,
        due_date=payload.due_date,
        status=str(payload.status),
        progress=payload.progress,
        blocker=payload.blocker,
        change_source=str(ChangeSource.MANUAL),
        changed_by=payload.created_by,
        is_auto=False,
    )
    db.commit()
    db.refresh(task)
    return success(TaskResponse.model_validate(task).model_dump(mode="json"))


@router.get("", response_model=Envelope[TaskListResponse])
def list_tasks(
    workspace_id: str = Query(..., description="워크스페이스 ID"),
    status: TaskStatus | None = Query(None, description="라이프사이클 상태 필터"),
    assignee_member_id: str | None = Query(None, description="담당자 필터"),
    due_before: date | None = Query(None, description="마감일 상한 (캘린더 뷰)"),
    due_after: date | None = Query(None, description="마감일 하한 (캘린더 뷰)"),
    db: Session = Depends(get_db),
) -> dict:
    filters = [Task.workspace_id == workspace_id]
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
            items=[TaskResponse.model_validate(r) for r in rows], total=total
        ).model_dump(mode="json")
    )


@router.get("/{task_id}", response_model=Envelope[TaskResponse])
def get_task(task_id: str, db: Session = Depends(get_db)) -> dict:
    task = _get_task(db, task_id)
    return success(TaskResponse.model_validate(task).model_dump(mode="json"))


@router.patch("/{task_id}", response_model=Envelope[TaskResponse])
def update_task(
    task_id: str,
    payload: TaskUpdateRequest,
    db: Session = Depends(get_db),
) -> dict:
    task = _get_task(db, task_id)

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
        changed_by=payload.changed_by,
        is_auto=False,
    )
    db.commit()
    db.refresh(task)
    return success(TaskResponse.model_validate(task).model_dump(mode="json"))


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
    changed_by: str | None = Query(None, description="되돌리기를 수행한 PM member_id"),
    db: Session = Depends(get_db),
) -> dict:
    task = _get_task(db, task_id)
    history = db.get(TaskHistory, history_id)
    if history is None or history.task_id != task_id:
        raise AppError(
            ErrorCode.TASK_HISTORY_NOT_FOUND, details={"history_id": history_id}
        )

    rollback_task_history(db, task, history, changed_by=changed_by)
    db.commit()
    db.refresh(task)
    return success(TaskResponse.model_validate(task).model_dump(mode="json"))
