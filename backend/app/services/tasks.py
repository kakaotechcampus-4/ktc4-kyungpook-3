"""태스크 생성·수정·되돌리기 공통 로직.

PATCH /tasks, 승인 처리(approvals.py), 추출 게이트 판정(extractions.py) 세 경로가
전부 이 모듈을 거쳐야 반영 로그(TaskHistory)가 빠짐없이 남는다.
"""
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import ChangedField, Meeting, Member, Task, TaskHistory, TaskStatus
from app.services import notion

# TaskUpdateRequest/승인 payload의 필드명 -> ChangedField 매핑
_FIELD_MAP: dict[str, ChangedField] = {
    "title": ChangedField.TITLE,
    "assignee_member_id": ChangedField.ASSIGNEE,
    "status": ChangedField.STATUS,
    "progress": ChangedField.PROGRESS,
    "blocker": ChangedField.BLOCKER,
    "start_date": ChangedField.START_DATE,
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


def parse_date(value: object, *, field: str) -> date | None:
    """승인 payload 등 외부 입력의 날짜 값을 date로 변환한다.

    형식이 잘못되면 500 대신 INVALID_REQUEST(400)로 돌려준다.
    """
    if value is None:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message=f"{field}는 YYYY-MM-DD 형식이어야 합니다: {value}",
            details={"field": field, "value": str(value)},
        )


def validate_workspace_ownership(
    db: Session,
    workspace_id: str,
    *,
    assignee_member_id: str | None = None,
    meeting_id: str | None = None,
) -> None:
    """assignee_member_id·meeting_id가 같은 워크스페이스 소속인지 검증한다.

    Task에 연결하는 ID들이 실제로 같은 workspace에 소속되어 있는지 확인하여
    cross-workspace 참조를 방지한다.
    """
    if assignee_member_id is not None:
        member = db.get(Member, assignee_member_id)
        if member is None:
            raise AppError(
                ErrorCode.MEMBER_NOT_FOUND,
                details={"member_id": assignee_member_id},
            )
        if member.workspace_id != workspace_id:
            raise AppError(
                ErrorCode.WORKSPACE_MISMATCH,
                message="담당자가 해당 워크스페이스 소속이 아닙니다.",
                details={
                    "field": "assignee_member_id",
                    "member_id": assignee_member_id,
                    "member_workspace_id": member.workspace_id,
                    "task_workspace_id": workspace_id,
                },
            )

    if meeting_id is not None:
        meeting = db.get(Meeting, meeting_id)
        if meeting is None:
            raise AppError(
                ErrorCode.MEETING_NOT_FOUND,
                details={"meeting_id": meeting_id},
            )
        if meeting.workspace_id != workspace_id:
            raise AppError(
                ErrorCode.WORKSPACE_MISMATCH,
                message="회의가 해당 워크스페이스 소속이 아닙니다.",
                details={
                    "field": "meeting_id",
                    "meeting_id": meeting_id,
                    "meeting_workspace_id": meeting.workspace_id,
                    "task_workspace_id": workspace_id,
                },
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
    if field in {"due_date", "start_date"}:
        return date.fromisoformat(value)
    return value


def create_task(
    db: Session,
    *,
    workspace_id: str,
    title: str,
    meeting_id: str | None = None,
    assignee_member_id: str | None = None,
    start_date: date | None = None,
    due_date: date | None = None,
    status: str = TaskStatus.TODO,
    progress: int | None = None,
    blocker: str | None = None,
    change_source: str,
    changed_by: str | None = None,
    is_auto: bool = False,
) -> Task:
    """태스크를 새로 만들고, 생성 사실을 반영 로그 한 줄로 남긴다.

    수동 생성, 승인 반영, 자동 반영 모든 경로가 이 함수에서 같은 도메인 검증을 거친다.
    """
    fields: dict[str, object] = {"title": title, "status": status, "progress": progress}
    validate_task_fields(fields)
    title = fields["title"]
    status = fields["status"]
    progress = fields["progress"]

    validate_workspace_ownership(
        db, workspace_id,
        assignee_member_id=assignee_member_id,
        meeting_id=meeting_id,
    )

    task = Task(
        workspace_id=workspace_id,
        meeting_id=meeting_id,
        title=title,
        assignee_member_id=assignee_member_id,
        start_date=start_date,
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
    notion.upsert_task(db, task)
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
    if "assignee_member_id" in updates and updates["assignee_member_id"] is not None:
        validate_workspace_ownership(
            db, task.workspace_id,
            assignee_member_id=str(updates["assignee_member_id"]),
        )
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

    if entries:
        notion.upsert_task(db, task)
    return entries


def rollback_task_history(
    db: Session,
    task: Task,
    history: TaskHistory,
    *,
    changed_by: str | None = None,
) -> TaskHistory:
    """반영 로그 한 줄을 되돌린다. 되돌리기 자체도 새 로그 한 줄로 남는다.

    다음 경우 롤백을 거절한다:
    - 이미 롤백된 이력
    - 최초 생성 이력 (old_value가 None인 NOT NULL 필드 — 롤백 시 500 방지)
    - 현재 값이 해당 이력의 new_value와 다를 때 (이후 다른 변경이 있었으므로 충돌)
    """
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

    # 최초 생성 이력 롤백 차단 (NOT NULL 필드에 None을 넣으면 DB 에러)
    _NOT_NULLABLE_FIELDS = {"title", "status"}
    if history.old_value is None and field in _NOT_NULLABLE_FIELDS:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="최초 생성 이력은 되돌릴 수 없습니다.",
            details={"history_id": history.history_id, "field": field},
        )

    # 충돌 감지: 현재 값이 이 이력이 설정한 값과 다르면 이후 수정이 있었음
    current_value = _serialize(getattr(task, field))
    if current_value != history.new_value:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="이후 다른 변경이 있어 되돌릴 수 없습니다. 최신 이력부터 되돌려주세요.",
            details={
                "history_id": history.history_id,
                "field": field,
                "expected_current": history.new_value,
                "actual_current": current_value,
            },
        )

    restored_value = _deserialize(field, history.old_value)
    setattr(task, field, restored_value)

    history.is_rolled_back = True
    history.rolled_back_at = datetime.now(timezone.utc)

    db.add(
        TaskHistory(
            task_id=task.task_id,
            changed_field=history.changed_field,
            old_value=current_value,
            new_value=history.old_value,
            change_source=history.change_source,
            changed_by=changed_by,
            is_auto=False,
        )
    )
    notion.upsert_task(db, task)
    return history
