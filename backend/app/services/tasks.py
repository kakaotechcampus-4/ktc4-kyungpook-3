"""태스크 생성·수정·되돌리기 공통 로직.

PATCH /tasks, 승인 처리(approvals.py), 추출 게이트 판정(extractions.py) 세 경로가
전부 이 모듈을 거쳐야 반영 로그(TaskHistory)가 빠짐없이 남는다.
"""
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import ChangedField, Task, TaskHistory, TaskStatus

# TaskUpdateRequest/승인 payload의 필드명 -> ChangedField 매핑
_FIELD_MAP: dict[str, ChangedField] = {
    "title": ChangedField.TITLE,
    "assignee_member_id": ChangedField.ASSIGNEE,
    "status": ChangedField.STATUS,
    "progress": ChangedField.PROGRESS,
    "blocker": ChangedField.BLOCKER,
    "due_date": ChangedField.DUE_DATE,
}
_REVERSE_FIELD_MAP = {str(v): k for k, v in _FIELD_MAP.items()}

_VALID_STATUSES = {str(s) for s in TaskStatus}


def validate_task_fields(updates: dict[str, object]) -> None:
    """status·progress 등 업무 규칙을 검증한다.

    PATCH API, 승인 반영, 자동 반영 모든 경로가 이 함수를 거쳐야 한다.
    """
    if "status" in updates:
        status_val = str(updates["status"])
        if status_val not in _VALID_STATUSES:
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                message=f"유효하지 않은 status 값입니다: {status_val}",
                details={"field": "status", "value": status_val, "allowed": sorted(_VALID_STATUSES)},
            )
        updates["status"] = status_val

    if "progress" in updates and updates["progress"] is not None:
        try:
            progress_val = int(updates["progress"])
        except (TypeError, ValueError):
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                message=f"progress는 정수여야 합니다: {updates['progress']}",
                details={"field": "progress", "value": str(updates["progress"])},
            )
        if not (0 <= progress_val <= 100):
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                message=f"progress는 0~100 범위여야 합니다: {progress_val}",
                details={"field": "progress", "value": progress_val},
            )
        updates["progress"] = progress_val

    if "title" in updates:
        title_val = updates["title"]
        if not isinstance(title_val, str) or len(title_val.strip()) == 0:
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                message="title은 빈 문자열일 수 없습니다.",
                details={"field": "title"},
            )
        if len(title_val) > 300:
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                message=f"title은 300자 이하여야 합니다. (현재 {len(title_val)}자)",
                details={"field": "title", "length": len(title_val)},
            )


def _serialize(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _deserialize(field: str, value: str | None) -> object:
    if value is None:
        return None
    if field == "progress":
        return int(value)
    if field == "due_date":
        return date.fromisoformat(value)
    return value


def create_task(
    db: Session,
    *,
    workspace_id: str,
    title: str,
    meeting_id: str | None = None,
    assignee_member_id: str | None = None,
    due_date: date | None = None,
    status: str = TaskStatus.TODO,
    progress: int | None = None,
    blocker: str | None = None,
    change_source: str,
    changed_by: str | None = None,
    is_auto: bool = False,
) -> Task:
    """태스크를 새로 만들고, 생성 사실을 반영 로그 한 줄로 남긴다."""
    task = Task(
        workspace_id=workspace_id,
        meeting_id=meeting_id,
        title=title,
        assignee_member_id=assignee_member_id,
        due_date=due_date,
        status=str(status),
        progress=progress,
        blocker=blocker,
    )
    db.add(task)
    db.flush()

    db.add(
        TaskHistory(
            task_id=task.task_id,
            changed_field=str(ChangedField.TITLE),
            old_value=None,
            new_value=title,
            change_source=str(change_source),
            changed_by=changed_by,
            is_auto=is_auto,
        )
    )
    return task


def apply_task_updates(
    db: Session,
    task: Task,
    updates: dict[str, object],
    *,
    change_source: str,
    changed_by: str | None = None,
    is_auto: bool = False,
) -> list[TaskHistory]:
    """필드별로 변경을 적용하고, 실제로 바뀐 필드마다 반영 로그를 남긴다."""
    validate_task_fields(updates)
    entries: list[TaskHistory] = []
    for field, new_value in updates.items():
        if field not in _FIELD_MAP:
            continue
        old_value = getattr(task, field)
        if old_value == new_value:
            continue
        entry = TaskHistory(
            task_id=task.task_id,
            changed_field=str(_FIELD_MAP[field]),
            old_value=_serialize(old_value),
            new_value=_serialize(new_value),
            change_source=str(change_source),
            changed_by=changed_by,
            is_auto=is_auto,
        )
        db.add(entry)
        entries.append(entry)
        setattr(task, field, new_value)
    return entries


def rollback_task_history(
    db: Session,
    task: Task,
    history: TaskHistory,
    *,
    changed_by: str | None = None,
) -> TaskHistory:
    """반영 로그 한 줄을 되돌린다. 되돌리기 자체도 새 로그 한 줄로 남는다."""
    if history.is_rolled_back:
        raise AppError(
            ErrorCode.TASK_HISTORY_ALREADY_ROLLED_BACK,
            details={"history_id": history.history_id},
        )

    field = _REVERSE_FIELD_MAP.get(history.changed_field)
    if field is None:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="되돌릴 수 없는 변경 항목입니다.",
            details={"history_id": history.history_id, "changed_field": history.changed_field},
        )

    restored_value = _deserialize(field, history.old_value)
    setattr(task, field, restored_value)

    history.is_rolled_back = True
    history.rolled_back_at = datetime.now(timezone.utc)

    db.add(
        TaskHistory(
            task_id=task.task_id,
            changed_field=history.changed_field,
            old_value=history.new_value,
            new_value=history.old_value,
            change_source=history.change_source,
            changed_by=changed_by,
            is_auto=False,
        )
    )
    return history
