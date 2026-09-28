"""판단 파이프라인 — 1단계 → 유사 task 검색 → Terra 2단계 → Luna Phase 2 → /extractions item.

각 단계의 결과는 값마다 출처가 한 곳이다. to_item() 은 셋을 합치기만 하고 새로 판단하지 않는다:
  - 담당자, 근거 원문·화자        → JudgeFinding (1단계가 전사록 전체를 보고 판정)
  - 새 항목/수정, 대상, 상태, 분류 → JudgeResult  (Terra 가 후보와 비교해 판정)
  - 제목, 마감일, 설명 문장        → DraftResult  (Luna 가 생성)
"""

from __future__ import annotations

from typing import Any

from shared.schemas import DraftResult, JudgeFinding, JudgeResult, NotionCandidate, Transcript

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
