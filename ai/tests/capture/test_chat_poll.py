import json
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from capture.chat_poll import ChannelUnreadable, DiscordReader, clean_text, message_dates, poll, poll_all, to_transcript
from capture.handoff import BeClient
from capture.judge_path import JudgeAllFailed, JudgeOutput
from tests.capture.fake_be import FakeBe


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


NOW = datetime(2026, 11, 4, 0, 0, tzinfo=timezone.utc)
CFG = SimpleNamespace(chat_poll_context_messages=30, chat_poll_initial_hours=24, chat_poll_max_days=14,
                      meeting_timezone="Asia/Seoul")


def _at(**kw):
    return NOW - timedelta(**kw)


class FakeReader:
    def __init__(self, messages=(), before=()):
        self.messages, self.before = list(messages), list(before)
        self.read_args, self.before_args = None, None
        self.closed = False
        self.read_error = None

    def close(self):
        self.closed = True

    def read(self, after, before):
        self.read_args = (after, before)
        if self.read_error:
            raise self.read_error
        return [m for m in self.messages if after < m[3] < before]   # Discord history 처럼 열린 구간

    def read_before(self, before, limit):
        self.before_args = (before, limit)
        older = sorted((m for m in self.before if m[3] < before), key=lambda m: m[3])
        return older[-limit:]


class FakeExtract:
    def __init__(self, items=(), error=None):
        self.items, self.error, self.seen = list(items), error, None

    def __call__(self, transcript, names, today, workspace_id=None, *, context=None, dates=None):
        self.seen = SimpleNamespace(transcript=transcript, names=names, today=today, workspace_id=workspace_id,
                                    context=context, dates=dates)
        if self.error:
            raise self.error
        return JudgeOutput(items=[dict(i) for i in self.items])


@pytest.fixture(autouse=True)
def _runs_dir(tmp_path, monkeypatch):
    # 시도 기록(runs/chat_poll_attempt_ws-1.json)이 실제 runs/ 에 남지 않게 한다
    monkeypatch.setattr("capture.chat_poll.RUNS_DIR", tmp_path)


def _env(cursor=None):
    fake = FakeBe()
    fake.chat_channels = list(CHANNELS)  # poll_all 이 워크스페이스마다 다시 받는 목록
    if cursor:
        fake.chat_cursors["ws-1"] = cursor.isoformat()
    return fake, BeClient("http://be.local", session=fake, service_token="svc-token")


def _paths(fake):
    return [(m, p) for m, p, _ in fake.calls]


def test_no_human_messages_creates_nothing():
    fake, client = _env()
    reader = FakeReader([("900", "봇", True, _at(hours=1), "회의록")])
    assert poll(reader, client, FakeExtract(), workspace_id="ws-1", now=NOW, cfg=CFG) == 0
    assert ("POST", "/meetings") not in _paths(fake)


def test_first_run_reads_initial_hours():
    fake, client = _env()
    reader = FakeReader()
    poll(reader, client, FakeExtract(), workspace_id="ws-1", now=NOW, cfg=CFG)
    assert reader.read_args == (datetime(2026, 11, 3, tzinfo=timezone.utc), NOW)


def test_message_at_cursor_is_skipped():
    cursor = _at(hours=5)
    fake, client = _env(cursor)
    reader = FakeReader([("1", "하은", False, cursor, "이미 처리"), ("1", "하은", False, _at(hours=4), "새 글")])
    poll(reader, client, FakeExtract(), workspace_id="ws-1", now=NOW, cfg=CFG)
    assert [s["text"] for s in fake.sources["m1"].values()] == ["새 글"]


def test_catch_up_sends_only_first_14_days_of_messages():
    cursor = _at(days=20)
    fake, client = _env(cursor)
    first = cursor + timedelta(days=1)
    reader = FakeReader([("1", "하은", False, first, "첫 글"),
                         ("1", "하은", False, first + timedelta(days=14), "경계"),
                         ("1", "하은", False, first + timedelta(days=14, seconds=1), "다음 실행")])
    poll(reader, client, FakeExtract(), workspace_id="ws-1", now=NOW, cfg=CFG)
    assert reader.read_args == (cursor, NOW)
    saved = list(fake.sources["m1"].values())
    assert [s["text"] for s in saved] == ["첫 글", "경계"]
    assert all(s["end"] <= 1_209_600 for s in saved)


