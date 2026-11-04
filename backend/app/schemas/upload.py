from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator


class UploadAttendee(BaseModel):
    member_id: str
    display_name: str


class PendingUpload(BaseModel):
    """AI가 가져갈 업로드 회의 하나. 회의 행과 업로드 정보(`meeting_upload`)를 합친 것이다."""

    meeting_id: str
    workspace_id: str
    title: str | None
    started_at: datetime
    attendees: list[UploadAttendee] = Field(..., description="업로드 때 PM이 고른 참석자")
    original_filename: str | None
    stored_filename: str
    size_bytes: int
    content_type: str | None
    uploaded_at: datetime


class PendingUploadListResponse(BaseModel):
    items: list[PendingUpload]


class UploadClaimResponse(BaseModel):
    meeting_id: str
    status: str


class SpeakerSample(BaseModel):
    """한 화자의 대표 발화 구간(초). PM 이 목소리를 들어 보는 데 쓴다."""

    start: float = Field(..., ge=0, allow_inf_nan=False)
    end: float = Field(..., allow_inf_nan=False)

    @model_validator(mode="after")
    def _end_after_start(self) -> "SpeakerSample":
        if self.end <= self.start:
            raise ValueError("end 는 start 보다 커야 합니다")
        return self


class SpeakerLabel(BaseModel):
    label: str = Field(..., min_length=1, max_length=64)
    total_sec: float = Field(..., ge=0, allow_inf_nan=False)
    samples: list[SpeakerSample] = Field(default_factory=list)

    @field_validator("label")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("label 은 공백만으로 이루어질 수 없습니다")
        return value


class SpeakersReportRequest(BaseModel):
    speakers: list[SpeakerLabel] = Field(..., min_length=1)

    @field_validator("speakers")
    @classmethod
    def _unique_labels(cls, speakers: list[SpeakerLabel]) -> list[SpeakerLabel]:
        labels = [s.label for s in speakers]
        if len(set(labels)) != len(labels):
            raise ValueError("label 이 중복되었습니다")
        return speakers


class SpeakersReportResponse(BaseModel):
    meeting_id: str
    status: str


class AssignedUpload(BaseModel):
    """PM 이 화자 지정을 끝내 AI 가 이어서 처리할 업로드 회의 하나."""

    meeting_id: str
    workspace_id: str
    title: str | None
    started_at: datetime
    mapping: dict[str, str | None] = Field(..., description="라벨 -> member_id(없으면 null)")
    assigned_at: datetime


class AssignedUploadListResponse(BaseModel):
    items: list[AssignedUpload]


class ResumeResponse(BaseModel):
    meeting_id: str
    status: str
    mapping: dict[str, str | None]


class SpeakerAssignRequest(BaseModel):
    mapping: dict[str, str | None] = Field(..., description="라벨 -> member_id(지정하지 않으면 null)")


class SpeakerAssignResponse(BaseModel):
    meeting_id: str
    status: str


class SpeakerAudioInfo(BaseModel):
    content_type: str
    size_bytes: int


class SpeakerViewResponse(BaseModel):
    """PM 이 화자를 지정하는 화면용. 라벨을 아직 못 받았으면 speakers 는 빈 목록이다."""

    meeting_id: str
    status: str
    speakers: list[SpeakerLabel]
    candidates: list[UploadAttendee]
    mapping: dict[str, str | None] | None
    audio: SpeakerAudioInfo
