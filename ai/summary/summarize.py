"""회의 하나를 요약한다. 호출은 한 번이고 예외를 내지 않는다. 재시도는 BE 의 임대가 맡는다(capture/summary_sweep.py).

LLM 응답은 믿지 않는다. parse_summary 가 경계이고 지역 키는 여기서 사라진다. 잘못된 값 하나가 PUT 의 422 가 되면
그 시도의 비용이 통째로 사라지므로 BE 스키마(backend/app/schemas/project_map.py)에 맞춰 원소만 버리거나 자른다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from llm import LLMClient, LLMReply
from shared.schemas import (
    DecisionDraft,
    DiscussionBlock,
    ScheduleEntry,
    SummaryDraft,
    SummaryInput,
    TaskChange,
    TopicDraft,
)
from summary.prompt import CHAT, COMPACT, FULL, build_prompt, local_keys

SUMMARY_TIMEOUT_S = 300.0           # 측정 뒤 확정. BE 임대 15분보다 짧아야 같은 회의에 돈이 두 번 들지 않는다
REASONING_EFFORT = "low"            # 측정 뒤 확정
# 추론 토큰이 들어간다. 게이트웨이는 스트리밍이 아닌 답을 2,000 에서 끊고 그보다 큰 값은 400 으로 거절한다(2026-11-10).
# 30줄 회의의 첫 시도가 이 상한에 잘리면 워커의 두 번째 시도(COMPACT)가 받는다
MAX_OUTPUT_TOKENS = 2000
TOPIC_NAME_MAX = 100
TOPIC_ITEMS_MAX = 500


@dataclass(frozen=True)
class SummaryAttempt:
    draft: SummaryDraft | None
    reply: LLMReply
    failure: str | None = None      # draft 가 None 이면 그 이유


def summarize(summary_input: SummaryInput, llm: LLMClient, *, attempt: int) -> SummaryAttempt:
    """attempt 는 BE 가 준 시도 번호다. 두 번째부터 섹션 상한을 줄인다."""
    prompt, truncated = build_prompt(summary_input, COMPACT if attempt > 1 else FULL)
    reply = llm.generate_json_once(prompt, timeout_s=SUMMARY_TIMEOUT_S, max_completion_tokens=MAX_OUTPUT_TOKENS,
                                   reasoning_effort=REASONING_EFFORT)
    if reply.finish_reason == "length":     # 잘린 JSON 이 우연히 파싱돼도 뒤쪽 섹션이 빠져 있다
        return SummaryAttempt(None, reply, "출력 잘림")
    if reply.data is None:
        return SummaryAttempt(None, reply, "호출 실패" if reply.finish_reason is None else "형식 오류")
    draft = parse_summary(reply.data, summary_input, model_name=llm.model, truncated_input=truncated)
    return SummaryAttempt(draft, reply, None if draft else "형식 오류")


def parse_summary(raw: dict[str, Any], summary_input: SummaryInput, *, model_name: str,
                  truncated_input: bool) -> SummaryDraft | None:
    """overview 와 key_points 가 멀쩡해야 요약이다. 아니면 None. 나머지는 깨진 원소만 버린다."""
    overview = _text(raw.get("overview"))
    key_points = raw.get("key_points")
    if not overview or not isinstance(key_points, list) or not all(isinstance(x, str) for x in key_points):
        return None
    topic_keys = local_keys("T", [t.topic_id for t in summary_input.topics])
    item_keys = local_keys("I", [i.item_id for i in summary_input.items])
    decision_keys = local_keys("D", [d.decision_id for d in summary_input.decisions])
    topic_names = {t.topic_id: t.name for t in summary_input.topics}
    topics = (_topic(x, topic_keys, topic_names, item_keys, decision_keys) for x in _dicts(raw.get("topics")))
    return SummaryDraft(
        model_name=model_name,
        truncated_input=truncated_input,
        overview=overview,
        key_points=_texts(key_points),
        # 일일 채팅 요약에는 논의 절이 없다. 틀이 요구하지 않았는데 모델이 쓰면 버린다
        discussion=[] if summary_input.source == CHAT else [
            DiscussionBlock(_text(x.get("title")), _texts(x.get("points")))
            for x in _dicts(raw.get("discussion")) if _text(x.get("title"))],
        facts=_texts(raw.get("facts")),
        # 항목 키가 없거나 모르는 줄은 승인 여부를 가릴 수 없어 BE 가 보이지 않는다. 보내지 않는다
        task_changes=[TaskChange(_text(x.get("task")), _text(x.get("assignee")), _text(x.get("due")),
                                 _text(x.get("purpose")), _text(x.get("precondition")), item_keys[_text(x.get("item"))])
                      for x in _dicts(raw.get("task_changes"))
                      if _text(x.get("task")) and _text(x.get("item")) in item_keys],
        schedule=[ScheduleEntry(_text(x.get("when")), _text(x.get("what")))
                  for x in _dicts(raw.get("schedule")) if _text(x.get("when")) and _text(x.get("what"))],
        open_items=_texts(raw.get("open_items")),
        topics=[t for t in topics if t is not None],
    )


def _topic(raw: dict, topic_keys: dict[str, str], topic_names: dict[str, str], item_keys: dict[str, str],
           decision_keys: dict[str, str]) -> TopicDraft | None:
    """모르는 키의 주제는 그 아래 결정까지 버린다. 결정이 붙을 자리가 없다."""
    key = _text(raw.get("key"))
    item_ids = _ids(raw.get("items"), item_keys)[:TOPIC_ITEMS_MAX]
    decisions = [d for d in (_decision(x, decision_keys) for x in _dicts(raw.get("decisions"))) if d is not None]
    if key in topic_keys:
        topic_id = topic_keys[key]
        return TopicDraft(topic_id, topic_names[topic_id][:TOPIC_NAME_MAX], "", item_ids, decisions)
    name = _text(raw.get("name"))[:TOPIC_NAME_MAX].strip()
    if re.fullmatch(r"N\d+", key) and name:
        return TopicDraft(None, name, _text(raw.get("description")), item_ids, decisions)
    return None


def _decision(raw: dict, decision_keys: dict[str, str]) -> DecisionDraft | None:
    text = _text(raw.get("text"))
    if not text:
        return None
    return DecisionDraft(text, _text(raw.get("reason")) or None, _texts(raw.get("rejected")),
                         _ids(raw.get("replaces"), decision_keys))


# 짝 없는 서로게이트와 NUL 은 BE 가 저장하지 못해 PUT 이 통째로 떨어진다
_UNSTORABLE = re.compile("[\x00\ud800-\udfff]")


def _text(value: Any) -> str:
    return _UNSTORABLE.sub("", value).strip() if isinstance(value, str) else ""


def _texts(value: Any) -> list[str]:
    return [t for t in map(_text, value) if t] if isinstance(value, list) else []


def _dicts(value: Any) -> list[dict]:
    return [x for x in value if isinstance(x, dict)] if isinstance(value, list) else []


def _ids(value: Any, keys: dict[str, str]) -> list[str]:
    """지역 키 목록을 ID 로. 모르는 키를 버리고 중복을 없앤다."""
    return list(dict.fromkeys(keys[k] for k in _texts(value) if k in keys))
