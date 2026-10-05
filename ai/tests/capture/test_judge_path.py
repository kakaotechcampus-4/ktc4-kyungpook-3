"""판단 파이프라인을 추출기로 감싸는 자리(capture/judge_path.py). 파이프라인은 가짜로 끼운다. LLM 도 BE 도 안 부른다."""

from datetime import date
from types import SimpleNamespace

import pytest

from capture import judge_path as J
from shared.schemas import Transcript, TranscriptSegment

TRANSCRIPT = Transcript(segments=[
    TranscriptSegment(speaker="101", start=3.0, end=5.0, text="와이어프레임은 너가 금요일까지 해줘.", seq=1),
    TranscriptSegment(speaker="103", start=12.0, end=14.5, text="네, 제가 할게요.", seq=2),
    TranscriptSegment(speaker=None, start=20.0, end=21.0, text="좋습니다.", seq=3),
])
NAMES = {"101": "민수", "103": "재환"}


def _cfg(**over):
    base = dict(terra_api_key="k", terra_base_url="http://terra", luna_api_key="k", luna_base_url="http://luna",
                be_base_url="http://be", be_workspace_id="ws-1", be_service_token="svc", llm_mode="")
    base.update(over)
    return SimpleNamespace(**base)


def _item(**over):
    base = {"action": "create", "target_task_id": None, "category": "decision", "task_title": "와이어프레임 그리기",
            "due_date": "2026-09-25", "status": None, "assignee_type": "first", "assignee_raw": None,
            "doc_text": "와이어프레임을 재환이 9/25까지 그리기로 함", "evidence_quote": "네, 제가 할게요.",
            "evidence_speaker": "재환", "evidence_at_ms": 12000}
    base.update(over)
    return base


def _failure(stage="judge", text="로그인 마감을 미루기로 함", reason="Terra 응답을 파싱하지 못했습니다."):
    return SimpleNamespace(stage=stage, finding_text=text, reason=reason)


class FakeRun:
    """judge.pipeline.run 자리. 받은 것을 적어 두고 정해 둔 결과를 돌려준다."""

    def __init__(self, items=(), failures=()):
        self.items, self.failures = list(items), list(failures)
        self.seen = None

    def __call__(self, transcript, *, workspace_id, today, candidates):
        self.seen = SimpleNamespace(transcript=transcript, workspace_id=workspace_id, today=today, candidates=candidates)
        return SimpleNamespace(items=[dict(i) for i in self.items], failures=list(self.failures))


def _extractor(run, **cfg):
    candidates = object()
    return J.build_extractor(run=run, candidates=candidates, cfg=_cfg(**cfg)), candidates


def test_legacy_is_the_default_and_an_unknown_path_is_rejected(monkeypatch):
    monkeypatch.delenv("MM_EXTRACT_PATH", raising=False)
    assert J.extract_path() == "legacy"
    monkeypatch.setenv("MM_EXTRACT_PATH", "judge")
    assert J.extract_path() == "judge"
    monkeypatch.setenv("MM_EXTRACT_PATH", "jugde")
    with pytest.raises(ValueError):
        J.extract_path()


def test_missing_settings_are_named_and_no_extractor_is_built():
    """설정이 빠졌다고 옛 경로로 넘어가지 않는다. 무엇이 없는지 이름으로 말하고 추출기를 만들지 않는다."""
    run = FakeRun([_item()])
    assert J.missing_settings(_cfg(), run=run) == []
    assert J.missing_settings(_cfg(be_service_token="", terra_api_key=""), run=run) == ["TERRA_API_KEY", "BE_SERVICE_TOKEN"]
    assert J.missing_settings(_cfg(llm_mode="off"), run=run) == ["PM_AGENT_LLM=off"]
    assert J.build_extractor(run=run, candidates=object(), cfg=_cfg(be_base_url="")) is None
    assert J.build_extractor(run=run, candidates=object(), cfg=_cfg()) is not None


def test_speakers_reach_the_pipeline_as_names_and_come_back_as_uids():
    """LLM 은 "너가" 를 풀 이름이 필요하고 BE 는 1인칭 담당자를 uid 로 찾는다."""
    run = FakeRun([_item()])
    extract, candidates = _extractor(run)
    out = extract(TRANSCRIPT, NAMES, date(2026, 9, 19))
    assert [s.speaker for s in run.seen.transcript.segments] == ["민수", "재환", None]
    assert [s.speaker for s in TRANSCRIPT.segments] == ["101", "103", None]        # 원본은 그대로다
    assert [(s.text, s.seq, s.start) for s in run.seen.transcript.segments] == [(s.text, s.seq, s.start) for s in TRANSCRIPT.segments]
    assert run.seen.workspace_id == "ws-1" and run.seen.today == date(2026, 9, 19) and run.seen.candidates is candidates
    assert out.items[0]["evidence_speaker"] == "103" and out.failures == []


