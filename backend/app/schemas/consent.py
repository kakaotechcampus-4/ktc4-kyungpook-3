from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ConsentAgreeRequest(BaseModel):
    """두 문서의 지금 버전에 함께 동의한다. 화면이 본 버전을 그대로 보낸다."""

    model_config = ConfigDict(extra="forbid")

    terms_version: str = Field(min_length=1, max_length=32)
    privacy_version: str = Field(min_length=1, max_length=32)


class ConsentDocument(BaseModel):
    kind: Literal["terms", "privacy"]
    current_version: str
    agreed_version: str | None = Field(None, description="가장 최근에 동의한 버전. 동의한 적이 없으면 null")
    agreed_at: datetime | None = Field(None, description="agreed_version 에 동의한 시각")


class ConsentStatusResponse(BaseModel):
    required: bool = Field(..., description="한 문서라도 지금 버전에 동의하지 않았으면 true")
    documents: list[ConsentDocument]
