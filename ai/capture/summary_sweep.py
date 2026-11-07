"""회의 요약 한 건. BE 대기열에서 맡고, 재료를 읽고, 요약해서 저장한다. 워커는 바퀴 끝에 부른다.

실패를 BE 에 알리지 않는다. 보내지 않으면 BE 의 임대가 지나 다음 claim 이 다시 맡으므로 LLM 실패, PUT 실패, 워커 종료가
모두 한 길을 간다. 회의당 두 번까지이고 회의 처리 상태와는 무관하다.

MM_SUMMARY_LLM 이 luna, terra 일 때만 켜진다. 비어 있으면 claim 을 부르지 않고 비용도 없다.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace

from capture.handoff import BeClient
from llm import LLMClient, LLMReply, NullLLM, get_llm
from shared.config import settings
from shared.schemas import SummaryClaim, SummaryDraft
from summary.summarize import summarize

SUMMARY_MODELS = ("luna", "terra")


@dataclass(frozen=True)
class SummaryOutcome:
    extraction_id: str | None           # None 이면 맡는 호출이 실패했다
    meeting_id: str | None
    attempt: int
    saved: bool                         # False 이고 error 도 없으면 먼저 끝난 쪽이 있다(applied=false)
    reply: LLMReply | None = None       # None 이면 LLM 을 부르지 않았다
    draft: SummaryDraft | None = None
    error: str | None = None


@dataclass
class SummaryRunner:
    client: BeClient
    llm: LLMClient

    def run_once(self, only: list[str] | None = None) -> SummaryOutcome | None:
        """대기열에서 한 건. 대기가 없으면 None. 예외를 내지 않는다. only 를 주면 그 extraction 안에서만 맡는다."""
        try:
            claim = self.client.claim_summary(only)
        except Exception as e:  # noqa: BLE001 - 요약 실패가 워커를 멈추면 안 된다
            return _logged(SummaryOutcome(None, None, 0, False, error=_why(e)))
        return None if claim is None else _logged(self._summarize(claim))

    def _summarize(self, claim: SummaryClaim) -> SummaryOutcome:
        outcome = SummaryOutcome(claim.extraction_id, claim.meeting_id, claim.attempt, False)
        try:
            summary_input = self.client.summary_input(claim.extraction_id)
            attempt = summarize(summary_input, self.llm, attempt=claim.attempt)
            outcome = replace(outcome, reply=attempt.reply, draft=attempt.draft, error=attempt.failure)
            if attempt.draft is None:
                return outcome
            result = self.client.submit_summary(claim.extraction_id, attempt.draft.to_dict())
            return replace(outcome, saved=bool(result["applied"]))
        except Exception as e:  # noqa: BLE001 - 요약 실패가 워커를 멈추면 안 된다
            return replace(outcome, error=_why(e))


def _why(e: Exception) -> str:
    return f"{type(e).__name__}: {e}"


def _logged(outcome: SummaryOutcome) -> SummaryOutcome:
    if outcome.saved:
        result = "저장"
    elif outcome.error:
        result = f"실패 {outcome.error}"
    else:
        result = "먼저 끝난 쪽이 있어 쓰지 않음"
    r = outcome.reply or LLMReply(None)
    print(f"[summary] 회의 {outcome.meeting_id} 시도 {outcome.attempt} {result} 입력 {r.prompt_tokens} "
          f"출력 {r.completion_tokens} 추론 {r.reasoning_tokens} {r.elapsed_s:.1f}초", flush=True)
    return outcome


def summary_from_env() -> SummaryRunner | None:
    """MM_SUMMARY_LLM 으로 만든다. 비어 있으면 None, 모르는 값이면 ValueError 다. 워커가 시작할 때 불러서 오타로 멈춘다."""
    which = os.environ.get("MM_SUMMARY_LLM", "").strip()
    if not which:
        return None
    if which not in SUMMARY_MODELS:
        raise ValueError(f"MM_SUMMARY_LLM 은 luna 또는 terra 다. 받은 값: {which!r}")
    cfg = settings()
    missing = [n for n, v in (("BE_BASE_URL", cfg.be_base_url), ("BE_SERVICE_TOKEN", cfg.be_service_token)) if not v]
    llm = get_llm(which)
    if isinstance(llm, NullLLM):        # 켜 두면 답 없는 호출이 대기열의 시도를 전부 태운다
        missing.append(f"{which} LLM 키")
    if missing:
        print(f"[summary] MM_SUMMARY_LLM={which} 이지만 설정이 비어 요약을 끈다: {', '.join(missing)}", flush=True)
        return None
    return SummaryRunner(BeClient(cfg.be_base_url, service_token=cfg.be_service_token), llm)
