from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.email import NormalizedEmail


class InvitationCreateRequest(BaseModel):
    member_id: str = Field(..., description="초대할 팀원. 로그인 계정이 연결되지 않은 팀원이어야 한다")
    email: NormalizedEmail = Field(..., description="팀원의 가입 이메일. 소문자로 바꿔 저장한다")


class InvitedUser(BaseModel):
    user_id: str
    name: str
    email: str | None = None


class InvitationResponse(BaseModel):
    invitation_id: str
    member_id: str
    member_display_name: str
    email: str
    status: str
    invited_by_name: str | None
    accepted_user: InvitedUser | None = Field(
        None, description="수락한 계정. 연결을 끊은 뒤에도 남는다"
    )
    created_at: datetime
    responded_at: datetime | None = Field(None, description="마지막으로 상태가 바뀐 시각")


class InvitationListResponse(BaseModel):
    items: list[InvitationResponse]
    total: int


class MyInvitationResponse(BaseModel):
    invitation_id: str
    workspace_id: str
    workspace_name: str
    member_display_name: str
    invited_by_name: str | None
    created_at: datetime


class MyInvitationListResponse(BaseModel):
    items: list[MyInvitationResponse]
    total: int


class InvitationAcceptResponse(BaseModel):
    workspace_id: str
    member_id: str


class InvitationDeclineResponse(BaseModel):
    invitation_id: str
    status: str
