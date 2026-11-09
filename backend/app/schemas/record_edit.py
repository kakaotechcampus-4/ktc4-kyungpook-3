"""팀원이 회의 기록을 고치는 요청. 사람이 쓴 글이 들어오는 신뢰 경계다."""
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.schemas.project_map import _has_unstorable


class _Storable(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def _storable_text(cls, data: Any) -> Any:
        # DB 에 쓸 수 없는 글자(NUL, 짝 없는 서로게이트)는 PostgreSQL 500 대신 400 으로 막는다
        if _has_unstorable(data):
            raise ValueError("NUL 이나 짝 없는 서로게이트 글자는 저장할 수 없습니다.")
        return data


class TitleEditRequest(_Storable):
    """null 이나 원래 제목은 되돌리기다."""

    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)] | None


class TitleEditResponse(BaseModel):
    meeting_id: str
    title: str | None
    # 처음 고치기 전 제목. 고친 적 없으면 null 이다. 제목 없던 회의를 고쳐도 null 이라 고쳤는지는 edited 로 본다
    title_original: str | None
    edited: bool


class LineEditRequest(_Storable):
    """null 이나 원문과 같은 값은 되돌리기다."""

    text: Annotated[str, StringConstraints(min_length=1, max_length=10000)] | None


class LineEditResponse(BaseModel):
    seq: int
    text: str
    # 고쳤을 때만 원문, 아니면 null
    original_text: str | None
    edited: bool


class TopicEditRequest(_Storable):
    """보낸 칸만 바꾼다."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)] | None = None
    description: Annotated[str, StringConstraints(max_length=1000)] | None = None

    @model_validator(mode="after")
    def _something_changes(self) -> "TopicEditRequest":
        if self.name is None and self.description is None:
            raise ValueError("name 이나 description 이 있어야 합니다.")
        return self


class TopicMergeRequest(_Storable):
    into_topic_id: str = Field(min_length=1, max_length=36)


class TaskDetachResponse(BaseModel):
    topic_id: str
    task_id: str
    detached: Literal[True] = True


class DecisionEditRequest(_Storable):
    """보낸 칸만 바꾼다. state 를 valid 로 보내면 지우기나 유효하지 않음 표시를 되돌린다."""

    text: Annotated[str, StringConstraints(min_length=1, max_length=1000)] | None = None
    state: Literal["valid", "invalid", "removed"] | None = None

    @model_validator(mode="after")
    def _something_changes(self) -> "DecisionEditRequest":
        if self.text is None and self.state is None:
            raise ValueError("text 나 state 가 있어야 합니다.")
        return self