def test_empty_window_after_cursor_does_not_stall():
    cursor = _at(days=20)
    fake, client = _env(cursor)
    reader = FakeReader([("1", "하은", False, cursor + timedelta(days=16), "한참 뒤 글")])
    assert poll(reader, client, FakeExtract(), workspace_id="ws-1", now=NOW, cfg=CFG) == 0
    assert [s["text"] for s in fake.sources["m1"].values()] == ["한참 뒤 글"]


def test_chat_poll_settings_survive_empty_env(monkeypatch):
    from shared.config import Settings  # noqa: F401 - 기본값은 import 시점에 정해진다
    import importlib
    import shared.config as config
    for k in ("CONTEXT_MESSAGES", "INITIAL_HOURS", "MAX_DAYS"):
        monkeypatch.setenv(f"CHAT_POLL_{k}", "")
    try:
        c = importlib.reload(config).Settings()
        assert (c.chat_poll_context_messages, c.chat_poll_initial_hours, c.chat_poll_max_days) == (30, 24, 14)
    finally:
        monkeypatch.undo()
        importlib.reload(config)


def test_max_days_is_capped_at_be_limit(monkeypatch):
    # BE 는 chat 발화 시각을 14일까지만 받는다. 더 크게 두면 매일 400 이 나서 커서가 멈춘다
    import importlib
    import shared.config as config
    monkeypatch.setenv("CHAT_POLL_MAX_DAYS", "30")
    try:
        assert importlib.reload(config).Settings().chat_poll_max_days == 14
    finally:
        monkeypatch.undo()
        importlib.reload(config)


def test_calls_in_order_and_cursor_lands_on_last_message():
    fake, client = _env()
    first, last = _at(hours=3), _at(hours=1)
    reader = FakeReader([("1", "하은", False, first, "로그인 언제?"), ("2", "민수", False, last, "금요일")])
    item = {"action": "create", "task_title": "로그인"}
    assert poll(reader, client, FakeExtract([item]), workspace_id="ws-1", now=NOW, cfg=CFG) == 0
    assert _paths(fake)[-4:] == [("POST", "/meetings"), ("PATCH", "/meetings/m1/end"),
                                 ("POST", "/meetings/m1/sources"), ("POST", "/extractions")]
    created = fake.calls[-4][2]
    assert created["source"] == "chat" and created["started_at"] == first.isoformat()
    assert created["title"] == "채팅 2026-11-04"          # 첫 메시지의 KST 날짜
    ends = [s["end"] for s in fake.sources["m1"].values()]
    assert first + timedelta(seconds=max(ends)) == last
    assert fake.extractions["m1"]["items"][0]["task_title"] == "로그인"


def test_extraction_sent_even_with_zero_items():
    fake, client = _env()
    reader = FakeReader([("1", "하은", False, _at(hours=1), "점심 뭐 먹지")])
    assert poll(reader, client, FakeExtract(), workspace_id="ws-1", now=NOW, cfg=CFG) == 0
    e = fake.extractions["m1"]
    assert e["items"] == [] and e["transcript_path"] is None and e["model_name"] is None


def test_judge_failure_marks_meeting_failed():
    fake, client = _env()
    reader = FakeReader([("1", "하은", False, _at(hours=1), "로그인 할게요")])
    assert poll(reader, client, FakeExtract(error=JudgeAllFailed("x")), workspace_id="ws-1", now=NOW, cfg=CFG) == 1
    assert fake.meetings["m1"]["status"] == "failed" and fake.meetings["m1"]["failed_stage"] == "extract"
    assert "m1" not in fake.extractions


def test_context_not_in_sources():
    fake, client = _env()
    first = _at(hours=1)
    reader = FakeReader([("1", "하은", False, first, "새 글")],
                        before=[("2", "민수", False, _at(hours=30), "옛 글\nsecond line")])
    extract = FakeExtract()
    poll(reader, client, extract, workspace_id="ws-1", now=NOW, cfg=CFG)
    assert reader.before_args == (first, 30)
    assert [s["text"] for s in fake.sources["m1"].values()] == ["새 글"]
    assert [s.text for s in extract.seen.context.segments] == ["옛 글 second line"]
    assert extract.seen.context.source == "chat"
    assert [s.text for s in extract.seen.transcript.segments] == ["새 글"]
    assert extract.seen.workspace_id == "ws-1"


