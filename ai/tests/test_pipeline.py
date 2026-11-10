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
        seq=4, seqs=[3, 4], speaker="uid_haeun", method="llm",
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
        "evidence_speaker": "uid_haeun", "evidence_at_ms": 15500, "evidence_seqs": [3, 4],
    }


@pytest.mark.parametrize("a_type, raw, resolved, expected", [
    ("thirdname", "지민님", None, "지민님"),
    ("thirdpronoun", "그분", "환", "환"),       # 문맥으로 푼 이름을 보낸다
    ("thirdpronoun", "그분", None, None),       # 못 풀었으면 "그분"을 별칭으로 조회시키지 않는다
    ("second", "너", None, None),
    ("thirdrole", "백엔드 리더", None, "백엔드 리더"),
    ("first", None, None, None),                # 1인칭은 BE 가 evidence_speaker 로 푼다
    ("thirdname", "화은님", "하은", "화은님"),  # 이름 지목은 원문만 — 추측한 이름이 별칭으로 학습되지 않게
    ("first", None, "민수", None),              # first 에 섞여 온 resolved 도 보내지 않는다
    ("thirdrole", "백엔드 리더", "환", "백엔드 리더"),  # 역할 지목도 원문만(#522)
])
def test_assignee_raw_is_only_a_lookupable_alias(a_type, raw, resolved, expected):
    finding = _finding(assignee_type=a_type, assignee_raw=raw, assignee_resolved=resolved)
    result = _result(category="decision", is_new=True, matched_task_id=None)
    item = to_item(finding, result, _drafted(task="알림 설정 페이지 개발"), None, TRANSCRIPT)
    assert item["assignee_type"] == a_type
    assert item["assignee_raw"] == expected


@pytest.mark.parametrize("a_type", ["first", "group", "none"])
def test_create_sends_no_assignee_text_for_first_group_none(a_type):
    # 추출기가 "우리" 같은 글자를 채워도 BE 가 별칭으로 조회해 hold 로 돌리지 않게 막는다
    finding = _finding(assignee_type=a_type, assignee_raw="우리")
    item = to_item(finding, _result(category="decision", is_new=True, matched_task_id=None), _drafted(task="알림 설정"), None, TRANSCRIPT)
    assert item["assignee_raw"] is None


def test_update_assignee_uses_the_resolved_name_for_thirdname():
    # 별칭 학습은 create 승인 때뿐이다. 수정 항목은 예전처럼 고친 이름으로 찾는다
    finding = _finding(assignee_type="thirdname", assignee_raw="화은이가", assignee_resolved="하은")
    item = to_item(finding, _result(category="assignee"), _drafted(), _target(), TRANSCRIPT)
    assert item["assignee_raw"] == "하은"


def test_update_assignee_for_thirdrole_prefers_resolved_then_original():
    finding = _finding(assignee_type="thirdrole", assignee_raw="백엔드 리더가", assignee_resolved="환")
    item = to_item(finding, _result(category="assignee"), _drafted(), _target(), TRANSCRIPT)
    assert item["assignee_raw"] == "환"
    finding = _finding(assignee_type="thirdrole", assignee_raw="백엔드 리더가", assignee_resolved=None)
    item = to_item(finding, _result(category="assignee"), _drafted(), _target(), TRANSCRIPT)
    assert item["assignee_raw"] == "백엔드 리더가"


# ── update ────────────────────────────────────────────────────────────────


def test_update_schedule_keeps_only_changed_due_date():
    item = to_item(_finding(), _result(), _drafted(due_date="2026-10-06"), _target(), TRANSCRIPT)
    assert item["action"] == "update"
    assert item["target_task_id"] == "task_login"
    assert item["task_title"] == "로그인 화면 시안 마무리 작업"  # 표시용 현재 제목
    assert item["due_date"] == "2026-10-06"
    assert item["status"] is None


def test_update_carries_target_snapshot_of_all_fields():
    # 마감만 바뀌어도 검색에서 본 값을 다 보낸다 — 승인 때 BE 가 이 값을 기준으로 충돌을 본다(#160)
    target = _target(assignee_member_id="mem_haeun", updated_at="2026-09-27T10:00:00+00:00")
    item = to_item(_finding(), _result(), _drafted(due_date="2026-10-06"), target, TRANSCRIPT)
    assert item["target_snapshot"] == {
        "updated_at": "2026-09-27T10:00:00+00:00",
        "due_date": "2026-09-28",
        "status": "in_progress",
        "assignee_member_id": "mem_haeun",
        "title": "로그인 화면 시안 마무리 작업",  # 확인용 — 제안값에는 제목이 없다(#185)
    }
    assert item["status"] is None  # 제안값은 지금처럼 바뀌는 필드만
    assert item["task_title"] == "로그인 화면 시안 마무리 작업"  # 표시용 제목도 그대로


def test_update_target_snapshot_keeps_null_fields():
    # 마감이 없던 Task — 키를 빼면 BE 가 "안 보냈다"로 읽는다
    target = _target(due_date=None, status=None)
    item = to_item(_finding(), _result(), _drafted(due_date="2026-10-06"), target, TRANSCRIPT)
    assert item["target_snapshot"] == {
        "updated_at": None, "due_date": None, "status": None, "assignee_member_id": None,
        "title": "로그인 화면 시안 마무리 작업",
    }


def test_create_has_no_target_snapshot():
    result = _result(category="decision", is_new=True, matched_task_id=None)
    item = to_item(_finding(), result, _drafted(task="알림 설정 페이지 개발"), None, TRANSCRIPT)
    assert "target_snapshot" not in item


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


# ── run (오케스트레이터) ──────────────────────────────────────────────────────
#
# 세 단계 모두 FakeLLM 을 끼워 실제 파싱 코드까지 거친다. 1단계와 Luna Phase 2 는 같은 Luna 지만
# 모듈마다 get_llm 을 따로 부르므로 FakeLLM 도 따로 둔다.

from dataclasses import replace  # noqa: E402
from datetime import date  # noqa: E402

import draft.doc_draft as doc_draft  # noqa: E402
import judge.asr_check as asr_check  # noqa: E402
import judge.final_judge as final_judge  # noqa: E402
import judge.pipeline as pipeline  # noqa: E402
import judge.semantic_judge as semantic_judge  # noqa: E402
from judge.pipeline import PipelineUnavailableError  # noqa: E402
from judge.pipeline import run as run_pipeline  # noqa: E402
from judge.semantic_judge import FindingExtractionUnavailableError  # noqa: E402
from jev import FakeJev  # noqa: E402
from llm import FakeLLM, NullLLM  # noqa: E402


def run(*args, **kwargs):
    """이 파일의 모든 회의에서 outcomes 가 나간 카드와 실패를 순서대로 정확히 한 번씩 가리키는지 본다(#217).
    채팅 경로는 outcomes 로 만든 항목을 그대로 BE 에 보내므로 어긋나면 카드가 사라지거나 두 번 나간다."""
    out = run_pipeline(*args, **kwargs)
    cards = [o.item for o in out.outcomes if o.kind == "item"]
    failures = [o.failure for o in out.outcomes if o.kind == "failure"]
    assert [id(c) for c in cards] == [id(i) for i in out.items]
    assert [id(f) for f in failures] == [id(f) for f in out.failures]
    return out


MEETING = Transcript(segments=[
    TranscriptSegment(speaker="uid_pm", start=1.0, end=4.0, text="결제 환불 기능은 지민님이 다음 주까지 만들어 주세요.", seq=1),
    TranscriptSegment(speaker="uid_pm", start=5.0, end=8.0, text="로그인 화면 마감 좀 미룰 수 있을까요? 다음 주 화요일로요.", seq=2),
    TranscriptSegment(speaker="uid_haeun", start=8.5, end=9.2, text="네, 알겠습니다.", seq=3),
    TranscriptSegment(speaker="uid_dongwoo", start=10.0, end=12.0, text="검색 개선은 계속 진행 중이에요.", seq=4),
    TranscriptSegment(speaker="uid_pm", start=13.0, end=14.0, text="검색 마감 10월 3일 맞죠?", seq=5),
])
# _flatten 기준 문장 번호: 0 결제 환불 / 1 미룰 수 있을까요 / 2 다음 주 화요일로요 / 3 네 / 4 계속 진행 중 / 5 10월 3일 맞죠

FINDINGS = [
    {"indices": [0], "summary": "결제 환불 기능을 지민님이 다음 주까지 구현하기로 함", "signal": "decision",
     "assignee_type": "thirdname", "assignee_raw": "지민님", "reason": "새 할일"},
    {"indices": [1, 2, 3], "summary": "로그인 화면 마감을 다음 주 화요일로 연기하는 데 동의함", "signal": "decision",
     "assignee_type": "none", "reason": "일정 변경"},
    {"indices": [4], "summary": "검색 개선 작업을 계속 진행 중이라고 보고함", "signal": "progress",
     "assignee_type": "none", "reason": "진척"},
    {"indices": [5], "summary": "검색 마감이 10월 3일인지 확인함", "signal": "decision",
     "assignee_type": "none", "reason": "일정 확인"},
]

LOGIN = NotionCandidate(task_id="task_login", notion_page_id="n1", title="로그인 화면 시안 마무리 작업",
                        due_date="2026-09-28", status="in_progress", similarity=0.82)
