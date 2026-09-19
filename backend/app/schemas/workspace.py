from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class WorkspaceCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="워크스페이스 이름")


class WorkspaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    workspace_id: str
    name: str
    created_at: datetime


class WorkspaceListResponse(BaseModel):
    items: list[WorkspaceResponse]
    total: int