def test_message_dates_are_kst():
    at = datetime(2026, 11, 3, 15, 30, tzinfo=timezone.utc)      # KST 로는 11-04 00:30
    msgs = [("1", "하은", False, at, "내일까지요")]
    assert message_dates(msgs, CFG.meeting_timezone) == {1: date(2026, 11, 4)}
    fake, client = _env()
    extract = FakeExtract()
    poll(FakeReader(msgs), client, extract, workspace_id="ws-1", now=NOW, cfg=CFG)
    assert extract.seen.dates == {1: date(2026, 11, 4)} and extract.seen.today == date(2026, 11, 4)


def test_dry_run_writes_nothing_to_be(tmp_path, monkeypatch):
    monkeypatch.setattr("capture.chat_poll.RUNS_DIR", tmp_path)
    fake, client = _env()
    reader = FakeReader([("1", "하은", False, _at(hours=1), "로그인 할게요")])
    assert poll(reader, client, FakeExtract([{"action": "create", "task_title": "로그인"}]),
                workspace_id="ws-1", now=NOW, cfg=CFG, dry_run=True) == 0
    assert all(m == "GET" for m, _ in _paths(fake))
    files = list(tmp_path.glob("chat_poll_*.json"))
    assert len(files) == 1 and files[0].name.startswith("chat_poll_ws-1_")
    assert json.loads(files[0].read_text(encoding="utf-8"))["workspace_id"] == "ws-1"


def test_repeated_failure_on_same_cursor_warns(capsys):
    cursor = _at(hours=5)
    msgs = [("1", "하은", False, _at(hours=4), "로그인 할게요")]
    for _ in range(2):
        fake, client = _env(cursor)
        assert poll(FakeReader(msgs), client, FakeExtract(error=JudgeAllFailed("x")), workspace_id="ws-1", now=NOW, cfg=CFG) == 1
    err = capsys.readouterr().err
    assert err.count("번째 시도") == 1 and "2번째 시도" in err


def test_success_clears_attempt_record(tmp_path, capsys):
    cursor = _at(hours=5)
    msgs = [("1", "하은", False, _at(hours=4), "로그인 할게요")]
    fake, client = _env(cursor)
    poll(FakeReader(msgs), client, FakeExtract(error=JudgeAllFailed("x")), workspace_id="ws-1", now=NOW, cfg=CFG)
    fake, client = _env(cursor)
    assert poll(FakeReader(msgs), client, FakeExtract(), workspace_id="ws-1", now=NOW, cfg=CFG) == 0
    assert not (tmp_path / "chat_poll_attempt_ws-1.json").exists()
    capsys.readouterr()   # 성공한 두 번째 실행도 시작할 때는 2번째 시도로 경고한다
    fake, client = _env(cursor)
    poll(FakeReader(msgs), client, FakeExtract(error=JudgeAllFailed("x")), workspace_id="ws-1", now=NOW, cfg=CFG)
    assert "번째 시도" not in capsys.readouterr().err


def test_first_run_failure_is_reread_by_next_run():
    # 커서가 없을 때 실패하면, 다음 날 실행도 now-24h 가 아니라 지난 실행의 시작점부터 읽는다
    msgs = [("1", "하은", False, _at(hours=20), "로그인 할게요")]
    fake, client = _env()
    assert poll(FakeReader(msgs), client, FakeExtract(error=JudgeAllFailed("x")), workspace_id="ws-1", now=NOW, cfg=CFG) == 1
    fake, client = _env()
    reader = FakeReader(msgs)
    assert poll(reader, client, FakeExtract(), workspace_id="ws-1", now=NOW + timedelta(days=1), cfg=CFG) == 0
    assert reader.read_args[0] == NOW - timedelta(hours=24)
    assert [s["text"] for s in fake.sources["m1"].values()] == ["로그인 할게요"]


