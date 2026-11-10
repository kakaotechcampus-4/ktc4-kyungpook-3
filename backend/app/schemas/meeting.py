from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    field_validator,
    model_validator,
)

from app.models import (
    ApprovalStatus,
    EvidenceStatus,
    ExtractionAction,
    ExtractionPath,
    MeetingProcessingStage,
    MeetingSource,
    TaskStatus,
)
from app.schemas.source import INT4_MAX

# 추출 항목 하나의 근거 발화 수 상한. 근거는 결론까지의 몇 줄이라 넉넉하다
MAX_EVIDENCE_SEQS = 100


class MeetingCreateRequest(BaseModel):
    replaces_meeting_id: str | None = None
    workspace_id: str = Field(..., description="소속 워크스페이스 ID")
    title: str | None = Field(None, description="회의 제목 (optional)")
    source: MeetingSource = Field(
        MeetingSource.DISCORD, description="discord | manual_upload | chat"
    )
    started_at: AwareDatetime | None = Field(
        None,
        description="회의 시작 시각(시간대 필수, UTC 로 저장). 없으면 지금. 지금보다 늦으면 400. "
        "채팅 출처는 이 회의에 담긴 첫 메시지 시각을 보낸다",
    )


class ChatCursorResponse(BaseModel):
    """봇이 마지막으로 처리한 채팅 위치. 끝난 채팅 회의가 없으면 data 가 null 이다."""

    meeting_id: str
    # str 로 둔다. datetime 으로 직렬화하면 +00:00 이 Z 로 바뀌어 계약(`+00:00`)과 달라진다
    last_message_at: str = Field(..., description="마지막 메시지 시각. ISO 8601, UTC(+00:00)")


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


# 컬럼이 PostgreSQL INTEGER(4바이트)라 그보다 큰 값은 DB 에서 500 이 되기 전에 400 으로 막는다
_INT4_MAX = 2_147_483_647


class MeetingSttProgress(BaseModel):
    done: StrictInt = Field(..., ge=0, description="전사를 끝낸 조각 수")
    total: StrictInt = Field(..., ge=1, le=_INT4_MAX, description="전사할 전체 조각 수")

    @model_validator(mode="after")
    def _done_within_total(self) -> "MeetingSttProgress":
        if self.done > self.total:
            raise ValueError("done 은 total 이하여야 합니다")
        return self


class MeetingStageRequest(BaseModel):
    stage: MeetingProcessingStage = Field(
        ..., description="AI 가 지금 시작한 처리 단계"
    )
    stt: MeetingSttProgress | None = Field(
        None, description="stt 단계의 전사 진행. stage 가 stt 일 때만 보낸다"
    )

    @model_validator(mode="after")
    def _stt_only_on_stt_stage(self) -> "MeetingStageRequest":
        if self.stt is not None and self.stage != MeetingProcessingStage.STT:
            raise ValueError("stt 진행은 stage 가 stt 일 때만 보낼 수 있습니다")
        return self


class MeetingStageResponse(BaseModel):
    meeting_id: str
    status: str
    processing_stage: str | None
    stt: MeetingSttProgress | None = Field(None, description="저장된 전사 진행. stt 단계가 아니면 null")
    applied: bool = Field(..., description="이 보고가 반영됐는지(같은 단계·역행·처리 중이 아님은 False)")


class MeetingProgress(BaseModel):
    audio_merged: bool
    transcribed: bool
    extracted: bool


class MeetingProcessing(BaseModel):
    stage: str | None = Field(..., description="AI 가 알린 현재 단계. 아직 알리지 않았으면 null")
    stage_at: datetime | None = Field(..., description="현재 단계가 시작된 시각")
    stt: MeetingSttProgress | None = Field(..., description="전사 진행. stt 단계에서 알렸을 때만")


class MeetingDetailResponse(BaseModel):
    meeting_id: str
    deletion_available: bool = False
    workspace_id: str
    title: str | None
    status: str
    started_at: datetime
    ended_at: datetime | None
    extraction_id: str | None = None
    failed_stage: str | None = None
    progress: MeetingProgress
    processing: MeetingProcessing | None = Field(
        None, description="status 가 processing 일 때만 객체, 그 밖에는 null"
    )


