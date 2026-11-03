from datetime import date, datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, field_validator, model_validator

from app.models import DmFailureReason


def _non_blank(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("내용이 비어 있습니다.")
    return value


def _note(value: str | None) -> str | None:
    """빈 메모는 메모가 없는 것으로 본다."""
    if value is None:
        return None
    return value.strip() or None


class ReminderCreateRequest(BaseModel):
    member_id: str
    task_id: str
    scheduled_at: AwareDatetime
    note: str | None = None

    _strip_note = field_validator("note")(_note)


class ReminderUpdateRequest(BaseModel):
    """note 를 null 이나 빈 글로 보내면 메모를 지운다. 보내지 않으면 그대로 둔다."""

    note: str | None = None
    scheduled_at: AwareDatetime | None = None

    _strip_note = field_validator("note")(_note)

    @model_validator(mode="after")
    def _something_to_change(self) -> "ReminderUpdateRequest":
        if "note" not in self.model_fields_set and self.scheduled_at is None:
            raise ValueError("note 나 scheduled_at 중 하나는 있어야 합니다.")
        return self


class BundleUpdateRequest(BaseModel):
    body: str | None = None
    scheduled_at: AwareDatetime | None = None

    @field_validator("body")
    @classmethod
    def _strip_body(cls, value: str | None) -> str | None:
        return None if value is None else _non_blank(value)

    @model_validator(mode="after")
    def _something_to_change(self) -> "BundleUpdateRequest":
        if self.body is None and self.scheduled_at is None:
            raise ValueError("body 나 scheduled_at 중 하나는 있어야 합니다.")
        return self


class ReplyCreateRequest(BaseModel):
    body: str

    _strip_body = field_validator("body")(_non_blank)


class ReminderResponse(BaseModel):
    reminder_id: str
    bundle_id: str
    task_id: str | None
    task_title: str | None
    due_date: date | None
    note: str | None
    status: str
    kind: str
    origin: str
    created_at: datetime


class BundleResponse(BaseModel):
    bundle_id: str
    thread_id: str
    member_id: str
    recipient_name: str
    scheduled_at: datetime
    status: str
    approved: bool
    approved_at: datetime | None
    body: str
    body_source: str
    draft_status: str
    reminders: list[ReminderResponse]


class ReminderWithBundleResponse(BaseModel):
    reminder: ReminderResponse
    bundle: BundleResponse


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    message_id: str
    thread_id: str
    sender: str
    body: str
    created_at: datetime
    reply_channel: str | None
    dm_status: str | None
    dm_failure_reason: str | None
    scheduled_at: datetime | None


class LastMessage(BaseModel):
    message_id: str
    sender: str
    body: str
    created_at: datetime


class ThreadSummary(BaseModel):
    thread_id: str
    member_id: str
    name: str
    last_message: LastMessage | None
    awaiting_reply_since: datetime | None
    dm_failed: bool


class InboxResponse(BaseModel):
    threads: list[ThreadSummary]
    bundles: list[BundleResponse] | None


class ThreadDetailResponse(BaseModel):
    thread: ThreadSummary
    messages: list[MessageResponse]
    bundles: list[BundleResponse] | None


class ClaimedMessageResponse(BaseModel):
    message_id: str
    workspace_id: str
    member_id: str
    discord_user_id: str
    body: str
    scheduled_at: datetime | None


class ClaimResponse(BaseModel):
    items: list[ClaimedMessageResponse]
    total: int


class DmResultRequest(BaseModel):
    status: Literal["delivered", "failed"]
    failure_reason: DmFailureReason | None = None


class BotReplyRequest(BaseModel):
    discord_user_id: str
    discord_message_id: str
    body: str
    sent_at: AwareDatetime
    # 첨부만 있는 DM 은 글이 비어 있다. 봇 DM 은 전부 저장하므로 원문 그대로 받는다.


class BotReplyResponse(BaseModel):
    message_id: str
    thread_id: str
    workspace_id: str
    member_id: str

