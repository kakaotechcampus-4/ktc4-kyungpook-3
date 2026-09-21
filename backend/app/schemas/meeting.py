from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import MeetingSource


class MeetingCreateRequest(BaseModel):
    workspace_id: str = Field(..., description="소속 워크스페이스 ID")
    title: str | None = Field(None, description="회의 제목 (optional)")
    source: MeetingSource = Field(
        MeetingSource.DISCORD, description="discord | manual_upload"
    )


class MeetingCreateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    meeting_id: str
    workspace_id: str
    status: str
    started_at: datetime


class MeetingEndResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    meeting_id: str
    status: str
    ended_at: datetime | None


class MeetingFailRequest(BaseModel):
    failed_stage: str = Field(..., description="어느 단계에서 실패했는지 (e.g., STT, LLM)")


class MeetingProgress(BaseModel):
    audio_merged: bool
    transcribed: bool
    extracted: bool


class MeetingDetailResponse(BaseModel):
    meeting_id: str
    workspace_id: str
    title: str | None
    status: str
    started_at: datetime
    ended_at: datetime | None
    extraction_id: str | None = None
    failed_stage: str | None = None
    progress: MeetingProgress


class MeetingListResponse(BaseModel):
    items: list[dict]
    total: int


class MeetingMinutesResponse(BaseModel):
    meeting_id: str
    title: str | None
    started_at: datetime
    duration_ms: int
    source: str
    attendees: list[dict]
    summary: dict | None
    transcript: list[dict]
    permissions: dict



class TaskInfo(BaseModel):
    title: str
    confidence: float


class AssigneeInfo(BaseModel):
    raw: str | None
    member_id: str | None
    display_name: str | None
    confidence: float
    needs_check: bool = False


class DueDateInfo(BaseModel):
    value: date | None
    raw: str | None
    confidence: float


class EvidenceInfo(BaseModel):
    quote: str | None
    speaker: str | None
    at_ms: int | None


class ExtractionItemResponse(BaseModel):
    item_id: str
    task: TaskInfo
    assignee: AssigneeInfo
    due_date: DueDateInfo
    confidence: float
    gate: str
    evidence: EvidenceInfo
    task_id: str | None = Field(None, description="gate=auto — 바로 생성된 태스크 ID")
    approval_id: str | None = Field(
        None, description="gate=review|hold — PM 승인이 필요한 승인 요청 ID"
    )


class ExtractionDetailResponse(BaseModel):
    extraction_id: str
    meeting_id: str
    items: list[ExtractionItemResponse]


class ExtractionItemCreate(BaseModel):
    task_title: str
    task_confidence: float = 0.0
    assignee_raw: str | None = None
    assignee_type: str | None = Field(None, description="'first'(1인칭), 'third'(3인칭), 'group', 'none' 등")
    due_date: date | None = None
    due_raw: str | None = None
    due_confidence: float = 0.0
    evidence_quote: str | None = None
    evidence_speaker: str | None = None
    evidence_at_ms: int | None = None


class ExtractionCreateRequest(BaseModel):
    meeting_id: str
    workspace_id: str
    transcript_path: str | None = None
    model_name: str | None = None
    items: list[ExtractionItemCreate] = []


class ExtractionCreateResponse(BaseModel):
    extraction_id: str
    meeting_id: str
    item_count: int