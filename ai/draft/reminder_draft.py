"""리마인드 DM 문구 초안. PM 이 직접 쓴 것처럼 읽히는 한 통을 Luna 로 쓴다.

같은 수신자·시각에 나가는 태스크 여러 개는 BE 가 한 묶음으로 넘긴다. 이어 붙인 글은 사람이 쓴 것처럼
읽히지 않으므로 묶음 전체를 한 통으로 다시 쓴다. PM 이 쓰거나 고쳐 승인한 문구(style_examples)가 있으면
그 말투를 따르고, 없으면 기본 페르소나로 쓴다.

LLM 응답을 그대로 믿지 않고 코드가 한 번 더 거른다(_parse_reminder_response). 받는 사람 이름·제목·마감일이
빠지거나, 마감이 아닌 날짜나 틀린 요일이 들어가거나, 목록·AI 언급이 섞이면 None 이고, 호출자는 BE 의 규칙
문구(fallback_body)를 그대로 둔다.
"""

from __future__ import annotations

import re
from datetime import date

from llm import LLMClient, get_llm

BODY_MAX = 600

_STATUS_KO = {"todo": "할 일", "in_progress": "진행 중", "blocked": "막힘", "done": "완료"}
_WEEKDAYS = "월화수목금토일"
_LIST_LINE = re.compile(r"^\s*(?:[-*•·]|\d+[.)]|[\u2460-\u2473])")
_AI_WORD = re.compile(r"(?<![A-Za-z])AI(?![A-Za-z])|봇|인공지능|(?i:chatgpt)|자동으로 작성|자동 작성")
# M/D 와 바로 뒤의 요일. "11/14 수정본" 의 "수" 를 요일로 읽지 않게 괄호나 "요일" 이 붙은 것만 요일로 본다.
_DATE = re.compile(r"(?<!\d)(\d{1,2})/(\d{1,2})(?!\d)(?:\s*\(([월화수목금토일])(?:요일)?\)|\s+([월화수목금토일])요일)?")
# 지운 제목 자리. 앞뒤 글자가 붙어 없던 날짜나 금지어가 생기지 않게 빈 글 대신 넣는다.
_TITLE_MARK = "\0"

_DEFAULT_EXAMPLE = "재환님, API 명세서 마감이 11/14(토)이라 한번 여쭤봐요. 지금 어디까지 됐는지 편하게 알려 주세요!"


def _due_label(due: str) -> str:
    d = date.fromisoformat(due)
    return f"{d.month}/{d.day}({_WEEKDAYS[d.weekday()]})"


def _task_line(task: dict) -> str:
    parts = [f'제목 "{task["title"]}"']
    if task.get("due_date"):
        parts.append(f"마감 {_due_label(task['due_date'])}")
    parts.append(f"상태 {_STATUS_KO.get(task.get('status') or '', task.get('status') or '없음')}")
    line = "- " + " / ".join(parts)
    if task.get("note"):
        line += f"\n  PM 이 전하고 싶은 말: {task['note']}"
    return line


def _voice_section(style_examples: list[str]) -> str:
    if style_examples:
        examples = "\n".join(f"- {e}" for e in style_examples)
        return (
            "[말투] 아래는 이 PM 이 최근에 직접 쓰거나 고쳐 보낸 메시지다(최신순). 존댓말·반말, 이모지 여부,\n"
            "길이, 맺음말을 이 메시지들에 맞춰라. 말투만 따르고, 안에 나오는 이름·할 일·날짜는 가져오지 마라.\n"
            f"{examples}"
        )
    return (
        "[말투] 같은 팀 동료인 PM 이 가볍게 묻는 말투. 존댓말, 짧게, 재촉하거나 탓하지 않는다.\n"
        "말투만 참고할 예시(이름·할 일·날짜는 가져오지 마라):\n"
        f"- {_DEFAULT_EXAMPLE}"
    )


def _reminder_prompt(item: dict) -> str:
    tasks = "\n".join(_task_line(t) for t in item["tasks"])
    return (
        "너는 팀 PM 이다. 팀원에게 할 일 마감을 가볍게 챙기는 메시지 한 통을 직접 쓴다.\n\n"
        f"[받는 사람] {item['recipient_name']}\n"
        f"[할 일]\n{tasks}\n\n"
        f"{_voice_section(item.get('style_examples') or [])}\n\n"
        "쓰는 법:\n"
        "1. 받는 사람 이름을 한 번 부른다. 호칭은 말투를 따른다.\n"
        "2. 할 일마다 제목을 위에 적힌 그대로(따옴표 안 글자 그대로) 넣는다.\n"
        "3. 마감이 있으면 위에 적힌 M/D(요일) 형식 그대로 넣는다. 내일·이번 주 같은 말로 바꾸지 않는다.\n"
        "4. 'PM 이 전하고 싶은 말'은 뜻을 지키며 자연스럽게 녹여 쓴다.\n"
        "5. 위에 없는 사실, 날짜, 약속, 할 일을 더하지 않는다.\n"
        "6. 상태가 막힘이면 막힌 게 있는지 부드럽게 물어볼 수 있다. 꾸짖지 않는다.\n"
        "7. 짧은 메시지 한 통. 할 일이 여러 개면 목록으로 나누지 말고 자연스러운 문장으로 엮는다.\n"
        "   목록 기호, 번호, 제목줄, 마크다운을 쓰지 않는다.\n"
        "8. AI, 봇, 자동으로 썼다는 말을 하지 않는다. PM 본인이 쓴 글이다.\n\n"
        "JSON으로만 답하라:\n"
        '{"body": str}'
    )


def _parse_reminder_response(raw: object, item: dict) -> str | None:
    """Luna 응답을 검증해 본문으로. 검사를 못 넘으면 None."""
    if not isinstance(raw, dict) or not isinstance(raw.get("body"), str):
        return None
    body = raw["body"].strip()
    if not body or len(body) > BODY_MAX:
        return None

    if item["recipient_name"] not in body:
        return None

    # 긴 제목부터 지운다. "API 명세서" 를 지운 뒤에도 "API" 가 남아 있어야 "API" 태스크를 쓴 것이다.
    # 제목에 "봇 DM 발송"처럼 금지어나 날짜가 들어 있어도 제목을 그대로 옮긴 건 통과시킨다.
    unquoted = body
    for title in sorted({t["title"] for t in item["tasks"]}, key=len, reverse=True):
        if title not in unquoted:
            return None
        unquoted = unquoted.replace(title, _TITLE_MARK)

    weekdays: dict[tuple[int, int], set[str]] = {}
    for task in item["tasks"]:
        if task.get("due_date"):
            d = date.fromisoformat(task["due_date"])
            weekdays.setdefault((d.month, d.day), set()).add(_WEEKDAYS[d.weekday()])
    written = set()
    for m in _DATE.finditer(unquoted):
        month_day = (int(m[1]), int(m[2]))
        weekday = m[3] or m[4]
        if month_day not in weekdays or (weekday and weekday not in weekdays[month_day]):
            return None
        written.add(month_day)
    if written != set(weekdays):
        return None

    if any(_LIST_LINE.match(line) for line in body.splitlines()):
        return None
    if _AI_WORD.search(unquoted):
        return None
    return body


def draft_reminder(item: dict, *, llm: LLMClient | None = None) -> str | None:
    """리마인드 묶음 하나의 DM 본문을 쓴다. 키 없음·호출 실패·검사 실패면 None."""
    client = llm or get_llm("luna")
    raw = client.generate_json(_reminder_prompt(item), reasoning_effort="medium")
    if raw is None:
        return None
    return _parse_reminder_response(raw, item)
