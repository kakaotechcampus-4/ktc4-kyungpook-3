"""Terra 2단계 — JudgeInput(발화 + 기존 Notion 후보)을 받아 최종 판단을 내린다.

1단계(semantic_judge)가 "2단계까지 가볼 가치가 있다"고 골라낸 발화를, 여기서는 candidates 와
비교해서 실제로 Notion 을 바꿔야 하는지 최종 결정한다:
  - is_meaningful=False: candidates 와 비교해보니 이미 반영된 내용이거나, 더 넓은 문맥으로 보니
    애초에 결정이 아니었다 → Luna 를 부르지 않고 버린다
  - is_meaningful=True, is_new=True: candidates 에 없거나 안 맞음 → 새 Notion 항목 생성
  - is_meaningful=True, is_new=False: candidates[i] 를 수정 → matched_task_id 채워짐

Terra 없이는 후보 비교라는 이 단계의 핵심을 대신할 방법이 없으므로, 규칙 기반 폴백을 두지
않는다 — 키가 없거나 호출/파싱이 실패하면 JudgeUnavailableError 를 던진다.
"""

from __future__ import annotations

from llm import LLMClient, get_llm
from shared.schemas import JUDGE_CATEGORIES, TASK_STATUSES, JudgeInput, JudgeResult


class JudgeUnavailableError(RuntimeError):
    """Terra API 키가 없거나 호출/응답 파싱에 실패해 2단계 판단을 할 수 없을 때."""


def _numbered_candidates(judge_input: JudgeInput) -> str:
    if not judge_input.candidates:
        return "(없음)"
    lines = []
    for i, c in enumerate(judge_input.candidates):
        lines.append(
            f"[{i}] title={c.title!r}, 담당자={c.assignee_member_id}, "
            f"마감일={c.due_date}, 상태={c.status}, 유사도={c.similarity:.2f}"
        )
    return "\n".join(lines)


def _terra_user_prompt(judge_input: JudgeInput) -> str:
    return (
        "다음 발화가 기존 Notion 항목 중 하나를 바꿔야 하는지, 새 항목을 만들어야 하는지, "
        "아니면 이미 반영된 내용이라 아무것도 안 바꿔도 되는지 판단하라.\n\n"
        f"발화: {judge_input.text!r}\n\n"
        f"기존 후보:\n{_numbered_candidates(judge_input)}\n\n"
        "판단 기준:\n"
        "- 후보 중 하나와 내용이 같은 일을 가리키고, 발화가 그 후보의 현재 값과 실제로 다른 "
        "내용을 말하면 그 후보를 수정한다(is_new=false, matched_candidate_index=그 번호)\n"
        "- 후보 중 하나와 같은 일을 가리키지만 발화 내용이 후보의 현재 값과 이미 같다면 "
        "바꿀 게 없다(is_meaningful=false)\n"
        "- 어느 후보와도 안 맞으면(또는 후보가 없으면) 새 항목이다(is_new=true, "
        "matched_candidate_index=null)\n"
        "- status 는 발화에서 진행 상태(할 일/진행 중/막힘/완료)가 명시적으로 언급됐을 때만 "
        "채우고, 언급 없으면 null\n"
        "- category 는 무엇이 바뀌는지로 고른다: 일정(마감일)이면 schedule, 담당자면 assignee, "
        "하기로 했던 하위 작업/기능을 추가·제외·취소·확대·축소하면(예: '이번엔 안 넣기로 "
        "했다') scope, 그 외 일정/담당자/범위가 아닌 합의·결정이면 decision\n\n"
        "JSON으로만 답하라:\n"
        '{"is_meaningful": bool, "category": "schedule|assignee|scope|decision|none", '
        '"is_new": bool, "matched_candidate_index": int|null, '
        '"status": "todo|in_progress|blocked|done"|null, "evidence": "왜 이렇게 판단했는지"}'
    )


def _parse_terra_response(result: dict, judge_input: JudgeInput) -> JudgeResult | None:
    is_meaningful = result.get("is_meaningful")
    category = result.get("category")
    is_new = result.get("is_new")
    if not isinstance(is_meaningful, bool) or not isinstance(is_new, bool):
        return None
    if category not in JUDGE_CATEGORIES:
        return None

    status = result.get("status")
    if status is not None and status not in TASK_STATUSES:
        return None

    matched_task_id: str | None = None
    if is_meaningful and not is_new:
        idx = result.get("matched_candidate_index")
        if not isinstance(idx, int) or not (0 <= idx < len(judge_input.candidates)):
            return None  # 기존 항목 수정이라면서 어떤 건지 특정 못 하면 신뢰 못 함
        matched_task_id = judge_input.candidates[idx].task_id

    return JudgeResult(
        is_meaningful=is_meaningful,
        category=category,
        is_new=is_new,
        matched_task_id=matched_task_id,
        status=status,
        evidence=str(result.get("evidence", "")).strip()[:300],
    )


def judge_llm(judge_input: JudgeInput, client: LLMClient) -> JudgeResult | None:
    """Terra 로 최종 판단. 호출/파싱 실패면 None."""
    result = client.generate_json(_terra_user_prompt(judge_input), reasoning_effort="medium")
    if result is None:
        return None
    return _parse_terra_response(result, judge_input)


def judge(judge_input: JudgeInput) -> JudgeResult:
    """Terra 로 최종 판단한다. 키가 없거나 호출/파싱이 실패하면 JudgeUnavailableError."""
    client = get_llm("terra")
    if client.name == "off":
        raise JudgeUnavailableError("Terra API 키가 없어 2단계 판단을 할 수 없습니다.")
    result = judge_llm(judge_input, client)
    if result is None:
        raise JudgeUnavailableError("Terra 응답을 파싱하지 못했습니다.")
    return result
