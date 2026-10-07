from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import AliasSource, AliasType, MemberRole

# member.discord_user_id 컬럼 길이
DISCORD_USER_ID_MAX_LENGTH = 64


def _normalize_discord_user_id(value: object) -> object:
    # 빈 값은 "연결 없음" null 하나로만 저장한다. ""를 그대로 두면 사전 검사는 건너뛰는데 DB 유일 인덱스에는 걸린다.
    # 앞뒤 공백도 지워서 같은 계정이 공백 차이로 사전 검사를 빠져나가지 않게 한다.
    if isinstance(value, str):
        return value.strip() or None
    return value


class MemberCreateRequest(BaseModel):
    workspace_id: str = Field(..., description="소속 워크스페이스 ID")
    display_name: str = Field(..., min_length=1, max_length=100)
    discord_user_id: str | None = Field(None, max_length=DISCORD_USER_ID_MAX_LENGTH)
    notion_name: str | None = None
    role: MemberRole = MemberRole.MEMBER

    @field_validator("discord_user_id", mode="before")
    @classmethod
    def _blank_discord_user_id_is_none(cls, value: object) -> object:
        return _normalize_discord_user_id(value)


class MemberUpdateRequest(BaseModel):
    display_name: str | None = None
    discord_user_id: str | None = Field(
        None, max_length=DISCORD_USER_ID_MAX_LENGTH, description="빈 값이나 null이면 연결을 해제한다"
    )
    notion_name: str | None = None
    role: MemberRole | None = None

    @field_validator("discord_user_id", mode="before")
    @classmethod
    def _blank_discord_user_id_is_none(cls, value: object) -> object:
        return _normalize_discord_user_id(value)


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
