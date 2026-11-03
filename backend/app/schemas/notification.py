from datetime import datetime

from pydantic import BaseModel, Field


class NotificationLink(BaseModel):
    type: str
    id: str


class NotificationResponse(BaseModel):
    notification_id: str
    kind: str
    text: str
    link: NotificationLink
    read_at: datetime | None
    created_at: datetime


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    unread_count: int


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)


class PushSubscribeRequest(BaseModel):
    endpoint: str = Field(pattern=r"^https://", max_length=2048)
    keys: PushKeys


class PushUnsubscribeRequest(BaseModel):
    endpoint: str = Field(max_length=2048)


class VapidKeyResponse(BaseModel):
    public_key: str | None
