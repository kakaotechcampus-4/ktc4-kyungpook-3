import pytest

from judge.final_judge import JudgeUnavailableError, _numbered_candidates, judge, judge_llm
from llm import FakeLLM, NullLLM
from shared.schemas import JudgeInput, NotionCandidate


def _candidate(**overrides) -> NotionCandidate:
    base = dict(
        notion_page_id="notion_1", task_id="task_1", title="로그인 화면 시안 마무리 작업",
        assignee_member_id="mem_dongwoo", due_date="2026-09-16", status="in_progress",
        similarity=0.6,
    )
    base.update(overrides)
    return NotionCandidate(**base)


# ── _numbered_candidates (Terra 프롬프트에 넘기는 후보 포맷) ─────────────────


def test_numbered_candidates_includes_content_snippet():
    # title만 보고는 "카카오만 지원"인지 "카카오·구글 지원"인지 구분이 안 돼서
    # 범위 변경(scope) 판단이 틀릴 수 있다 — 본문 일부가 프롬프트에 실제로 들어가는지 확인.
    ji = JudgeInput(
        source="meeting", text="x",
        candidates=[_candidate(title="소셜 로그인 구현", content_snippet="카카오 로그인만 지원")],
    )
    assert "카카오 로그인만 지원" in _numbered_candidates(ji)


# ── judge_llm (Terra) ─────────────────────────────────────────────────────


def test_llm_update_path_resolves_matched_task_id_from_index():
    ji = JudgeInput(
        source="meeting", text="로그인 화면 마감일을 다음 주 화요일로 연기하는 데 합의함",
        candidates=[_candidate(task_id="task_9f8e7d6c", due_date="2026-09-16")],
    )
    fake = FakeLLM(responses=[{
        "is_meaningful": True, "category": "schedule", "is_new": False,
        "matched_candidate_index": 0, "status": None,
        "evidence": "기존 마감일(9/16)을 다음 주 화요일로 연기 합의",
    }])
    result = judge_llm(ji, fake)
    assert result.is_meaningful is True
    assert result.is_new is False
    assert result.matched_task_id == "task_9f8e7d6c"
    assert result.status is None


def test_llm_update_path_keeps_notion_page_id_even_without_task_id():
    # candidate가 우리 DB Task와 아직 연결 안 된(task_id=None) Notion 후보라도, 어떤 페이지를
    # 골랐는지는 matched_notion_page_id로 남아야 한다 — 안 그러면 BE가 뭘 고쳐야 할지 알 수 없다.
    ji = JudgeInput(
        source="meeting", text="x",
        candidates=[_candidate(task_id=None, notion_page_id="n_manual")],
    )
    fake = FakeLLM(responses=[{
        "is_meaningful": True, "category": "schedule", "is_new": False,
        "matched_candidate_index": 0, "status": None, "evidence": "",
    }])
    result = judge_llm(ji, fake)
    assert result.matched_task_id is None
    assert result.matched_notion_page_id == "n_manual"


def test_llm_new_item_path_has_no_matched_task_id():
    ji = JudgeInput(source="meeting", text="결제 환불 기능 구현하기로 했다.", candidates=[])
    fake = FakeLLM(responses=[{
        "is_meaningful": True, "category": "decision", "is_new": True,
        "matched_candidate_index": None, "status": "todo", "evidence": "새 결정 사항",
    }])
    result = judge_llm(ji, fake)
    assert result.is_new is True
    assert result.matched_task_id is None
    assert result.status == "todo"


def test_llm_not_meaningful_when_already_reflected():
    ji = JudgeInput(
        source="meeting", text="로그인 화면 마감일 화요일로 미루기로 했다.",
        candidates=[_candidate(due_date="2026-09-22")],  # 이미 화요일
    )
    fake = FakeLLM(responses=[{
        "is_meaningful": False, "category": "none", "is_new": False,
        "matched_candidate_index": None, "status": None,
        "evidence": "이미 반영된 내용",
    }])
    result = judge_llm(ji, fake)
    assert result.is_meaningful is False


def test_llm_returns_none_on_invalid_category():
    ji = JudgeInput(source="meeting", text="x", candidates=[])
    fake = FakeLLM(responses=[{
        "is_meaningful": True, "category": "invalid", "is_new": True,
        "matched_candidate_index": None, "status": None, "evidence": "",
    }])
    assert judge_llm(ji, fake) is None


def test_llm_returns_none_when_update_missing_valid_index():
    ji = JudgeInput(source="meeting", text="x", candidates=[_candidate()])
    fake = FakeLLM(responses=[{
        "is_meaningful": True, "category": "schedule", "is_new": False,
        "matched_candidate_index": None, "status": None, "evidence": "",
    }])
    assert judge_llm(ji, fake) is None


def test_llm_returns_none_when_index_is_bool():
    # bool은 int의 서브클래스라 isinstance(idx, int) 검사만으로는 True/False가 0/1 후보로
    # 잘못 통과할 수 있다 — type()으로 엄격히 걸러지는지 확인한다.
    ji = JudgeInput(source="meeting", text="x", candidates=[_candidate(), _candidate()])
    fake = FakeLLM(responses=[{
        "is_meaningful": True, "category": "schedule", "is_new": False,
        "matched_candidate_index": True, "status": None, "evidence": "",
    }])
    assert judge_llm(ji, fake) is None


def test_llm_returns_none_when_call_fails():
    ji = JudgeInput(source="meeting", text="x", candidates=[])
    assert judge_llm(ji, NullLLM()) is None


# ── judge (디스패처: 규칙 기반 폴백 없음) ───────────────────────────────────


def test_dispatcher_uses_llm_when_available(monkeypatch):
    import judge.final_judge as fj

    fake = FakeLLM(responses=[{
        "is_meaningful": True, "category": "decision", "is_new": True,
        "matched_candidate_index": None, "status": None, "evidence": "테스트",
    }])
    monkeypatch.setattr(fj, "get_llm", lambda which: fake)
    ji = JudgeInput(source="meeting", text="아무 발화", candidates=[])
    result = judge(ji)
    assert result.evidence == "테스트"


def test_dispatcher_raises_when_llm_off(monkeypatch):
    import judge.final_judge as fj

    monkeypatch.setattr(fj, "get_llm", lambda which: NullLLM())
    ji = JudgeInput(source="meeting", text="결제 환불 기능 구현하기로 했다.", candidates=[])
    with pytest.raises(JudgeUnavailableError):
        judge(ji)


def test_dispatcher_raises_when_llm_parse_fails(monkeypatch):
    import judge.final_judge as fj

    fake = FakeLLM(responses=[{"is_meaningful": "not-a-bool"}])  # 파싱 실패
    monkeypatch.setattr(fj, "get_llm", lambda which: fake)
    ji = JudgeInput(source="meeting", text="결제 환불 기능 구현하기로 했다.", candidates=[])
    with pytest.raises(JudgeUnavailableError):
        judge(ji)