SEARCH = NotionCandidate(task_id="task_search", notion_page_id="n6", title="검색 기능 성능 개선",
                         due_date="2026-10-03", status="in_progress", similarity=0.7)


def _terra(**overrides):
    base = {"is_meaningful": True, "category": "decision", "is_new": False,
            "matched_candidate_index": 0, "status": None, "evidence": "근거"}
    base.update(overrides)
    return base


TERRA_OK = [
    _terra(is_new=True, matched_candidate_index=None),              # 결제 환불 → 새 항목
    _terra(category="schedule"),                                     # 로그인 → 마감 변경
    _terra(status="in_progress"),                                    # 검색 → 이미 in_progress (빈 update)
    _terra(is_meaningful=False, category="none", matched_candidate_index=None),  # 확인만 → 버림
]
LUNA_DRAFT_OK = [
    {"task": "결제 환불 기능 구현", "due_date": "2026-10-04", "doc_text": "결제 환불 기능 구현을 지민님이 10/4까지 하기로 함"},
    {"task": None, "due_date": "2026-10-06", "doc_text": "로그인 화면 시안 마무리 작업 마감을 9/28에서 10/6으로 연기"},
    {"task": None, "due_date": None, "doc_text": "검색 기능 성능 개선 진행 중"},
]


class FakeCandidates:
    def __init__(self, fail_on: str | None = None):
        self.fail_on = fail_on
        self.calls: list[tuple[str, str]] = []

    def similar_tasks(self, workspace_id, text):
        self.calls.append((workspace_id, text))
        if self.fail_on and self.fail_on in text:
            raise ConnectionError("BE 연결 실패")
        if "로그인" in text:
            return [LOGIN]
        if "검색" in text:
            return [SEARCH]
        return []


def _install(monkeypatch, *, stage1, terra, luna_draft, jev=()):
    # jev 를 안 주면 근거 검증은 모두 None(확인 못 함 → inferred). 실제 Jev 를 부르지 않게 항상 바꿔 끼운다
    fakes = {"stage1": FakeLLM(responses=[stage1]), "terra": FakeLLM(responses=list(terra)),
             "draft": FakeLLM(responses=list(luna_draft)), "jev": FakeJev(list(jev))}
    monkeypatch.setattr(pipeline, "get_jev", lambda: fakes["jev"])
    monkeypatch.setattr(semantic_judge, "get_llm", lambda which: fakes["stage1"])
    monkeypatch.setattr(final_judge, "get_llm", lambda which: fakes["terra"])
    monkeypatch.setattr(doc_draft, "get_llm", lambda which: fakes["draft"])
    monkeypatch.setattr(pipeline, "get_llm", lambda which: fakes["terra"] if which == "terra" else fakes["draft"])
    return fakes


def _run(source=None):
    return run(MEETING, workspace_id="ws_1", today=date(2026, 9, 28), candidates=source or FakeCandidates())


def test_run_mixed_meeting(monkeypatch):
    fakes = _install(monkeypatch, stage1={"findings": FINDINGS}, terra=TERRA_OK, luna_draft=LUNA_DRAFT_OK)
    source = FakeCandidates()

    out = _run(source)

    assert [(i["action"], i["target_task_id"]) for i in out.items] == [("create", None), ("update", "task_login")]
    create, update = out.items
    assert create["task_title"] == "결제 환불 기능 구현"
    assert create["assignee_raw"] == "지민님"
    assert update["due_date"] == "2026-10-06"
    assert update["evidence_quote"] == "네, 알겠습니다."
    assert update["evidence_speaker"] == "uid_haeun"
    assert out.failures == []
    # 유사 검색 쿼리는 1단계 요약문 — finding 마다 한 번
    assert [text for _, text in source.calls] == [f["summary"] for f in FINDINGS]
    # 버린 finding(is_meaningful=False)은 Luna 를 부르지 않는다
    assert len(fakes["draft"].prompts) == 3


def test_run_terra_failure_skips_only_that_finding(monkeypatch):
    terra = [TERRA_OK[0], {"is_meaningful": "모름"}, {"is_meaningful": "모름"}, *TERRA_OK[2:]]  # 로그인만 다시 해도 실패
    _install(monkeypatch, stage1={"findings": FINDINGS}, terra=terra, luna_draft=[LUNA_DRAFT_OK[0], LUNA_DRAFT_OK[2]])

    out = _run()

    assert [i["action"] for i in out.items] == ["create"]
    assert [(f.stage, f.finding_text) for f in out.failures] == [("judge", FINDINGS[1]["summary"])]


def test_run_similar_search_failure_is_recorded(monkeypatch):
    _install(monkeypatch, stage1={"findings": FINDINGS[:2]}, terra=[TERRA_OK[0]], luna_draft=[LUNA_DRAFT_OK[0]])

    out = _run(FakeCandidates(fail_on="로그인"))

    assert [i["action"] for i in out.items] == ["create"]
    assert out.failures[0].stage == "similar"
    assert "ConnectionError" in out.failures[0].reason


def test_run_carries_stage1_drop_counts(monkeypatch):
    # 1단계에서 탈락한 항목 수가 결과에 실려 회의 기록까지 갈 수 있다(#186)
    _install(monkeypatch, stage1={"findings": [FINDINGS[1], {"indices": [99]}, "x"]}, terra=[TERRA_OK[1]],
             luna_draft=[LUNA_DRAFT_OK[1]])

    out = _run()

    # lines 는 발화가 아니라 근거 번호를 매긴 문장 수다 — 발화 5개 중 하나가 두 문장이라 6
    assert out.dropped == {"not_dict": 1, "no_valid_indices": 1, "bad_indices": [[99]], "bad_indices_total": 1, "lines": 6}
    assert len(out.items) == 1


def test_run_draft_failure_is_recorded(monkeypatch):
    _install(monkeypatch, stage1={"findings": FINDINGS[:2]}, terra=TERRA_OK[:2],
             luna_draft=[LUNA_DRAFT_OK[0], {"task": None, "due_date": None}])  # doc_text 없음

    out = _run()

    assert [i["action"] for i in out.items] == ["create"]
    assert [f.stage for f in out.failures] == ["draft"]


def test_run_schedule_update_with_unusable_due_date_is_draft_failure(monkeypatch):
    # Luna 가 없는 날짜("2026-10-40")를 주면 항목이 조용히 사라지지 않고 draft 실패로 남는다
    _install(monkeypatch, stage1={"findings": [FINDINGS[1]]}, terra=[TERRA_OK[1]],
             luna_draft=[{"task": None, "due_date": "2026-10-40", "doc_text": "로그인 화면 마감을 연기"}])

    out = _run()

    assert out.items == []
    assert [f.stage for f in out.failures] == ["draft"]


def test_run_update_without_task_id_is_target_failure(monkeypatch):
    # Notion 에만 있는(task_id 없는) 후보를 골랐을 때 — 수정할 Task 가 없다
    notion_only = NotionCandidate(task_id=None, notion_page_id="n7", title="로그인 화면 시안 마무리 작업", similarity=0.8)

    class NotionOnly(FakeCandidates):
        def similar_tasks(self, workspace_id, text):
            return [notion_only]

    _install(monkeypatch, stage1={"findings": [FINDINGS[1]]}, terra=[TERRA_OK[1]], luna_draft=[])

    out = _run(NotionOnly())

    assert out.items == []
    assert [f.stage for f in out.failures] == ["target"]


def test_run_stage1_failure_fails_whole_meeting(monkeypatch):
    fakes = _install(monkeypatch, stage1=None, terra=TERRA_OK, luna_draft=LUNA_DRAFT_OK)
    with pytest.raises(FindingExtractionUnavailableError):
        _run()
    assert fakes["terra"].prompts == []


def test_run_missing_key_fails_before_any_call(monkeypatch):
    fakes = _install(monkeypatch, stage1={"findings": FINDINGS}, terra=TERRA_OK, luna_draft=LUNA_DRAFT_OK)
    monkeypatch.setattr(pipeline, "get_llm", lambda which: NullLLM() if which == "terra" else fakes["draft"])
    source = FakeCandidates()

    with pytest.raises(PipelineUnavailableError, match="terra"):
        _run(source)
    assert fakes["stage1"].prompts == []
    assert source.calls == []


# ── 같은 회의 안 중복 · 번복 (#140) ─────────────────────────────────────────
# run() 이 이번 회의에서 앞서 만든 카드를 기억해 다음 finding 의 후보에 보여 주고, Terra 가 그 후보를 고르면
# 새 카드를 만들지 않고 합친다. 가짜 Terra 는 정해 둔 답을 내므로, "기억한 후보가 Terra 에게 보였는지"는
# 프롬프트로, "합쳤는지"는 결과로 확인한다.

