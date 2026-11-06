from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models import ApprovalStatus, ApprovalType


class ApprovalCreateRequest(BaseModel):
    workspace_id: str = Field(..., description="소속 워크스페이스 ID")
    type: ApprovalType = Field(..., description="task_create | task_update. reminder_dm 은 400 (#335)")
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
    alias_candidate: bool = Field(
        False,
        description="담당자를 못 찾은 이름 지목(thirdname) 항목의 pending 생성 승인이고, 같은 워크스페이스에서 아직 아무도 그 글자를 별칭으로 갖고 있지 않으면 true. PM 이 담당자를 골라 save_alias=true 로 승인하면 alias_text 를 그 팀원의 별칭으로 저장한다. 누군가 이미 갖고 있으면 false 이고 저장하지 않는다",
    )
    alias_text: str | None = Field(
        None,
        description="저장될 별칭 글자(원문에서 끝 조사·님을 뗀 것). alias_candidate 가 false 면 null",
    )


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
    task_overrides: dict[str, Any] | None = Field(
        None,
        description="승인하면서 PM이 고친 값. approved 일 때만 보낸다. 키가 없으면 제안 그대로이고, "
        "null 이면 미정(due_date, assignee_member_id 만 가능)이다. "
        "task_create 는 task_title, assignee_member_id, due_date, task_update 는 status, due_date 를 고칠 수 있다",
    )
    save_alias: bool = Field(
        False,
        description="task_create 를 승인하며 고른 담당자에게 alias_text 를 별칭으로 저장할지. "
        "alias_candidate 가 false 이거나 담당자가 미정이거나 이미 있으면 아무것도 하지 않는다. rejected 와 함께 오면 무시한다",
    )


class ApprovalListResponse(BaseModel):
    items: list[ApprovalResponse]
    total: int
