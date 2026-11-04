import pytest

import draft.reminder_draft as rd
from draft.reminder_draft import draft_reminder
from llm import FakeLLM, NullLLM


def _item(**overrides) -> dict:
    base = dict(
        bundle_id="b1", draft_version=1, workspace_id="w1",
        recipient_name="재환", scheduled_at="2026-11-12T09:00:00+09:00",
        tasks=[
            {"task_id": "t1", "title": "API 명세서 작성", "due_date": "2026-11-14", "status": "in_progress", "note": None},
            {"task_id": "t2", "title": "로그인 화면 QA", "due_date": "2026-11-20", "status": "blocked",
             "note": "디자인 시안 바뀐 부분도 같이 봐 주세요"},
        ],
        style_examples=[],
        fallback_body="API 명세서 작성 마감이 11/14 입니다.",
    )
    base.update(overrides)
    return base


# BE 가 인사·이름·소개·맺음 틀을 씌우므로 초안은 마감을 묻는 가운데만이다.
GOOD = ("API 명세서 작성 마감이 11/14(토)이라 한번 여쭤봐요. 로그인 화면 QA도 11/20(금)까지인데 "
        "디자인 시안 바뀐 부분도 같이 봐 주시면 좋겠어요. 막힌 게 있으면 편하게 말씀 주세요!")


def _run(response, item=None):
    fake = FakeLLM(responses=[response])
    return draft_reminder(item or _item(), llm=fake), fake


def test_prompt_carries_name_titles_due_dates_and_notes():
    _, fake = _run(None)
    prompt = fake.prompts[0]
    assert "재환" in prompt
    assert '"API 명세서 작성"' in prompt and '"로그인 화면 QA"' in prompt
    assert "11/14(토)" in prompt and "11/20(금)" in prompt
    assert "디자인 시안 바뀐 부분도 같이 봐 주세요" in prompt
    assert "막힘" in prompt


def test_prompt_follows_style_examples_when_present():
    examples = ["지민아 배포 문서 어때? 🙌", "내일까지 부탁해~ 😊"]
    _, fake = _run(None, _item(style_examples=examples))
    prompt = fake.prompts[0]
    assert all(e in prompt for e in examples)
    assert rd._DEFAULT_EXAMPLE not in prompt


def test_prompt_uses_default_persona_without_examples():
    _, fake = _run(None)
    prompt = fake.prompts[0]
    assert rd._DEFAULT_EXAMPLE in prompt
    assert "존댓말" in prompt


def test_task_without_due_date_has_no_date_in_prompt_and_needs_none():
    tasks = [{"task_id": "t1", "title": "회의록 정리", "due_date": None, "status": "todo", "note": None}]
    body, fake = _run({"body": "회의록 정리 어떻게 되고 있는지 편하게 알려 주세요!"}, _item(tasks=tasks))
    assert '"회의록 정리" / 상태 할 일\n' in fake.prompts[0]
    assert body == "회의록 정리 어떻게 되고 있는지 편하게 알려 주세요!"


def test_good_response_passes_stripped():
    body, _ = _run({"body": f"  {GOOD}\n"})
    assert body == GOOD


@pytest.mark.parametrize("body", [
    GOOD.replace("로그인 화면 QA", "로그인 QA"),          # 제목이 그대로 안 들어감
    GOOD.replace("11/20(금)", "다음 주 금요일"),            # 마감일이 빠짐
    GOOD.replace("11/14", "11/04"),                       # 날짜가 다름
    "챙겨 주세요.\n- API 명세서 작성 11/14\n- 로그인 화면 QA 11/20",
    "챙겨 주세요.\n* API 명세서 작성 11/14 로그인 화면 QA 11/20",
    "챙겨 주세요.\n• API 명세서 작성 11/14 로그인 화면 QA 11/20",
    "챙겨 주세요.\n1. API 명세서 작성 11/14 로그인 화면 QA 11/20",
    GOOD + "가" * 600,                                    # 너무 김
    GOOD + " AI가 대신 정리해 드렸어요.",
    GOOD + " (리마인드 봇)",
    "   ",
])
def test_bad_body_is_rejected(body):
    assert _run({"body": body})[0] is None


LISTED = "챙겨 주세요.\n{0} API 명세서 작성 11/14\n{1} 로그인 화면 QA 11/20"


@pytest.mark.parametrize("body", [
    GOOD + " 초안은 11/10까지 먼저 주실 수 있을까요?",                   # 태스크에 없는 날짜
    GOOD.replace("11/20(금)까지", "11/20(금)에서 11/27로 미뤄졌는데"),  # 없는 날짜로 바꿔 씀
    GOOD.replace("11/14(토)", "11/14(월)"),                          # 틀린 요일
    GOOD.replace("11/14(토)", "11/14 월요일"),
    LISTED.format("1)", "2)"),
    LISTED.format("①", "②"),
    LISTED.format("·", "·"),
    GOOD + " (인공지능이 정리했어요)",
    GOOD + " ChatGPT로 다듬었어요.",
    GOOD + " 자동으로 작성된 메시지예요.",
    GOOD + " 자동 작성 메시지예요.",
])
def test_wrong_facts_lists_and_ai_mentions_are_rejected(body):
    assert _run({"body": body})[0] is None


