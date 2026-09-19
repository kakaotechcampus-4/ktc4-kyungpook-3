from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import TaskStatus


class TaskCreateRequest(BaseModel):
    workspace_id: str = Field(..., description="소속 워크스페이스 ID")
    title: str = Field(..., min_length=1, max_length=300)
    meeting_id: str | None = None
    assignee_member_id: str | None = None
    start_date: date | None = None
    due_date: date | None = None
    status: TaskStatus = TaskStatus.TODO
    progress: int | None = Field(None, ge=0, le=100)
    blocker: str | None = None
    created_by: str | None = Field(None, description="수동 생성한 PM member_id")


class TaskUpdateRequest(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=300)
    assignee_member_id: str | None = None
    status: TaskStatus | None = None
    progress: int | None = Field(None, ge=0, le=100)
    blocker: str | None = None
    start_date: date | None = None
    due_date: date | None = None
    changed_by: str | None = Field(None, description="변경한 PM member_id")


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    task_id: str
    workspace_id: str
    meeting_id: str | None
    title: str
    assignee_member_id: str | None
    status: str
    progress: int | None
    blocker: str | None
    start_date: date | None
    due_date: date | None
    notion_page_id: str | None
    created_at: datetime
    updated_at: datetime


class TaskListResponse(BaseModel):
    items: list[TaskResponse]
    total: int


class TaskHistoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    history_id: str
    task_id: str
    changed_field: str
    old_value: str | None
    new_value: str | None
    change_source: str
    changed_by: str | None
    is_auto: bool
    is_rolled_back: bool
    rolled_back_at: datetime | None
    created_at: datetime


class TaskHistoryListResponse(BaseModel):
    items: list[TaskHistoryResponse]
    total: int
