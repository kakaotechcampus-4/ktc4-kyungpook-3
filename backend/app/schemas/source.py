from collections import Counter
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class TranscriptSegmentIn(BaseModel):
    """AI의 TranscriptSegment(ai/shared/schemas.py) 한 줄. 시각은 회의 시작 기준 초다."""

    speaker: str | None = Field(
        None, max_length=64, description="발화한 사람의 Discord uid. 모르면 null"
    )
    start: float = Field(..., ge=0, description="발화 시작(초)")
    end: float = Field(..., ge=0, description="발화 끝(초)")
    text: str
    seq: int = Field(..., ge=0, description="회의 전체에서의 발화 순번. 사이가 비어도 된다")

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
