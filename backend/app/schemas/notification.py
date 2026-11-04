from datetime import datetime

from pydantic import BaseModel, Field, field_validator
from urllib3.exceptions import LocationParseError
from urllib3.util import parse_url

# 브라우저가 쓰는 푸시 서비스. 서버가 이 주소로 요청을 보내므로 다른 곳은 받지 않는다.
PUSH_HOSTS = ("fcm.googleapis.com", "web.push.apple.com")
PUSH_HOST_SUFFIXES = (".push.services.mozilla.com", ".notify.windows.com")
PRINTABLE_ASCII = r"^[\x21-\x7e]+$"


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
    p256dh: str = Field(pattern=PRINTABLE_ASCII, max_length=255)
    auth: str = Field(pattern=PRINTABLE_ASCII, max_length=255)


class PushSubscribeRequest(BaseModel):
    endpoint: str = Field(pattern=PRINTABLE_ASCII, max_length=2048)
    keys: PushKeys

    @field_validator("endpoint")
    @classmethod
    def endpoint_is_push_service(cls, value: str) -> str:
        # 실제 발송(requests)과 같은 파서로 읽는다. 파서가 다르면 역슬래시 같은 주소가 검사를 비켜 간다.
        try:
            url = parse_url(value)
        except LocationParseError:
            url = None
        host = (url.host or "") if url else ""
        known = host in PUSH_HOSTS or host.endswith(PUSH_HOST_SUFFIXES)
        if not known or url.scheme != "https" or url.auth is not None or url.port not in (None, 443):
            raise ValueError("지원하는 푸시 서비스 주소가 아닙니다.")
        return value


class PushUnsubscribeRequest(BaseModel):
    endpoint: str = Field(pattern=PRINTABLE_ASCII, max_length=2048)


class VapidKeyResponse(BaseModel):
    public_key: str | None
