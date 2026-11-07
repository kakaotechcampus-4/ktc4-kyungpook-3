"""판단 파이프라인을 추출기로 감싸는 자리(capture/judge_path.py). 파이프라인은 가짜로 끼운다. LLM 도 BE 도 안 부른다."""

from datetime import date
from types import SimpleNamespace

import pytest

from capture import judge_path as J
from judge.semantic_judge import empty_drops
from shared.schemas import Transcript, TranscriptSegment

TRANSCRIPT = Transcript(segments=[
    TranscriptSegment(speaker="101", start=3.0, end=5.0, text="와이어프레임은 너가 금요일까지 해줘.", seq=1),
    TranscriptSegment(speaker="103", start=12.0, end=14.5, text="네, 제가 할게요.", seq=2),
    TranscriptSegment(speaker=None, start=20.0, end=21.0, text="좋습니다.", seq=3),
])
NAMES = {"101": "민수", "103": "재환"}


def _cfg(**over):
    base = dict(terra_api_key="k", terra_base_url="http://terra", luna_api_key="k", luna_base_url="http://luna",
                be_base_url="http://be", be_service_token="svc", llm_mode="")
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
    """judge.pipeline.run 자리. 받은 것을 적어 두고 정해 둔 결과를 돌려준다.

    outcomes 는 run 이 돌려준 항목과 실패를 받아 결과 목록을 만드는 함수다. 주지 않으면 finding 하나가 항목이나
    실패 하나가 됐다고 보고 서로 겹치지 않는 문장 번호를 붙인다.
    """

    def __init__(self, items=(), failures=(), dropped=None, outcomes=None):
        self.items, self.failures = list(items), list(failures)
        self.dropped = dropped if dropped is not None else empty_drops()
        self.outcomes = outcomes or (lambda items, failures: (
            [SimpleNamespace(indices=[k], kind="item", item=i, failure=None) for k, i in enumerate(items)]
            + [SimpleNamespace(indices=[len(items) + k], kind="failure", item=None, failure=f)
               for k, f in enumerate(failures)]))
        self.seen = None

    def __call__(self, transcript, *, workspace_id, today, candidates):
        self.seen = SimpleNamespace(transcript=transcript, workspace_id=workspace_id, today=today, candidates=candidates)
        items, failures = [dict(i) for i in self.items], list(self.failures)
        return SimpleNamespace(items=items, failures=failures, dropped=dict(self.dropped),
                               outcomes=self.outcomes(items, failures))


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
    assert J.build_extractor(run=run, cfg=_cfg(be_base_url="")) is None
    assert J.build_extractor(run=run, candidates=object(), cfg=_cfg()) is not None


def test_injected_candidates_do_not_need_be_settings():
    """유사 검색을 밖에서 끼우면(채팅 폴링 검증) BE 설정을 요구하지 않는다. 끼우지 않는 봇·워커는 지금처럼 요구한다."""
    run = FakeRun([_item()])
    no_be = _cfg(be_base_url="", be_service_token="")
    assert J.missing_settings(no_be, run=run) == ["BE_BASE_URL", "BE_SERVICE_TOKEN"]
    assert J.missing_settings(no_be, run=run, candidates=object()) == []
    no_be_no_terra = _cfg(be_base_url="", be_service_token="", terra_api_key="")
    assert J.missing_settings(no_be_no_terra, run=run, candidates=object()) == ["TERRA_API_KEY"]
    assert J.build_extractor(run=run, candidates=object(), cfg=no_be) is not None
    assert J.build_extractor(run=run, cfg=no_be) is None


def test_the_pipeline_gets_the_workspace_of_the_meeting_not_a_setting():
    """워크스페이스는 회의마다 다르다(#199). 설정에 없고 추출기를 부를 때 받는다."""
    run = FakeRun([_item()])
    extract, _ = _extractor(run)
    extract(TRANSCRIPT, NAMES, date(2026, 9, 19), workspace_id="ws-7")
    assert run.seen.workspace_id == "ws-7"
    assert "BE_WORKSPACE_ID" not in [name for name, _ in J._REQUIRED_LLM + J._REQUIRED_BE]


def test_the_pipeline_is_not_run_without_a_workspace():
    """워크스페이스 없이 부르면 유사 검색이 /workspaces/None/... 로 간다. 그 전에 분명한 오류로 멈춘다."""
    run = FakeRun([_item()])
    extract, _ = _extractor(run)
    with pytest.raises(ValueError, match="워크스페이스"):
        extract(TRANSCRIPT, NAMES, date(2026, 9, 19))
    assert run.seen is None


