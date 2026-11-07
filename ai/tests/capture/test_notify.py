"""회의 처리 알림(capture/notify.py). 워커가 단계가 끝날 때마다 그 회의의 채널에 올린다. 채널은 가짜다."""

from pathlib import Path

from capture import notify as N


class FakeNotifier:
    def __init__(self, fail=False):
        self.sent = []
        self.fail = fail

    def send(self, channel_id, text, file=None):
        if self.fail:
            raise RuntimeError("디스코드 500")
        self.sent.append((channel_id, text, file))
        return True


MANIFEST = {"session": "77_500", "guild_id": "77", "text_channel_id": "900", "status": "saved"}
ITEMS = [{"action": "create", "doc_text": "와이어프레임을 재환이 금요일까지 그리기로 함"},
         {"action": "update", "doc_text": "로그인 마감을 다음 주로 미루기로 함"}]


def _done(rep, stage, **result):
    rep.progress("done", {"stage": stage, "result": result})


def _texts(n):
    return [t for _, t, _ in n.sent]


def test_each_finished_stage_is_said_once_in_the_meetings_channel(tmp_path):
    n = FakeNotifier()
    rep = N.MeetingReporter(n, dict(MANIFEST))
    rep.started()
    rep.progress("stt")                                            # 단계 시작은 디버그에서만 말한다
    rep.progress("stt", {"done": 1, "sent": 2, "tracks": 1, "tracks_total": 2})
    _done(rep, "transcribed", transcribe={"lines": 12, "failed": 0, "markdown": str(tmp_path / "t.md")})
    _done(rep, "sourced", sources={"inserted": 12, "skipped": 0})
    _done(rep, "extracted", items=ITEMS)
    _done(rep, "handed_off", be={"meeting_id": "m1", "item_count": 2})
    assert _texts(n) == ["⏳ 회의 처리를 시작합니다.", "📝 전사를 마쳤습니다. 줄 12개.", "🗂 웹 회의록에 12줄을 올렸습니다.",
                         "📋 할 일 후보 2건을 찾았습니다.", "📨 웹에 올렸습니다. PM 승인을 기다리는 항목 2건."]
    assert {c for c, _, _ in n.sent} == {"900"} and all(f is None for _, _, f in n.sent)


def test_debug_adds_stage_starts_the_transcript_file_the_items_and_the_processing_line(tmp_path):
    n = FakeNotifier()
    rep = N.MeetingReporter(n, dict(MANIFEST), debug=True)
    rep.progress("stt")
    _done(rep, "transcribed", transcribe={"lines": 3, "failed": 0, "markdown": str(tmp_path / "t.md")})
    _done(rep, "extracted", items=ITEMS)
    rep.finished({"session": "77_500", "status": "handed_off", "ran": ["transcribed", "extracted", "handed_off"],
                  "ops": {"wall_s": 42.0, "wait_s": 3.0, "peak_rss_bytes": 300 * 1024 ** 2}})
    texts = _texts(n)
    assert texts[0] == "🎧 전사 시작" and n.sent[1][2] == Path(tmp_path / "t.md")
    assert "와이어프레임을 재환이 금요일까지 그리기로 함" in texts[2] and "새 항목 1, 수정 1" in texts[2]
    assert texts[-1].startswith("⏱ 처리 42초") and "최대 메모리 300MB" in texts[-1]


def test_a_meeting_without_a_channel_or_a_notifier_is_not_announced():
    """녹음 파일 업로드처럼 채널이 없는 회의, 봇 토큰이 없는 워커는 알리지 않는다."""
    n = FakeNotifier()
    rep = N.MeetingReporter(n, {"session": "x", "status": "saved"})
    rep.started()
    _done(rep, "transcribed", transcribe={"lines": 1, "failed": 0, "markdown": "t.md"})
    assert n.sent == []
    N.MeetingReporter(None, dict(MANIFEST)).started()


def test_nothing_is_said_when_a_pass_changes_nothing():
    """설정이 없어 멈춘 회의, 연결을 기다리는 회의는 워커가 바퀴마다 다시 집는다. 바뀐 것이 없으면 조용하다."""
    n = FakeNotifier()
    rep = N.MeetingReporter(n, dict(MANIFEST, status="transcribed"))
    rep.started()                                                    # 처음 처리가 아니다
    rep.finished({"session": "77_500", "status": "transcribed", "ran": [], "skipped": {"extracted": "LLM 설정 없음"}})
    waiting = N.MeetingReporter(n, dict(MANIFEST, workspace_wait="2026-10-13T00:00:00+00:00"))
    waiting.started()
    waiting.finished({"session": "77_500", "status": "saved", "ran": [], "workspace": "not_connected"})
    assert n.sent == []


