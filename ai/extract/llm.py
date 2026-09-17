"""Phase 1 — 회의 대화록에서 할일·담당자·마감일 추출.

역할 분담 (실측 근거는 extract/dates.py 주석과 PR 본문 참고):
  - 할일 여부·task 내용·담당자 타입 분류·모호한 호칭 해소·마감일 해석 → **LLM**
  - 마감일 검증(과거/먼 미래/형식 이상) → **코드**(dates.sanity_check_due_date)
  - 담당자 → member_id 매칭 → **BE**(backend/app/services/matching.py). 여기선 원문·타입까지만
  - 명시적 "OO님" 패턴 → 정규식(text.find_explicit_name)으로 교차검증, 어긋나면 inferred 로 낮춤

판단 기준(무엇을 할일로 보는가)은 extract/TASK_CRITERIA.md 가 원본이고, 프롬프트는
extract/prompts.py 에 모아 뒀다.

2단계 파이프라인 — 문장마다 호출하지 않고 회의 전체를 한 번에 넣어 호출 1~2번으로 처리:
  1) 관련성 필터: 전체 문장 중 할일이 담긴 번호만 고름
  2) 구조화 추출: 걸러진 문장만 대상으로 evidence→reasoning→결론 순서로 구조화 추출

self-consistency(n_samples>1)는 항목 존재 여부는 합집합으로 잡고, 담당자/마감 값이 회차마다
흔들리면 해당 필드 상태를 inferred 로 낮춘다.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any, Protocol

from pydantic import BaseModel, ValidationError

from extract import prompts
from extract.dates import sanity_check_due_date
from extract.text import find_explicit_name, split_sentences
from shared.config import today as _config_today
from shared.schemas import ExtractedTask, Transcript

CERTAIN, INFERRED, MISSING = "certain", "inferred", "missing"

# 원문에 그대로 적힌 것으로 볼 수 있는 담당자 타입 (해소가 필요 없는 것들)
_EXPLICIT_ASSIGNEE_TYPES = {"first", "thirdname", "all"}


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
    max_completion_tokens: int = 16000,
    reasoning_effort: str | None = None,
) -> BaseModel:
    """max_completion_tokens 는 항상 명시한다 — Gemini 로 돌릴 때 내부 추론이 JSON 을 다 뱉기 전에
    한도를 넘겨 openai.LengthFinishReasonError 로 죽은 적이 있다(완료 토큰 5986). 짧은 케이스는
    Claude 기준 70 토큰 남짓이라 여유롭지만, 상한은 공급자가 바뀌어도 안전하도록 유지한다.

    상한이 4000 이던 시절 long_meeting(할일 34개)이 정확히 4000 에서 잘려 케이스 전체가
    LengthFinishReasonError 로 죽었다 — 잘리면 일부 손실이 아니라 **전량 손실**이다.
    다만 이 숫자를 올려도 해결되지 않는다: Elice MLAPI 게이트웨이는 요청값과 무관하게 완료
    토큰을 6000 에서 하드캡한다(16000 을 요청해도 6000 에서 length 로 끊긴다). 그래서 실제
    방어는 청킹 쪽에 있고(_CHUNK_SIZE), 여기 16000 은 게이트웨이가 상한을 풀거나 다른
    공급자로 옮겼을 때를 위한 여유값이다. 근거: decision_log/0009.

    reasoning_effort 는 Gemini 계열 전용이라 기본은 안 보낸다 — 게이트웨이가 지원하지 않는
    파라미터를 400 으로 거절할 수 있어서, 필요한 공급자에서만 명시적으로 넘긴다."""
    extra = {"reasoning_effort": reasoning_effort} if reasoning_effort else {}
    response = client.chat.completions.parse(
        model=model,
        messages=messages,
        response_format=schema,
        temperature=temperature,
        max_completion_tokens=max_completion_tokens,
        **extra,
    )
    message = response.choices[0].message
    parsed = getattr(message, "parsed", None)
    if isinstance(parsed, schema):
        return parsed
    return _validate_json(schema, message.content)


def _validate_json(schema: type[BaseModel], content: str) -> BaseModel:
    """게이트웨이가 JSON 을 문자열로 한 겹 더 감싸 보내는 경우가 있어 한 번 벗겨보고 재시도한다.

    실제로 겪었다 — 프롬프트 문구를 한 줄 바꿨더니 items 값이 배열이 아니라 "배열이 담긴 JSON
    문자열"로 와서 ValidationError 로 케이스가 통째로 날아갔다(출력 잘림과 같은 전량 손실).
    """
    try:
        return schema.model_validate_json(content)
    except ValidationError:
        inner = next((v for v in json.loads(content).values() if isinstance(v, str)), None)
        if inner is None:
            raise
        return schema.model_validate_json(inner)


_RELEVANCE_CHUNK_SIZE = 40


def filter_relevant(client: ChatClient, model: str, sentences: list[str], speakers: list[str | None]) -> list[int]:
    """할일 후보 문장의 인덱스. 문장이 많으면 _RELEVANCE_CHUNK_SIZE 개씩 끊어 묻는다.

    한 번에 100문장 넘게 주면 애매한 문장("~하죠", "~기로 했어요")을 조용히 빠뜨린다 —
    long_meeting(115문장)에서 같은 문장이 짧게 따로 돌릴 땐 잡히는데 길게 붙이면 안 잡혔다.
    """
    relevant: set[int] = set()
    for start in range(0, len(sentences), _RELEVANCE_CHUNK_SIZE):
        chunk = list(range(start, min(start + _RELEVANCE_CHUNK_SIZE, len(sentences))))
        lines = _numbered_lines(chunk, speakers, sentences)
        messages = [
            {"role": "system", "content": prompts.RELEVANCE_SYSTEM},
            {"role": "user", "content": prompts.relevance_user_prompt(lines)},
        ]
        result = _call_llm(client, model, messages, RelevanceResult, temperature=0.0)
        relevant |= {i for i in result.relevant_indices if chunk[0] <= i <= chunk[-1]}
    return sorted(relevant)


# 한 번에 추출을 요청할 관련 문장 수. 게이트웨이(Elice MLAPI)가 요청값과 무관하게 완료 토큰을
# 6000 에서 하드캡하는데, 항목 하나가 한국어 evidence_span+reasoning 포함 ~180 토큰이라 30개를
# 넘기면 JSON 이 잘리고 LengthFinishReasonError 로 **케이스 전량이 날아간다**. 여유를 두고 20.
_CHUNK_SIZE = 20


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
    """관련 문장을 _CHUNK_SIZE 개씩 끊어 추출한다. 인덱스가 전역이라 결과는 그냥 이어 붙이면 된다.

    추출 프롬프트에는 원래 전체 대화록이 아니라 관련 문장만 들어가므로, 청킹으로 더 잃는 문맥은
    청크 경계를 넘는 지시대명사 해소뿐이다. 연속 구간으로 끊어 그 손실을 최소화한다.
    """
    items: list[ExtractionItem] = []
    for start in range(0, len(indices), _CHUNK_SIZE):
        chunk = indices[start:start + _CHUNK_SIZE]
        lines = _numbered_lines(chunk, speakers, sentences)
        messages = [
            {"role": "system", "content": prompts.extraction_system_prompt(today)},
            {"role": "user", "content": prompts.extraction_user_prompt(lines)},
        ]
        result = _call_llm(client, model, messages, ExtractionResult, temperature=temperature)
        items.extend(result.items)
    return items


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
    """담당자 근거 상태. 원문에 이름이 그대로 있으면 certain, 문맥 추론이면 inferred.

    all("다 같이")은 이름은 없지만 "참석자 전원"이라는 판단이 명확하므로 certain.
    """
    if item.assignee_type == "none":
        return MISSING
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
    """대화록에서 할일을 뽑는다. client/model 은 호출자가 넘긴다(설정 로딩은 안 함)."""
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
        mention = None if item.assignee_type in {"first", "all", "none"} else item.assignee_mention

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