def test_the_drops_of_stage_one_come_back_with_the_items():
    """1단계에서 검증에 탈락한 항목 기록을 회의 기록까지 올린다(#186). 회의 ID 는 recorder 만 안다."""
    drops = {"not_dict": 1, "no_valid_indices": 1, "bad_indices": [[7]], "bad_indices_total": 1, "lines": 3}
    extract, _ = _extractor(FakeRun([_item()], dropped=drops))
    assert extract(TRANSCRIPT, NAMES, date(2026, 9, 19), workspace_id="ws-1").dropped == drops


def test_speakers_reach_the_pipeline_as_names_and_come_back_as_uids():
    """LLM 은 "너가" 를 풀 이름이 필요하고 BE 는 1인칭 담당자를 uid 로 찾는다."""
    run = FakeRun([_item()])
    extract, candidates = _extractor(run)
    out = extract(TRANSCRIPT, NAMES, date(2026, 9, 19), workspace_id="ws-1")
    assert [s.speaker for s in run.seen.transcript.segments] == ["민수", "재환", None]
    assert [s.speaker for s in TRANSCRIPT.segments] == ["101", "103", None]        # 원본은 그대로다
    assert [(s.text, s.seq, s.start) for s in run.seen.transcript.segments] == [(s.text, s.seq, s.start) for s in TRANSCRIPT.segments]
    assert run.seen.workspace_id == "ws-1" and run.seen.today == date(2026, 9, 19) and run.seen.candidates is candidates
    assert out.items[0]["evidence_speaker"] == "103" and out.failures == []


def test_a_speaker_without_a_name_stays_as_the_uid():
    run = FakeRun([_item(evidence_speaker="103")])
    extract, _ = _extractor(run)
    out = extract(TRANSCRIPT, {"101": "민수"}, date(2026, 9, 19), workspace_id="ws-1")
    assert [s.speaker for s in run.seen.transcript.segments] == ["민수", "103", None]
    assert out.items[0]["evidence_speaker"] == "103"


def test_two_speakers_with_one_name_stay_apart():
    """표시 이름이 같으면 어느 uid 인지 되돌릴 수 없다. 뒤에 나온 쪽에 꼬리표를 붙여 보내고, 담당자 이름으로 돌아오면 뗀다."""
    labels = J.speaker_labels({"101": "민수", "103": "민수", "105": "서연"})
    assert labels == {"101": "민수", "103": "민수(2)", "105": "서연"}
    run = FakeRun([_item(evidence_speaker="민수(2)"),
                   _item(assignee_type="second", assignee_raw="민수(2)", evidence_speaker="민수")])
    extract, _ = _extractor(run)
    out = extract(TRANSCRIPT, {"101": "민수", "103": "민수"}, date(2026, 9, 19), workspace_id="ws-1")
    assert [i["evidence_speaker"] for i in out.items] == ["103", "101"]
    assert out.items[1]["assignee_raw"] == "민수"


def test_a_name_tag_does_not_reach_the_text_the_pm_reads():
    """꼬리표는 화자를 가르려고 붙인 것이다. 호칭이 붙어 돌아오거나 제목과 설명 문장에 섞여 돌아와도 뗀다."""
    run = FakeRun([_item(assignee_type="thirdname", assignee_raw="민수(2)님", task_title="민수(2) 와이어프레임 검토",
                         doc_text="와이어프레임을 민수(2)가 9/25까지 그리기로 함", evidence_speaker="민수")])
    extract, _ = _extractor(run)
    item = extract(TRANSCRIPT, {"101": "민수", "103": "민수"}, date(2026, 9, 19), workspace_id="ws-1").items[0]
    assert item["assignee_raw"] == "민수님" and item["task_title"] == "민수 와이어프레임 검토"
    assert item["doc_text"] == "와이어프레임을 민수가 9/25까지 그리기로 함" and item["evidence_speaker"] == "101"
    assert item["evidence_quote"] == "네, 제가 할게요."                     # 전사 원문은 건드리지 않는다


def test_an_unknown_speaker_in_an_item_is_dropped_for_pm_review():
    """되돌릴 수 없는 화자를 uid 자리에 그대로 두면 BE 가 엉뚱한 값으로 팀원을 찾는다. 비워서 PM 확인으로 보낸다."""
    run = FakeRun([_item(evidence_speaker="모르는 사람"), _item(evidence_speaker=None)])
    extract, _ = _extractor(run)
    out = extract(TRANSCRIPT, NAMES, date(2026, 9, 19), workspace_id="ws-1")
    assert [i["evidence_speaker"] for i in out.items] == [None, None]


def test_failures_keep_their_stage_text_and_reason():
    run = FakeRun([_item()], [_failure(), _failure("similar", "환불 기능을 만들기로 함", "BeError: NETWORK")])
    extract, _ = _extractor(run)
    out = extract(TRANSCRIPT, NAMES, date(2026, 9, 19), workspace_id="ws-1")
    assert len(out.items) == 1
    assert out.failures == [
        {"stage": "judge", "text": "로그인 마감을 미루기로 함", "reason": "Terra 응답을 파싱하지 못했습니다."},
        {"stage": "similar", "text": "환불 기능을 만들기로 함", "reason": "BeError: NETWORK"}]


