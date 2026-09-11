from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models import ApprovalStatus, ApprovalType


class ApprovalCreateRequest(BaseModel):
    workspace_id: str = Field(..., description="소속 워크스페이스 ID")
    type: ApprovalType = Field(..., description="task_create | task_update | reminder_dm")
    payload: dict[str, Any] = Field(..., description="변경 내용 (JSON)")
    related_task_id: str | None = Field(None, description="연관 태스크 ID")
    requested_by: str | None = Field(None, description="요청자 member_id (AI 자동이면 null)")


class ApprovalResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    approval_id: str
    workspace_id: str
    type: str
    payload: dict[str, Any]  # 서비스 레이어에서 JSON 파싱 후 반환
    related_task_id: str | None
    requested_by: str | None
    status: str
    resolved_by: str | None
    created_at: datetime
    resolved_at: datetime | None


class ApprovalResolveRequest(BaseModel):
    status: ApprovalStatus = Field(
        ..., description="approved | rejected (pending 불가)"
    )
    resolved_by: str = Field(..., description="승인/반려한 PM member_id")


class ApprovalListResponse(BaseModel):
    items: list[ApprovalResponse]
    total: int
