from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import (
    ApprovalStatus,
    EvidenceStatus,
    ExtractionAction,
    ExtractionPath,
    MeetingSource,
    TaskStatus,
)


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
    confidence: float | None = Field(None, description="null이면 AI가 측정하지 않았다(judge 경로)")
    evidence_status: EvidenceStatus | None = Field(
        None, description="할 일이 원문에 얼마나 드러나 있는지(judge 새 항목). AI가 보내지 않았으면 null"
    )


class AssigneeInfo(BaseModel):
    raw: str | None
    member_id: str | None
    display_name: str | None
    confidence: float
    needs_check: bool = False


class DueDateInfo(BaseModel):
    value: date | None
    raw: str | None
    confidence: float | None = Field(None, description="null이면 AI가 측정하지 않았다(judge 경로)")
    evidence_status: EvidenceStatus | None = Field(
        None, description="마감이 원문에 얼마나 드러나 있는지(judge 새 항목). AI가 보내지 않았으면 null"
    )


class EvidenceInfo(BaseModel):
    quote: str | None
    speaker: str | None
    at_ms: int | None


class ExtractionItemResponse(BaseModel):
    item_id: str
    task: TaskInfo
    assignee: AssigneeInfo
    due_date: DueDateInfo
    confidence: float | None = Field(
        None, description="언급된 값들의 확신도 최솟값. 할 일 확신도가 측정되지 않았으면 null"
    )
    gate: str = Field(
        ...,
        description="auto | review | hold. auto는 승인 없이 태스크를 바로 만든 항목이다. "
        "PM이 되돌려도 처음 판단을 남기려고 auto로 둔다. 되돌렸는지는 reverted_at으로 본다",
    )
    evidence: EvidenceInfo
    similar_count: int | None = Field(
        None, description="AI가 판단할 때 본 비슷한 기존 태스크 수(judge 새 항목). 보내지 않았으면 null"
    )
    top_similarity: float | None = Field(
        None, description="그 태스크들 중 가장 높은 유사도(0~1). 보내지 않았거나 검색 결과가 없으면 null"
    )
    reverted_at: datetime | None = Field(
        None,
        description="auto로 만든 태스크를 PM이 되돌린 시각. 되돌리면 태스크는 지워지고 같은 내용의 생성 승인 "
        "요청이 approval_id로 연결된다. 되돌리지 않았으면 null",
    )
    task_id: str | None = Field(
        None,
        description=(
            "연결된 태스크 ID. 생성 항목은 태스크가 생긴 뒤(자동 생성 또는 생성 승인 뒤)에 채워진다. "
            "수정 항목은 수정 대상 태스크라 승인 전에도 있다. 반영 여부는 approval_status로 본다"
        ),
    )
    approval_id: str | None = Field(
        None, description="연결된 승인 요청 ID. 승인·반려 뒤에도 남는다. 승인 요청이 없으면 null"
    )
    approval_status: ApprovalStatus | None = Field(
        None,
        description=(
            "연결된 승인 요청의 지금 상태. 승인 요청이 없으면 null. "
            "approved는 태스크 반영과 승인 처리가 함께 커밋된 상태다"
        ),
    )


class ExtractionDetailResponse(BaseModel):
    extraction_id: str
    meeting_id: str
    extraction_path: str | None = Field(None, description="legacy | judge. 판별할 수 없었으면 null")
    items: list[ExtractionItemResponse]


class ExtractionItemRevertResponse(BaseModel):
    item_id: str
    reverted_task_id: str = Field(..., description="지운 태스크 ID")
    approval_id: str = Field(..., description="대신 만든 생성 승인 요청 ID(pending)")
    reverted_at: datetime


class TargetSnapshot(BaseModel):
    """AI가 유사 검색(SimilarTaskCandidate)에서 본 수정 대상 task의 값. 승인 충돌의 기준값으로 쓴다.

    보낸 필드만 기준값으로 쓴다. null은 "그때 값이 없었다"이고, 보내지 않은 필드는 등록 시점의 DB 값을 쓴다.
    title은 예외다. task 제목은 비어 있을 수 없어서 null도 보내지 않은 것으로 보고 등록 시점의 제목을 쓴다.
    """

    updated_at: datetime | None = Field(None, description="검색 응답의 updated_at. 비교에는 쓰지 않고 기록용")
    due_date: date | None = None
    status: str | None = Field(None, max_length=16)
    assignee_member_id: str | None = Field(None, max_length=36)
    title: str | None = Field(
        None,
        max_length=300,
        description="AI가 이 task를 고른 근거가 된 제목. 바꿀 값이 아니라 승인 때 대상이 그대로인지 확인하는 기준이다",
    )