def test_a_run_with_failures_and_no_items_raises():
    """BE 가 꺼졌거나 토큰이 틀리면 finding 이 모두 실패하고 항목이 0개로 돌아온다. 그대로 등록하면 빈 추출로 회의가 닫힌다."""
    extract, _ = _extractor(FakeRun([], [_failure("similar", "a", "BeError: UNAUTHENTICATED"), _failure("similar", "b", "x")]))
    with pytest.raises(J.JudgeAllFailed) as e:
        extract(TRANSCRIPT, NAMES, date(2026, 9, 19), workspace_id="ws-1")
    assert "2" in str(e.value) and "UNAUTHENTICATED" in str(e.value)
    extract, _ = _extractor(FakeRun([], []))                     # 결정이 없는 회의. 실패가 아니다
    out = extract(TRANSCRIPT, NAMES, date(2026, 9, 19), workspace_id="ws-1")
    assert out.items == [] and out.failures == []


def test_the_default_candidate_source_is_the_be_client_with_the_service_token():
    """밖에서 끼우지 않으면 유사 검색은 설정의 BE 주소와 서비스 토큰으로 만든 BeClient 다."""
    from capture.handoff import BeClient

    run = FakeRun([_item()])
    extract = J.build_extractor(run=run, cfg=_cfg(be_base_url="http://be.local/", be_service_token="svc"))
    extract(TRANSCRIPT, NAMES, date(2026, 9, 19), workspace_id="ws-1")
    client = run.seen.candidates
    assert isinstance(client, BeClient) and client.api == "http://be.local/api/v1" and client.service_token == "svc"


def test_each_finding_comes_back_with_its_sentences_and_what_became_of_it():
    """다시 돌린 실행끼리 같은 얘기를 짝지으려면 finding 마다 근거 문장 번호와 결과가 있어야 한다(#217).
    항목은 화자를 uid 로 되돌린 것을 붙인다."""
    outcomes = lambda items, failures: [SimpleNamespace(indices=[2], kind="item", item=items[0], failure=None),
                                        SimpleNamespace(indices=[1], kind="skip", item=None, failure=None),
                                        SimpleNamespace(indices=[0, 1], kind="failure", item=None, failure=failures[0])]
    extract, _ = _extractor(FakeRun([_item()], [_failure()], outcomes=outcomes))
    out = extract(TRANSCRIPT, NAMES, date(2026, 9, 19), workspace_id="ws-1")
    restored = _item(evidence_speaker="103")
    failure = {"stage": "judge", "text": "로그인 마감을 미루기로 함", "reason": "Terra 응답을 파싱하지 못했습니다."}
    assert out.outcomes == [{"indices": [2], "kind": "item", "item": restored, "failure": None},
                            {"indices": [1], "kind": "skip", "item": None, "failure": None},
                            {"indices": [0, 1], "kind": "failure", "item": None, "failure": failure}]
    assert out.items == [restored] and out.failures == [failure]


def _o(kind, value=None, *, at):
    """finding 하나의 결과. at 은 근거 문장 번호다."""
    return {"indices": list(at), "kind": kind, "item": value if kind == "item" else None,
            "failure": value if kind == "failure" else None}


A1, A2, B, C = (_item(task_title=t) for t in ("로그인 화면 마감 변경", "로그인 화면 담당 변경", "결제 API 문서", "색상표 정리"))
FB, FB2 = ({"stage": "judge", "text": t, "reason": "Terra 응답을 파싱하지 못했습니다."} for t in ("결제 API 문서를 쓰기로 함", "결제 문서 작성"))


def test_a_story_that_succeeds_only_in_the_rerun_is_kept():
    """#128 멘토 리뷰의 예. 1회차는 A 관련 항목 2개와 B 실패, 2회차는 A 는 바꿀 것 없음과 B 항목이다.
    항목 수로 실행 하나를 고르면 1회차가 남아 B 가 버려진다. 얘기마다 합치면 A 는 1회차, B 는 2회차의 것을 쓴다.
    A 는 실행마다 판단이 엇갈렸지만 항목을 남긴다. judge 항목은 PM 검토로 간다."""
    first = [_o("item", A1, at=[3]), _o("item", A2, at=[4]), _o("failure", FB, at=[9])]
    second = [_o("skip", at=[3, 4]), _o("item", B, at=[9])]
    assert J.merge_runs([first, second]) == ([A1, A2, B], [])