def test_attempt_on_another_channel_starts_fresh(capsys):
    # 첫 실행이 실패한 뒤 채널이 바뀌면 옛 채널의 시작점을 이어받지 않고 새 시도로 센다(#431 리뷰)
    msgs = [("1", "하은", False, _at(hours=20), "로그인 할게요")]
    fake, client = _env()
    assert poll(FakeReader(msgs), client, FakeExtract(error=JudgeAllFailed("x")), workspace_id="ws-1",
                channel_id="1", now=NOW, cfg=CFG) == 1
    fake, client = _env()
    reader = FakeReader(msgs)
    later = NOW + timedelta(days=1)
    assert poll(reader, client, FakeExtract(), workspace_id="ws-1", channel_id="2", now=later, cfg=CFG) == 0
    assert reader.read_args[0] == later - timedelta(hours=24)
    assert "번째 시도" not in capsys.readouterr().err


def test_dry_run_leaves_no_attempt_record(tmp_path):
    fake, client = _env()
    poll(FakeReader([("1", "하은", False, _at(hours=1), "글")]), client,
         FakeExtract(error=JudgeAllFailed("x")), workspace_id="ws-1", now=NOW, cfg=CFG, dry_run=True)
    assert not (tmp_path / "chat_poll_attempt_ws-1.json").exists()


def test_attempt_records_are_per_workspace(tmp_path, capsys):
    cursor = _at(hours=5)
    msgs = [("1", "하은", False, _at(hours=4), "로그인 할게요")]
    for _ in range(2):
        fake, client = _env(cursor)
        assert poll(FakeReader(msgs), client, FakeExtract(error=JudgeAllFailed("x")),
                    workspace_id="ws-1", now=NOW, cfg=CFG) == 1
    assert "2번째 시도" in capsys.readouterr().err
    fake, client = _env()
    fake.chat_cursors["ws-2"] = cursor.isoformat()
    assert poll(FakeReader(msgs), client, FakeExtract(), workspace_id="ws-2", now=NOW, cfg=CFG) == 0
    assert "번째 시도" not in capsys.readouterr().err
    assert (tmp_path / "chat_poll_attempt_ws-1.json").exists()
    assert not (tmp_path / "chat_poll_attempt_ws-2.json").exists()


def test_poll_does_not_look_up_guild():
    fake, client = _env()
    reader = FakeReader([("1", "하은", False, _at(hours=1), "글")])
    assert poll(reader, client, FakeExtract(), workspace_id="ws-1", now=NOW, cfg=CFG) == 0
    assert not any("/integrations/discord/guilds/" in p for _, p in _paths(fake))


# --- poll_all ---

CHANNELS = [{"workspace_id": "ws-1", "guild_id": "g1", "channel_id": "1"},
            {"workspace_id": "ws-2", "guild_id": "g2", "channel_id": "2"}]


def _all(client, readers, extract=None, **kw):
    opened = []

    def open_reader(cid):
        opened.append(cid)
        return readers[cid]

    rc = poll_all(CHANNELS, open_reader, client, extract or FakeExtract(), now=NOW, cfg=CFG, **kw)
    return rc, opened


def _msg(text="글"):
    return [("1", "하은", False, _at(hours=1), text)]


def _meeting_workspaces(fake):
    return sorted(m["workspace_id"] for m in fake.meetings.values())


def test_poll_all_runs_each_workspace_with_its_channel():
    fake, client = _env()
    readers = {1: FakeReader(_msg()), 2: FakeReader(_msg())}
    rc, opened = _all(client, readers)
    assert rc == 0 and opened == [1, 2]
    assert _meeting_workspaces(fake) == ["ws-1", "ws-2"]
    assert readers[1].closed and readers[2].closed


def test_workspace_left_unfinished_last_time_runs_last(tmp_path, capsys):
    # 지난 실행이 끝내지 못한(시도 기록이 남은) 워크스페이스는 뒤로 보내 다른 곳이 시간 제한에 같이 막히지 않게 한다
    (tmp_path / "chat_poll_attempt_ws-1.json").write_text(json.dumps({"cursor": None, "after": None, "count": 1}),
                                                          encoding="utf-8")
    fake, client = _env()
    rc, opened = _all(client, {1: FakeReader(_msg()), 2: FakeReader(_msg())})
    assert rc == 0 and opened == [2, 1]
    out = capsys.readouterr().out
    assert out.index("[chat] ws=ws-2 시작") < out.index("[chat] ws=ws-1 시작")


