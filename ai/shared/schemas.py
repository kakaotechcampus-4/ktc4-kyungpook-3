"""데이터 모델 (data_model.md MVP 4테이블과 1:1) + 파이프라인 단계 간 입출력 타입.

외부 의존성 없이 dataclass 만 사용합니다. 모든 타입은 to_dict()/from_dict() 로 JSON 과 왕복 가능.
날짜/시각은 문자열(ISO 8601)로 보관합니다 — BE/Notion 과 주고받을 때 변환 비용을 없애기 위함.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime, timezone
from typing import Any, ClassVar, Literal, TypeVar

T = TypeVar("T", bound="_Base")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class _Base:
    """dict 왕복 공통 헬퍼."""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)  # type: ignore[arg-type]

    @classmethod
    def from_dict(cls: type[T], data: dict[str, Any]) -> T:
        allowed = {f.name for f in fields(cls)}  # type: ignore[arg-type]
        return cls(**{k: v for k, v in data.items() if k in allowed})


# ─────────────────────────────────────────────────────────────── MVP 4 테이블
@dataclass
class Member(_Base):
    """member 테이블. discord_user_id 는 캡처 플랫폼의 사용자 ID.

    코어 로직(extract/judge/draft)은 이 필드를 직접 참조하지 말고 platform_user_id 를 쓰세요 —
    9주차 이후 웹사이트 이전 시 이 클래스만 고치면 되게 하기 위함.
    """

    member_id: str
    display_name: str
    discord_user_id: str | None = None
    role: str = "member"  # pm | member
    aliases: list[str] = field(default_factory=list)  # 닉네임/영문명 등 추가 호칭

    @property
    def platform_user_id(self) -> str | None:
        return self.discord_user_id


TaskStatus = Literal["todo", "in_progress", "done", "blocked"]


@dataclass
class Task(_Base):
    """task 테이블."""

    task_id: str
    title: str
    assignee_member_id: str | None = None
    status: str = "todo"
    due_date: str | None = None  # YYYY-MM-DD
    notion_page_id: str | None = None
    updated_at: str = field(default_factory=now_iso)


@dataclass
class TaskHistory(_Base):
    """task_history 테이블. 필드 단위 변경 기록 (롤백의 근거)."""

    history_id: str
    task_id: str
    changed_field: str
    old_value: str | None
    new_value: str | None
    change_source: str  # meeting | chat | reminder_reply | manual | rollback
    created_at: str = field(default_factory=now_iso)


ApprovalType = Literal["task_create", "task_update", "reminder_dm"]
ApprovalStatus = Literal["pending", "approved", "rejected"]


@dataclass
class ApprovalRequest(_Base):
    """approval_request 테이블. PM 이 승인/반려하기 전까지 모든 변경은 여기서 대기."""

    approval_id: str
    type: str
    payload: dict[str, Any]
    related_task_id: str | None = None
    status: str = "pending"
    resolved_by: str | None = None
    created_at: str = field(default_factory=now_iso)
    resolved_at: str | None = None


# ─────────────────────────────────────────────────────────── 단계 간 입출력
@dataclass
class TranscriptSegment(_Base):
    """Phase 0 출력 단위. speaker = 플랫폼 사용자 ID(문자열) 또는 None."""

    speaker: str | None
    start: float
    end: float
    text: str


@dataclass
class Transcript(_Base):
    segments: list[TranscriptSegment]
    source: str = "meeting"  # meeting | chat

    def to_dict(self) -> dict[str, Any]:
        return {"source": self.source, "segments": [s.to_dict() for s in self.segments]}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Transcript":
        return cls(
            segments=[TranscriptSegment.from_dict(s) for s in data.get("segments", [])],
            source=data.get("source", "meeting"),
        )

    def merged_text(self) -> str:
        return " ".join(s.text.strip() for s in sorted(self.segments, key=lambda s: s.start) if s.text.strip())


@dataclass
class ExtractedTask(_Base):
    """Phase 1 출력. 계획서 스키마 그대로."""

    task: str
    assignee_member_id: str | None
    due_date: str | None
    confidence: float
    # 아래는 디버깅/근거 추적용 부가 정보 (스키마 확장, 선택)
    assignee_mention: str | None = None
    source_sentence: str | None = None
    method: str = "rules"  # rules | llm


JudgeCategory = Literal["schedule", "assignee", "scope", "decision", "none"]
JUDGE_CATEGORIES: tuple[str, ...] = ("schedule", "assignee", "scope", "decision", "none")


@dataclass
class JudgeResult(_Base):
    """Phase 2 Terra 출력. 계획서 스키마 그대로."""

    is_meaningful: bool
    category: str
    confidence: float
    evidence: str
    method: str = "rules"

    VALID: ClassVar[tuple[str, ...]] = JUDGE_CATEGORIES


@dataclass
class DraftResult(_Base):
    """Phase 2 Luna 출력. structured = {task, assignee_member_id, due_date, type}."""

    structured: dict[str, Any]
    doc_text: str
    method: str = "rules"
