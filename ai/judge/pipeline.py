"""판단 파이프라인 — 1단계 → 유사 task 검색 → Terra 2단계 → Luna Phase 2 → /extractions item.

실패는 두 종류로 나눈다(run):
  - 회의 전체가 못 도는 실패 — LLM 키 없음, 1단계 실패. 어떤 finding 을 돌려도 같으므로 바로 에러
  - finding 하나의 실패 — 유사 검색/Terra/Luna 가 그 한 번 실패. 그 finding 만 failures 에 남기고
    나머지는 계속 — 결정 하나 때문에 회의의 다른 결정까지 버리지 않는다

각 단계의 결과는 값마다 출처가 한 곳이다. to_item() 은 셋을 합치기만 하고 새로 판단하지 않는다:
  - 담당자, 근거 원문·화자        → JudgeFinding (1단계가 전사록 전체를 보고 판정)
  - 새 항목/수정, 대상, 상태, 분류 → JudgeResult  (Terra 가 후보와 비교해 판정)
  - 제목, 마감일, 설명 문장        → DraftResult  (Luna 가 생성)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Protocol

from draft.doc_draft import DraftUnavailableError, draft
from judge.final_judge import JudgeUnavailableError, judge
from judge.semantic_judge import extract_findings
from llm import get_llm
from shared.schemas import (
    DraftResult,
    JudgeFinding,
    JudgeInput,
    JudgeResult,
    NotionCandidate,
    Transcript,
)

# 별칭 텍스트가 아닌 호칭 — "네가", "그분", "백엔드 리더" 를 BE 가 별칭으로 조회하면 영원히 안 맞는다.
# 문맥으로 풀린 이름(assignee_resolved)이 없으면 보내지 않는다 (capture/handoff.py 와 같은 규칙).
_NOT_ALIAS_TYPES = {"second", "thirdpronoun", "thirdrole"}


def _assignee(finding: JudgeFinding) -> tuple[str | None, str | None]:
    """(assignee_type, assignee_raw) — BE 가 member_id 로 해소할 값."""
    mention = None if finding.assignee_type in _NOT_ALIAS_TYPES else finding.assignee_raw
    return finding.assignee_type, finding.assignee_resolved or mention


def _evidence_at_ms(finding: JudgeFinding, transcript: Transcript) -> int | None:
    """근거 마지막 줄(finding.seq)을 말한 시각. 회의 시작 기준 ms."""
    for seg in transcript.segments:
        if seg.seq == finding.seq:
            return int(round(seg.start * 1000))
    return None


def to_item(
    finding: JudgeFinding,
    result: JudgeResult,
    drafted: DraftResult,
    target: NotionCandidate | None,
    transcript: Transcript,
) -> dict[str, Any] | None:
    """세 단계의 결과를 POST /extractions 의 item 하나로 합친다.

    update 에서 후보의 현재 값과 달라지는 필드가 하나도 없으면 None(범위 변경은 예외) — 그대로 보내면 PM 에게
    "진행 중 → 진행 중" 같은 빈 승인 카드가 뜬다(#99). 담당자는 AI 쪽에 member_id 가 없어 현재
    값과 비교할 수 없으므로, 호칭이 있으면 바뀌는 것으로 본다(BE 가 해소 후 같으면 걸러야 한다).
    """
    if not result.is_meaningful:
        raise ValueError("is_meaningful=False 인 JudgeResult 는 item 으로 만들지 않는다.")
    if not result.is_new and target is None:
        raise ValueError("기존 항목 수정인데 수정 대상 후보가 없다.")

    assignee_type, assignee_raw = _assignee(finding)
    item: dict[str, Any] = {
        "action": "create" if result.is_new else "update",
        "target_task_id": None if result.is_new else target.task_id,
        "category": result.category,
        # update 의 제목은 어떤 Task 인지 보여주는 표시용 — BE 는 update payload 에 넣지 않는다
        "task_title": drafted.structured.task if result.is_new else target.title,
        "due_date": drafted.structured.due_date,
        # 상태만 바뀌면 category 가 decision 으로 나온다 — category 와 무관하게 반영한다(#99)
        "status": result.status,
        "assignee_type": assignee_type,
        "assignee_raw": assignee_raw,
        "doc_text": drafted.doc_text,
        "evidence_quote": finding.evidence[-1] if finding.evidence else finding.text,
        "evidence_speaker": finding.speaker,
        "evidence_at_ms": _evidence_at_ms(finding, transcript),
    }
    if result.is_new:
        return item

    # ── update: 현재 값과 달라지는 필드만 남긴다
    if item["due_date"] == target.due_date:
        item["due_date"] = None
    if item["status"] == target.status:
        item["status"] = None
    if result.category != "assignee":
        # 일정 변경 발화에 담당자 호칭이 섞여 있어도 담당자는 바꾸지 않는다
        item["assignee_type"] = item["assignee_raw"] = None
    changes = item["due_date"] or item["status"] or item["assignee_raw"] or item["assignee_type"] == "first"
    # 범위 변경("소셜 로그인은 이번엔 빼기로")은 담을 Task 필드가 없지만 실제 결정이다 — 버리면
    # 조용히 사라지므로 doc_text 만으로 승인 요청을 만든다. 반영 위치는 doc_text 저장 위치가
    # 정해지면 따른다.
    if not changes and result.category != "scope":
        return None
    return item


class CandidateSource(Protocol):
    """유사 task 검색 — 실제로는 BE 의 POST /workspaces/{id}/tasks/similar (#102)."""

    def similar_tasks(self, workspace_id: str, text: str) -> list[NotionCandidate]: ...


@dataclass
class PipelineFailure:
    """finding 하나가 건너뛰어진 이유."""

    stage: str  # similar | judge | target | draft — 어느 단계에서 실패했나
    finding_text: str
    reason: str


@dataclass
class PipelineResult:
    items: list[dict[str, Any]] = field(default_factory=list)  # POST /extractions 로 보낼 item
    failures: list[PipelineFailure] = field(default_factory=list)


class PipelineUnavailableError(RuntimeError):
    """회의 전체가 못 도는 실패 — LLM 키가 없을 때."""


def _check_llm_keys() -> None:
    # final_judge / doc_draft 는 "키 없음"과 "파싱 실패"를 같은 에러로 던진다. 루프 전에 키를 먼저
    # 보면, 루프 안의 에러는 전부 finding 하나의 실패로 볼 수 있다(모듈은 고치지 않는다).
    missing = [which for which in ("terra", "luna") if get_llm(which).name == "off"]
    if missing:
        raise PipelineUnavailableError(f"LLM 키가 없어 파이프라인을 돌릴 수 없습니다: {', '.join(missing)}")


def run(
    transcript: Transcript,
    *,
    workspace_id: str,
    today: date,
    candidates: CandidateSource,
) -> PipelineResult:
    """회의 전사록 하나를 /extractions item 목록으로.

    today 는 회의 날짜다 — "다음 주 화요일"을 날짜로 바꾸는 기준.
    키가 없으면 PipelineUnavailableError, 1단계가 실패하면 FindingExtractionUnavailableError.
    """
    _check_llm_keys()
    findings = extract_findings(transcript)  # 실패하면 그대로 올린다 — finding 자체가 없다

    out = PipelineResult()
    for finding in findings:
        try:
            cands = candidates.similar_tasks(workspace_id, finding.text)
        except Exception as e:  # 검색 구현(HTTP 등)의 어떤 실패든 이 finding 만의 실패로 본다
            out.failures.append(PipelineFailure("similar", finding.text, f"{type(e).__name__}: {e}"))
            continue

        # Terra 가 본 후보와 수정 대상을 꺼내는 후보가 같은 리스트여야 한다
        judge_input = JudgeInput(source=transcript.source, text=finding.text, candidates=cands)
        try:
            result = judge(judge_input)
        except JudgeUnavailableError as e:
            out.failures.append(PipelineFailure("judge", finding.text, str(e)))
            continue

        if not result.is_meaningful:
            continue  # 이미 반영됐거나 바꿀 게 없다 — 실패가 아니다

        target = None
        if not result.is_new:
            target = next(
                (c for c in judge_input.candidates
                 if result.matched_task_id is not None and c.task_id == result.matched_task_id),
                None,
            )  # matched_task_id 가 None 이면 None == None 으로 task_id 없는 후보가 잡히므로 먼저 거른다
            if target is None:
                # task_id 없는(Notion 에만 있는) 후보를 고른 경우 — 수정할 Task 가 없다
                out.failures.append(PipelineFailure("target", finding.text, "수정 대상 후보를 찾지 못했습니다."))
                continue

        try:
            drafted = draft(finding, result, candidate=target, today=today)
        except DraftUnavailableError as e:
            out.failures.append(PipelineFailure("draft", finding.text, str(e)))
            continue

        item = to_item(finding, result, drafted, target, transcript)
        if item is not None:  # None 은 바뀌는 게 없는 update — 실패가 아니다
            out.items.append(item)
    return out
