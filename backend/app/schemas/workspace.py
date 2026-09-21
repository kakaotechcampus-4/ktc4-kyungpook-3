from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, ConfigDict, Field


class WorkspaceOnboardingStep(BaseModel):
    step: str
    status: str


class WorkspaceOnboarding(BaseModel):
    completed: bool
    current_step: str
    steps: List[WorkspaceOnboardingStep]


class WorkspaceOnboardingUpdateRequest(BaseModel):
    step: str
    action: str  # skip or complete


class WorkspaceCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="워크스페이스 이름")


class WorkspaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    workspace_id: str
    name: str
    created_at: datetime
    role: Optional[str] = None
    onboarding: Optional[WorkspaceOnboarding] = None


class WorkspaceListResponse(BaseModel):
    items: list[WorkspaceResponse]
    total: int
