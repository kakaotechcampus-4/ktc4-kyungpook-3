from datetime import datetime, timezone

from capture.chat_poll import clean_text, to_transcript


def _t(s):
    return datetime(2026, 10, 12, 10, 0, s, tzinfo=timezone.utc)


def test_to_transcript_keeps_human_messages_in_order():
    transcript = to_transcript([
        ("민수", False, _t(30), "로그인 API 금요일까지 할게요"),
        ("봇", True, _t(10), "회의록: ..."),
        ("하은", False, _t(0), "  로그인 언제 돼요?  "),
        ("하은", False, _t(40), ""),
    ])
    assert transcript.source == "chat"
    assert [(s.seq, s.speaker, s.start, s.text) for s in transcript.segments] == [
        (1, "하은", 0.0, "로그인 언제 돼요?"),
        (2, "민수", 30.0, "로그인 API 금요일까지 할게요"),
    ]


def test_reaction_line_stays_right_after_its_message():
    # fetch_messages 는 리액션 줄을 원래 메시지와 같은 시각으로 바로 뒤에 넣는다
    transcript = to_transcript([
        ("동우", False, _t(10), "검색 마감 다음 주로 미뤄도 될까요?"),
        ("지민", False, _t(10), "👍 (위 메시지에 반응)"),
        ("진호", False, _t(5), "결제 API 막혀 있어요"),
        ("재환", False, _t(20), "알겠습니다"),
    ])
    assert [s.speaker for s in transcript.segments] == ["진호", "동우", "지민", "재환"]
    assert transcript.segments[2].start == transcript.segments[1].start


def test_clean_text_names_mentions_and_drops_newlines():
    assert clean_text("<@111> 이거\n내일까지 <@!222> 확인", {111: "동우", 222: "진호"}) == "@동우 이거 내일까지 @진호 확인"