def test_a_speaker_without_a_name_stays_as_the_uid():
    run = FakeRun([_item(evidence_speaker="103")])
    extract, _ = _extractor(run)
    out = extract(TRANSCRIPT, {"101": "민수"}, date(2026, 9, 19))
    assert [s.speaker for s in run.seen.transcript.segments] == ["민수", "103", None]
    assert out.items[0]["evidence_speaker"] == "103"


def test_two_speakers_with_one_name_stay_apart():
    """표시 이름이 같으면 어느 uid 인지 되돌릴 수 없다. 뒤에 나온 쪽에 꼬리표를 붙여 보내고, 담당자 이름으로 돌아오면 뗀다."""
    labels = J.speaker_labels({"101": "민수", "103": "민수", "105": "서연"})
    assert labels == {"101": "민수", "103": "민수(2)", "105": "서연"}
    run = FakeRun([_item(evidence_speaker="민수(2)"),
                   _item(assignee_type="second", assignee_raw="민수(2)", evidence_speaker="민수")])
    extract, _ = _extractor(run)
    out = extract(TRANSCRIPT, {"101": "민수", "103": "민수"}, date(2026, 9, 19))
    assert [i["evidence_speaker"] for i in out.items] == ["103", "101"]
    assert out.items[1]["assignee_raw"] == "민수"


def test_a_name_tag_does_not_reach_the_text_the_pm_reads():
    """꼬리표는 화자를 가르려고 붙인 것이다. 호칭이 붙어 돌아오거나 제목과 설명 문장에 섞여 돌아와도 뗀다."""
    run = FakeRun([_item(assignee_type="thirdname", assignee_raw="민수(2)님", task_title="민수(2) 와이어프레임 검토",
                         doc_text="와이어프레임을 민수(2)가 9/25까지 그리기로 함", evidence_speaker="민수")])
    extract, _ = _extractor(run)
    item = extract(TRANSCRIPT, {"101": "민수", "103": "민수"}, date(2026, 9, 19)).items[0]
    assert item["assignee_raw"] == "민수님" and item["task_title"] == "민수 와이어프레임 검토"
    assert item["doc_text"] == "와이어프레임을 민수가 9/25까지 그리기로 함" and item["evidence_speaker"] == "101"
    assert item["evidence_quote"] == "네, 제가 할게요."                     # 전사 원문은 건드리지 않는다


def test_an_unknown_speaker_in_an_item_is_dropped_for_pm_review():
    """되돌릴 수 없는 화자를 uid 자리에 그대로 두면 BE 가 엉뚱한 값으로 팀원을 찾는다. 비워서 PM 확인으로 보낸다."""
    run = FakeRun([_item(evidence_speaker="모르는 사람"), _item(evidence_speaker=None)])
    extract, _ = _extractor(run)
    out = extract(TRANSCRIPT, NAMES, date(2026, 9, 19))
    assert [i["evidence_speaker"] for i in out.items] == [None, None]


def test_failures_keep_their_stage_text_and_reason():
    run = FakeRun([_item()], [_failure(), _failure("similar", "환불 기능을 만들기로 함", "BeError: NETWORK")])
    extract, _ = _extractor(run)
    out = extract(TRANSCRIPT, NAMES, date(2026, 9, 19))
    assert len(out.items) == 1
    assert out.failures == [
        {"stage": "judge", "text": "로그인 마감을 미루기로 함", "reason": "Terra 응답을 파싱하지 못했습니다."},
        {"stage": "similar", "text": "환불 기능을 만들기로 함", "reason": "BeError: NETWORK"}]


def test_a_run_with_failures_and_no_items_raises():
    """BE 가 꺼졌거나 토큰이 틀리면 finding 이 모두 실패하고 항목이 0개로 돌아온다. 그대로 등록하면 빈 추출로 회의가 닫힌다."""
    extract, _ = _extractor(FakeRun([], [_failure("similar", "a", "BeError: UNAUTHENTICATED"), _failure("similar", "b", "x")]))
    with pytest.raises(J.JudgeAllFailed) as e:
        extract(TRANSCRIPT, NAMES, date(2026, 9, 19))
    assert "2" in str(e.value) and "UNAUTHENTICATED" in str(e.value)
    extract, _ = _extractor(FakeRun([], []))                     # 결정이 없는 회의. 실패가 아니다
    out = extract(TRANSCRIPT, NAMES, date(2026, 9, 19))
    assert out.items == [] and out.failures == []


def test_the_default_candidate_source_is_the_be_client_with_the_service_token():
    """밖에서 끼우지 않으면 유사 검색은 설정의 BE 주소와 서비스 토큰으로 만든 BeClient 다."""
    from capture.handoff import BeClient

    run = FakeRun([_item()])
    extract = J.build_extractor(run=run, cfg=_cfg(be_base_url="http://be.local/", be_service_token="svc"))
    extract(TRANSCRIPT, NAMES, date(2026, 9, 19))
    client = run.seen.candidates
    assert isinstance(client, BeClient) and client.api == "http://be.local/api/v1" and client.service_token == "svc"
