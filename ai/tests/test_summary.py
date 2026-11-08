"""회의 요약(summary/). FakeLLM 으로만 돈다. 프롬프트 품질은 재지 않는다(규칙 5)."""

import json
from pathlib import Path

import pytest

from llm import FakeLLM, LLMReply
from shared.schemas import SummaryInput, SummaryItem, SummaryLine, SummaryPriorDecision, SummaryTopic
from summary.prompt import COMPACT, FULL, MAX_TRANSCRIPT_CHARS, build_prompt, render_transcript
from summary.summarize import parse_summary, summarize

GOLDEN = Path(__file__).parent / "capture/fixtures/summary_put.json"
TOPIC_ID = "00000000-0000-0000-0000-00000000aaaa"
ITEM_ID = "00000000-0000-0000-0000-00000000bbbb"
DECISION_ID = "00000000-0000-0000-0000-00000000cccc"


def _input(*, lines=None, started_at="2026-11-05T05:00:00Z", title="3주차 정기회의"):
    return SummaryInput(
        extraction_id="e1", meeting_id="m1", workspace_id="w1", title=title, started_at=started_at,
        lines=lines if lines is not None else [SummaryLine(1, 125000, "민수", "초대는 이메일로만 하죠")],
        items=[SummaryItem(ITEM_ID, "create", "초대 메일 보내기", "민수", "2026-11-14")],
        topics=[SummaryTopic(TOPIC_ID, "팀원 초대", "초대 방식")],
        decisions=[SummaryPriorDecision(DECISION_ID, "초대 코드로 합류한다", "팀원 초대", "2026-10-20")],
    )


def _raw(**over):
    return {"overview": "요약", "key_points": ["핵심"], **over}


def _parse(raw, summary_input=None):
    return parse_summary(raw, summary_input or _input(), model_name="m", truncated_input=False)


def _llm_reply_for_golden():
    return {
        "overview": "팀원 초대 방식을 이메일로 바꾸고 로그인 범위를 정했다.",
        "key_points": ["초대 코드를 없앤다", "카카오 로그인을 먼저 만든다"],
        "discussion": [{"title": "초대 방식", "points": ["코드는 유출 위험이 있다", "이메일은 인증과 묶을 수 있다"]}],
        "facts": ["메일 발송 한도는 하루 500건이다"],
        "task_changes": [{"task": "초대 메일 보내기", "assignee": "민수", "due": "11월 14일",
                          "purpose": "코드 없이 합류한다", "precondition": "메일 도메인 인증"}],
        "schedule": [{"when": "11/20", "what": "중간 발표"}],
        "open_items": ["구글 로그인을 넣을지 정하지 못했다"],
        "topics": [
            {"key": "T1", "items": ["I1"], "decisions": [
                {"text": "초대는 이메일로만 한다", "reason": "코드는 유출되면 막을 수 없다",
                 "rejected": ["초대 코드"], "replaces": ["D1"]}]},
            {"key": "N1", "name": "로그인·계정", "description": "이메일 인증 뒤 가입과 카카오 로그인을 만든다.", "items": [],
             "decisions": [{"text": "이메일 인증 전에는 계정을 만들지 않는다", "reason": "", "rejected": [], "replaces": []}]},
        ],
    }


def test_the_put_body_matches_the_golden_file_key_for_key():
    llm = FakeLLM([_llm_reply_for_golden()])
    llm.model = "gpt-5.6-luna"
    long_lines = [SummaryLine(i, i * 1000, "민수", "가" * 1000) for i in range(200)]
    attempt = summarize(_input(lines=long_lines), llm, attempt=1)
    assert attempt.failure is None
    assert attempt.draft.to_dict() == json.loads(GOLDEN.read_text(encoding="utf-8"))


def test_valid_json_becomes_a_draft_and_the_prompt_carries_the_inputs():
    llm = FakeLLM([_raw()])
    attempt = summarize(_input(), llm, attempt=1)
    assert attempt.draft.overview == "요약" and attempt.draft.model_name == "fake"
    assert attempt.draft.truncated_input is False
    prompt = llm.prompts[0]
    assert "초대는 이메일로만 하죠" in prompt and "I1" in prompt and "T1" in prompt and "D1" in prompt
    assert ITEM_ID not in prompt and TOPIC_ID not in prompt and DECISION_ID not in prompt


