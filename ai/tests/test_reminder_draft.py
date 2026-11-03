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


GOOD = ("재환님, API 명세서 작성 마감이 11/14(금)이라 한번 여쭤봐요. 로그인 화면 QA도 11/20(금)까지인데 "
        "디자인 시안 바뀐 부분도 같이 봐 주시면 좋겠어요. 막힌 게 있으면 편하게 말씀 주세요!")


def _run(response, item=None):
    fake = FakeLLM(responses=[response])
    return draft_reminder(item or _item(), llm=fake), fake


def test_prompt_carries_name_titles_due_dates_and_notes():
    _, fake = _run(None)
    prompt = fake.prompts[0]
    assert "재환" in prompt
    assert '"API 명세서 작성"' in prompt and '"로그인 화면 QA"' in prompt
    assert "11/14(금)" in prompt and "11/20(금)" in prompt
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
    body, fake = _run({"body": "재환님, 회의록 정리 어떻게 되고 있는지 편하게 알려 주세요!"}, _item(tasks=tasks))
    assert '"회의록 정리" / 상태 할 일\n' in fake.prompts[0]
    assert body == "재환님, 회의록 정리 어떻게 되고 있는지 편하게 알려 주세요!"


def test_good_response_passes_stripped():
    body, _ = _run({"body": f"  {GOOD}\n"})
    assert body == GOOD


@pytest.mark.parametrize("body", [
    GOOD.replace("로그인 화면 QA", "로그인 QA"),          # 제목이 그대로 안 들어감
    GOOD.replace("11/20(금)", "다음 주 금요일"),            # 마감일이 빠짐
    GOOD.replace("11/14", "11/04"),                       # 날짜가 다름
    "재환님, 챙겨 주세요.\n- API 명세서 작성 11/14\n- 로그인 화면 QA 11/20",
    "재환님, 챙겨 주세요.\n* API 명세서 작성 11/14 로그인 화면 QA 11/20",
    "재환님, 챙겨 주세요.\n• API 명세서 작성 11/14 로그인 화면 QA 11/20",
    "재환님, 챙겨 주세요.\n1. API 명세서 작성 11/14 로그인 화면 QA 11/20",
    GOOD + "가" * 600,                                    # 너무 김
    GOOD + " AI가 대신 정리해 드렸어요.",
    GOOD + " (리마인드 봇)",
    "   ",
])
def test_bad_body_is_rejected(body):
    assert _run({"body": body})[0] is None


def test_date_check_does_not_match_inside_a_longer_date():
    tasks = [{"task_id": "t1", "title": "배포 점검", "due_date": "2026-01-14", "status": "todo", "note": None}]
    assert _run({"body": "재환님, 배포 점검 마감이 11/14 이에요."}, _item(tasks=tasks))[0] is None


def test_banned_word_inside_a_title_is_allowed():
    # 이 서비스는 봇·AI 작업이 많다. 제목을 그대로 옮긴 건 금지어로 보지 않는다
    tasks = [{"task_id": "t1", "title": "봇 DM 발송 AI 연동", "due_date": "2026-11-14", "status": "todo", "note": None}]
    body = "재환님, 봇 DM 발송 AI 연동 마감이 11/14(금)이라 한번 여쭤봐요!"
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