DEDUP_MEETING = Transcript(segments=[
    TranscriptSegment(speaker="uid_pm", start=1.0, end=3.0, text="결제 환불 기능은 지민님이 맡아 주세요.", seq=1),
    TranscriptSegment(speaker="uid_pm", start=4.0, end=6.0, text="그 환불 기능은 다음 주 금요일까지 해 주세요.", seq=2),
    TranscriptSegment(speaker="uid_pm", start=7.0, end=9.0, text="로그인 화면 마감 다음 주 화요일로 미뤄도 될까요?", seq=3),
    TranscriptSegment(speaker="uid_haeun", start=9.5, end=10.0, text="네, 그렇게 해요.", seq=4),
    TranscriptSegment(speaker="uid_pm", start=11.0, end=13.0, text="아 QA 일정 때문에 로그인 마감은 원래대로 둡시다.", seq=5),
    TranscriptSegment(speaker="uid_pm", start=14.0, end=15.0, text="환불 기능 담당은 지민님 맞죠?", seq=6),
    TranscriptSegment(speaker="uid_jimin", start=15.5, end=16.0, text="네, 맞아요.", seq=7),
    TranscriptSegment(speaker="uid_pm", start=17.0, end=19.0, text="알림 설정 페이지도 새로 만들어야 해요.", seq=8),
])
# 문장 번호: 0 환불 담당 / 1 환불 마감 / 2 로그인 미룰까요 / 3 네 / 4 원래대로 / 5 환불 담당 맞죠 / 6 네 맞아요 /
# 7 알림 설정(DB 에 없는 새 주제)

REFUND_OWNER = {"indices": [0], "summary": "결제 환불 기능을 지민님이 맡기로 함",
                "assignee_type": "thirdname", "assignee_raw": "지민님", "reason": "새 할일"}
REFUND_DUE = {"indices": [1], "summary": "결제 환불 기능 마감을 다음 주 금요일로 정함",
              "assignee_type": "none", "reason": "마감"}
LOGIN_DELAY = {"indices": [2, 3], "summary": "로그인 화면 마감을 다음 주 화요일로 미루기로 함",
               "assignee_type": "none", "reason": "일정 변경"}
LOGIN_KEEP = {"indices": [4], "summary": "로그인 화면 마감을 원래대로 두기로 함",
              "assignee_type": "none", "reason": "일정 번복"}
# 재언급 근거에는 마감 얘기가 없다 — 마감 문장을 근거로 잡으면 Luna 가 마감을 끌어와 재언급이 아니게 된다
REFUND_RESTATE = {"indices": [5, 6], "summary": "결제 환불 기능 담당이 지민님이 맞다고 다시 확인함",
                  "assignee_type": "thirdname", "assignee_raw": "지민님", "reason": "재확인"}
# DB 의 로그인 · 검색 Task 와 겹치지 않는 주제 — 겹치면 Terra 가 기존 Task 수정으로 본다
NOTI_NEW = {"indices": [7], "summary": "알림 설정 페이지를 새로 만들기로 함",
            "assignee_type": "none", "reason": "새 할일"}

LOGIN_FRI = NotionCandidate(task_id="task_login", notion_page_id="n1", title="로그인 화면 시안 마무리 작업",
                            due_date="2026-10-02", status="in_progress", assignee_member_id="mem_haeun",
                            similarity=0.82)


class DedupCandidates:
    """DB 에는 로그인 · 검색 Task 만 있다. 환불은 이번 회의에서 처음 나온 일이라 DB 에 없다."""

    def similar_tasks(self, workspace_id, text):
        if "로그인" in text:
            return [LOGIN_FRI]
        if "검색" in text:
            return [SEARCH]
        return []


def _run_dedup():
    return run(DEDUP_MEETING, workspace_id="ws_1", today=date(2026, 9, 28), candidates=DedupCandidates())


def test_same_new_item_twice_becomes_one_card(monkeypatch):
    # 14:05 담당 → 14:20 마감. 두 번째를 판단할 때 첫 카드가 "이번 회의 후보"로 보여야 하고, 고르면 합친다
    fakes = _install(
        monkeypatch, stage1={"findings": [REFUND_OWNER, REFUND_DUE]},
        terra=[_terra(is_new=True, matched_candidate_index=None), _terra(category="schedule")],
        luna_draft=[
            {"task": "결제 환불 기능 구현", "due_date": None, "doc_text": "결제 환불 기능 구현을 지민님이 맡기로 함"},
            {"task": None, "due_date": "2026-10-09", "doc_text": "결제 환불 기능 마감을 10/9로 정함"},
        ],
    )

    out = _run_dedup()

    assert "이번 회의에서 새로 나온 항목" in fakes["terra"].prompts[1]
    assert out.failures == []
    assert len(out.items) == 1
    card = out.items[0]
    assert card["action"] == "create"
    assert card["task_title"] == "결제 환불 기능 구현"   # 제목은 앞 카드
    assert card["assignee_raw"] == "지민님"               # 담당은 앞 카드에서
    assert card["due_date"] == "2026-10-09"              # 마감은 뒤 발화에서
    assert "맡기로" in card["doc_text"] and "10/9" in card["doc_text"]


OWNER_MEETING = Transcript(segments=[
    TranscriptSegment(speaker="uid_alice", start=1.0, end=3.0, text="결제 환불 기능 만들어야 해요.", seq=1),
    TranscriptSegment(speaker="uid_bob", start=4.0, end=5.0, text="그건 제가 맡을게요.", seq=2),
    TranscriptSegment(speaker="uid_carol", start=6.0, end=7.0, text="환불 기능은 금요일까지 해 주세요.", seq=3),
])
REFUND_NEW = {"indices": [0], "summary": "결제 환불 기능을 만들기로 함", "assignee_type": "first", "reason": "새 할일"}
REFUND_BOB = {"indices": [1], "summary": "결제 환불 기능을 Bob 이 맡기로 함", "assignee_type": "first", "reason": "담당"}
REFUND_FRI = {"indices": [2], "summary": "결제 환불 기능 마감을 금요일로 정함", "assignee_type": "none", "reason": "마감"}


def _run_owner(monkeypatch, findings, terra, luna):
    _install(monkeypatch, stage1={"findings": findings}, terra=terra, luna_draft=luna)
    return run(OWNER_MEETING, workspace_id="ws_1", today=date(2026, 9, 28), candidates=DedupCandidates())


def test_new_card_merge_keeps_the_original_thirdname_mention(monkeypatch):
    # 새 할 일 카드에 담당 발화를 합쳐도 원문 언급이 간다(create 승인 때 BE 가 별칭을 배운다)
    who = {"indices": [1], "summary": "결제 환불 기능을 화은이가 맡기로 함", "assignee_type": "thirdname",
           "assignee_raw": "화은이가", "assignee_resolved": "하은", "reason": "담당"}
    out = _run_owner(
        monkeypatch, [REFUND_NEW, who],
        [_terra(is_new=True, matched_candidate_index=None), _terra(category="assignee")],
        [{"task": "결제 환불 기능 구현", "due_date": None, "doc_text": "결제 환불 기능 구현"},
         {"task": None, "due_date": None, "doc_text": "화은이 담당"}],
    )

    (card,) = out.items
    assert card["action"] == "create"
    assert card["assignee_raw"] == "화은이가"


def test_new_card_merge_keeps_the_original_thirdrole_mention(monkeypatch):
    # 역할 지목도 새 할 일 카드에서는 원문이 간다(#522)
    who = {"indices": [1], "summary": "결제 환불 기능을 백엔드 리더가 맡기로 함", "assignee_type": "thirdrole",
           "assignee_raw": "백엔드 리더가", "assignee_resolved": "환", "reason": "담당"}
    out = _run_owner(
        monkeypatch, [REFUND_NEW, who],
        [_terra(is_new=True, matched_candidate_index=None), _terra(category="assignee")],
        [{"task": "결제 환불 기능 구현", "due_date": None, "doc_text": "결제 환불 기능 구현"},
         {"task": None, "due_date": None, "doc_text": "백엔드 리더 담당"}],
    )

    (card,) = out.items
    assert card["action"] == "create"
    assert card["assignee_raw"] == "백엔드 리더가"


def test_assignee_change_card_sends_the_resolved_name(monkeypatch):
    # 기존 Task 의 담당자 변경은 별칭을 배우지 않는다 — 예전처럼 고친 이름으로 찾는다
    due = {"indices": [0], "summary": "로그인 화면 마감을 금요일로 정함", "assignee_type": "none", "reason": "마감"}
    who = {"indices": [1], "summary": "로그인 화면 담당을 화은이가 맡기로 함", "assignee_type": "thirdname",
           "assignee_raw": "화은이가", "assignee_resolved": "하은", "reason": "담당"}
    out = _run_owner(
        monkeypatch, [due, who],
        [_terra(category="schedule"), _terra(category="assignee")],
        [{"task": None, "due_date": "2026-10-02", "doc_text": "마감 변경"},
         {"task": None, "due_date": None, "doc_text": "담당 변경"}],
    )

    (card,) = out.items
    assert card["action"] == "update"
    assert card["assignee_raw"] == "하은"


def test_merged_assignee_carries_the_speaker_who_took_it(monkeypatch):
    # Alice 카드에 Bob 의 "제가 맡을게요" 를 합치면 BE 는 evidence_speaker 로 Bob 을 찾아야 한다
    out = _run_owner(
        monkeypatch, [REFUND_NEW, REFUND_BOB],
        [_terra(is_new=True, matched_candidate_index=None), _terra(category="assignee")],
        [{"task": "결제 환불 기능 구현", "due_date": None, "doc_text": "결제 환불 기능 구현"},
         {"task": None, "due_date": None, "doc_text": "Bob 이 맡기로 함"}],
    )

    card = out.items[0]
    assert card["assignee_type"] == "first"
    assert card["evidence_speaker"] == "uid_bob"
    assert card["evidence_quote"] == "그건 제가 맡을게요."
    assert card["evidence_at_ms"] == 4000


