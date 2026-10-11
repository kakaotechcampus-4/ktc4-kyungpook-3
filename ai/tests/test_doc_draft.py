from datetime import date

import pytest

import draft.doc_draft as dd
from draft.doc_draft import DraftUnavailableError, _draft_prompt, draft, draft_llm
from llm import FakeLLM, NullLLM
from shared.schemas import DraftStructured, JudgeFinding, JudgeResult, NotionCandidate

TODAY = date(2026, 9, 28)  # 월요일


def _finding(**overrides) -> JudgeFinding:
    base = dict(
        text="로그인 화면 마감을 다음 주 화요일로 연기하는 데 동의함",
        evidence=["로그인 화면 마감 좀 미룰 수 있을까요? 다음 주 화요일로요.", "네, 알겠습니다."],
        speaker="mem_haeun",
        method="llm",
    )
    base.update(overrides)
    return JudgeFinding(**base)


def _result(**overrides) -> JudgeResult:
    base = dict(is_meaningful=True, category="schedule", is_new=False, matched_task_id="task_login")
    base.update(overrides)
    return JudgeResult(**base)


def _candidate(**overrides) -> NotionCandidate:
    base = dict(
        notion_page_id="n1", task_id="task_login", title="로그인 화면 시안 마무리 작업",
        due_date="2026-09-28", status="in_progress", similarity=0.8,
    )
    base.update(overrides)
    return NotionCandidate(**base)


# ── _draft_prompt ─────────────────────────────────────────────────────────


def test_prompt_carries_meeting_date_evidence_and_current_values():
    # 날짜 계산 기준(회의 날짜·요일), 근거 원문, 수정 대상의 현재 값이 빠지면
    # "다음 주 화요일"도 "현재 값 → 새 값"도 쓸 수 없다
    prompt = _draft_prompt(_finding(), _result(), _candidate(), TODAY)
    assert "2026-09-28 (월요일)" in prompt
    assert "네, 알겠습니다." in prompt
    assert "기존 할일 수정" in prompt
    assert "마감일: 2026-09-28" in prompt


def test_prompt_for_create_has_no_current_values_but_shows_assignee():
    f = _finding(
        text="결제 환불 기능을 지민님이 다음 주까지 구현하기로 함",
        evidence=["결제 환불 기능은 지민님이 다음 주까지 만들어 주세요."],
        assignee_type="thirdname", assignee_raw="지민님",
    )
    prompt = _draft_prompt(f, _result(category="decision", is_new=True, matched_task_id=None), None, TODAY)
    assert "새 할일 생성" in prompt
    assert "- 바뀌는 것:" not in prompt  # 새 항목에 category 를 넣으면 doc_text 에 "범위에 추가" 가 붙는다
    assert "[수정 대상의 현재 값]" not in prompt
    assert "[담당자 언급] 지민님" in prompt


# ── draft_llm (응답 검증) ──────────────────────────────────────────────────


def test_create_keeps_task_and_due_date():
    fake = FakeLLM(responses=[{
        "task": "결제 환불 기능 구현", "due_date": "2026-10-04",
        "doc_text": "결제 환불 기능을 지민님이 10/4까지 구현하기로 함",
    }])
    result = _result(category="decision", is_new=True, matched_task_id=None)
    drafted = draft_llm(_finding(), result, None, TODAY, fake)
    assert drafted.structured == DraftStructured(task="결제 환불 기능 구현", due_date="2026-10-04")
    assert drafted.method == "llm"


def test_update_drops_task_even_if_luna_fills_it():
    # 수정에서 제목이 채워지면 승인 시 기존 제목을 덮어쓴다
    fake = FakeLLM(responses=[{
        "task": "로그인 화면 디자인 작업", "due_date": "2026-10-06",
        "doc_text": "로그인 화면 시안 마감을 9/28에서 10/6으로 연기",
    }])
    drafted = draft_llm(_finding(), _result(), _candidate(), TODAY, fake)
    assert drafted.structured == DraftStructured(task=None, due_date="2026-10-06")


def test_update_outside_schedule_drops_due_date():
    # 상태만 바뀌는 수정에서 마감일이 채워지면 관계없는 필드가 바뀐다
    fake = FakeLLM(responses=[{"task": None, "due_date": "2026-10-02", "doc_text": "검색 성능 개선 완료"}])
    result = _result(category="decision", status="done", matched_task_id="task_search")
    drafted = draft_llm(_finding(text="검색 성능 개선 작업을 끝냈다고 보고함"), result, _candidate(), TODAY, fake)
    assert drafted.structured == DraftStructured()


