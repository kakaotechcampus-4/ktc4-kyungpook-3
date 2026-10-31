from datetime import date, datetime, timezone
from types import SimpleNamespace

from capture.chat_poll import clean_text, judge_chat, to_transcript


def _t(s):
    return datetime(2026, 10, 12, 10, 0, s, tzinfo=timezone.utc)


def test_to_transcript_keeps_human_messages_in_order():
    """화자는 음성 회의처럼 작성자 uid 다. 표시 이름은 {uid: 이름} 으로 따로 돌려준다."""
    transcript, names = to_transcript([
        ("202", "민수", False, _t(30), "로그인 API 금요일까지 할게요"),
        ("900", "봇", True, _t(10), "회의록: ..."),
        ("101", "하은", False, _t(0), "  로그인 언제 돼요?  "),
        ("101", "하은", False, _t(40), ""),
    ])
    assert transcript.source == "chat"
    assert [(s.seq, s.speaker, s.start, s.text) for s in transcript.segments] == [
        (1, "101", 0.0, "로그인 언제 돼요?"),
        (2, "202", 30.0, "로그인 API 금요일까지 할게요"),
    ]
    assert names == {"101": "하은", "202": "민수"}   # 빠진 메시지(봇)의 작성자는 없다


def test_reaction_line_stays_right_after_its_message():
    # fetch_messages 는 리액션 줄을 누른 사람의 uid 로, 원래 메시지와 같은 시각으로 바로 뒤에 넣는다
    transcript, names = to_transcript([
        ("1", "동우", False, _t(10), "검색 마감 다음 주로 미뤄도 될까요?"),
        ("2", "지민", False, _t(10), "👍 (위 메시지에 반응)"),
        ("3", "진호", False, _t(5), "결제 API 막혀 있어요"),
        ("4", "재환", False, _t(20), "알겠습니다"),
    ])
    assert [s.speaker for s in transcript.segments] == ["3", "1", "2", "4"]
    assert transcript.segments[2].start == transcript.segments[1].start
    assert names["2"] == "지민"


def test_to_transcript_of_nothing_is_empty():
    transcript, names = to_transcript([("900", "봇", True, _t(0), "회의록: ...")])
    assert transcript.segments == [] and names == {}


def test_clean_text_names_mentions_and_drops_newlines():
    assert clean_text("<@111> 이거\n내일까지 <@!222> 확인", {111: "동우", 222: "진호"}) == "@동우 이거 내일까지 @진호 확인"


def _judge_cfg(**over):
    base = dict(terra_api_key="k", terra_base_url="http://terra", luna_api_key="k", luna_base_url="http://luna",
                be_base_url="", be_service_token="", llm_mode="")
    base.update(over)
    return SimpleNamespace(**base)


class _FakeRun:
    def __init__(self, items=(), failures=()):
        self.items, self.failures, self.seen = list(items), list(failures), None

    def __call__(self, transcript, *, workspace_id, today, candidates):
        self.seen = SimpleNamespace(transcript=transcript, workspace_id=workspace_id, today=today, candidates=candidates)
        return SimpleNamespace(items=[dict(i) for i in self.items], failures=list(self.failures), dropped={})


def test_judge_chat_goes_through_the_judge_path_without_be_settings():
    """판단은 음성과 같은 capture.judge_path 추출기로 돈다. 유사 검색을 끼우므로 BE 설정이 비어 있어도 된다.

    LLM 은 이름을 보고, 돌아온 evidence_speaker 는 uid 로 되돌아온다. 그래야 BE 가 1인칭 담당자를 uid 로 찾는다.
    """
    transcript, names = to_transcript([("202", "민수", False, _t(0), "로그인 API 금요일까지 할게요")])
    item = {"action": "create", "target_task_id": None, "category": "decision", "task_title": "로그인 API",
            "due_date": None, "status": None, "assignee_raw": "민수", "doc_text": "민수가 로그인 API 를 맡음",
            "evidence_speaker": "민수"}
    run, candidates = _FakeRun([item]), object()
    out, missing = judge_chat(transcript, names, date(2026, 10, 12), candidates, run=run, cfg=_judge_cfg())
    assert missing == []
    assert run.seen.candidates is candidates
    assert run.seen.workspace_id == "chat_poll"
    assert [s.speaker for s in run.seen.transcript.segments] == ["민수"]
    assert out.items[0]["evidence_speaker"] == "202"


def test_judge_chat_names_missing_llm_settings():
    transcript, names = to_transcript([("202", "민수", False, _t(0), "로그인 API 금요일까지 할게요")])
    run = _FakeRun()
    out, missing = judge_chat(transcript, names, date(2026, 10, 12), object(), run=run,
                              cfg=_judge_cfg(terra_api_key=""))
    assert out is None
    assert missing == ["TERRA_API_KEY"]
    assert run.seen is None
