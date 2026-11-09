from datetime import datetime
from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models import OnboardingStep


class WorkspaceOnboardingStep(BaseModel):
    step: str
    status: str


class WorkspaceOnboarding(BaseModel):
    completed: bool
    current_step: str
    steps: List[WorkspaceOnboardingStep]


class WorkspaceOnboardingUpdateRequest(BaseModel):
    step: OnboardingStep
    action: Literal["skip", "complete"]


class WorkspaceCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="워크스페이스 이름")


class WorkspaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    workspace_id: str
    name: str
    created_at: datetime
    role: Optional[str] = None
    member_id: Optional[str] = Field(
        None,
        description="로그인 사용자의 이 워크스페이스 팀원 행 ID. 탈퇴하지 않은 행이고 role 과 같은 행. 없으면 null",
    )
    onboarding: Optional[WorkspaceOnboarding] = None


class WorkspaceListResponse(BaseModel):
    items: list[WorkspaceResponse]
    total: int


class DiscordGuildWorkspaceResponse(BaseModel):
    identity_epoch: int = 0
    """디스코드 서버(길드)에 연결된 워크스페이스. 녹음 봇이 회의를 보낼 워크스페이스를 찾을 때 쓴다."""

    guild_id: str
    workspace_id: str


class AsrPendingTitle(BaseModel):
    title_id: str
    title: str


class AsrTermsResponse(BaseModel):
    """워크스페이스 용어 목록과 AI 가 아직 받아 가지 않은 승인 제목(#532)."""

    words: list[str] = Field(..., description="용어. 사전순")
    pending_titles: list[AsrPendingTitle] = Field(..., description="PM 이 승인한 태스크 제목. 오래된 순, 최대 200개")


class AsrTermsAddRequest(BaseModel):
    words: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30)]] = Field(
        default_factory=list, max_length=2000
    )
    absorbed_title_ids: list[Annotated[str, StringConstraints(max_length=36)]] = Field(
        default_factory=list, max_length=200, description="명사를 뽑아 올린 큐 행. 이 워크스페이스 행만 지운다"
    )


class AsrTermsAddResponse(BaseModel):
    added: int
    absorbed: int
