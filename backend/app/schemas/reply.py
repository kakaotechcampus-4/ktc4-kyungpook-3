from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field


class ClaimedLine(BaseModel):
    sender: Literal["pm", "member"]
    text: str


class ClaimedCandidate(BaseModel):
    task_id: str
    title: str
    status: str = Field(description="열린 시계가 있는 막힘 태스크면 막기 전 상태다")
    due_date: date | None
    assignee_member_id: str | None
    updated_at: datetime


class ClaimedReply(BaseModel):
    message_id: str
    attempt: int
    workspace_id: str
    identity_epoch: int = 0
    member_name: str
    reply_date: date = Field(description="보낸 날 KST")
    lines: list[ClaimedLine] = Field(description="시간순. 마지막이 이번 답장이고 최대 12줄이다")
    candidates: list[ClaimedCandidate]


class ReplyClaimResponse(BaseModel):
    item: ClaimedReply | None


class ChangeBase(BaseModel):
    """판단이 본 값. claim 의 후보를 그대로 돌려준다. 게이트와 승인 충돌 확인의 기준이다."""

    status: str | None = None
    due_date: str | None = None
    assignee_member_id: str | None = None
    title: str | None = None
    updated_at: str | None = None


class ReplyChangeRequest(BaseModel):
    task_id: str | None = None
    field: Literal["status", "due_date", "assignee", "scope", "unknown", "due_clear", "failed"]
    new_value: str | None = None
    evidence_status: Literal["certain", "inferred"] | None = None
    summary: str | None = None
    evidence_quote: str | None = None
    assignee_type: str | None = None
    assignee_raw: str | None = None
    base: ChangeBase | None = None


class ReplyJudgmentRequest(BaseModel):
    attempt: int
    failure_reason: str | None = Field(None, description="값이 있으면 판단 전체 실패다. 예외 종류만 싣고 답장 글은 싣지 않는다")
    model_name: str | None = None
    changes: list[ReplyChangeRequest] = []


class AttributionRequest(BaseModel):
    task_id: str | None = Field(description="null 이면 해당 없음")


class AttributionResponse(BaseModel):
    message_id: str


class TaskRef(BaseModel):
    task_id: str
    title: str


class ReplyAttribution(BaseModel):
    message_id: str
    status: Literal["needs_pm", "resolved"]
    candidates: list[TaskRef] | None = None
    task: TaskRef | None = None


class ReplyAttributionListResponse(BaseModel):
    items: list[ReplyAttribution]
    total: int


class TimelineChange(BaseModel):
    change_id: str
    field: str
    new_value: str | None
    evidence_status: str | None
    summary: str | None = Field(description="AI 해석. 대화 주인과 PM 에게만 보인다")
    evidence_quote: str | None = Field(description="대화 주인과 PM 에게만 보인다")
    result: Literal["applied", "undone", "pending", "approved", "rejected", "noted", "recorded"]
    undoable: bool


class TimelineReply(BaseModel):
    kind: Literal["reply"]
    at: datetime
    message_id: str
    member_name: str
    channel: str | None
    body: str | None = Field(description="대화 주인과 PM 에게만 보인다")
    changes: list[TimelineChange]


class TimelineHistory(BaseModel):
    kind: Literal["history"]
    at: datetime
    history_id: str
    changed_field: str
    old_value: str | None
    new_value: str | None
    change_source: str


class TaskTimelineResponse(BaseModel):
    items: list[Annotated[TimelineReply | TimelineHistory, Field(discriminator="kind")]]
    total: int