def test_later_due_date_keeps_the_assignee_evidence(monkeypatch):
    # 담당을 정한 뒤 다른 사람이 마감을 말해도 담당자 근거는 그대로다
    out = _run_owner(
        monkeypatch, [REFUND_NEW, REFUND_BOB, REFUND_FRI],
        [_terra(is_new=True, matched_candidate_index=None), _terra(category="assignee"), _terra(category="schedule")],
        [{"task": "결제 환불 기능 구현", "due_date": None, "doc_text": "결제 환불 기능 구현"},
         {"task": None, "due_date": None, "doc_text": "Bob 이 맡기로 함"},
         {"task": None, "due_date": "2026-10-02", "doc_text": "마감을 10/2 로 정함"}],
    )

    card = out.items[0]
    assert card["due_date"] == "2026-10-02"
    assert card["evidence_speaker"] == "uid_bob"
    assert card["evidence_quote"] == "그건 제가 맡을게요."


def test_evidence_seqs_are_segment_seqs_not_sentence_positions(monkeypatch):
    # 근거 문장 번호 1, 2 는 seq 2 한 발화에서, 3 은 seq 3 에서 나온다
    _install(monkeypatch, stage1={"findings": FINDINGS[1:2]}, terra=[_terra(category="schedule")],
             luna_draft=[{"task": None, "due_date": "2026-10-06", "doc_text": "마감 연기"}])

    out = run(MEETING, workspace_id="ws_1", today=date(2026, 9, 28), candidates=FakeCandidates())

    assert out.items[0]["evidence_seqs"] == [2, 3]


def test_merged_card_keeps_every_evidence_seq(monkeypatch):
    out = _run_owner(
        monkeypatch, [{**REFUND_NEW, "assignee_type": "none"}, {**REFUND_BOB, "assignee_type": "none"}, REFUND_FRI],
        [_terra(is_new=True, matched_candidate_index=None), _terra(category="assignee"), _terra(category="schedule")],
        [{"task": "결제 환불 기능 구현", "due_date": None, "doc_text": "결제 환불 기능 구현"},
         {"task": None, "due_date": None, "doc_text": "Bob 이 맡기로 함"},
         {"task": None, "due_date": "2026-10-02", "doc_text": "마감을 10/2 로 정함"}],
    )

    assert out.items[0]["evidence_seqs"] == [1, 2, 3]


def test_first_person_without_speaker_does_not_take_a_later_seq(monkeypatch):
    # 화자가 없으면 BE 는 가장 큰 seq 의 화자로 찾는다. 뒤에 마감을 말한 사람이 담당자가 되면 안 된다
    meeting = Transcript(segments=[
        TranscriptSegment(speaker=None, start=1.0, end=3.0, text="결제 환불 기능 제가 만들게요.", seq=1),
        TranscriptSegment(speaker="uid_carol", start=4.0, end=5.0, text="환불 기능은 금요일까지 해 주세요.", seq=2),
    ])
    _install(
        monkeypatch,
        stage1={"findings": [{"indices": [0], "summary": "결제 환불 기능을 맡기로 함", "assignee_type": "first", "reason": "담당"},
                             {"indices": [1], "summary": "결제 환불 기능 마감을 금요일로 정함", "assignee_type": "none", "reason": "마감"}]},
        terra=[_terra(is_new=True, matched_candidate_index=None), _terra(category="schedule")],
        luna_draft=[{"task": "결제 환불 기능 구현", "due_date": None, "doc_text": "결제 환불 기능 구현"},
                    {"task": None, "due_date": "2026-10-02", "doc_text": "마감을 10/2 로 정함"}],
    )

    out = run(meeting, workspace_id="ws_1", today=date(2026, 9, 28), candidates=DedupCandidates())

    assert out.items[0]["evidence_speaker"] is None
    assert out.items[0]["evidence_seqs"] == [1]


def test_first_person_of_an_upload_label_does_not_take_a_later_seq(monkeypatch):
    # 업로드는 인계 때 라벨을 지운다. 외부 참석자면 BE 가 가장 큰 seq 의 화자로 찾아, 마감을 말한 팀원이 담당자가 된다
    meeting = Transcript(segments=[
        TranscriptSegment(speaker="SPEAKER_00", start=1.0, end=3.0, text="결제 환불 기능 제가 만들게요.", seq=1),
        TranscriptSegment(speaker="SPEAKER_01", start=4.0, end=5.0, text="환불 기능은 금요일까지 해 주세요.", seq=2),
    ])
    _install(
        monkeypatch,
        stage1={"findings": [{"indices": [0], "summary": "결제 환불 기능을 맡기로 함", "assignee_type": "first", "reason": "담당"},
                             {"indices": [1], "summary": "결제 환불 기능 마감을 금요일로 정함", "assignee_type": "none", "reason": "마감"}]},
        terra=[_terra(is_new=True, matched_candidate_index=None), _terra(category="schedule")],
        luna_draft=[{"task": "결제 환불 기능 구현", "due_date": None, "doc_text": "결제 환불 기능 구현"},
                    {"task": None, "due_date": "2026-10-02", "doc_text": "마감을 10/2 로 정함"}],
    )

    out = run(meeting, workspace_id="ws_1", today=date(2026, 9, 28), candidates=DedupCandidates())

    assert out.items[0]["evidence_speaker"] == "SPEAKER_00"
    assert out.items[0]["evidence_seqs"] == [1]


def test_evidence_seqs_stay_within_the_be_limit():
    # BE 는 항목 하나에 seq 가 100개를 넘으면 요청 전체를 400 으로 막는다. 결론에 가까운 뒤쪽을 남긴다
    item = to_item(_finding(seqs=list(range(150))), _result(), _drafted(due_date="2026-10-06"), _target(), TRANSCRIPT)

    assert item["evidence_seqs"] == list(range(50, 150))


def test_different_new_items_stay_separate(monkeypatch):
    _install(
        monkeypatch, stage1={"findings": [REFUND_OWNER, NOTI_NEW]},
        terra=[_terra(is_new=True, matched_candidate_index=None), _terra(is_new=True, matched_candidate_index=None)],
        luna_draft=[
            {"task": "결제 환불 기능 구현", "due_date": None, "doc_text": "결제 환불 기능 구현"},
            {"task": "알림 설정 페이지 개발", "due_date": None, "doc_text": "알림 설정 페이지 개발"},
        ],
    )

    out = _run_dedup()

    assert [i["task_title"] for i in out.items] == ["결제 환불 기능 구현", "알림 설정 페이지 개발"]


def test_restating_the_same_new_item_is_dropped(monkeypatch):
    # 같은 내용을 다시 말함 — Terra 가 앞 카드를 고르고 바뀌는 것 없음으로 본다
    fakes = _install(
        monkeypatch, stage1={"findings": [REFUND_OWNER, REFUND_RESTATE]},
        terra=[_terra(is_new=True, matched_candidate_index=None),
               _terra(is_meaningful=False, category="none")],
        luna_draft=[{"task": "결제 환불 기능 구현", "due_date": None, "doc_text": "결제 환불 기능 구현"}],
    )

    out = _run_dedup()

    assert "이번 회의에서 새로 나온 항목" in fakes["terra"].prompts[1]
    assert len(out.items) == 1


def test_reversed_change_in_same_meeting_leaves_no_card(monkeypatch):
    # DB 마감 10/2(금). "10/6 으로 미루자" → "원래대로 두자". 두 번째를 판단할 때 후보가 앞의 제안(10/6)으로
    # 보여야 하고, 합친 결과(10/2)가 DB 와 같아 남는 변경이 없으면 카드를 버린다
    fakes = _install(
        monkeypatch, stage1={"findings": [LOGIN_DELAY, LOGIN_KEEP]},
        terra=[_terra(category="schedule"), _terra(category="schedule")],
        luna_draft=[
            {"task": None, "due_date": "2026-10-06", "doc_text": "로그인 화면 마감을 10/2에서 10/6으로 연기"},
            {"task": None, "due_date": "2026-10-02", "doc_text": "로그인 화면 마감을 10/6에서 10/2로 되돌림"},
        ],
    )

    out = _run_dedup()

    second = fakes["terra"].prompts[1]
    assert "2026-10-06" in second and "이번 회의" in second   # 앞의 제안이 반영돼 보인다
    assert out.items == []
    assert out.failures == []



class NoDueCandidates:
    """로그인 Task 에 원래 마감이 없다."""

    def similar_tasks(self, workspace_id, text):
        return [replace(LOGIN_FRI, due_date=None)] if "로그인" in text else []


