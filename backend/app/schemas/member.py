from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import AliasSource, AliasType, MemberRole


class MemberCreateRequest(BaseModel):
    workspace_id: str = Field(..., description="소속 워크스페이스 ID")
    display_name: str = Field(..., min_length=1, max_length=100)
    discord_user_id: str | None = None
    notion_name: str | None = None
    role: MemberRole = MemberRole.MEMBER


class MemberUpdateRequest(BaseModel):
    display_name: str | None = None
    discord_user_id: str | None = None
    notion_name: str | None = None
    role: MemberRole | None = None


class MemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    member_id: str
    workspace_id: str
    display_name: str
    discord_user_id: str | None
    notion_name: str | None
    role: str
    created_at: datetime


class MemberListResponse(BaseModel):
    items: list[MemberResponse]
    total: int


class MemberAliasCreateRequest(BaseModel):
    alias_text: str = Field(..., min_length=1, max_length=100)
    alias_type: AliasType = AliasType.NICKNAME
    source: AliasSource = AliasSource.MANUAL
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    verified: bool = True


class MemberAliasResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    alias_id: str
    member_id: str
    workspace_id: str
    alias_text: str
    alias_type: str
    source: str
    confidence: float
    verified: bool
    created_at: datetime


class MemberAliasListResponse(BaseModel):
    items: list[MemberAliasResponse]
    total: int


class UnresolvedAliasResponse(BaseModel):
    alias_text: str
    occurrences: int
    last_seen_at: datetime


class UnresolvedAliasListResponse(BaseModel):
    items: list[UnresolvedAliasResponse]
    total: int
