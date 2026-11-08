from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, model_validator

SummaryRequestState = Literal[
    "requested", "done", "queued", "gave_up", "no_sources", "not_summarized_source", "not_done"
]


class SummaryClaimBody(BaseModel):
    """본문이 없으면 범위 없이 가져간다. 빈 목록은 아무것도 가져가지 않는다."""

    extraction_ids: list[str] | None = Field(None, max_length=500)


class SummaryClaimResponse(BaseModel):
    extraction_id: str
    meeting_id: str
    workspace_id: str
    attempt: int


class SummaryInputLine(BaseModel):
    seq: int
    at_ms: int
    speaker: str
    text: str


class SummaryInputItem(BaseModel):
    item_id: str
    action: str
    title: str
    assignee: str | None
    due_date: date | None


class SummaryInputTopic(BaseModel):
    topic_id: str
    name: str
    description: str


class SummaryInputDecision(BaseModel):
    decision_id: str
    text: str
    topic: str
    decided_on: date


class SummaryInputResponse(BaseModel):
    extraction_id: str
    meeting_id: str
    workspace_id: str
    title: str | None
    started_at: datetime
    lines: list[SummaryInputLine]
    items: list[SummaryInputItem]
    topics: list[SummaryInputTopic]
    decisions: list[SummaryInputDecision]


class SummaryDecisionIn(BaseModel):
    text: str = Field(min_length=1)
    reason: str | None = None
    rejected: list[str] = []
    # 뒤집은 이전 결정의 decision_id
    replaces: list[str] = []


class SummaryTopicIn(BaseModel):
    """기존 주제는 topic_id 와 그 이름, 새 주제는 name. 결정을 주제 아래에 둬서 주제 없는 결정이 표현되지 않는다.

    기존 주제의 이름도 받는 것은 재료를 읽은 뒤 다른 회의의 재요약이 그 주제를 지웠을 때 이름으로 다시 찾기 위해서다.
    """

    topic_id: str | None = None
    name: str | None = Field(None, max_length=100)
    description: str = ""
    item_ids: list[str] = Field(default_factory=list, max_length=500)
    decisions: list[SummaryDecisionIn] = []

    @model_validator(mode="after")
    def _topic_is_named(self) -> "SummaryTopicIn":
        if self.topic_id is None and self.name is None:
            raise ValueError("topic_id 나 name 이 있어야 합니다.")
        return self


class DiscussionBlock(BaseModel):
    title: str
    points: list[str] = []


class TaskChangeEntry(BaseModel):
    task: str
    assignee: str = ""
    due: str = ""
    purpose: str = ""
    precondition: str = ""


class ScheduleEntry(BaseModel):
    when: str
    what: str


def _has_unstorable(value: Any) -> bool:
    if isinstance(value, str):
        return any(ch == "\x00" or "\ud800" <= ch <= "\udfff" for ch in value)
    if isinstance(value, dict):
        return any(_has_unstorable(v) for v in value.values())
    if isinstance(value, list):
        return any(_has_unstorable(v) for v in value)
    return False


class SummaryWriteRequest(BaseModel):
    """LLM 이 만든 글이 들어오는 신뢰 경계다. DB 에 쓸 수 없는 글자(NUL, 짝 없는 서로게이트)는 500 대신 400 으로 막는다."""

    model_name: str
    truncated_input: bool = False
    overview: str = Field(min_length=1)
    key_points: list[str]
    discussion: list[DiscussionBlock] = []
    facts: list[str] = []
    task_changes: list[TaskChangeEntry] = []
    schedule: list[ScheduleEntry] = []
    open_items: list[str] = []
    topics: list[SummaryTopicIn] = []

    @model_validator(mode="before")
    @classmethod
    def _storable_text(cls, data: Any) -> Any:
        if _has_unstorable(data):
            raise ValueError("NUL 이나 짝 없는 서로게이트 글자는 저장할 수 없습니다.")
        return data


class SummarySaveResponse(BaseModel):
    extraction_id: str
    meeting_id: str
    applied: bool
    topic_count: int
    decision_count: int


class SummaryRequestBody(BaseModel):
    meeting_ids: list[str] | None = None
    include_all: bool = False
    force: bool = False
    dry_run: bool = True

    @model_validator(mode="after")
    def _one_scope(self) -> "SummaryRequestBody":
        if self.include_all == (self.meeting_ids is not None):
            raise ValueError("meeting_ids 와 include_all 중 하나만 보냅니다.")
        return self


class SummaryRequestRow(BaseModel):
    meeting_id: str
    extraction_id: str | None
    title: str | None
    started_at: datetime
    state: SummaryRequestState
    chars: int


class SummaryRequestResponse(BaseModel):
    items: list[SummaryRequestRow]


class MeetingRef(BaseModel):
    meeting_id: str
    title: str | None
    started_at: datetime


class TopicNode(BaseModel):
    id: str
    kind: Literal["topic"] = "topic"
    label: str
    appeared_at: datetime


class TaskNode(BaseModel):
    id: str
    kind: Literal["task"] = "task"
    label: str
    status: str
    due_date: date | None
    assignee_name: str | None
    blocker: str | None
    meeting_ids: list[str]
    appeared_at: datetime


class GraphEdge(BaseModel):
    source: str
    target: str


class GraphResponse(BaseModel):
    meetings: list[MeetingRef]
    nodes: list[Annotated[TopicNode | TaskNode, Field(discriminator="kind")]]
    edges: list[GraphEdge]


class TopicDecision(BaseModel):
    decision_id: str
    text: str
    reason: str | None
    meeting_id: str
    meeting_title: str | None
    decided_at: datetime
    replaced_by: str | None


class TopicTask(BaseModel):
    task_id: str
    title: str
    status: str
    due_date: date | None
    assignee_name: str | None


class TopicDetailResponse(BaseModel):
    topic_id: str
    name: str
    description: str
    decisions: list[TopicDecision]
    tasks: list[TopicTask]
    meetings: list[MeetingRef]