def test_reverting_to_no_due_in_same_meeting_leaves_no_card(monkeypatch):
    # 원래 마감 없음. "10/16 까지" → "취소하고 원래처럼 미정으로". Luna 는 되돌릴 값이 없어 "none" 을 낸다.
    # 전에는 Luna 의 null 이 초안 실패가 되어 10/16 제안이 남았다(멘토 리뷰 #230)
    fakes = _install(
        monkeypatch, stage1={"findings": [LOGIN_DELAY, LOGIN_KEEP]},
        terra=[_terra(category="schedule"), _terra(category="schedule")],
        luna_draft=[
            {"task": None, "due_date": "2026-10-16", "doc_text": "로그인 화면 마감을 10/16으로 정함"},
            {"task": None, "due_date": "none", "doc_text": "로그인 화면 마감을 다시 미정으로 되돌림"},
        ],
    )

    out = run(DEDUP_MEETING, workspace_id="ws_1", today=date(2026, 9, 28), candidates=NoDueCandidates())

    assert "마감을 없음 → 2026-10-16" in fakes["terra"].prompts[1]   # 원래 값이 "없음"으로 보인다
    assert out.items == []
    assert out.failures == []


def test_clearing_an_existing_due_is_an_update_card_with_due_cleared(monkeypatch):
    # 원래 마감(10/2)이 있는 Task 의 마감을 없애자는 결정. BE 는 due_date=null 을 "바꾸지 않음"으로 받으므로
    # due_cleared 로 따로 보낸다. 전에는 보낼 칸이 없어 실패로 남았고, 회의 전체 재시도만 불렀다(#624)
    _install(
        monkeypatch, stage1={"findings": [LOGIN_KEEP]}, terra=[_terra(category="schedule")],
        luna_draft=[{"task": None, "due_date": "none", "doc_text": "로그인 화면 마감을 10/2에서 미정으로 변경"}],
    )

    out = _run_dedup()

    assert out.failures == []
    (card,) = out.items
    assert (card["action"], card["target_task_id"], card["due_date"], card["due_cleared"]) == (
        "update", "task_login", None, True)
    assert card["target_snapshot"]["due_date"] == "2026-10-02"


def test_clearing_a_due_that_was_never_set_still_says_so(monkeypatch):
    # 원래 마감이 있는지는 BE 가 등록 시점 값으로 다시 본다(없으면 승인 요청을 만들지 않는다). AI 는 결정을 그대로
    # 싣는다. 그래야 답장 판단이 후보 수와 상관없이 같은 알림을 낸다(#624 리뷰)
    _install(
        monkeypatch, stage1={"findings": [LOGIN_KEEP]}, terra=[_terra(category="schedule")],
        luna_draft=[{"task": None, "due_date": "none", "doc_text": "로그인 화면 마감은 미정"}],
    )

    out = run(DEDUP_MEETING, workspace_id="ws_1", today=date(2026, 9, 28), candidates=NoDueCandidates())

    assert out.failures == []
    (card,) = out.items
    assert (card["due_date"], card["due_cleared"]) == (None, True)


def test_a_proposed_due_then_cleared_in_the_same_meeting_clears_the_existing_due(monkeypatch):
    # 10/2 인 Task 를 10/6 으로 미루자고 했다가 "날짜는 아직 못 정하겠다". 카드는 하나, 마감은 없앰
    _install(
        monkeypatch, stage1={"findings": [LOGIN_DELAY, LOGIN_KEEP]},
        terra=[_terra(category="schedule"), _terra(category="schedule")],
        luna_draft=[
            {"task": None, "due_date": "2026-10-06", "doc_text": "로그인 화면 마감을 10/6으로 연기"},
            {"task": None, "due_date": "none", "doc_text": "로그인 화면 마감을 미정으로"},
        ],
    )

    (card,) = _run_dedup().items
    assert (card["due_date"], card["due_cleared"]) == (None, True)


def test_a_cleared_due_then_dated_again_keeps_the_new_date(monkeypatch):
    fakes = _install(
        monkeypatch, stage1={"findings": [LOGIN_DELAY, LOGIN_KEEP]},
        terra=[_terra(category="schedule"), _terra(category="schedule")],
        luna_draft=[
            {"task": None, "due_date": "none", "doc_text": "로그인 화면 마감을 미정으로"},
            {"task": None, "due_date": "2026-10-08", "doc_text": "로그인 화면 마감을 10/8로"},
        ],
    )

    (card,) = _run_dedup().items
    assert "마감을 2026-10-02 → 없음" in fakes["terra"].prompts[1]   # 뒤 발화를 판단할 때 앞의 해제가 보인다
    assert card["due_date"] == "2026-10-08" and not card.get("due_cleared")


def test_changed_again_in_same_meeting_keeps_last_value(monkeypatch):
    # 10/2 → 10/6 → 10/7. 카드는 하나, 마감은 마지막 값. 스냅샷은 덮어 보여 준 값이 아니라 DB 원래 값
    _install(
        monkeypatch, stage1={"findings": [LOGIN_DELAY, LOGIN_KEEP]},
        terra=[_terra(category="schedule"), _terra(category="schedule")],
        luna_draft=[
            {"task": None, "due_date": "2026-10-06", "doc_text": "로그인 화면 마감을 10/6으로 연기"},
            {"task": None, "due_date": "2026-10-07", "doc_text": "로그인 화면 마감을 다시 10/7로 조정"},
        ],
    )

    out = _run_dedup()

    assert len(out.items) == 1
    card = out.items[0]
    assert (card["action"], card["target_task_id"], card["due_date"]) == ("update", "task_login", "2026-10-07")
    assert card["target_snapshot"]["due_date"] == "2026-10-02"
    assert card["evidence_quote"] == "네, 그렇게 해요."   # 근거는 앞 카드


def test_updates_to_different_tasks_are_not_merged(monkeypatch):
    search_done = {"indices": [4], "summary": "검색 기능 성능 개선을 끝냈다고 보고함",
                   "assignee_type": "none", "reason": "진척"}
    _install(
        monkeypatch, stage1={"findings": [LOGIN_DELAY, search_done]},
        terra=[_terra(category="schedule"), _terra(category="status", status="done")],
        luna_draft=[
            {"task": None, "due_date": "2026-10-06", "doc_text": "로그인 화면 마감을 10/6으로 연기"},
            {"task": None, "due_date": None, "doc_text": "검색 기능 성능 개선 완료"},
        ],
    )

    out = _run_dedup()

    assert [i["target_task_id"] for i in out.items] == ["task_login", "task_search"]


def test_findings_are_handled_in_meeting_order(monkeypatch):
    # 1단계가 순서를 섞어 줘도 회의 순서(seq)대로 판단해야 "나중에 말한 것이 최신"이 맞는다
    _install(
        monkeypatch, stage1={"findings": [LOGIN_KEEP, LOGIN_DELAY]},
        terra=[_terra(category="schedule"), _terra(category="schedule")],
        luna_draft=[
            {"task": None, "due_date": "2026-10-06", "doc_text": "로그인 화면 마감을 10/6으로 연기"},
            {"task": None, "due_date": "2026-10-02", "doc_text": "로그인 화면 마감을 10/2로 되돌림"},
        ],
    )

    out = _run_dedup()

    assert out.items == []


def test_merged_description_is_not_cut(monkeypatch):
    # 합친 설명을 300자(Luna 한 문장 상한)로 자르면 맨 뒤의 최신 결정부터 잘린다(PR #206 리뷰)
    long_owner = "결제 환불 기능 구현을 지민님이 맡기로 함. " + "카드 결제만 먼저 지원한다. " * 20
    _install(
        monkeypatch, stage1={"findings": [REFUND_OWNER, REFUND_DUE]},
        terra=[_terra(is_new=True, matched_candidate_index=None), _terra(category="schedule")],
        luna_draft=[
            {"task": "결제 환불 기능 구현", "due_date": None, "doc_text": long_owner},
            {"task": None, "due_date": "2026-10-09", "doc_text": "결제 환불 기능 마감을 10/9로 정함"},
        ],
    )

    out = _run_dedup()

    assert out.items[0]["doc_text"].endswith("결제 환불 기능 마감을 10/9로 정함")


class MissesEditedTask(DedupCandidates):
    """Task 이름 없이 오는 짧은 발화는 검색에 앞서 수정한 Task 가 안 나온다."""

    def similar_tasks(self, workspace_id, text):
        return [] if "원래대로" in text else super().similar_tasks(workspace_id, text)


def test_reverting_is_caught_even_when_search_misses_the_task(monkeypatch):
    # 수정 카드는 검색 결과와 상관없이 후보에 보여야 번복을 알아본다(PR #206 리뷰)
    keep_short = LOGIN_KEEP | {"summary": "마감은 원래대로 두기로 함"}
    fakes = _install(
        monkeypatch, stage1={"findings": [LOGIN_DELAY, keep_short]},
        terra=[_terra(category="schedule"), _terra(category="schedule")],
        luna_draft=[
            {"task": None, "due_date": "2026-10-06", "doc_text": "로그인 화면 마감을 10/2에서 10/6으로 연기"},
            {"task": None, "due_date": "2026-10-02", "doc_text": "로그인 화면 마감을 10/6에서 10/2로 되돌림"},
        ],
    )

    out = run(DEDUP_MEETING, workspace_id="ws_1", today=date(2026, 9, 28), candidates=MissesEditedTask())

    assert "2026-10-02 → 2026-10-06" in fakes["terra"].prompts[1]
    assert out.items == []


