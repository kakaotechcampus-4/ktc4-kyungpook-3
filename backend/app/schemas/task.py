from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, computed_field

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
    blocker: str | None = None
    created_by: str | None = Field(
        None, description="하위 호환용. 생성한 사람은 이 값 대신 로그인한 멤버(세션)로 기록한다."
    )


class TaskUpdateRequest(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=300)
    assignee_member_id: str | None = None
    status: TaskStatus | None = None
    blocker: str | None = None
    start_date: date | None = None
    due_date: date | None = None
    changed_by: str | None = Field(
        None, description="하위 호환용. 변경한 사람은 이 값 대신 로그인한 멤버(세션)로 기록한다."
    )


class TaskFields(BaseModel):
    """Task 행에서 그대로 읽는 필드. 응답은 이것에 auto_blocked 를 더한 TaskResponse 로 낸다."""

    model_config = ConfigDict(from_attributes=True)

    task_id: str
    workspace_id: str
    meeting_id: str | None
    title: str
    assignee_member_id: str | None
    status: str
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


class TaskResponse(TaskFields):
    meeting_deleted: bool = False
    auto_blocked: bool = Field(
        ...,
        description="지금 POST /tasks/{task_id}/auto-block/undo 가 성공하는 상태면 true. "
        "무응답 자동 막힘이 걸려 있고 그 뒤 막힘 사유가 바뀌지 않았다는 뜻",
    )


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
    is_rolled_back: bool
    rolled_back_at: datetime | None
    created_at: datetime

    @computed_field
    @property
    def is_auto(self) -> bool:
        """변경자가 없으면 시스템이 자동 반영한 이력이다."""
        return self.changed_by is None


class TaskHistoryListResponse(BaseModel):
    items: list[TaskHistoryResponse]
    total: int


class SimilarTaskSearchRequest(BaseModel):
    text: str = Field(..., min_length=1, description="검색할 문장 (AI의 JudgeFinding.text)")
    k: int = Field(DEFAULT_K, ge=1, le=20, description="최대 후보 수")
    min_similarity: float = Field(
        DEFAULT_MIN_SIMILARITY, ge=0.0, le=1.0,
        description="이 값 미만인 후보는 뺀다. 기본값 근거는 ai/docs/basis_for_decision/ai/2026-09-22-0010-embedding-similarity-threshold.md",
    )
    include_pending: bool = Field(
        False, strict=True,
        description="true 면 승인 대기 중인 task_create 요청 최대 2개를 task k개 뒤에 합쳐 돌려준다",
    )


class SimilarTaskCandidate(BaseModel):
    """AI의 NotionCandidate(ai/shared/schemas.py)와 필드 이름을 맞춘다."""

    task_id: str | None = Field(None, description="승인 대기 요청 후보면 null")
    approval_id: str | None = Field(None, description="승인 대기 요청 후보일 때만 값이 있다")
    notion_page_id: str | None = Field(None, description="Notion 반영 전이거나 승인 대기 요청이면 null")
    title: str
    content_snippet: str = Field("", description="Task에 본문 필드가 없어 당분간 빈 문자열")
    assignee_member_id: str | None
    due_date: date | None
    status: str | None = Field(..., description="승인 대기 요청 후보면 null")
    similarity: float = Field(..., description="코사인 유사도 (0.0~1.0)")
    updated_at: datetime


class SimilarTaskListResponse(BaseModel):
    items: list[SimilarTaskCandidate]