def test_one_workspace_failure_does_not_stop_others():
    fake, client = _env()
    readers = {1: FakeReader(_msg()), 2: FakeReader(_msg())}

    class Extract(FakeExtract):
        def __call__(self, transcript, names, today, workspace_id=None, **kw):
            if workspace_id == "ws-1":
                raise JudgeAllFailed("x")
            return super().__call__(transcript, names, today, workspace_id, **kw)

    rc, _ = _all(client, readers, Extract())
    assert rc == 1
    assert [m["status"] for m in fake.meetings.values() if m["workspace_id"] == "ws-2"] == ["done"]


def test_error_before_meeting_is_contained():
    fake, client = _env()
    orig = fake.request

    def request(method, url, **kw):
        if "/workspaces/ws-1/chat-cursor" in url:
            from tests.capture.fake_be import _err
            return _err(500, "INTERNAL")
        return orig(method, url, **kw)

    fake.request = request
    readers = {1: FakeReader(_msg()), 2: FakeReader(_msg())}
    rc, _ = _all(client, readers)
    assert rc == 1
    assert _meeting_workspaces(fake) == ["ws-2"] and readers[1].closed


def test_workspace_dropped_from_list_mid_run_is_skipped(capsys):
    fake, client = _env()
    fake.chat_channels = [CHANNELS[0]]
    rc, opened = _all(client, {1: FakeReader(_msg()), 2: FakeReader(_msg())})
    assert rc == 0 and opened == [1]
    assert _meeting_workspaces(fake) == ["ws-1"]
    assert not any("ws-2/chat-cursor" in p for _, p in _paths(fake))
    out = capsys.readouterr().out
    assert "ws-2" in out and "건너뜁니다" in out


def test_workspace_whose_channel_changed_is_skipped():
    fake, client = _env()
    fake.chat_channels = [CHANNELS[0], {"workspace_id": "ws-2", "guild_id": "g2", "channel_id": "3"}]
    rc, opened = _all(client, {1: FakeReader(_msg()), 2: FakeReader(_msg())})
    assert rc == 0 and opened == [1] and _meeting_workspaces(fake) == ["ws-1"]


def test_channel_list_refetch_failure_skips_that_workspace_and_returns_1(capsys):
    fake, client = _env()
    orig = fake.request
    failed = []

    def request(method, url, **kw):
        if url.endswith("/bot/chat-channels") and not failed:
            failed.append(url)
            from tests.capture.fake_be import _err
            return _err(500, "INTERNAL")
        return orig(method, url, **kw)

    fake.request = request
    rc, opened = _all(client, {1: FakeReader(_msg()), 2: FakeReader(_msg())})
    assert rc == 1 and opened == [2] and _meeting_workspaces(fake) == ["ws-2"]
    assert "ws-1" in capsys.readouterr().err


def test_channel_list_is_refetched_before_each_workspace():
    fake, client = _env()
    _all(client, {1: FakeReader(_msg()), 2: FakeReader(_msg())})
    paths = [p for _, p in _paths(fake)]
    lists = [i for i, p in enumerate(paths) if p.endswith("/bot/chat-channels")]
    c1, c2 = paths.index("/workspaces/ws-1/chat-cursor"), paths.index("/workspaces/ws-2/chat-cursor")
    assert len(lists) == 2 and lists[0] < c1 < lists[1] < c2


def test_dry_run_also_skips_dropped_workspace():
    fake, client = _env()
    fake.chat_channels = [CHANNELS[0]]
    rc, opened = _all(client, {1: FakeReader(_msg()), 2: FakeReader(_msg())}, dry_run=True)
    assert rc == 0
    assert opened == [1] and ("POST", "/meetings") not in _paths(fake)


def test_only_workspace_dropped_on_refetch_is_skipped_with_rc_0():
    fake, client = _env()
    fake.chat_channels = [CHANNELS[0]]
    rc, opened = _all(client, {2: FakeReader(_msg())}, only="ws-2")
    assert rc == 0 and opened == []


