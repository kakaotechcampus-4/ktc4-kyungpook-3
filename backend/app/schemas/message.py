from datetime import date, datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

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


class BundleApproveRequest(BaseModel):
    """PM 화면에 보이는 묶음의 draft_version. 그 사이 문구나 구성이 바뀌었으면 승인하지 않는다."""

    draft_version: int


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
    draft_version: int
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
    # 실제로 나간 DM 들의 디스코드 메시지 id. 2,000자를 넘으면 여러 통이다. 나눠 보내다 실패했으면 나간 것만 싣는다.
    discord_message_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _delivered_has_ids(self) -> "DmResultRequest":
        if self.status == "delivered" and not self.discord_message_ids:
            raise ValueError("보냄 보고에는 discord_message_ids 가 필요합니다.")
        return self


class BotReplyRequest(BaseModel):
    discord_user_id: str
    discord_message_id: str
    body: str
    sent_at: AwareDatetime
    # 첨부만 있는 DM 은 글이 비어 있다. 봇 DM 은 전부 저장하므로 원문 그대로 받는다.
    reply_to_discord_message_id: str | None = None


class BotReplyResponse(BaseModel):
    message_id: str
    thread_id: str
    workspace_id: str
    member_id: str


class DraftTask(BaseModel):
    task_id: str | None
    title: str
    due_date: date | None
    status: str
    note: str | None


class DraftClaimItem(BaseModel):
    bundle_id: str
    draft_version: int
    workspace_id: str
    recipient_name: str
    scheduled_at: datetime
    tasks: list[DraftTask]
    style_examples: list[str]
    fallback_body: str


class DraftClaimResponse(BaseModel):
    items: list[DraftClaimItem]
    total: int


DRAFT_MAX_LENGTH = 2000


class DraftWriteRequest(BaseModel):
    """body 가 null 이면 AI 가 초안을 못 쓴 것이다. 규칙 문구를 그대로 둔다."""

    draft_version: int
    body: str | None

    @field_validator("body")
    @classmethod
    def _check_body(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = _non_blank(value)
        if len(value) > DRAFT_MAX_LENGTH:
            raise ValueError(f"초안은 {DRAFT_MAX_LENGTH}자 이하여야 합니다.")
        return value