def test_scope_merged_into_a_change_goes_as_scope_with_the_change(monkeypatch):
    scope = {"indices": [3], "summary": "로그인 화면에서 소셜 로그인은 이번 버전에서 빼기로 함",
             "assignee_type": "none", "reason": "범위"}
    _install(
        monkeypatch, stage1={"findings": [LOGIN_DELAY, scope]},
        terra=[_terra(category="schedule"), _terra(category="scope")],
        luna_draft=[
            {"task": None, "due_date": "2026-10-06", "doc_text": "로그인 화면 마감을 10/2에서 10/6으로 연기"},
            {"task": None, "due_date": None, "doc_text": "소셜 로그인은 이번 버전 범위에서 제외"},
        ],
    )

    (card,) = _run_dedup().items

    assert (card["category"], card["due_date"]) == ("scope", "2026-10-06")


def test_scope_decision_survives_when_schedule_is_reverted(monkeypatch):
    # 마감 변경 → 같은 Task 범위 결정 → 마감 원래대로. 마감은 지워져도 범위 결정은 남아야 하고,
    # 필드 없는 결정이라 BE 가 받도록 category 를 scope 로(PR #206 리뷰)
    scope = {"indices": [3], "summary": "로그인 화면에서 소셜 로그인은 이번 버전에서 빼기로 함",
             "assignee_type": "none", "reason": "범위"}
    _install(
        monkeypatch, stage1={"findings": [LOGIN_DELAY, scope, LOGIN_KEEP]},
        terra=[_terra(category="schedule"), _terra(category="scope"), _terra(category="schedule")],
        luna_draft=[
            {"task": None, "due_date": "2026-10-06", "doc_text": "로그인 화면 마감을 10/2에서 10/6으로 연기"},
            {"task": None, "due_date": None, "doc_text": "소셜 로그인은 이번 버전 범위에서 제외"},
            {"task": None, "due_date": "2026-10-02", "doc_text": "로그인 화면 마감을 10/6에서 10/2로 되돌림"},
        ],
    )

    out = _run_dedup()

    assert len(out.items) == 1
    card = out.items[0]
    assert (card["category"], card["due_date"]) == ("scope", None)
    assert "소셜 로그인" in card["doc_text"]


# ── 근거 상태 · 유사 검색 값 (이슈 #232) ───────────────────────────────────

class ListCandidates:
    """검색 결과를 그대로 돌려준다."""

    def __init__(self, found):
        self.found = found

    def similar_tasks(self, workspace_id, text):
        return list(self.found)


def _one_line_meeting(*texts):
    return Transcript(segments=[
        TranscriptSegment(speaker="uid_pm", start=1.0 + 3 * i, end=3.0 + 3 * i, text=t, seq=i + 1)
        for i, t in enumerate(texts)])


def _stage1(*indices, summary="결제 환불 기능 담당과 마감을 정함"):
    return {"indices": list(indices), "summary": summary, "assignee_type": "none", "reason": "새 할일"}


def _sim(similarity):
    return replace(SEARCH, similarity=similarity)


NEW = _terra(is_new=True, matched_candidate_index=None)


def _jev(task_yes, due_yes=None):
    """Jev answers. yes 확률만 정한다."""
    out = {"task": {"choice": "yes", "probabilities": {"yes": task_yes, "no": 1 - task_yes, "unclear": 0.0}}}
    if due_yes is not None:
        out["due"] = {"choice": "yes", "probabilities": {"yes": due_yes, "no": 1 - due_yes, "unclear": 0.0}}
    return out


def test_run_create_carries_evidence_and_similar_values(monkeypatch):
    meeting = _one_line_meeting("그건 제가 이번 주 금요일까지 할게요.")
    fakes = _install(monkeypatch, stage1={"findings": [_stage1(0)]}, terra=[NEW],
                     luna_draft=[{"task": "환불 구현", "due_date": "2026-10-02", "due_raw": "이번 주 금요일까지",
                                  "doc_text": "환불 구현을 10/2까지"}],
                     jev=[_jev(0.95, 0.9)])

    out = run(meeting, workspace_id="ws_1", today=date(2026, 9, 28),
              candidates=ListCandidates([_sim(0.5), _sim(0.7)]))

    item = out.items[0]
    assert (item["task_status"], item["due_status"], item["due_raw"]) == ("certain", "certain", "이번 주 금요일까지")
    (state, questions), = fakes["jev"].calls  # 항목당 한 번, 할 일과 마감을 같이 묻는다
    assert set(questions) == {"task", "due"}
    assert "할 일: 환불 구현" in state and '- "그건 제가 이번 주 금요일까지 할게요."' in state
    assert (item["similar_count"], item["top_similarity"]) == (2, 0.7)


def test_run_create_without_due_is_missing(monkeypatch):
    meeting = _one_line_meeting("그건 제가 할게요.")
    _install(monkeypatch, stage1={"findings": [_stage1(0)]}, terra=[NEW],
             luna_draft=[{"task": "환불 구현", "due_date": None, "due_raw": None, "doc_text": "환불 구현"}],
             jev=[_jev(0.95)])

    out = run(meeting, workspace_id="ws_1", today=date(2026, 9, 28), candidates=ListCandidates([]))

    item = out.items[0]
    assert (item["due_status"], item["due_date"], item["due_raw"]) == ("missing", None, None)
    assert (item["similar_count"], item["top_similarity"]) == (0, None)


def test_run_update_has_no_evidence_keys(monkeypatch):
    _install(monkeypatch, stage1={"findings": FINDINGS}, terra=TERRA_OK, luna_draft=LUNA_DRAFT_OK)

    update = _run().items[1]

    assert update["action"] == "update"
    assert not {"task_status", "due_status", "due_raw", "similar_count", "top_similarity"} & update.keys()


def test_run_merge_updates_create_card_status(monkeypatch):
    meeting = _one_line_meeting("결제 환불 기능은 제가 할게요.", "그 환불 기능은 다음 주 화요일까지 가능할까요?")
    _install(monkeypatch, stage1={"findings": [_stage1(0), _stage1(1, summary="환불 기능 마감을 정함")]},
             terra=[NEW, _terra(category="schedule", matched_candidate_index=1)],  # 0 검색 후보, 1 이번 회의 카드,
             luna_draft=[{"task": "환불 구현", "due_date": None, "due_raw": None, "doc_text": "환불 구현"},
                         {"task": None, "due_date": "2026-10-06", "due_raw": "다음 주 화요일",
                          "doc_text": "마감을 10/6으로"}],
             jev=[_jev(0.95), _jev(0.4, 0.9)])

    out = run(meeting, workspace_id="ws_1", today=date(2026, 9, 28), candidates=ListCandidates([_sim(0.6)]))

    assert len(out.items) == 1
    card = out.items[0]
    assert (card["due_status"], card["due_raw"], card["due_date"]) == ("certain", "다음 주 화요일", "2026-10-06")
    assert card["task_status"] == "inferred"   # 앞은 certain, 뒤는 Jev 가 낮게 봄 → 나쁜 쪽
    assert (card["similar_count"], card["top_similarity"]) == (1, 0.6)


def test_run_merge_due_cleared_sets_missing(monkeypatch):
    meeting = _one_line_meeting("그건 제가 다음 주 화요일까지 할게요.", "아 마감은 없던 걸로 합시다.")
    _install(monkeypatch, stage1={"findings": [_stage1(0), _stage1(1, summary="환불 마감을 없앰")]},
             terra=[NEW, _terra(category="schedule", matched_candidate_index=0)],
             luna_draft=[{"task": "환불 구현", "due_date": "2026-10-06", "due_raw": "다음 주 화요일",
                          "doc_text": "환불 구현"},
                         {"task": None, "due_date": "none", "due_raw": None, "doc_text": "마감 취소"}])

    out = run(meeting, workspace_id="ws_1", today=date(2026, 9, 28), candidates=ListCandidates([]))

    card = out.items[0]
    assert (card["due_status"], card["due_raw"], card["due_date"]) == ("missing", None, None)


def test_evidence_fields_without_evidence_lines_do_not_fall_back_to_summary(monkeypatch):
    # 근거 줄이 비면 LLM 요약("...하기로 했음")을 원문 대신 Jev 에 보여 주지 않는다 — 묻지 않고 inferred
    jev = FakeJev([_jev(1.0)])
    monkeypatch.setattr(pipeline, "get_jev", lambda: jev)
    finding = _finding(text="결제 환불 기능을 지민님이 구현하기로 했음", evidence=[])

    fields = pipeline._evidence_fields(finding, _drafted(task="환불 구현"), "환불 구현", date(2026, 9, 28))

    assert fields["task_status"] == "inferred"
    assert jev.calls == []


class SequenceCandidates:
    """호출마다 정해 둔 검색 결과를 차례로 돌려준다."""

    def __init__(self, *results):
        self.results = list(results)

    def similar_tasks(self, workspace_id, text):
        return list(self.results.pop(0))


def test_run_merge_keeps_first_certain_due_when_later_finding_has_none(monkeypatch):
    meeting = _one_line_meeting("그건 제가 다음 주 화요일까지 할게요.", "그 환불 기능 설명은 조금 더 붙일게요.")
    _install(monkeypatch, stage1={"findings": [_stage1(0), _stage1(1, summary="환불 기능 설명을 더함")]},
             terra=[NEW, _terra(category="decision", matched_candidate_index=0)],
             luna_draft=[{"task": "환불 구현", "due_date": "2026-10-06", "due_raw": "다음 주 화요일",
                          "doc_text": "환불 구현"},
                         {"task": None, "due_date": None, "due_raw": None, "doc_text": "설명 추가"}],
             jev=[_jev(0.9, 0.9), _jev(0.9)])

    out = run(meeting, workspace_id="ws_1", today=date(2026, 9, 28), candidates=ListCandidates([]))

    assert len(out.items) == 1
    card = out.items[0]
    assert (card["due_date"], card["due_status"], card["due_raw"]) == ("2026-10-06", "certain", "다음 주 화요일")


