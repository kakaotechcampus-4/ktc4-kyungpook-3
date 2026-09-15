"""규칙 기반(extract/rules.py) vs LLM 기반(extract/llm.py) 추출 결과를 golden set 으로 나란히 비교.

실행 (ai/ 디렉토리 안에서):
  python -m extract.compare_eval
  python -m extract.compare_eval --n-samples 3   # self-consistency 신뢰도까지 보고 싶을 때

규칙 기반은 항상 돈다. LLM 쪽은 openai 설치 + GEMINI_API_KEY 가 있어야 돌고,
없으면 이유를 출력하고 규칙 기반 결과만 보여준다. GEMINI_BASE_URL 이 채워져 있으면
(Elice MLAPI 같은 OpenAI 호환 프록시) 그 엔드포인트로, 비어 있으면 OpenAI 공식 엔드포인트로 붙는다.

지금은 눈으로 보는 나란히 비교(diff)만 한다 — stt/eval/eval.py 처럼 골든셋 9개 신호에 대해 자동으로
PASS/FAIL 채점하는 리포트는 다음 단계(정답 파일이 좀 더 갖춰지면 추가).
"""

from __future__ import annotations

import argparse
import sys

from extract import rules
from extract.fixtures import SPEAKER_NAMES, TODAY, build_transcript
from shared.schemas import ExtractedTask


def _print_tasks(label: str, tasks: list[ExtractedTask]) -> None:
    print(f"\n[{label}] {len(tasks)}건")
    for t in tasks:
        due = t.due_date or "-"
        assignee = t.assignee_mention or "?"
        print(f"  - 담당:{assignee:<4} 마감:{due:<10} conf={t.confidence:.2f} | {t.task}")
        print(f"      근거: {t.source_sentence}")


def main() -> int:
    ap = argparse.ArgumentParser(description="규칙 기반 vs LLM 기반 추출 비교 (golden set)")
    ap.add_argument("--n-samples", type=int, default=1, help="LLM self-consistency 반복 횟수 (기본 1)")
    args = ap.parse_args()

    transcript = build_transcript()

    rule_tasks = rules.extract_tasks(transcript, today=TODAY, speaker_names=SPEAKER_NAMES)
    _print_tasks("규칙 기반", rule_tasks)

    try:
        from openai import OpenAI
    except ImportError:
        print("\nopenai 가 설치돼 있지 않아 LLM 비교는 건너뜁니다 (pip install openai).")
        return 0

    from shared.config import settings

    cfg = settings()
    if not cfg.llm_api_key:
        print("\nLLM_API_KEY(또는 GEMINI_API_KEY) 가 없어 LLM 비교는 건너뜁니다 (.env 에 채워 주세요).")
        return 0

    from extract import llm as llm_extract

    client = OpenAI(base_url=cfg.llm_base_url or None, api_key=cfg.llm_api_key)
    llm_tasks = llm_extract.extract_tasks(
        transcript,
        client=client,
        model=cfg.llm_model,
        today=TODAY,
        speaker_names=SPEAKER_NAMES,
        n_samples=args.n_samples,
    )
    _print_tasks(f"LLM 기반 (n_samples={args.n_samples})", llm_tasks)
    return 0


if __name__ == "__main__":
    sys.exit(main())