class ExtractionItemCreate(BaseModel):
    action: ExtractionAction = Field(
        ExtractionAction.CREATE,
        description="create: 새 task(없으면 create) / update: target_task_id의 기존 task 수정. "
        "AI Terra 2단계의 JudgeResult.is_new에서 온다.",
    )
    target_task_id: str | None = Field(
        None,
        description="action이 update일 때 수정할 task ID (JudgeResult.matched_task_id). "
        "없거나 이 워크스페이스 task가 아니면 그 항목만 건너뛴다.",
    )
    task_title: str | None = Field(
        None,
        description="action이 create면 필수(비어 있으면 그 항목만 건너뛴다). "
        "update면 보내지 않아도 되고, 보내도 제목은 바꾸지 않는다.",
    )
    task_confidence: float | None = Field(
        None,
        description="할 일 확신도(0~1). legacy 경로만 보낸다. 보내지 않으면 null(측정 안 함)이고 0.0과 다르다.",
    )
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
    due_confidence: float | None = Field(
        None, description="마감 확신도(0~1). legacy 경로만 보낸다. 보내지 않으면 null(측정 안 함)."
    )
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
    task_status: EvidenceStatus | None = Field(
        None,
        description="할 일 근거 상태. judge 새 항목만 보낸다. certain이어야 auto가 될 수 있다. "
        "보내지 않으면 null이고 auto로 보내지 않는다",
    )
    due_status: EvidenceStatus | None = Field(
        None,
        description="마감 근거 상태. judge 새 항목만 보낸다. 마감이 없으면 missing. "
        "certain이거나 missing이어야 auto가 될 수 있다. 보내지 않으면 null이고 auto로 보내지 않는다",
    )
    similar_count: int | None = Field(
        None,
        ge=0,
        description="AI가 판단할 때 유사 검색이 돌려준 기존 태스크 수. judge 새 항목만 보낸다. "
        "0이어야 auto가 될 수 있다. 보내지 않으면 null이고 auto로 보내지 않는다",
    )
    top_similarity: float | None = Field(
        None,
        ge=0.0,
        le=1.0,
        description="그 태스크들 중 가장 높은 유사도. 기록용이라 게이트 판단에는 쓰지 않는다. "
        "검색 결과가 없으면 null",
    )
    target_snapshot: TargetSnapshot | None = Field(
        None,
        description="action이 update일 때 AI가 유사 검색에서 본 대상 task 값. 승인 충돌의 기준값이 된다. "
        "없으면 등록 시점의 DB 값을 기준으로 쓴다.",
    )

    def extraction_path(self) -> ExtractionPath | None:
        """이 항목을 만든 AI 추출 경로. 값이 아니라 어떤 키를 보냈는지로 가린다.

        judge(ai/judge/pipeline.py to_item)는 action·category·doc_text를 값이 null이어도 키째 보내고,
        확신도는 보내지 않는다. legacy(ai/capture/handoff.py to_extraction_items)는 task_confidence·
        due_confidence를 항상 보내고, judge의 키는 보내지 않는다. 둘 다 아니면 None(판별 불가)이다.
        judge의 키가 있으면 확신도를 함께 보냈어도 judge로 본다. 게이트를 경로로 정하므로, judge가
        나중에 확신도를 보내기 시작해도 정책을 바꾸기 전까지는 auto로 가지 않게 하려는 것이다.
        """
        sent = self.model_fields_set
        if sent & _JUDGE_KEYS:
            return ExtractionPath.JUDGE
        if sent & _LEGACY_KEYS:
            return ExtractionPath.LEGACY
        return None


# 경로를 가리는 키. ExtractionItemCreate.extraction_path 참고
_JUDGE_KEYS = frozenset({"action", "category", "doc_text"})
_LEGACY_KEYS = frozenset({"task_confidence", "due_confidence"})


class ExtractionCreateRequest(BaseModel):
    meeting_id: str
    workspace_id: str
    transcript_path: str | None = None
    model_name: str | None = Field(None, description="STT 모델 이름. 두 추출 경로에서 같아 경로 판별에 쓰지 않는다")
    items: list[ExtractionItemCreate] = []

    def extraction_path(self) -> ExtractionPath | None:
        """추출 전체의 경로. 모든 항목이 같은 경로일 때만 그 경로이고, 항목이 없거나 섞였거나 판별할 수
        없는 항목이 있으면 None이다. AI는 회의 하나를 한 경로로만 처리하므로 섞이면 정상 요청이 아니다."""
        paths = {item.extraction_path() for item in self.items}
        if len(paths) == 1:
            return paths.pop()
        return None


class ExtractionCreateResponse(BaseModel):
    extraction_id: str
    meeting_id: str
    item_count: int