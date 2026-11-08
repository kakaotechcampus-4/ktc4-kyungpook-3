from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import AliasSource, AliasType, MemberRole
from app.schemas.name import NameStr
from app.services.matching import normalize_alias_text

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
    display_name: NameStr
    discord_user_id: str | None = Field(None, max_length=DISCORD_USER_ID_MAX_LENGTH)
    notion_name: str | None = None
    role: MemberRole = MemberRole.MEMBER

    @field_validator("discord_user_id", mode="before")
    @classmethod
    def _blank_discord_user_id_is_none(cls, value: object) -> object:
        return _normalize_discord_user_id(value)


class MemberUpdateRequest(BaseModel):
    display_name: NameStr | None = None
    discord_user_id: str | None = Field(
        None, max_length=DISCORD_USER_ID_MAX_LENGTH, description="빈 값이나 null이면 연결을 해제한다"
    )
    notion_name: str | None = None
    role: MemberRole | None = None

    @field_validator("discord_user_id", mode="before")
    @classmethod
    def _blank_discord_user_id_is_none(cls, value: object) -> object:
        return _normalize_discord_user_id(value)

    @field_validator("display_name", mode="before")
    @classmethod
    def _display_name_is_not_null(cls, value: object) -> object:
        # 키를 생략하면 이 검증은 돌지 않아 이름이 유지된다. null 을 명시하면 NOT NULL 컬럼에서 500 이 나므로 막는다.
        if value is None:
            raise ValueError("표시명은 null 일 수 없습니다. 이름을 바꾸지 않으려면 display_name 을 빼 주세요")
        return value


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

    @field_validator("alias_text")
    @classmethod
    def _normalize_alias_text(cls, value: str) -> str:
        # 후보를 만들 때와 같은 규칙으로 공백을 정리해 저장한다. 공백뿐인 표기는 어떤 입력으로도 걸리지 않으니 막는다.
        normalized = normalize_alias_text(value)
        if not normalized:
            raise ValueError("별칭은 공백만으로 이루어질 수 없습니다")
        return normalized

    @field_validator("source")
    @classmethod
    def _reject_server_only_source(cls, value: AliasSource) -> AliasSource:
        # display_name 은 이름에서 자동으로 만든 별칭 표시라 서버만 쓴다. 받으면 이름을 바꿀 때 조용히 지워진다.
        if value == AliasSource.DISPLAY_NAME:
            raise ValueError("display_name 별칭은 직접 등록할 수 없습니다")
        return value


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


class MemberNameResponse(BaseModel):
    """녹음 봇이 전사 이름 힌트로 쓰는 팀원 이름."""

    member_id: str
    name: str = Field(..., description="PM이 온보딩에서 정한 이름(display_name)")
    discord_user_id: str | None
    aliases: list[str] = Field(..., description="별칭 문자열. 확인한(verified) 별칭부터, 만든 순서")


class MemberNameListResponse(BaseModel):
    items: list[MemberNameResponse]