@pytest.mark.parametrize("body", [
    "재환님, " + GOOD,
    "안녕하세요! " + GOOD,
    GOOD + " 재환님 화이팅!",
])
def test_greeting_or_recipient_name_is_rejected_because_the_frame_adds_them(body):
    assert _run({"body": body})[0] is None


def test_recipient_name_inside_a_title_and_a_rule_style_middle_pass():
    tasks = [{"task_id": "t1", "title": "재환 온보딩 문서", "due_date": "2026-11-14", "status": "todo", "note": None}]
    body = "'재환 온보딩 문서' 마감이 11/14(토)이라 한번 여쭤봐요.\n지금 어디까지 됐는지 편하게 알려 주세요!"
    assert _run({"body": body}, _item(tasks=tasks))[0] == body


def test_prompt_asks_for_the_middle_only_and_to_skip_frame_lines_in_examples():
    _, fake = _run(None, _item(style_examples=["안녕하세요 지민님, 팀 PM이에요.\n배포 문서 어때요?"]))
    prompt = fake.prompts[0]
    assert "인사" in prompt and "자기소개" in prompt and "맺음" in prompt
    assert "1. 받는 사람 이름을 한 번 부른다" not in prompt


def test_weekday_written_in_full_or_left_out_is_fine():
    for body in (GOOD.replace("11/14(토)", "11/14(토요일)"), GOOD.replace("11/14(토)", "11/14")):
        assert _run({"body": body})[0] == body


def test_short_title_inside_a_longer_title_must_appear_on_its_own():
    tasks = [
        {"task_id": "t1", "title": "API 명세서", "due_date": "2026-11-14", "status": "todo", "note": None},
        {"task_id": "t2", "title": "API", "due_date": "2026-11-20", "status": "todo", "note": None},
    ]
    dropped = "API 명세서 마감이 11/14(토)이고 11/20(금)도 챙겨 주세요!"
    both = "API 명세서는 11/14(토), API 연동은 11/20(금)까지예요. 편하게 알려 주세요!"
    assert _run({"body": dropped}, _item(tasks=tasks))[0] is None
    assert _run({"body": both}, _item(tasks=tasks))[0] == both


def test_date_inside_a_title_is_not_read_as_an_extra_date():
    tasks = [{"task_id": "t1", "title": "11/20 배포 점검", "due_date": "2026-11-14", "status": "todo", "note": None}]
    body = "11/20 배포 점검 마감이 11/14(토)이라 한번 여쭤봐요!"
    assert _run({"body": body}, _item(tasks=tasks))[0] == body


def test_date_check_does_not_match_inside_a_longer_date():
    tasks = [{"task_id": "t1", "title": "배포 점검", "due_date": "2026-01-14", "status": "todo", "note": None}]
    assert _run({"body": "배포 점검 마감이 11/14 이에요."}, _item(tasks=tasks))[0] is None


def test_banned_word_inside_a_title_is_allowed():
    # 이 서비스는 봇·AI 작업이 많다. 제목을 그대로 옮긴 건 금지어로 보지 않는다
    tasks = [{"task_id": "t1", "title": "봇 DM 발송 AI 연동", "due_date": "2026-11-14", "status": "todo", "note": None}]
    body = "봇 DM 발송 AI 연동 마감이 11/14(토)이라 한번 여쭤봐요!"
    assert _run({"body": body}, _item(tasks=tasks))[0] == body


@pytest.mark.parametrize("response", [None, {"text": GOOD}, {"body": None}, {"body": ["a"]}, ["a"], "a"])
def test_missing_or_malformed_response_is_none(response):
    assert _run(response)[0] is None


def test_no_key_returns_none(monkeypatch):
    monkeypatch.setattr(rd, "get_llm", lambda which: NullLLM())
    assert draft_reminder(_item()) is None
    assert draft_reminder(_item(), llm=NullLLM()) is None


def test_uses_luna_by_default(monkeypatch):
    seen = []
    fake = FakeLLM(responses=[{"body": GOOD}])
    monkeypatch.setattr(rd, "get_llm", lambda which: seen.append(which) or fake)
    assert draft_reminder(_item()) == GOOD
    assert seen == ["luna"]


def test_swapped_due_dates_between_tasks_are_rejected():
    swapped = ("API 명세서 작성은 11/20(금), 로그인 화면 QA는 11/14(토)까지라 한번 여쭤봐요. "
               "막힌 게 있으면 편하게 말씀 주세요!")
    assert _run({"body": swapped})[0] is None


def test_date_written_before_its_title_still_passes():
    before = ("11/14(토) 마감인 API 명세서 작성이랑 11/20(금)까지인 로그인 화면 QA 한번 여쭤봐요. "
              "디자인 시안 바뀐 부분도 같이 봐 주세요!")
    assert _run({"body": before})[0] == before


def test_a_draft_that_copies_the_frame_closing_or_calls_the_given_name_is_rejected():
    item = {"recipient_name": "김재환", "tasks": [
        {"task_id": "t1", "title": "API 명세서", "due_date": "2026-11-14", "status": "todo", "note": None}]}
    middle = "'API 명세서' 마감이 11/14(토)이라 한번 여쭤봐요."
    assert rd._parse_reminder_response({"body": middle}, item) == middle
    assert rd._parse_reminder_response({"body": f"재환님, {middle}"}, item) is None
    assert rd._parse_reminder_response({"body": f"{middle}\n여기로 답장하시면 저한테 바로 전달돼요."}, item) is None