@pytest.mark.parametrize("reply,failure", [
    (None, "호출 실패"),
    (LLMReply(None, finish_reason="stop"), "형식 오류"),
    ({"key_points": []}, "형식 오류"),
    (LLMReply(_raw(), finish_reason="length"), "출력 잘림"),
    (LLMReply(None, finish_reason="length"), "출력 잘림"),
])
def test_a_reply_that_cannot_be_used_is_a_failure_without_a_draft(reply, failure):
    attempt = summarize(_input(), FakeLLM([reply]), attempt=1)
    assert attempt.draft is None and attempt.failure == failure


@pytest.mark.parametrize("raw", [
    {},
    _raw(overview=""),
    _raw(overview="   "),
    _raw(overview=3),
    {"overview": "요약"},
    _raw(key_points="핵심"),
    _raw(key_points=["핵심", 1]),
    _raw(key_points=None),
])
def test_overview_and_key_points_are_required(raw):
    assert _parse(raw) is None


def test_empty_key_points_are_still_a_summary():
    assert _parse(_raw(key_points=[])).key_points == []


def test_broken_elements_drop_alone_and_nulls_become_empty_strings():
    draft = _parse(_raw(
        discussion=[{"title": "좋음", "points": ["a", 1, None]}, {"points": ["b"]}, "x"],
        facts=["사실", 2, ""],
        task_changes=[{"task": "일", "assignee": None, "due": None, "purpose": 3}, {"assignee": "민수"}, 1],
        schedule=[{"when": "11/20", "what": "발표"}, {"when": "11/21"}, {"what": "x", "when": None}],
        open_items="문장 하나",
    ))
    assert [(b.title, b.points) for b in draft.discussion] == [("좋음", ["a"])]
    assert draft.facts == ["사실"]
    change = draft.task_changes[0]
    assert (change.task, change.assignee, change.due, change.purpose, change.precondition) == ("일", "", "", "", "")
    assert len(draft.task_changes) == 1 and len(draft.schedule) == 1 and draft.open_items == []


def test_unknown_keys_are_dropped_at_every_level():
    draft = _parse(_raw(extra=1, topics=[
        {"key": "T1", "items": ["I1", "I9", 3], "other": 1,
         "decisions": [{"text": "결정", "replaces": ["D1", "D9", None], "weird": True}]},
        {"key": "T9", "items": ["I1"], "decisions": [{"text": "떠도는 결정"}]},
        {"key": "Nope", "name": "이름"},
        {"items": []},
        "x",
    ]))
    assert [t.topic_id for t in draft.topics] == [TOPIC_ID]
    assert draft.topics[0].item_ids == [ITEM_ID]
    assert draft.topics[0].decisions[0].replaces == [DECISION_ID]


def test_a_decision_with_no_valid_topic_is_dropped():
    draft = _parse(_raw(decisions=[{"text": "주제 없는 결정", "topic": "T1"}],
                        topics=[{"key": "T7", "decisions": [{"text": "없는 주제의 결정"}]}]))
    assert draft.topics == []


def test_a_nameless_new_topic_is_dropped_with_its_decisions():
    draft = _parse(_raw(topics=[{"key": "N1", "name": "  ", "decisions": [{"text": "결정"}]}]))
    assert draft.topics == []


def test_topic_reuse_sends_the_id_with_the_known_name_and_a_new_topic_sends_the_name():
    draft = _parse(_raw(topics=[
        {"key": "T1", "name": "무시되는 이름", "description": "무시", "items": []},
        {"key": "N1", "name": " 새 주제 ", "description": " 설명 ", "items": []},
    ]))
    reused, new = draft.topics
    # 이름은 LLM 이 아니라 재료의 이름이다. BE 가 그 주제를 못 찾을 때 이름으로 다시 찾는다
    assert (reused.topic_id, reused.name, reused.description) == (TOPIC_ID, "팀원 초대", "")
    assert (new.topic_id, new.name, new.description) == (None, "새 주제", "설명")


def test_a_decision_without_text_is_dropped_and_blank_reason_is_none():
    draft = _parse(_raw(topics=[{"key": "T1", "decisions": [
        {"text": "  "}, 3, {"text": "결정", "reason": " ", "rejected": ["대안", 1]}]}]))
    decision = draft.topics[0].decisions
    assert len(decision) == 1 and decision[0].reason is None and decision[0].rejected == ["대안"]