def test_unreadable_channel_is_skipped_with_warning(capsys):
    fake, client = _env()
    bad = FakeReader(_msg())
    bad.read_error = ChannelUnreadable("403")
    readers = {1: bad, 2: FakeReader(_msg())}
    rc, _ = _all(client, readers)
    assert rc == 0
    assert _meeting_workspaces(fake) == ["ws-2"]
    assert "건너뜁니다" in capsys.readouterr().err and bad.closed


def test_discord_forbidden_and_notfound_become_channel_unreadable():
    import discord

    def raiser(exc):
        async def go():
            raise exc
        return go()

    reader = DiscordReader("t", 1)
    try:
        for exc in (discord.Forbidden(SimpleNamespace(status=403, reason="Forbidden"), "x"),
                    discord.NotFound(SimpleNamespace(status=404, reason="Not Found"), "x")):
            with pytest.raises(ChannelUnreadable) as ei:
                reader._run(raiser(exc))
            assert ei.value.__cause__ is exc
        with pytest.raises(discord.HTTPException):
            reader._run(raiser(discord.HTTPException(SimpleNamespace(status=500, reason="Err"), "x")))
    finally:
        reader.close()


def test_empty_channel_list_does_nothing():
    fake, client = _env()
    assert poll_all([], lambda cid: FakeReader(), client, FakeExtract(), now=NOW, cfg=CFG) == 0
    assert ("POST", "/meetings") not in _paths(fake)


def test_only_workspace_filters():
    fake, client = _env()
    rc, opened = _all(client, {1: FakeReader(_msg()), 2: FakeReader(_msg())}, only="ws-2")
    assert rc == 0 and opened == [2] and _meeting_workspaces(fake) == ["ws-2"]


def test_only_unknown_workspace_fails(capsys):
    fake, client = _env()
    rc, opened = _all(client, {}, only="ws-9")
    assert rc == 1 and opened == [] and ("POST", "/meetings") not in _paths(fake)
    assert "ws-9" in capsys.readouterr().err


def test_entry_missing_key_fails_only_that_entry():
    fake, client = _env()
    readers = {2: FakeReader(_msg())}
    rc = poll_all([{"workspace_id": "ws-1"}, CHANNELS[1]], lambda cid: readers[cid], client, FakeExtract(),
                  now=NOW, cfg=CFG)
    assert rc == 1 and _meeting_workspaces(fake) == ["ws-2"]


def _main_env(monkeypatch, *, token="tok", channels=None, error=None):
    import capture.chat_poll as cp
    from capture import handoff, judge_path

    seen = {}
    cfg = SimpleNamespace(discord_bot_token=token, be_base_url="http://be.local", be_service_token="s")

    class StubBe:
        def __init__(self, *a, **k):
            pass

        def chat_channels(self):
            if error:
                raise error
            return channels or []

    class StubReader:
        def __init__(self, tok, cid):
            seen["reader"] = (tok, cid)

    def fake_poll_all(chs, open_reader, client, extract, **kw):
        seen["only"] = kw["only"]
        open_reader(7)
        return 0

    monkeypatch.setattr(cp, "settings", lambda: cfg)
    monkeypatch.setattr(handoff, "BeClient", StubBe)
    monkeypatch.setattr(judge_path, "build_extractor", lambda **k: object())
    monkeypatch.setattr(cp, "DiscordReader", StubReader)
    monkeypatch.setattr(cp, "poll_all", fake_poll_all)
    return cp, seen


def test_main_without_bot_token_returns_1(monkeypatch):
    cp, _ = _main_env(monkeypatch, token="")
    monkeypatch.setattr("sys.argv", ["chat_poll"])
    assert cp.main() == 1


def test_main_chat_channels_error_returns_1(monkeypatch):
    from capture.handoff import BeError

    cp, _ = _main_env(monkeypatch, error=BeError("BAD_RESPONSE", "x"))
    monkeypatch.setattr("sys.argv", ["chat_poll"])
    assert cp.main() == 1


def test_main_passes_workspace_as_only_and_token_to_reader(monkeypatch):
    cp, seen = _main_env(monkeypatch)
    monkeypatch.setattr("sys.argv", ["chat_poll", "--workspace", "ws-2"])
    assert cp.main() == 0
    assert seen["only"] == "ws-2" and seen["reader"] == ("tok", 7)