def test_merged_update_card_has_no_evidence_keys(monkeypatch):
    _install(
        monkeypatch, stage1={"findings": [LOGIN_DELAY, LOGIN_KEEP]},
        terra=[_terra(category="schedule"), _terra(category="schedule")],
        luna_draft=[{"task": None, "due_date": "2026-10-06", "doc_text": "로그인 화면 마감을 10/6으로 연기"},
                    {"task": None, "due_date": "2026-10-07", "doc_text": "로그인 화면 마감을 다시 10/7로 조정"}],
    )

    out = _run_dedup()

    assert len(out.items) == 1 and out.items[0]["action"] == "update"
    assert not {"task_status", "due_status", "due_raw", "similar_count", "top_similarity"} & out.items[0].keys()


def test_run_merge_takes_max_similar_count_and_top_similarity(monkeypatch):
    meeting = _one_line_meeting("결제 환불 기능은 제가 할게요.", "그 환불 기능은 다음 주 화요일까지 가능할까요?")
    _install(monkeypatch, stage1={"findings": [_stage1(0), _stage1(1, summary="환불 기능 마감을 정함")]},
             terra=[NEW, _terra(category="schedule", matched_candidate_index=2)],  # 검색 후보 2개 뒤가 이번 회의 카드
             luna_draft=[{"task": "환불 구현", "due_date": None, "due_raw": None, "doc_text": "환불 구현"},
                         {"task": None, "due_date": "2026-10-06", "due_raw": "다음 주 화요일",
                          "doc_text": "마감을 10/6으로"}])

    out = run(meeting, workspace_id="ws_1", today=date(2026, 9, 28),
              candidates=SequenceCandidates([_sim(0.6)], [_sim(0.3), _sim(0.8)]))

    card = out.items[0]
    assert (card["similar_count"], card["top_similarity"]) == (2, 0.8)


# ── 답장 판단: 이번 답장의 finding 만 (judge_seq) ─────────────────────────


CHAT = Transcript(source="chat", segments=[
    TranscriptSegment(speaker="PM", start=0.0, end=0.0, text="로그인 화면 마감 어떻게 될까요?", seq=1),
    TranscriptSegment(speaker="재환", start=1.0, end=1.0, text="로그인 화면은 10월 6일까지 할게요", seq=2),
    TranscriptSegment(speaker="재환", start=2.0, end=2.0, text="아니요 로그인 화면은 10월 8일까지요", seq=3),
])
CHAT_FINDINGS = [
    {"indices": [0, 1], "summary": "로그인 화면 마감을 10월 6일로 미룸", "assignee_type": "none", "reason": "일정"},
    {"indices": [2], "summary": "로그인 화면 마감을 10월 8일로 다시 미룸", "assignee_type": "none", "reason": "일정"},
]


def _run_chat(monkeypatch, *, terra, drafts, **kwargs):
    fakes = _install(monkeypatch, stage1={"findings": CHAT_FINDINGS}, terra=terra, luna_draft=drafts)
    source = FakeCandidates()
    out = run(CHAT, workspace_id="ws_1", today=date(2026, 10, 1), candidates=source, **kwargs)
    return out, fakes, source


def test_judge_seq_does_not_merge_into_a_change_from_an_earlier_reply(monkeypatch):
    out, fakes, source = _run_chat(
        monkeypatch, terra=[_terra(category="schedule")],
        drafts=[{"task": None, "due_date": "2026-10-08", "doc_text": "로그인 마감을 10/8로 미룸"}], judge_seq=3)

    (item,) = out.items
    assert item["due_date"] == "2026-10-08"
    assert item["evidence_quote"] == "아니요 로그인 화면은 10월 8일까지요"
    assert item["doc_text"] == "로그인 마감을 10/8로 미룸"
    assert [text for _, text in source.calls] == [CHAT_FINDINGS[1]["summary"]]
    assert len(fakes["terra"].prompts) == 1 and len(fakes["draft"].prompts) == 1


def test_without_judge_seq_the_later_finding_merges_as_in_a_meeting(monkeypatch):
    out, fakes, _ = _run_chat(
        monkeypatch, terra=[_terra(category="schedule"), _terra(category="schedule")],
        drafts=[{"task": None, "due_date": "2026-10-06", "doc_text": "10/6으로"},
                {"task": None, "due_date": "2026-10-08", "doc_text": "10/8로"}])

    (item,) = out.items
    assert item["due_date"] == "2026-10-08"
    assert item["evidence_quote"] == "로그인 화면은 10월 6일까지 할게요"
    assert len(fakes["terra"].prompts) == 2


def test_judge_seq_with_nothing_from_this_reply_judges_nothing(monkeypatch):
    out, fakes, source = _run_chat(monkeypatch, terra=[], drafts=[], judge_seq=9)

    assert out.items == [] and out.failures == []
    assert source.calls == [] and fakes["terra"].prompts == []


def test_run_uses_per_seq_dates(monkeypatch):
    _install(monkeypatch, stage1={"findings": FINDINGS}, terra=TERRA_OK, luna_draft=LUNA_DRAFT_OK)
    seen = []
    real = pipeline.draft
    monkeypatch.setattr(pipeline, "draft", lambda finding, result, **kw: (seen.append((finding.seq, kw["today"])), real(finding, result, **kw))[1])

    # 결제 환불 finding 은 seq=1, 로그인(1,2,3 → 앵커 seq=3)
    run(MEETING, workspace_id="ws_1", today=date(2026, 11, 5), candidates=FakeCandidates(),
        dates={3: date(2026, 11, 4)})

    assert (3, date(2026, 11, 4)) in seen
    assert (1, date(2026, 11, 5)) in seen  # dates 에 없는 seq 는 today


def test_run_passes_context_to_stage1(monkeypatch):
    _install(monkeypatch, stage1={"findings": []}, terra=[], luna_draft=[])
    seen = {}
    monkeypatch.setattr(pipeline, "extract_findings_counted",
                        lambda t, context=None: (seen.update(context=context) or ([], pipeline.empty_drops())))
    ctx = Transcript(segments=[], source="chat")
    run(MEETING, workspace_id="ws_1", today=date(2026, 11, 5), candidates=FakeCandidates(), context=ctx)
    assert seen["context"] is ctx


# ── 전사 오인식 의심 단어 (asr_suspects, judge/asr_check.py) ──────────────────────
# 제목 명사 중 용어 목록에 없는 말을 근거 판정과 같은 Jev 호출로 "맞게 적힌 말인가?" 묻는다(결정 기록 0051)


def _asr_answers(task_yes=0.95, **words):
    """근거 판정 답에 asr0, asr1 … 답을 더한다. words 는 순서대로 yes 확률."""
    out = _jev(task_yes)
    for i, p in enumerate(words.values()):
        out[f"asr{i}"] = {"choice": "yes", "probabilities": {"yes": p, "no": 1 - p, "unclear": 0.0}}
    return out


def _asr_run(monkeypatch, lines, task, *, jev=None, candidates=None, source="meeting", speakers=None):
    segs = _one_line_meeting(*lines).segments
    if speakers:
        segs = [replace(s, speaker=who) for s, who in zip(segs, speakers)]
    meeting = Transcript(source=source, segments=segs)
    fakes = _install(monkeypatch, stage1={"findings": [_stage1(0)]}, terra=[NEW],
                     luna_draft=[{"task": task, "due_date": None, "due_raw": None, "doc_text": task}],
                     jev=[_jev(0.95)] if jev is None else jev)
    out = run(meeting, workspace_id="ws_1", today=date(2026, 9, 28), candidates=candidates or ListCandidates([]))
    return out, fakes["jev"]


def test_run_asks_jev_about_a_title_word_off_the_list_in_the_same_call(monkeypatch):
    out, jev = _asr_run(monkeypatch, ["애포 문서 정리는 제가 맡을게요."], "애포 문서 정리",
                        jev=[_asr_answers(애포=0.2)])
    [(state, questions)] = jev.calls          # 근거 판정과 한 호출이다
    assert set(questions) == {"task", "asr0"} and "'애포'" in questions["asr0"]["instructions"]
    [s] = out.items[0]["asr_suspects"]
    assert (s["word"], s["source"]) == ("애포", "title") and "배포" in s["candidates"]
    assert out.items[0]["task_status"] == "certain"   # 근거 판정의 뜻은 그대로다


def test_run_passes_a_title_word_jev_says_is_right(monkeypatch):
    out, _ = _asr_run(monkeypatch, ["애포 문서 정리는 제가 맡을게요."], "애포 문서 정리", jev=[_asr_answers(애포=0.95)])
    assert out.items[0]["asr_suspects"] == []


