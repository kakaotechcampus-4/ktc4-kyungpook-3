from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import TaskStatus
from app.services.embedding import DEFAULT_K, DEFAULT_MIN_SIMILARITY


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
    version: int
    notion_sync_status: str | None = Field(
        None, description="Notion 반영 상태: pending | synced | failed (미연동이면 null)"
    )
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


class SimilarTaskSearchRequest(BaseModel):
    text: str = Field(..., min_length=1, description="검색할 문장 (AI의 JudgeFinding.text)")
    k: int = Field(DEFAULT_K, ge=1, le=20, description="최대 후보 수")
    min_similarity: float = Field(
        DEFAULT_MIN_SIMILARITY, ge=0.0, le=1.0,
        description="이 값 미만인 후보는 뺀다. 기본값 근거는 ai/decision_log/0010",
    )


class SimilarTaskCandidate(BaseModel):
    """AI의 NotionCandidate(ai/shared/schemas.py)와 필드 이름을 맞춘다."""

    task_id: str
    notion_page_id: str | None = Field(None, description="Notion 반영 전이면 null")
    title: str
    content_snippet: str = Field("", description="Task에 본문 필드가 없어 당분간 빈 문자열")
    assignee_member_id: str | None
    due_date: date | None
    status: str
    similarity: float = Field(..., description="코사인 유사도 (0.0~1.0)")
    updated_at: datetime


class SimilarTaskListResponse(BaseModel):
    items: list[SimilarTaskCandidate]
