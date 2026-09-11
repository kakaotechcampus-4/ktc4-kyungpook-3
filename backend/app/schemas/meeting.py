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
    progress: MeetingProgress
    extraction_id: str | None = None
    failed_stage: str | None = None


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


class ExtractionDetailResponse(BaseModel):
    extraction_id: str
    meeting_id: str
    items: list[ExtractionItemResponse]


class ExtractionItemCreate(BaseModel):
    task_title: str
    task_confidence: float = 0.0
    assignee_raw: str | None = None
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