def test_a_long_topic_name_is_trimmed_instead_of_losing_the_attempt():
    draft = _parse(_raw(topics=[{"key": "N1", "name": "가" * 150}]))
    assert draft.topics[0].name == "가" * 100


def test_item_ids_are_deduplicated_and_capped_at_the_be_limit():
    items = [SummaryItem(f"i{n}", "create", "t", None, None) for n in range(600)]
    summary_input = SummaryInput("e", "m", "w", None, "2026-11-05T05:00:00Z", [], items, [], [])
    keys = [f"I{n}" for n in range(1, 601)]
    draft = _parse(_raw(topics=[{"key": "N1", "name": "n", "items": keys + keys}]), summary_input)
    assert len(draft.topics[0].item_ids) == 500


def test_a_transcript_at_the_limit_is_untouched():
    lines = [SummaryLine(1, 0, "민수", "가" * 10)]
    text, truncated = render_transcript(lines, limit=1000)
    assert truncated is False and text == "[00:00:00] 민수: " + "가" * 10


def test_timestamps_read_past_an_hour():
    text, _ = render_transcript([SummaryLine(1, 3_725_000, "민수", "x")])
    assert text.startswith("[01:02:05]")


def test_a_long_transcript_keeps_head_and_tail_and_says_what_it_left_out():
    lines = [SummaryLine(i, i * 1000, "민수", f"발화{i:04d} " + "가" * 80) for i in range(1000)]
    text, truncated = render_transcript(lines, limit=10_000)
    rendered = text.split("\n")
    marker = next(i for i, line in enumerate(rendered) if "줄 생략" in line)
    head, tail = rendered[:marker], rendered[marker + 1:]
    assert truncated is True
    assert "발화0000" in head[0] and "발화0999" in tail[-1]
    assert len(text) <= 10_000 + 20
    assert sum(map(len, head)) / sum(map(len, head + tail)) == pytest.approx(0.7, abs=0.03)
    assert f"[중간 {1000 - len(head) - len(tail)}줄 생략]" in text


def test_a_long_meeting_sets_truncated_input_on_the_draft():
    lines = [SummaryLine(i, i, "민수", "가" * 1000) for i in range(MAX_TRANSCRIPT_CHARS // 1000 + 5)]
    assert summarize(_input(lines=lines), FakeLLM([_raw()]), attempt=1).draft.truncated_input is True


def test_the_second_attempt_asks_for_shorter_sections():
    first, second = FakeLLM([_raw()]), FakeLLM([_raw()])
    summarize(_input(), first, attempt=1)
    summarize(_input(), second, attempt=2)
    assert f"key_points {FULL.key_points}개" in first.prompts[0]
    assert f"key_points {COMPACT.key_points}개" in second.prompts[0]
    assert COMPACT.key_points < FULL.key_points


@pytest.mark.parametrize("started_at,expected,not_expected", [
    ("2026-11-05T16:30:00Z", "2026-11-06", "2026-11-05"),     # 한국 시간으로는 다음 날이다
    ("2026-11-05T16:30:00", "2026-11-06", "2026-11-05"),      # 시간대 없는 값은 UTC 다
    ("2026-11-05T14:30:00+00:00", "2026-11-05", "2026-11-06"),
])
def test_relative_dates_resolve_from_the_meeting_date_not_the_processing_date(started_at, expected, not_expected):
    prompt, _ = build_prompt(_input(started_at=started_at), FULL)
    assert f"회의 날짜: {expected}" in prompt and f"회의 날짜: {not_expected}" not in prompt


def test_braces_in_a_transcript_do_not_break_the_prompt():
    lines = [SummaryLine(1, 0, "민수", "{key_points} 는 {그대로} 둔다")]
    assert "{key_points} 는 {그대로} 둔다" in build_prompt(_input(lines=lines), FULL)[0]


def test_characters_the_db_cannot_store_are_dropped_before_the_put():
    """짝 없는 서로게이트와 NUL 은 BE 가 받지 않는다. 그 시도의 비용이 통째로 사라지지 않게 여기서 지운다."""
    draft = _parse(_raw(overview="요약\ud83d", facts=["사실\u0000"],
                        topics=[{"key": "N1", "name": "주제\u0000", "decisions": [{"text": "결정\udc00"}]}]))
    assert draft.overview == "요약" and draft.facts == ["사실"]
    assert (draft.topics[0].name, draft.topics[0].decisions[0].text) == ("주제", "결정")