class MeetingListResponse(BaseModel):
    items: list[dict]
    total: int


class MeetingAudioInfo(BaseModel):
    content_type: str
    expires_at: datetime = Field(description="이 시각까지 원문 녹음을 들을 수 있다")


class MeetingMinutesResponse(BaseModel):
    meeting_id: str
    title: str | None
    started_at: datetime
    duration_ms: int
    source: str
    attendees: list[dict]
    summary: dict | None
    # ready: 요약이 있다. pending: 곧 나온다. none: 없다(대상 아님, 실패)
    summary_status: Literal["ready", "pending", "none"]
    transcript: list[dict]
    permissions: dict
    audio: MeetingAudioInfo | None = Field(
        None, description="호출자가 이 회의 녹음을 들을 수 있을 때만 값(보관 기간 안, done 이 아니면 PM 만). 아니면 null"
    )



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
    speaker_member_id: str | None = Field(
        None,
        description="근거 발화를 한 팀원 ID. 근거 발화를 찾았으면 그 발화에 저장된 값 그대로이고(탈퇴했어도), 못 찾았으면 "
        "요청의 evidence_speaker_member_id(이 워크스페이스의 탈퇴하지 않은 팀원으로 확인된 값만). 없으면 null",
    )


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
    alias_candidate: bool = Field(
        False,
        description="담당자를 못 찾은 이름 지목(thirdname) 항목의 pending 생성 승인이고, 그 항목이 카드의 담당 항목(payload assignee_item_id, 없으면 extraction_item_id)이며(다른 회의 항목을 합친 카드는 담당 항목에만 나온다), 같은 워크스페이스에서 탈퇴하지 않은 팀원 누구도 그 글자(님·조사를 뗀 찾기 후보 포함)를 별칭으로 갖고 있지 않으면 true. PM 이 담당자를 골라 save_alias=true 로 승인하면 alias_text 를 그 팀원의 별칭으로 저장한다. 탈퇴하지 않은 누군가가 이미 갖고 있으면 false 이고 저장하지 않는다(탈퇴한 팀원의 별칭은 세지 않는다)",
    )
    alias_text: str | None = Field(
        None,
        description="저장될 별칭 글자(원문에서 끝 조사·님을 뗀 것). alias_candidate 가 false 면 null",
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


class AsrSuspect(BaseModel):
    """전사 오인식 의심 단어 하나(AI judge/asr_check.py). 확인 카드에 "'애포'는 '배포'일 수 있어요"로 보일 수 있다."""

    word: str = Field(max_length=100, description="의심 단어. 검사를 하지 못했으면 빈 문자열")
    source: str = Field(
        max_length=32,
        description="evidence(근거 발화) · title(제목) · check_failed(검사 실패, word 는 빈 문자열). "
        "AI 가 새 값을 먼저 배포해도 회의 전체가 400 이 되지 않게 문자열로 받는다. 모르는 값도 payload 에 그대로 싣고 "
        "FE 는 evidence·title 만 교정 후보로, check_failed 는 \"검사하지 못함\"으로 따로 보인다",
    )
    candidates: list[Annotated[str, Field(max_length=100)]] = Field(
        default_factory=list, max_length=5, description="발음이 가까운 업무 용어 후보. 가까운 순, 최대 5개"
    )


class ExtractionItemCreate(BaseModel):
    action: ExtractionAction = Field(
        ExtractionAction.CREATE,
        description="create: 새 task(없으면 create) / update: target_task_id의 기존 task 수정 / "
        "merge: target_approval_id의 승인 대기 task_create 카드에 합침. "
        "AI Terra 2단계의 JudgeResult.is_new에서 온다.",
    )
    target_approval_id: str | None = Field(
        None,
        max_length=36,
        description="action이 merge일 때 합칠 승인 대기 카드 ID. merge일 때만 읽는다. "
        "없거나 이 워크스페이스의 대기 중 task_create 카드가 아니면 create로 처리한다(auto 아님).",
    )
    target_task_id: str | None = Field(
        None,
        description="action이 update일 때 수정할 task ID (JudgeResult.matched_task_id). "
        "없거나 이 워크스페이스 task가 아니면 그 항목만 건너뛴다.",
    )
    task_title: str | None = Field(
        None,
        description="action이 create·merge면 필수(비어 있으면 그 항목만 건너뛴다). "
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
        description="담당자 표현의 종류. 'first'(1인칭), 'second', 'thirdname', 'thirdpronoun', 'thirdrole', "
        "'group', 'none' 중 하나다. BE가 추출 항목에 저장하며(승인 때 별칭 학습에 쓴다) 모르는 값은 NULL로 저장한다. "
        "first이면 assignee_raw 대신 화자로 팀원을 찾는다. 화자는 다음 순서로 정한다. "
        "(1) evidence_speaker_member_id가 있으면 그 팀원이다. 이 워크스페이스의 탈퇴하지 않은 팀원이 아니면 "
        "화자를 못 찾은 것이고 (2)(3)으로 넘어가지 않는다. "
        "(2) evidence_speaker(Discord uid)로 Member.discord_user_id를 찾는다. "
        "(3) 둘 다 없으면 evidence_seqs 중 가장 큰 seq의 발화(결론 발화)를 찾았을 때 그 발화의 member_id, "
        "없거나 탈퇴한 팀원이면 그 발화의 화자 uid. 그 발화를 찾지 못하면 화자가 없다.",
    )
    due_date: date | None = None
    due_cleared: bool = Field(
        False,
        description="update에서 대상 task의 마감을 없애자는 결정이면 true. due_date=null은 '바꾸지 않음'이라 따로 둔다. "
        "due_date가 함께 오면 due_date를 따른다. 대상 task에 마감이 없으면 바뀌는 것이 없다.",
    )
    due_raw: str | None = None
    due_confidence: float | None = Field(
        None, description="마감 확신도(0~1). legacy 경로만 보낸다. 보내지 않으면 null(측정 안 함)."
    )
    evidence_quote: str | None = None
    evidence_speaker: str | None = Field(
        None, description="근거 문장을 말한 화자의 Discord uid (별칭 텍스트가 아님)"
    )
    evidence_speaker_member_id: str | None = Field(
        None,
        max_length=36,
        description="근거 문장을 말한 화자의 팀원 ID. 있으면 evidence_speaker보다 먼저 쓴다. "
        "이 워크스페이스의 탈퇴하지 않은 팀원이 아니면 화자를 못 찾은 것으로 본다. 빈 문자열은 null",
    )
    evidence_at_ms: int | None = None
    # 범위는 발화 저장 API의 seq와 같다. 벗어난 값은 DB 조회에서 터지므로 요청에서 막는다
    evidence_seqs: list[Annotated[int, Field(ge=0, le=INT4_MAX)]] | None = Field(
        None,
        # 요청 전체의 seq를 IN 한 번으로 읽는다. 잘못 만든 항목 하나가 DB의 바인드 변수 한도를 넘기지 않게 막는다
        max_length=MAX_EVIDENCE_SEQS,
        description="근거 발화의 seq 목록(발화 저장 API의 seq). 순서는 자유, 최대 100개. 모두 evidence로 저장하고 "
        "가장 큰 seq를 대표 근거로 쓴다. 이 회의에 없는 seq는 건너뛴다. 모르면 [] 또는 생략",
    )
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
    asr_suspects: list[AsrSuspect] | None = Field(
        None,
        max_length=50,
        description="전사 오인식 의심 단어. judge 새 항목만 보낸다. 하나라도 있으면 auto로 보내지 않는다. "
        "검사해서 없으면 빈 목록, 보내지 않으면(옛 AI) null이고 둘 다 게이트에 영향이 없다",
    )
    target_snapshot: TargetSnapshot | None = Field(
        None,
        description="action이 update일 때 AI가 유사 검색에서 본 대상 task 값. 승인 충돌의 기준값이 된다. "
        "없으면 등록 시점의 DB 값을 기준으로 쓴다.",
    )

    @field_validator("evidence_speaker_member_id", mode="before")
    @classmethod
    def _blank_member_id_is_unknown(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

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
