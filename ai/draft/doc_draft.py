"""Luna Phase 2 — Terra 2단계가 의미 있다고 판정한 발화를 PM 승인 요청에 담을 값으로 옮겨 적는다.

여기서 만드는 건 **Luna 가 새로 만들어야 하는 값뿐**이다:
  - task: 새 할일의 제목 (create 에서만)
  - due_date: "다음 주 화요일" 같은 표현을 계산한 날짜
  - doc_text: PM 이 승인 화면에서 읽을 한 문장

담당자(JudgeFinding.assignee_*)와 진행 상태(JudgeResult.status)는 앞 단계가 이미 판정했으므로
다시 판단하지 않는다 — 프롬프트에 "이미 확정된 판단"으로 넣어 문장을 쓰는 데만 쓴다.

LLM 응답을 그대로 믿지 않고 코드가 한 번 더 거른다(_parse_draft_response). 특히 update 에서
제목이나 관계없는 마감일이 채워지면 승인 시 기존 값을 덮어쓰므로 여기서 지운다.
"""

from __future__ import annotations

from datetime import date

from extract.dates import sanity_check_due_date
from llm import LLMClient, get_llm
from shared.schemas import DraftResult, DraftStructured, JudgeFinding, JudgeResult, NotionCandidate



class DraftUnavailableError(RuntimeError):
    """Luna API 키가 없거나 호출/응답 파싱에 실패해 승인 요청 값을 만들 수 없을 때."""


_CATEGORY_KO = {
    "schedule": "일정(마감일)",
    "assignee": "담당자",
    "status": "진행 상태",
    "scope": "작업 범위",
    "decision": "결정 사항",
    "none": "없음",
}
_STATUS_KO = {"todo": "할 일", "in_progress": "진행 중", "blocked": "막힘", "done": "완료"}

DOC_TEXT_MAX = 300  # JudgeResult.evidence 와 같은 기준

# few-shot 예시는 골든셋(judge/golden_set*, eval_embedding_search)과 겹치지 않는 주제로 새로 지었다 —
# 채점용 문장을 프롬프트에 넣으면 점수가 부풀려진다(extract/prompts.py 와 같은 원칙).
# 기준일을 실제 회의 날짜와 다르게 둬서 예시의 날짜 계산이 실제 계산에 섞이지 않게 한다.
_FEW_SHOT = """예시 (기준일은 예시마다 다르다 — 실제 계산은 위의 오늘 날짜로 해라):

[예시 1] 새 할일 생성 / 기준일 2026-03-02 (월)
요약: API 에러 코드 목록을 수빈님이 이번 주 금요일까지 정리하기로 함
근거: "API 에러 코드 목록 정리가 필요할 것 같아요." / "그건 제가 이번 주 금요일까지 할게요."
→ {"task": "API 에러 코드 목록 정리", "due_date": "2026-03-06", "doc_text": "API 에러 코드 목록 정리를 수빈님이 3/6(금)까지 하기로 함"}

[예시 2] 기존 할일 수정 · 일정(마감일) / 기준일 2026-03-02 (월)
요약: 배포 가이드 문서 마감을 다음 주 수요일로 미루기로 함
현재 값: 제목 "배포 가이드 문서 작성" / 마감일 2026-03-06 / 상태 진행 중
→ {"task": null, "due_date": "2026-03-11", "doc_text": "배포 가이드 문서 작성 마감을 3/6에서 3/11로 연기"}

[예시 3] 기존 할일 수정 · 상태(완료) / 기준일 2026-03-02 (월)
요약: 관리자 대시보드 통계 차트 작업을 끝냈다고 보고함
현재 값: 제목 "관리자 대시보드 통계 차트" / 마감일 2026-03-04 / 상태 진행 중
→ {"task": null, "due_date": null, "doc_text": "관리자 대시보드 통계 차트 작업 완료 (진행 중 → 완료)"}

[예시 4] 기존 할일 수정 · 담당자 / 기준일 2026-03-02 (월)
요약: 다크모드 토글 구현은 태윤님이 맡기로 함
담당자 언급: 태윤님
현재 값: 제목 "다크모드 토글 구현" / 마감일 없음 / 상태 할 일
→ {"task": null, "due_date": null, "doc_text": "다크모드 토글 구현 담당을 태윤님으로 지정"}

[예시 5] 기존 할일 수정 · 작업 범위 / 기준일 2026-03-02 (월)
요약: 사용자 설정 페이지에서 이메일 알림 옵션은 이번 버전에서 빼기로 함
현재 값: 제목 "사용자 설정 페이지 개발" / 마감일 2026-03-10 / 상태 진행 중
→ {"task": null, "due_date": null, "doc_text": "사용자 설정 페이지 개발에서 이메일 알림 옵션을 이번 버전 범위에서 제외"}"""


