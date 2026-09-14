"""Phase 1 — LLM 기반 추출 (method="llm"). extract/rules.py 의 대안이자 기본 경로.

역할 분담 (실측 근거는 extract/dates.py 주석 참고):
  - 할일 여부·task 내용·담당자 타입 분류·모호한 호칭 해소·마감일 해석 → **LLM**
  - 마감일 검증(과거/먼 미래/형식 이상) → **코드**(dates.sanity_check_due_date)
  - 담당자 → member_id 매칭 → **BE**(backend/app/services/matching.py). 여기선 원문·타입까지만
  - 명시적 "OO님" 패턴 → 정규식(rules._ASSIGNEE_RE)으로 교차검증, 어긋나면 상태를 inferred 로 낮춤

판단 기준(무엇을 할일로 보는가)은 extract/TASK_CRITERIA.md 가 원본이고, 프롬프트는
extract/prompts.py 에 모아 뒀다.

2단계 파이프라인 — 문장마다 호출하지 않고 회의 전체를 한 번에 넣어 호출 1~2번으로 처리:
  1) 관련성 필터: 전체 문장 중 할일이 담긴 번호만 고름
  2) 구조화 추출: 걸러진 문장만 대상으로 evidence→reasoning→결론 순서로 구조화 추출

self-consistency(n_samples>1)는 항목 존재 여부는 합집합으로 잡고, 담당자/마감 값이 회차마다
흔들리면 해당 필드 상태를 inferred 로 낮춘다.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Protocol

from pydantic import BaseModel

from extract import prompts
from extract.dates import sanity_check_due_date
from extract.rules import find_explicit_name, split_sentences
from shared.config import today as _config_today
from shared.schemas import ExtractedTask, Transcript

CERTAIN, INFERRED, MISSING = "certain", "inferred", "missing"

# 원문에 그대로 적힌 것으로 볼 수 있는 담당자 타입 (해소가 필요 없는 것들)
_EXPLICIT_ASSIGNEE_TYPES = {"first", "thirdname"}


class RelevanceResult(BaseModel):
    relevant_indices: list[int]


class ExtractionItem(BaseModel):
    index: int
    evidence_span: str
    reasoning: str
    task_raw: str
    assignee_type: str = "none"
    assignee_mention: str | None = None
    assignee_resolved: str | None = None
    due_date: str | None = None  # LLM 이 계산한 ISO 날짜 (코드가 다시 검증한다)
    due_raw: str | None = None
    ambiguity_flag: bool = False


class ExtractionResult(BaseModel):
    items: list[ExtractionItem]


class ChatClient(Protocol):
    """client.chat.completions.parse(...) 만 있으면 됨 — openai.OpenAI 든 테스트용 가짜든 상관없다."""

    chat: Any


def _numbered_lines(indices: list[int], speakers: list[str | None], sentences: list[str]) -> str:
    return "\n".join(f"[{i}] {speakers[i] or '?'}: {sentences[i]}" for i in indices)


def _call_llm(
    client: ChatClient,
    model: str,
    messages: list[dict],
    schema: type[BaseModel],
    *,
    temperature: float,
    max_completion_tokens: int = 4000,
    reasoning_effort: str = "low",
) -> BaseModel:
    """추론형 모델은 reasoning_effort='none' 이어도 내부 추론을 완전히 끄지 않는다(Elice MLAPI 문서).
    max_completion_tokens 를 안 주면 그 추론이 JSON 을 다 뱉기 전에 한도를 넘겨
    openai.LengthFinishReasonError 로 죽는다(실제로 겪음). 둘 다 보수적으로 명시한다."""
    response = client.chat.completions.parse(
        model=model,
        messages=messages,
        response_format=schema,
        temperature=temperature,
        max_completion_tokens=max_completion_tokens,
        reasoning_effort=reasoning_effort,
    )
    message = response.choices[0].message
    parsed = getattr(message, "parsed", None)
    if isinstance(parsed, schema):
        return parsed
    return schema.model_validate_json(message.content)


def filter_relevant(client: ChatClient, model: str, sentences: list[str], speakers: list[str | None]) -> list[int]:
    lines = _numbered_lines(list(range(len(sentences))), speakers, sentences)
    messages = [
        {"role": "system", "content": prompts.RELEVANCE_SYSTEM},
        {"role": "user", "content": prompts.relevance_user_prompt(lines)},
    ]
    result = _call_llm(client, model, messages, RelevanceResult, temperature=0.0)
    return sorted(i for i in set(result.relevant_indices) if 0 <= i < len(sentences))


def extract_structured(
    client: ChatClient,
    model: str,
    indices: list[int],
    speakers: list[str | None],
    sentences: list[str],
    *,
    today: date,
    temperature: float,
) -> list[ExtractionItem]:
    if not indices:
        return []
    lines = _numbered_lines(indices, speakers, sentences)
    messages = [
        {"role": "system", "content": prompts.extraction_system_prompt(today)},
        {"role": "user", "content": prompts.extraction_user_prompt(lines)},
    ]
    result = _call_llm(client, model, messages, ExtractionResult, temperature=temperature)
    return result.items


def _norm(s: str | None) -> str:
    return (s or "").strip().rstrip("님")


def _reconcile(runs: list[list[ExtractionItem]]) -> dict[int, tuple[ExtractionItem, bool, bool]]:
    """반복 호출 결과를 인덱스로 모아 (대표항목, 담당자 흔들림, 마감 흔들림) 을 만든다.

    항목 존재 여부는 합집합 — 한 회차라도 잡았으면 채택한다(놓치는 것보다 낫다).
    값이 회차마다 다르면 그 필드 상태를 inferred 로 낮추는 근거가 된다.
    """
    by_index: dict[int, list[ExtractionItem]] = {}
    for run in runs:
        for item in run:
            by_index.setdefault(item.index, []).append(item)

    out: dict[int, tuple[ExtractionItem, bool, bool]] = {}
    for idx, items in by_index.items():
        base = items[0]
        assignee_wobbles = any(
            _norm(it.assignee_resolved or it.assignee_mention) != _norm(base.assignee_resolved or base.assignee_mention)
            or it.assignee_type != base.assignee_type
            for it in items
        )
        due_wobbles = any((it.due_date or None) != (base.due_date or None) for it in items)
        out[idx] = (base, assignee_wobbles, due_wobbles)
    return out


def _assignee_status(item: ExtractionItem, sentence: str, wobbles: bool) -> str:
    """담당자 근거 상태. 원문에 이름이 그대로 있으면 certain, 문맥 추론이면 inferred."""
    if item.assignee_type == "none":
        return MISSING
    if item.assignee_type == "group":
        return MISSING  # 할일은 맞지만 담당자는 PM 이 지정해야 함
    if wobbles or item.ambiguity_flag:
        return INFERRED
    if item.assignee_type in _EXPLICIT_ASSIGNEE_TYPES:
        # 혼합 검증: thirdname 은 정규식이 같은 이름을 찾아내는지 교차확인
        if item.assignee_type == "thirdname":
            regex_name = find_explicit_name(sentence)
            if regex_name is None or _norm(regex_name) != _norm(item.assignee_mention):
                return INFERRED  # LLM 만 주장하는 이름 — 사람이 한 번 보게 한다
        return CERTAIN
    return INFERRED  # second/thirdpronoun/thirdrole 은 해소했든 못 했든 확인이 필요


def _due_status(due: date | None, raw: str | None, wobbles: bool) -> str:
    if due is None:
        return MISSING
    if wobbles or not raw:
        return INFERRED
    return CERTAIN


def _confidence(task_status: str, assignee_status: str, due_status: str) -> float:
    """내부 로그·정렬용 숫자. 사용자에겐 상태로 보여주고 이 값은 노출하지 않는다."""
    score = {CERTAIN: 1.0, INFERRED: 0.6, MISSING: 0.3}
    return round(min(score[task_status], score[assignee_status], score[due_status]), 2)


def extract_tasks(
    transcript: Transcript,
    *,
    client: ChatClient,
    model: str,
    today: date | None = None,
    speaker_names: dict[str, str] | None = None,
    n_samples: int = 1,
) -> list[ExtractedTask]:
    """extract/rules.py::extract_tasks 와 같은 자리. client/model 은 호출자가 넘긴다."""
    ref_date = today if today is not None else _config_today()
    names = speaker_names or {}

    sentences: list[str] = []
    speakers: list[str | None] = []
    for seg in sorted(transcript.segments, key=lambda s: s.start):
        speaker_name = names.get(seg.speaker) if seg.speaker else None
        for sentence in split_sentences(seg.text):
            sentences.append(sentence)
            speakers.append(speaker_name)

    if not sentences:
        return []

    relevant = filter_relevant(client, model, sentences, speakers)
    if not relevant:
        return []

    n_samples = max(1, n_samples)
    runs = [
        extract_structured(
            client, model, relevant, speakers, sentences,
            today=ref_date, temperature=0.0 if n_samples == 1 else 0.4,
        )
        for _ in range(n_samples)
    ]
    reconciled = _reconcile(runs)

    results: list[ExtractedTask] = []
    for idx in sorted(reconciled):
        item, assignee_wobbles, due_wobbles = reconciled[idx]
        sentence = sentences[idx] if 0 <= idx < len(sentences) else item.evidence_span

        due = sanity_check_due_date(item.due_date, ref_date)  # LLM 계산 → 코드 검증
        assignee_status = _assignee_status(item, sentence, assignee_wobbles)
        due_status = _due_status(due, item.due_raw, due_wobbles)
        task_status = INFERRED if item.ambiguity_flag else CERTAIN

        # first 는 BE 가 발화자로 바로 푸니 AI 가 이름을 채우지 않는다(중복 작업 방지)
        mention = None if item.assignee_type in {"first", "group", "none"} else item.assignee_mention

        results.append(
            ExtractedTask(
                task=item.task_raw,
                assignee_member_id=None,
                due_date=due.isoformat() if due else None,
                confidence=_confidence(task_status, assignee_status, due_status),
                assignee_mention=mention,
                source_sentence=item.evidence_span or sentence,
                method="llm",
                assignee_type=item.assignee_type,
                assignee_resolved=item.assignee_resolved,
                due_raw=item.due_raw,
                task_status=task_status,
                assignee_status=assignee_status,
                due_status=due_status,
            )
        )
    return results
