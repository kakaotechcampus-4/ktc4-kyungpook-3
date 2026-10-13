from datetime import datetime, timezone

from capture.chat_poll import to_transcript


def test_to_transcript_keeps_human_messages_in_order():
    t = lambda s: datetime(2026, 10, 12, 10, 0, s, tzinfo=timezone.utc)
    transcript = to_transcript([
        ("민수", False, t(30), "로그인 API 금요일까지 할게요"),
        ("봇", True, t(10), "회의록: ..."),
        ("하은", False, t(0), "  로그인 언제 돼요?  "),
        ("하은", False, t(40), ""),
    ])
    assert transcript.source == "chat"
    assert [(s.seq, s.speaker, s.start, s.text) for s in transcript.segments] == [
        (1, "하은", 0.0, "로그인 언제 돼요?"),
        (2, "민수", 30.0, "로그인 API 금요일까지 할게요"),
    ]