def _assignee_line(finding: JudgeFinding) -> str:
    names = [n for n in (finding.assignee_raw, finding.assignee_resolved) if n]
    if not names:
        return "없음"
    if finding.assignee_resolved and finding.assignee_raw:
        return f"{finding.assignee_raw} (= {finding.assignee_resolved})"
    return names[0]


def _current_values(candidate: NotionCandidate) -> str:
    status = _STATUS_KO.get(candidate.status or "", candidate.status or "없음")
    return (
        f"- 제목: {candidate.title} / 마감일: {candidate.due_date or '없음'} / 상태: {status}"
    )


def _draft_prompt(
    finding: JudgeFinding,
    result: JudgeResult,
    candidate: NotionCandidate | None,
    today: date,
) -> str:
    weekday = "월화수목금토일"[today.weekday()]
    kind = "새 할일 생성" if result.is_new else "기존 할일 수정"
    status = _STATUS_KO.get(result.status or "", "언급 없음")
    evidence = "\n".join(f'- "{line}"' for line in finding.evidence) or f'- "{finding.text}"'
    # 새 항목에는 "바뀌는 것"이 없다 — Terra 가 새 항목에도 category(scope 등)를 주는데, 그대로 넣으면
    # Luna 가 doc_text 에 "작업 범위에 추가하고"처럼 쓴다
    changed = "" if result.is_new else f"- 바뀌는 것: {_CATEGORY_KO.get(result.category, result.category)}\n"
    current = ""
    if not result.is_new and candidate is not None:
        current = f"[수정 대상의 현재 값]\n{_current_values(candidate)}\n\n"

    return (
        "너는 팀 회의에서 나온 결정을 PM 승인 요청으로 옮겨 적는 작성자다.\n"
        f"오늘(회의 날짜)은 {today.isoformat()} ({weekday}요일)이다.\n\n"
        "[이미 확정된 판단 — 다시 판단하지 마라]\n"
        f"- 종류: {kind}\n"
        f"{changed}"
        f"- 진행 상태: {status}\n\n"
        f"[발화 요약] {finding.text}\n"
        f"[근거 원문]\n{evidence}\n"
        f"[담당자 언급] {_assignee_line(finding)}\n\n"
        f"{current}"
        "작성할 것:\n"
        "1. task — 새 할일 생성일 때만 쓴다. 기존 할일 수정이면 null.\n"
        '   명사형으로 짧게 (예: "알림 설정 페이지 개발"). 담당자·마감일·"~하기로 함"은 넣지 않는다.\n'
        "2. due_date — 근거 원문에 마감이 나오면 YYYY-MM-DD 로 계산한다. 없으면 null. 지어내지 마라.\n"
        '   - "월요일까지"처럼 요일만 있으면 오늘 기준 가장 가까운 다음 해당 요일\n'
        '   - "다음 주 수요일"처럼 "다음 주"가 붙으면 다음 주(월~일)의 그 요일\n'
        "   - 요일이 특정되지 않은 기간은 그 기간의 마지막 날:\n"
        '     "이번 주 안으로" → 이번 주 일요일, "다음 주까지" → 다음 주 일요일, "월말까지" → 그 달 마지막 날\n'
        "3. doc_text — PM 이 승인 화면에서 읽을 한 문장. 무엇이 어떻게 바뀌는지 쓴다.\n"
        '   기존 할일 수정이면 "현재 값 → 새 값"이 드러나게 쓴다. 단 작업 범위 변경은 바뀌는 값이 없으므로\n'
        "   화살표 없이 무엇이 범위에서 빠지거나 더해지는지만 쓴다. 근거 원문에 없는 내용은 쓰지 마라.\n\n"
        f"{_FEW_SHOT}\n\n"
        "JSON으로만 답하라:\n"
        '{"task": str|null, "due_date": "YYYY-MM-DD"|null, "doc_text": str}'
    )