def test_run_does_not_ask_when_every_title_noun_is_on_the_list(monkeypatch):
    out, jev = _asr_run(monkeypatch, ["배포 문서 정리는 제가 맡을게요."], "배포 문서 정리")
    [(_, questions)] = jev.calls
    assert set(questions) == {"task"}
    assert out.items[0]["asr_suspects"] == []


def test_run_jev_failure_blocks_only_items_with_suspects(monkeypatch):
    out, _ = _asr_run(monkeypatch, ["애포 문서 정리는 제가 맡을게요."], "애포 문서 정리", jev=[None])
    assert out.items[0]["asr_suspects"] == asr_check.failed()
    clean, _ = _asr_run(monkeypatch, ["배포 문서 정리는 제가 맡을게요."], "배포 문서 정리", jev=[None])
    assert clean.items[0]["asr_suspects"] == []


def test_run_evidence_words_are_not_checked_only_the_title(monkeypatch):
    # 초안이 제목을 고쳤으면 근거 원문의 오인식은 결과물에 남지 않는다
    out, jev = _asr_run(monkeypatch, ["애포 문서 정리는 제가 맡을게요."], "배포 문서 정리")
    assert set(jev.calls[0][1]) == {"task"} and out.items[0]["asr_suspects"] == []


class _Terms(ListCandidates):
    def __init__(self, words=(), pending=(), fail=False):
        super().__init__([])
        self.words, self.pending, self.fail, self.pushed = list(words), list(pending), fail, []

    def asr_terms(self, workspace_id):
        if self.fail:
            raise ConnectionError("BE 연결 실패")
        return {"words": self.words, "pending_titles": self.pending}

    def add_asr_terms(self, workspace_id, words, absorbed_title_ids):
        self.pushed.append((words, absorbed_title_ids))


def test_run_workspace_terms_and_approved_titles_count_as_known(monkeypatch):
    be = _Terms(words=["핀테크볼트"], pending=[{"title_id": "t1", "title": "애포 대시보드 정리"}])
    out, jev = _asr_run(monkeypatch, ["핀테크볼트 애포 정리는 제가 맡을게요."], "핀테크볼트 애포 정리", candidates=be)
    assert set(jev.calls[0][1]) == {"task"} and out.items[0]["asr_suspects"] == []
    # 승인 제목의 명사를 뽑아 올리고 그 제목을 큐에서 지운다. 이미 있는 말은 다시 올리지 않는다
    [(words, ids)] = be.pushed
    assert "애포" in words and "핀테크볼트" not in words and ids == ["t1"]


def test_run_nouns_said_by_two_speakers_are_known_and_pushed(monkeypatch):
    be = _Terms()
    out, jev = _asr_run(monkeypatch, ["애포 문서 정리는 제가 맡을게요.", "애포 일정은 금요일이에요."], "애포 문서 정리",
                        candidates=be, speakers=["uid_a", "uid_b"])
    assert set(jev.calls[0][1]) == {"task"} and out.items[0]["asr_suspects"] == []
    assert "애포" in be.pushed[0][0]


def test_run_a_word_one_speaker_repeats_is_still_asked(monkeypatch):
    # STT 는 한 사람의 같은 발음을 같은 꼴로 거듭 잘못 듣는다(#532 리뷰)
    be = _Terms()
    _, jev = _asr_run(monkeypatch, ["애포 문서 정리는 제가 맡을게요.", "애포 일정은 금요일이에요."], "애포 문서 정리",
                      candidates=be, speakers=["uid_a", "uid_a"])
    assert "asr0" in jev.calls[0][1]
    assert not be.pushed or "애포" not in be.pushed[0][0]


def test_run_term_lookup_failure_falls_back_to_the_base_list(monkeypatch):
    out, jev = _asr_run(monkeypatch, ["애포 문서 정리는 제가 맡을게요."], "애포 문서 정리",
                        candidates=_Terms(fail=True), jev=[_asr_answers(애포=0.1)])
    assert [s["word"] for s in out.items[0]["asr_suspects"]] == ["애포"]


def test_run_member_names_and_search_titles_count_as_known(monkeypatch):
    class WithNames(ListCandidates):
        def member_names(self, workspace_id):
            return [{"member_id": "m1", "name": "콜린스", "discord_user_id": "u1", "aliases": ["콜린"]}]

    _, jev = _asr_run(monkeypatch, ["콜린스 문서 정리는 제가 맡을게요."], "콜린스 문서 정리", candidates=WithNames([]))
    assert set(jev.calls[0][1]) == {"task"}
    titled = ListCandidates([replace(SEARCH, title="핀테크볼트 정산 연동", similarity=0.5)])
    _, jev = _asr_run(monkeypatch, ["핀테크볼트 정산 정리는 제가 맡을게요."], "핀테크볼트 정산 정리", candidates=titled)
    assert set(jev.calls[0][1]) == {"task"}


def test_run_marks_every_create_item_when_the_analyzer_cannot_start(monkeypatch):
    def boom(n=None):
        raise OSError("모델 파일 없음")
    monkeypatch.setattr(asr_check, "seed_nouns", boom)
    out, _ = _asr_run(monkeypatch, ["배포 문서 정리는 제가 맡을게요."], "배포 문서 정리")
    assert out.items[0]["asr_suspects"] == asr_check.failed()


def test_run_update_items_are_not_checked(monkeypatch):
    _install(monkeypatch, stage1={"findings": FINDINGS}, terra=TERRA_OK, luna_draft=LUNA_DRAFT_OK)
    create, update = _run().items
    assert "asr_suspects" in create and "asr_suspects" not in update


def test_run_chat_items_are_not_checked(monkeypatch):
    # 채팅은 전사를 거치지 않고 auto 로도 가지 않는다(BE 가 review 로 내림). 분석기를 올리지 않는다
    monkeypatch.setattr(asr_check, "_kiwi", lambda: (_ for _ in ()).throw(AssertionError("분석기를 올리면 안 된다")))
    out, _ = _asr_run(monkeypatch, ["애포 문서 정리는 제가 맡을게요."], "애포 문서 정리", source="chat")
    assert "asr_suspects" not in out.items[0]


def _ends(out):
    return [(o.indices, o.kind) for o in out.outcomes]


def test_each_finding_ends_as_an_item_or_a_skip_with_its_sentences(monkeypatch):
    _install(monkeypatch, stage1={"findings": FINDINGS}, terra=TERRA_OK, luna_draft=LUNA_DRAFT_OK)

    assert _ends(_run()) == [([0], "item"), ([1, 2, 3], "item"), ([4], "skip"), ([5], "skip")]


def test_a_failed_finding_keeps_its_sentences(monkeypatch):
    _install(monkeypatch, stage1={"findings": FINDINGS[:2]}, terra=TERRA_OK[:1], luna_draft=LUNA_DRAFT_OK[:1])

    out = _run(FakeCandidates(fail_on="로그인"))

    assert _ends(out) == [([0], "item"), ([1, 2, 3], "failure")]


def test_findings_merged_into_a_new_card_share_its_outcome(monkeypatch):
    """합친 카드의 근거 문장을 전부 들고 있어야 다른 실행이 뒷부분만 항목으로 낼 때 같은 얘기로 묶인다."""
    _install(monkeypatch, stage1={"findings": [REFUND_OWNER, REFUND_DUE]},
             terra=[_terra(is_new=True, matched_candidate_index=None), _terra(category="schedule")],
             luna_draft=[{"task": "결제 환불 기능 구현", "due_date": None, "doc_text": "지민님이 맡기로 함"},
                         {"task": None, "due_date": "2026-10-09", "doc_text": "마감을 10/9로 정함"}])

    assert _ends(_run_dedup()) == [([0, 1], "item")]


def test_findings_merged_into_a_change_share_its_outcome(monkeypatch):
    _install(monkeypatch, stage1={"findings": [LOGIN_DELAY, LOGIN_KEEP]},
             terra=[_terra(category="schedule"), _terra(category="schedule")],
             luna_draft=[{"task": None, "due_date": "2026-10-06", "doc_text": "마감을 10/6으로 연기"},
                         {"task": None, "due_date": "2026-10-09", "doc_text": "마감을 10/9로 다시 연기"}])

    assert _ends(_run_dedup()) == [([2, 3, 4], "item")]


def test_a_card_reverted_in_the_meeting_ends_as_one_skip(monkeypatch):
    """되돌려 카드가 사라졌다. 뒤에 만든 카드를 가리키는 결과는 그대로여야 한다."""
    noti = NOTI_NEW | {"indices": [3]}
    delay = LOGIN_DELAY | {"indices": [2]}
    _install(monkeypatch, stage1={"findings": [delay, noti, LOGIN_KEEP]},
             terra=[_terra(category="schedule"), _terra(is_new=True, matched_candidate_index=None), _terra(category="schedule")],
             luna_draft=[{"task": None, "due_date": "2026-10-06", "doc_text": "마감을 10/6으로 연기"},
                         {"task": "알림 설정 페이지", "due_date": None, "doc_text": "알림 설정 페이지를 만들기로 함"},
                         {"task": None, "due_date": "2026-10-02", "doc_text": "마감을 10/2로 되돌림"}])

    out = _run_dedup()

    assert sorted(_ends(out)) == [([2, 4], "skip"), ([3], "item")]
    assert out.outcomes[1].item is out.items[0] and out.items[0]["task_title"] == "알림 설정 페이지"
