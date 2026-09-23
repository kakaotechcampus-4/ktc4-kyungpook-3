"""AI 파이프라인 단계 간 입출력 타입.

외부 의존성 없이 dataclass 만 사용합니다. 모든 타입은 to_dict()/from_dict() 로 JSON 과 왕복 가능.
날짜/시각은 문자열(ISO 8601)로 보관합니다 — BE/Notion 과 주고받을 때 변환 비용을 없애기 위함.

NOTE: DB 테이블 모델(Member, Task, TaskHistory, ApprovalRequest 등)은
BE(backend/app/models/models.py)가 Single Source of Truth입니다.
이 파일에는 AI 파이프라인 단계 간 입출력 타입만 정의합니다.
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


# ─────────────────────────────────────────────────────────── 단계 간 입출력
@dataclass
class TranscriptSegment(_Base):
    """Phase 0 출력 단위.

    speaker: 플랫폼 사용자 ID(문자열) 또는 None
    start/end: **회의 시작 기준 초**. 화자 트랙 파일 안의 위치가 아니다
    seq: 회의 전체에서의 발화 순번. 근거 점프가 참조하는 안정된 식별자
    """

    speaker: str | None
    start: float
    end: float
    text: str
    seq: int = 0


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
    method: str = "llm"

    # ── 담당자 호칭 분류 (BE alias 설계와 1:1). 기준은 extract/TASK_CRITERIA.md
    # BE 는 assignee_type 을 보고 처리 경로를 고른다: first/mention 은 발화자·멤버 테이블로 직행,
    # thirdname 은 alias 테이블 조회, second/thirdpronoun 은 AI 가 해소한 결과를 쓰고,
    # thirdrole/group/none 은 PM 확인으로 보낸다.
    assignee_type: str = "none"  # first|second|thirdname|thirdpronoun|thirdrole|group|none
    assignee_resolved: str | None = None  # second/thirdpronoun 을 문맥으로 푼 이름 (못 풀면 None)
    due_raw: str | None = None  # 마감을 가리킨 원문 표현 ("이번 주 목요일까지")

    # ── 필드별 근거 상태. 사용자에겐 정확도 % 대신 이걸 보여준다 (숫자는 로그로만)
    # certain=원문에 명시 / inferred=문맥 추론이거나 반복 호출 시 흔들림 / missing=발화에 없음
    task_status: str = "certain"
    assignee_status: str = "missing"
    due_status: str = "missing"


JudgeCategory = Literal["schedule", "assignee", "scope", "decision", "none"]
JUDGE_CATEGORIES: tuple[str, ...] = ("schedule", "assignee", "scope", "decision", "none")


@dataclass
class JudgeFinding(_Base):
    """Terra 1단계 출력. '이 발화는 2단계 판단까지 가볼 가치가 있다'고 골라낸 후보 하나.

    아직 Notion 후보와 비교하지 않은 상태라 JudgeResult보다 거친 1차 필터다.

    text 는 원문 그대로가 아니라 문맥까지 반영해서 자기완결적으로 다시 쓴 것일 수 있다
    (예: "네, 알겠습니다." 원문 → "로그인 화면 마감을 다음 주 화요일로 연기하는 데 동의함").
    LLM 경로는 전사록 전체를 한 번에 보고 판단하기 때문에 이런 재구성이 가능하고, 규칙
    기반 경로는 그런 능력이 없어서 원문을 그대로 쓴다(이 경우 text == evidence).

    근거는 문장 하나가 아니라 **여러 줄에 걸칠 수 있다.** 결정은 보통 "제안 → 합의"처럼
    나뉘어 만들어지기 때문이다("API 명세서 작성 담당이 필요합니다." + "이건 지민님이
    맡아주세요."). 그래서 evidence 에는 해당 원문들이 순서대로 이어 붙는다. seq/speaker 는
    그중 **마지막 줄**을 가리킨다 — 결론을 말한 발화이자, 1인칭 담당자 해소가 봐야 하는 화자다.
    """

    text: str  # 자기완결적 요약(LLM) 또는 원문 그대로(규칙). 나중에 JudgeInput.text로 이어짐
    evidence: str = ""  # 근거 발화 원문(여러 줄이면 순서대로 이어 붙임) — 추적/감사용. 비어있으면 text와 동일하다고 간주
    source: str = "meeting"  # "meeting" | "chat"
    seq: int = 0  # 근거 마지막 줄의 TranscriptSegment.seq — 근거 추적용 안정 식별자
    speaker: str | None = None  # 근거 마지막 줄의 화자(opaque id) — 문맥 참고/디버깅용
    reason: str = ""  # 왜 후보로 골랐는지 (규칙 기반이면 어떤 규칙에 걸렸는지)
    method: str = "rules"  # rules | llm


@dataclass
class NotionCandidate(_Base):
    """BE가 벡터 검색으로 찾아준, 의미상 가장 가까운 기존 Notion 항목 하나."""

    notion_page_id: str  # 이 후보가 가리키는 실제 Notion 페이지 ID (나중에 반영할 때 필수)
    task_id: str | None = None  # 우리 DB task 테이블과 연결돼 있으면 그 ID (없으면 아직 task화 안 된 Notion 내용)
    title: str = ""  # 페이지 항목 제목
    content_snippet: str = ""  # 본문 일부 — 유사도 비교와 문맥 파악용 (전체 본문 아님, 필요한 만큼만)
    assignee_member_id: str | None = None  # 현재 기록된 담당자
    due_date: str | None = None  # 현재 기록된 마감일
    status: str | None = None  # 현재 진행 상태(todo/in_progress/done/blocked 등) — 비교 기준값
    similarity: float = 0.0  # 새 텍스트와의 벡터 유사도 (0.0~1.0). BE가 계산해서 넘겨줌
    updated_at: str | None = None  # 이 항목이 마지막으로 수정된 시각 — 오래된 정보인지 참고용


@dataclass
class JudgeInput(_Base):
    """Terra(semantic_judge)의 입력. candidates 가 빈 리스트면 기존 문서화된 단순 판단(문장만 보고 판단)과 동일하게 동작."""

    source: str  # "meeting" | "chat" — 어디서 나온 텍스트인지
    text: str  # 실제로 판단할 문장/발화 원문
    candidates: list[NotionCandidate] = field(default_factory=list)  # BE가 검색해 온 기존 Notion 후보들 (없으면 빈 리스트)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "text": self.text,
            "candidates": [c.to_dict() for c in self.candidates],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "JudgeInput":
        return cls(
            source=data["source"],
            text=data["text"],
            candidates=[NotionCandidate.from_dict(c) for c in data.get("candidates", [])],
        )


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