def test_a_meeting_waiting_for_the_connection_is_said_once():
    """연결이 없는 서버의 회의는 워커가 연결될 때까지 바퀴마다 다시 집는다. 기다리기 시작할 때 한 번만 알린다."""
    n = FakeNotifier()
    waiting = {"session": "77_500", "status": "saved", "ran": [], "workspace": "not_connected",
               "skipped": {"sourced": "x", "extracted": "x", "handed_off": "x"}}
    rep = N.MeetingReporter(n, dict(MANIFEST))
    rep.started()
    rep.finished(waiting)
    assert _texts(n) == ["⏳ 회의 처리를 시작합니다.", N.NOT_CONNECTED_WAIT]
    again = N.MeetingReporter(n, dict(MANIFEST, workspace_wait="2026-10-13T00:00:00+00:00"))
    again.started()
    again.finished(waiting)
    assert len(n.sent) == 2


def test_a_failure_is_said_the_first_time_and_when_the_retries_give_up():
    n = FakeNotifier()
    fail = {"session": "77_500", "status": "failed", "ran": ["transcribed"], "failed_stage": "extract",
            "error": "RuntimeError: Terra 응답 없음", "attempts": 1, "retry_in_s": 60.0}
    N.MeetingReporter(n, dict(MANIFEST)).finished(fail)
    assert _texts(n) == ["⚠️ 할일 추출 실패: RuntimeError: Terra 응답 없음. 1분 뒤 이 단계부터 자동으로 다시 시도합니다(실패 1회)."]
    failed = dict(MANIFEST, status="failed", stages={"transcribed": "x"})
    N.MeetingReporter(n, failed).finished(dict(fail, ran=[], attempts=2, retry_in_s=120.0))
    assert len(n.sent) == 1                                          # 예약된 재시도의 실패는 로그로만
    N.MeetingReporter(n, failed).finished(dict(fail, ran=[], attempts=5, retry_in_s=None, gave_up=True))
    assert "실패 5회로 자동 재시도를 멈췄습니다" in n.sent[-1][1]
    assert "python -m capture.worker --retry 77" in n.sent[-1][1]


def test_warnings_from_the_be_and_the_judge_are_said():
    n = FakeNotifier()
    rep = N.MeetingReporter(n, dict(MANIFEST))
    _done(rep, "handed_off", be={"meeting_id": "m1", "item_count": 3, "dropped_items": 1, "stale_extraction": True})
    rep.finished({"session": "77_500", "status": "handed_off", "ran": ["extracted", "handed_off"],
                  "items": ITEMS, "extract_failures": [{"stage": "judge", "text": "소셜 로그인은 빼기로 함", "reason": "x"}],
                  "partial": True, "missing_units": 2, "skipped": {"sourced": "BE_SERVICE_TOKEN 없음"}})
    texts = "\n".join(_texts(n))
    assert "BE 가 항목 1건을 받지 않았습니다" in texts and "예전 추출이 남아 있습니다" in texts
    assert "판단하지 못한 발화 1건" in texts and "빠진 구간 2개" in texts and "건너뛴 단계: 회의록 저장 (BE_SERVICE_TOKEN 없음)" in texts


def test_a_partial_transcription_says_the_retry():
    n = FakeNotifier()
    N.MeetingReporter(n, dict(MANIFEST)).finished(
        {"session": "77_500", "status": "partial", "ran": ["transcribed"], "attempts": 1, "retry_in_s": 60.0,
         "transcribe": {"lines": 9, "failed": 2, "markdown": "t.md"}})
    assert _texts(n) == ["⚠️ 전사 실패 2줄. 이 회의는 아직 끝나지 않았습니다. 1분 뒤 그 구간만 자동으로 다시 보냅니다(실패 1회)."]


def test_a_failing_channel_does_not_stop_reporting():
    rep = N.MeetingReporter(FakeNotifier(fail=True), dict(MANIFEST), debug=True)
    rep.started()
    _done(rep, "transcribed", transcribe={"lines": 1, "failed": 0, "markdown": "t.md"})
    rep.finished({"session": "77_500", "status": "failed", "ran": [], "attempts": 1, "failed_stage": "stt",
                  "error": "x", "retry_in_s": 60.0})


def test_long_item_lists_stay_under_the_message_limit():
    n = FakeNotifier()
    rep = N.MeetingReporter(n, dict(MANIFEST), debug=True)
    _done(rep, "extracted", items=[{"action": "create", "doc_text": "가" * 400} for _ in range(40)])
    assert len(n.sent[0][1]) <= N.MESSAGE_MAX and "외 30건" in n.sent[0][1]
