from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models import ApprovalStatus, ApprovalType


class ApprovalCreateRequest(BaseModel):
    workspace_id: str = Field(..., description="소속 워크스페이스 ID")
    type: ApprovalType = Field(..., description="task_create | task_update | reminder_dm")
    payload: dict[str, Any] = Field(..., description="변경 내용 (JSON)")
    related_task_id: str | None = Field(None, description="연관 태스크 ID")
    requested_by: str | None = Field(
        None,
        description="하위 호환용. 보내도 쓰지 않고, 요청자는 로그인한 팀원으로 기록한다.",
    )


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
    resolved_by: str | None = Field(
        None, description="하위 호환용. 승인/반려한 사람은 이 값 대신 로그인한 멤버(세션)로 기록한다."
    )
    confirm_task_version: int | None = Field(
        None,
        ge=1,
        description="task_update 승인이 APPROVAL_CONFLICT(409)로 막혔을 때, 그 응답의 details.task_version. "
        "충돌을 확인하고도 제안 값으로 덮어쓰려면 보낸다. 그 뒤 task가 또 바뀌었으면 다시 409다",
    )


class ApprovalListResponse(BaseModel):
    items: list[ApprovalResponse]
    total: int
