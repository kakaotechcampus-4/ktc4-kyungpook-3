from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import ExtractionAction, MeetingSource, TaskStatus


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
    action: ExtractionAction = Field(
        ExtractionAction.CREATE,
        description="create: 새 task(없으면 create) / update: target_task_id의 기존 task 수정. "
        "AI Terra 2단계의 JudgeResult.is_new에서 온다.",
    )
    target_task_id: str | None = Field(
        None, description="action이 update일 때 수정할 task ID (JudgeResult.matched_task_id)"
    )
    task_title: str | None = Field(
        None, description="action이 create면 필수. update면 보내지 않아도 되고, 보내도 제목은 바꾸지 않는다."
    )
    task_confidence: float = 0.0
    assignee_raw: str | None = Field(
        None, description="담당자를 가리킨 원문. first가 아니면 이 값을 별칭 텍스트로 매칭한다."
    )
    assignee_type: str | None = Field(
        None,
        description="'first'(1인칭), 'second', 'thirdname', 'group', 'none' 등. "
        "first이면 assignee_raw 대신 evidence_speaker(Discord uid)로 Member.discord_user_id를 찾는다.",
    )
    due_date: date | None = None
    due_raw: str | None = None
    due_confidence: float = 0.0
    evidence_quote: str | None = None
    evidence_speaker: str | None = Field(
        None, description="근거 문장을 말한 화자의 Discord uid (별칭 텍스트가 아님)"
    )
    evidence_at_ms: int | None = None
    category: str | None = Field(
        None, max_length=16, description="schedule / assignee / scope / decision (JudgeResult.category)"
    )
    status: TaskStatus | None = Field(None, description="JudgeResult.status. 언급이 없으면 null")
    doc_text: str | None = Field(None, description="PM에게 보여 줄 설명 문장 (DraftResult.doc_text)")

    @model_validator(mode="after")
    def _check_action_fields(self) -> "ExtractionItemCreate":
        if self.action == ExtractionAction.CREATE and not (self.task_title and self.task_title.strip()):
            raise ValueError("action이 create면 task_title이 필요합니다.")
        if self.action == ExtractionAction.UPDATE and not self.target_task_id:
            raise ValueError("action이 update면 target_task_id가 필요합니다.")
        return self


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