def _parse_draft_response(raw: dict, result: JudgeResult, today: date) -> DraftResult | None:
    """Luna 응답을 검증해 DraftResult 로. 신뢰할 수 없는 응답이면 None.

    값을 버리는 것과 실패로 보는 것을 구분한다 — update 의 제목처럼 **있으면 안 되는 값**은
    조용히 지우고, create 의 제목·doc_text 처럼 **없으면 승인 요청을 못 만드는 값**이 비면 실패다.
    """
    doc_text = str(raw.get("doc_text") or "").strip()
    if not doc_text:
        return None

    task = str(raw.get("task") or "").strip() or None
    if not result.is_new:
        task = None  # 수정에서 제목을 채우면 승인 시 기존 제목을 덮어쓴다
    elif task is None:
        return None  # 제목 없는 새 Task 는 만들 수 없다

    due_raw = raw.get("due_date")
    due = sanity_check_due_date(due_raw if isinstance(due_raw, str) else None, today)
    if not result.is_new and result.category != "schedule":
        due = None  # 일정 변경이 아닌 수정에서 마감일을 채우면 관계없는 필드가 바뀐다

    return DraftResult(
        structured=DraftStructured(task=task, due_date=due.isoformat() if due else None),
        doc_text=doc_text[:DOC_TEXT_MAX],
    )


def draft_llm(
    finding: JudgeFinding,
    result: JudgeResult,
    candidate: NotionCandidate | None,
    today: date,
    client: LLMClient,
) -> DraftResult | None:
    """Luna 로 DraftResult 를 만든다. 호출/파싱 실패면 None."""
    raw = client.generate_json(_draft_prompt(finding, result, candidate, today), reasoning_effort="medium")
    if raw is None:
        return None
    return _parse_draft_response(raw, result, today)


def draft(
    finding: JudgeFinding,
    result: JudgeResult,
    *,
    candidate: NotionCandidate | None = None,
    today: date,
) -> DraftResult:
    """승인 요청에 담을 제목·마감일·설명을 만든다.

    candidate 는 update 일 때 수정 대상 후보(JudgeResult.matched_task_id 에 해당하는 것)다 —
    doc_text 에 "현재 값 → 새 값"을 쓰려면 현재 값이 필요하다. today 는 회의 날짜로,
    "다음 주 화요일" 같은 표현을 날짜로 바꾸는 기준이다.

    키가 없거나 호출/파싱이 실패하면 DraftUnavailableError (1·2단계와 같이 규칙 폴백 없음).
    """
    if not result.is_meaningful:
        # is_meaningful=False 는 2단계에서 버리기로 한 발화다 — 여기까지 오면 호출자 버그
        raise ValueError("is_meaningful=False 인 JudgeResult 로는 DraftResult 를 만들지 않는다.")
    client = get_llm("luna")
    if client.name == "off":
        raise DraftUnavailableError("Luna API 키가 없어 승인 요청 값을 만들 수 없습니다.")
    drafted = draft_llm(finding, result, candidate, today, client)
    if drafted is None:
        raise DraftUnavailableError("Luna 응답을 파싱하지 못했습니다.")
    return drafted