@pytest.mark.parametrize("bad", ["2020-01-01", "다음 주 화요일", "2026-13-01", 20261006, None])
def test_invalid_due_date_becomes_none_without_failing(bad):
    # 날짜만 틀렸으면 마감만 비우고 나머지는 살린다
    fake = FakeLLM(responses=[{"task": "알림 설정 페이지 개발", "due_date": bad, "doc_text": "알림 설정 페이지 개발"}])
    result = _result(category="decision", is_new=True, matched_task_id=None)
    drafted = draft_llm(_finding(), result, None, TODAY, fake)
    assert drafted.structured == DraftStructured(task="알림 설정 페이지 개발", due_date=None)


@pytest.mark.parametrize("bad", ["2026-10-40", "2020-01-01", "다음 주 화요일", None])
def test_update_schedule_without_usable_due_date_is_failure(bad, monkeypatch):
    # 일정 변경인데 쓸 수 있는 마감일이 없으면 승인 요청이 "바뀌는 값 없음"으로 사라진다 — 조용히 버리지 않고 실패
    response = {"task": None, "due_date": bad, "doc_text": "로그인 화면 시안 마감을 연기"}
    assert draft_llm(_finding(), _result(), _candidate(), TODAY, FakeLLM(responses=[response])) is None

    monkeypatch.setattr(dd, "get_llm", lambda which: FakeLLM(responses=[response]))
    with pytest.raises(DraftUnavailableError):
        draft(_finding(), _result(), candidate=_candidate(), today=TODAY)


@pytest.mark.parametrize("response, is_new", [
    ({"task": "알림 설정 페이지 개발", "due_date": None, "doc_text": "  "}, True),  # doc_text 없음
    ({"task": "", "due_date": None, "doc_text": "알림 설정 페이지 개발"}, True),     # create 인데 제목 없음
    ({"due_date": "2026-10-06"}, False),                                            # doc_text 키 자체가 없음
])
def test_missing_required_value_is_parse_failure(response, is_new):
    result = _result(is_new=is_new, matched_task_id=None if is_new else "task_login")
    assert draft_llm(_finding(), result, None, TODAY, FakeLLM(responses=[response])) is None


def test_doc_text_is_truncated():
    fake = FakeLLM(responses=[{"task": None, "due_date": "2026-10-06", "doc_text": "가" * 500}])
    drafted = draft_llm(_finding(), _result(), _candidate(), TODAY, fake)
    assert len(drafted.doc_text) == dd.DOC_TEXT_MAX


def test_llm_failure_returns_none():
    assert draft_llm(_finding(), _result(), _candidate(), TODAY, NullLLM()) is None


# ── draft (디스패처) ───────────────────────────────────────────────────────


def test_dispatcher_uses_luna(monkeypatch):
    fake = FakeLLM(responses=[{"task": None, "due_date": "2026-10-06", "doc_text": "마감 연기"}])
    monkeypatch.setattr(dd, "get_llm", lambda which: fake)
    drafted = draft(_finding(), _result(), candidate=_candidate(), today=TODAY)
    assert drafted.structured.due_date == "2026-10-06"


def test_dispatcher_raises_when_llm_off(monkeypatch):
    monkeypatch.setattr(dd, "get_llm", lambda which: NullLLM())
    with pytest.raises(DraftUnavailableError):
        draft(_finding(), _result(), candidate=_candidate(), today=TODAY)


def test_dispatcher_raises_when_llm_parse_fails(monkeypatch):
    fake = FakeLLM(responses=[{"task": None, "due_date": None}])
    monkeypatch.setattr(dd, "get_llm", lambda which: fake)
    with pytest.raises(DraftUnavailableError):
        draft(_finding(), _result(), candidate=_candidate(), today=TODAY)


def test_dispatcher_rejects_not_meaningful_result(monkeypatch):
    # 2단계가 버리기로 한 발화가 여기까지 오면 호출자 버그 — Luna 를 부르지 않고 바로 막는다
    fake = FakeLLM(responses=[{"task": None, "due_date": None, "doc_text": "x"}])
    monkeypatch.setattr(dd, "get_llm", lambda which: fake)
    with pytest.raises(ValueError):
        draft(_finding(), _result(is_meaningful=False), today=TODAY)
    assert fake.prompts == []