def test_a_story_that_fails_in_every_run_stays_one_failure():
    """모든 실행에서 실패한 얘기만 실패로 남긴다. 같은 얘기의 실패를 실행마다 하나씩 겹쳐 세지 않는다."""
    first = [_o("item", A1, at=[3]), _o("failure", FB, at=[9])]
    second = [_o("item", A1, at=[3]), _o("failure", FB2, at=[8, 9])]
    assert J.merge_runs([first, second]) == ([A1], [FB])


def test_an_item_stays_when_another_run_skips_the_same_story():
    """한 실행에서는 항목 하나와 실패 하나로, 다른 실행에서는 통째로 바꿀 것 없음으로 끝난 얘기. 실패 없이 끝낸 실행이
    있으니 실패로 세지 않고, 항목은 남긴다."""
    first = [_o("item", A1, at=[3]), _o("failure", FB, at=[3, 4])]
    second = [_o("skip", at=[3, 4])]
    assert J.merge_runs([first, second]) == ([A1], [])


def test_a_run_that_found_nothing_changes_nothing():
    """1단계가 응답을 이상하게 줘 finding 을 하나도 못 고른 실행. 가진 결과를 지우지 않는다."""
    first = [_o("item", A1, at=[3]), _o("failure", FB, at=[9])]
    assert J.merge_runs([first, []]) == ([A1], [FB])


def test_a_story_split_differently_in_each_run_is_one_story():
    """1단계는 실행마다 얘기를 다르게 쪼갠다. 문장 번호가 겹치면 실행이 달라도 한 얘기로 묶는다."""
    first = [_o("item", A1, at=[3, 4]), _o("item", A2, at=[5])]
    second = [_o("failure", FB, at=[3, 4, 5])]
    assert J.merge_runs([first, second]) == ([A1, A2], [])


def test_the_same_story_from_two_runs_goes_out_once():
    """두 실행이 같은 얘기를 둘 다 항목으로 만들면 실행 하나의 것만 쓴다. 둘 다 보내면 PM 앞에 같은 카드가 두 장 선다."""
    other = _item(task_title="로그인 화면 마감을 금요일로")
    assert J.merge_runs([[_o("item", A1, at=[3])], [_o("item", other, at=[3])]]) == ([A1], [])
    # 실패 없이 끝난 실행의 항목을 먼저 쓴다
    first = [_o("item", A1, at=[3]), _o("failure", FB, at=[3, 4])]
    second = [_o("item", other, at=[3, 4])]
    assert J.merge_runs([first, second]) == ([other], [])


def test_a_card_merged_in_one_run_stays_one_story_when_the_other_run_splits_it():
    """1회차는 3번과 9번 문장을 카드 하나로 합쳤고, 2회차는 3번에서 실패하고 9번을 따로 카드로 냈다. 합친 카드가 문장을
    전부 들고 있어 한 얘기로 묶이고, 같은 일의 카드가 두 장 서지 않는다."""
    first = [_o("item", A1, at=[3, 9])]
    second = [_o("failure", FB, at=[3]), _o("item", A2, at=[9])]
    assert J.merge_runs([first, second]) == ([A1], [])


def test_a_story_every_run_skips_goes_nowhere_and_the_items_keep_the_sentence_order():
    first = [_o("item", C, at=[7]), _o("skip", at=[1])]
    second = [_o("skip", at=[1]), _o("item", B, at=[5])]
    assert J.merge_runs([first, second]) == ([B, C], [])


def test_no_reply_judger_without_settings():
    assert J.reply_judger(_cfg(terra_api_key="")) is None
    assert J.reply_judger(_cfg(llm_mode="off")) is None
    assert J.reply_judger(_cfg(be_service_token="")) is None


def test_the_reply_judger_is_judge_reply():
    from judge.reply import judge_reply
    assert J.reply_judger(_cfg()) is judge_reply


def test_extract_passes_context_and_dates_to_run():
    """문맥은 본문과 같은 이름 꼬리표를 달아 넘기고, dates 는 그대로 넘긴다. 둘 다 없으면 run 은 예전 인자만 받는다."""
    seen = {}

    def run(transcript, *, workspace_id, today, candidates, **extra):
        seen.update(extra)
        return SimpleNamespace(items=[], failures=[], outcomes=[], dropped=empty_drops())

    extract, _ = _extractor(run)
    context = Transcript(segments=[TranscriptSegment(speaker="101", start=0.0, end=0.0, text="이전", seq=0)], source="meeting")
    dates = {2: date(2026, 11, 4)}
    extract(TRANSCRIPT, NAMES, date(2026, 11, 5), workspace_id="ws-1", context=context, dates=dates)
    assert [s.speaker for s in seen["context"].segments] == ["민수"]
    assert seen["dates"] == dates

    seen.clear()
    extract(TRANSCRIPT, NAMES, date(2026, 11, 5), workspace_id="ws-1")
    assert seen == {}
