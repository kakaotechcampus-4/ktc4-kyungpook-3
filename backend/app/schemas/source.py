from collections import Counter
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

# 회의 하나는 하루를 넘지 않는다. 이보다 큰 값은 잘못 들어온 값이다.
MAX_SECONDS = 24 * 60 * 60
# source.seq, start_ms, end_ms는 PostgreSQL integer(int4) 컬럼이다
INT4_MAX = 2**31 - 1


class TranscriptSegmentIn(BaseModel):
    """AI의 TranscriptSegment(ai/shared/schemas.py) 한 줄. 시각은 회의 시작 기준 초다."""

    speaker: str | None = Field(
        None, max_length=64, description="발화한 사람의 Discord uid. 모르면 null"
    )
    start: float = Field(..., ge=0, le=MAX_SECONDS, allow_inf_nan=False, description="발화 시작(초)")
    end: float = Field(..., ge=0, le=MAX_SECONDS, allow_inf_nan=False, description="발화 끝(초)")
    text: str
    seq: int = Field(
        ..., ge=0, le=INT4_MAX, description="회의 전체에서의 발화 순번. 사이가 비어도 된다"
    )

    @field_validator("speaker", mode="before")
    @classmethod
    def _blank_speaker_is_unknown(cls, value: object) -> object:
        # 화자를 모르는 발화를 null 하나로만 저장한다
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @model_validator(mode="after")
    def _end_not_before_start(self) -> "TranscriptSegmentIn":
        if self.end < self.start:
            raise ValueError(f"seq {self.seq}의 end가 start보다 앞선다.")
        return self


class TranscriptCreateRequest(BaseModel):
    """AI의 Transcript.to_dict() 그대로. 한 회의의 전사를 나눠 보내도 된다."""

    source: Literal["meeting"] = Field(
        "meeting", description="회의 발화만 받는다. chat 전사는 이 API로 받지 않는다"
    )
    segments: list[TranscriptSegmentIn]
    speaker_names: (
        dict[Annotated[str, StringConstraints(max_length=64)], Annotated[str, StringConstraints(max_length=100)]]
        | None
    ) = Field(
        None,
        description="{ 화자 Discord uid : 디스코드 표시 이름 }. 팀원이 아닌 화자를 이름으로 보여 줄 때 쓴다. "
        "같은 seq는 다시 보내도 건너뛰므로 처음 보낼 때 같이 보낸다",
    )

    @model_validator(mode="after")
    def _seq_unique(self) -> "TranscriptCreateRequest":
        # 한 요청 안의 중복은 재전송이 아니라 seq를 매기지 않은 전사(전부 0)라서 받지 않는다.
        counts = Counter(s.seq for s in self.segments)
        duplicated = sorted(seq for seq, n in counts.items() if n > 1)
        if duplicated:
            raise ValueError(f"한 요청 안에 seq가 겹친다: {duplicated}")
        return self


class TranscriptCreateResponse(BaseModel):
    meeting_id: str
    inserted: int = Field(..., description="새로 저장한 발화 수")
    skipped: int = Field(..., description="같은 seq가 이미 있어 건너뛴 발화 수")
    duration_ms: int | None = Field(
        ..., description="저장된 발화 전체의 end_ms 최댓값. 발화가 없으면 null"
    )
