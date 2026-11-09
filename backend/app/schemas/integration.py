import re

from pydantic import BaseModel, field_validator

_CHANNEL_ID = re.compile(r"^[0-9]{1,20}$")


class DiscordChannelItem(BaseModel):
    channel_id: str
    name: str


class DiscordChannelListResponse(BaseModel):
    items: list[DiscordChannelItem]
    total: int


class ChatChannelSetRequest(BaseModel):
    channel_id: str

    @field_validator("channel_id")
    @classmethod
    def _digits_only(cls, value: str) -> str:
        """Discord 채널 ID(snowflake)는 숫자다. 앞뒤 공백은 지우고, 아니면 400 INVALID_REQUEST 가 된다."""
        value = value.strip()
        if not _CHANNEL_ID.fullmatch(value):
            raise ValueError("channel_id 는 숫자 1~20자여야 합니다.")
        return value


class ChatChannelResponse(BaseModel):
    channel_id: str
    name: str


class ChatChannelClearResponse(BaseModel):
    off_notice_sent: bool


class BotChatChannelItem(BaseModel):
    workspace_id: str
    guild_id: str
    channel_id: str
    identity_epoch: int = 0


class BotChatChannelListResponse(BaseModel):
    items: list[BotChatChannelItem]
