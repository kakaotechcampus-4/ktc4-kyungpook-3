import pytest

from judge.pipeline import to_item
from shared.schemas import (
    DraftResult,
    DraftStructured,
    JudgeFinding,
    JudgeResult,
    NotionCandidate,
    Transcript,
    TranscriptSegment,
)

TRANSCRIPT = Transcript(segments=[
    TranscriptSegment(speaker="uid_pm", start=12.0, end=15.0, text="로그인 화면 마감 좀 미룰 수 있을까요?", seq=3),
    TranscriptSegment(speaker="uid_haeun", start=15.5, end=16.4, text="네, 알겠습니다.", seq=4),
])


def _finding(**overrides) -> JudgeFinding:
    base = dict(
        text="로그인 화면 마감을 다음 주 화요일로 연기하는 데 동의함",
        evidence=["로그인 화면 마감 좀 미룰 수 있을까요?", "네, 알겠습니다."],
        seq=4, speaker="uid_haeun", method="llm",
    )
    base.update(overrides)
    return JudgeFinding(**base)


def _result(**overrides) -> JudgeResult:
    base = dict(is_meaningful=True, category="schedule", is_new=False, matched_task_id="task_login")
    base.update(overrides)
    return JudgeResult(**base)


def _drafted(task=None, due_date=None, doc_text="로그인 화면 시안 마감을 9/28에서 10/6으로 연기") -> DraftResult:
    return DraftResult(structured=DraftStructured(task=task, due_date=due_date), doc_text=doc_text)


def _target(**overrides) -> NotionCandidate:
    base = dict(
        task_id="task_login", notion_page_id="n1", title="로그인 화면 시안 마무리 작업",
        due_date="2026-09-28", status="in_progress", similarity=0.8,
    )
    base.update(overrides)
    return NotionCandidate(**base)


# ── create ────────────────────────────────────────────────────────────────


def test_create_item_carries_all_three_stages():
    finding = _finding(
        text="결제 환불 기능을 지민님이 다음 주까지 구현하기로 함",
        evidence=["결제 환불 기능은 지민님이 다음 주까지 만들어 주세요."],
        assignee_type="thirdname", assignee_raw="지민님",
    )
    result = _result(category="decision", is_new=True, matched_task_id=None)
    drafted = _drafted(task="결제 환불 기능 구현", due_date="2026-10-04", doc_text="결제 환불 기능 구현을 지민님이 10/4까지")

    item = to_item(finding, result, drafted, None, TRANSCRIPT)

    assert item == {
        "action": "create", "target_task_id": None, "category": "decision",
        "task_title": "결제 환불 기능 구현", "due_date": "2026-10-04", "status": None,
        "assignee_type": "thirdname", "assignee_raw": "지민님",
        "doc_text": "결제 환불 기능 구현을 지민님이 10/4까지",
        "evidence_quote": "결제 환불 기능은 지민님이 다음 주까지 만들어 주세요.",
        "evidence_speaker": "uid_haeun", "evidence_at_ms": 15500,
    }


@pytest.mark.parametrize("a_type, raw, resolved, expected", [
    ("thirdname", "지민님", None, "지민님"),
    ("thirdpronoun", "그분", "환", "환"),       # 문맥으로 푼 이름을 보낸다
    ("thirdpronoun", "그분", None, None),       # 못 풀었으면 "그분"을 별칭으로 조회시키지 않는다
    ("second", "너", None, None),
    ("thirdrole", "백엔드 리더", None, None),
    ("first", None, None, None),                # 1인칭은 BE 가 evidence_speaker 로 푼다
])
def test_assignee_raw_is_only_a_lookupable_alias(a_type, raw, resolved, expected):
    finding = _finding(assignee_type=a_type, assignee_raw=raw, assignee_resolved=resolved)
    result = _result(category="decision", is_new=True, matched_task_id=None)
    item = to_item(finding, result, _drafted(task="알림 설정 페이지 개발"), None, TRANSCRIPT)
    assert item["assignee_type"] == a_type
    assert item["assignee_raw"] == expected


# ── update ────────────────────────────────────────────────────────────────


def test_update_schedule_keeps_only_changed_due_date():
    item = to_item(_finding(), _result(), _drafted(due_date="2026-10-06"), _target(), TRANSCRIPT)
    assert item["action"] == "update"
    assert item["target_task_id"] == "task_login"
    assert item["task_title"] == "로그인 화면 시안 마무리 작업"  # 표시용 현재 제목
    assert item["due_date"] == "2026-10-06"
    assert item["status"] is None


def test_update_status_is_kept_even_when_category_is_decision():
    # 상태만 바뀌면 Terra 가 category=decision 을 준다 — category 만 보면 status 가 빠진다(#99)
    result = _result(category="decision", status="done")
    item = to_item(_finding(text="로그인 화면 작업을 끝냈다고 보고함"), result, _drafted(), _target(), TRANSCRIPT)
    assert item["status"] == "done"
    assert item["category"] == "decision"


def test_update_with_nothing_changed_is_skipped():
    # 이미 in_progress 인데 in_progress — PM 에게 빈 승인 카드가 뜨지 않게 버린다(#99)
    result = _result(category="decision", status="in_progress")
    assert to_item(_finding(), result, _drafted(), _target(status="in_progress"), TRANSCRIPT) is None


def test_update_same_due_date_is_skipped():
    assert to_item(_finding(), _result(), _drafted(due_date="2026-09-28"), _target(), TRANSCRIPT) is None


def test_update_drops_assignee_outside_assignee_category():
    # 일정 변경 발화에 "지민님"이 섞여 있어도 담당자를 바꾸지 않는다
    finding = _finding(assignee_type="thirdname", assignee_raw="지민님")
    item = to_item(finding, _result(), _drafted(due_date="2026-10-06"), _target(), TRANSCRIPT)
    assert item["assignee_type"] is None
    assert item["assignee_raw"] is None


@pytest.mark.parametrize("a_type, raw", [("thirdname", "지민님"), ("first", None)])
def test_update_assignee_counts_as_change(a_type, raw):
    finding = _finding(assignee_type=a_type, assignee_raw=raw)
    item = to_item(finding, _result(category="assignee"), _drafted(), _target(), TRANSCRIPT)
    assert item is not None
    assert item["assignee_type"] == a_type


def test_update_scope_is_kept_without_field_change():
    # 범위 변경은 담을 Task 필드가 없지만 실제 결정 — 버리면 조용히 사라진다
    item = to_item(_finding(), _result(category="scope"), _drafted(doc_text="소셜 로그인 버튼 제외"), _target(), TRANSCRIPT)
    assert item is not None
    assert item["doc_text"] == "소셜 로그인 버튼 제외"


# ── 입력 오류 ───────────────────────────────────────────────────────────────


def test_rejects_not_meaningful_and_update_without_target():
    with pytest.raises(ValueError):
        to_item(_finding(), _result(is_meaningful=False), _drafted(), _target(), TRANSCRIPT)
    with pytest.raises(ValueError):
        to_item(_finding(), _result(), _drafted(), None, TRANSCRIPT)


def test_evidence_at_ms_is_none_when_seq_not_in_transcript():
    item = to_item(_finding(seq=99), _result(), _drafted(due_date="2026-10-06"), _target(), TRANSCRIPT)
    assert item["evidence_at_ms"] is None
