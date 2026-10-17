"""녹음 Cog. 가짜 디스코드 객체로 /record → 트랙 → /stop → 저장, 그 뒤 워커 한 바퀴 → 우편함 → 채널 흐름을 본다. 모델은 안 쓴다."""

import asyncio
import json
import threading

import numpy as np

from capture import discord_adapter as A
from capture import handoff as H
from capture import recorder as R
from capture.streaming_sink import StreamingSink
from stt.backend import SttResult, Word
from tests.capture.fake_be import FakeBe

GUILD_ID = 77
ROOM_ID = 5
TEXT_ID = 900


class EchoStt:
    name = "echo"

    def transcribe(self, samples, sample_rate):
        dur = len(samples) / sample_rate
        ws = [Word(text=f"w{t:.2f}", start_s=t - 0.05, end_s=t + 0.05) for t in np.arange(0.25, dur, 0.5)]
        return SttResult(text=" ".join(w.text for w in ws), words=ws)


class FakeMember:
    def __init__(self, uid, name, guild=None):
        self.id, self.display_name, self.guild = uid, name, guild
        self.mention = f"<@{uid}>"


class FakeMessage:
    def __init__(self, text):
        self.content = text
        self.edits = []

    async def edit(self, *, content):
        self.edits.append(content)
        self.content = content


class FakeTextChannel:
    def __init__(self, cid=TEXT_ID):
        self.id = cid
        self.sent = []
        self.messages = []         # sent 와 같은 순서의 메시지. 진행 표시가 고친 내용을 본다
        self.fail_first = 0        # 처음 몇 번의 send 를 실패시킨다

    async def send(self, text, file=None):
        if self.fail_first > 0:
            self.fail_first -= 1
            raise RuntimeError("디스코드 429")
        self.sent.append((text, file))
        self.messages.append(FakeMessage(text))
        return self.messages[-1]


class FakeVoiceChannel:
    def __init__(self):
        self.id, self.name = ROOM_ID, "회의방"


class FakeVC:
    """py-cord 처럼 stop_recording 안에서 콜백을 동기로 부른다."""

    def __init__(self, channel):
        self.channel = channel
        self.started = None
        self.disconnected = 0

    def is_connected(self):
        return True

    def is_recording(self):
        return self.started is not None

    def start_recording(self, sink, callback, *args):
        self.started = (sink, callback, args)

    def stop_recording(self):
        sink, callback, args = self.started
        self.started = None
        sink.cleanup()
        callback(sink, *args)

    async def disconnect(self, *, force=False):
        self.disconnected += 1
        self.started = None


class FakeGuild:
    def __init__(self, members, vc, gid=GUILD_ID):
        self.id, self.name = gid, "테스트 서버"
        self._members = members
        self.voice_client = vc

    def get_member(self, uid):
        return self._members.get(uid)

    @property
    def members(self):
        return list(self._members.values())


class FakeBot:
    def __init__(self, guild, channels=()):
        self._guild = guild
        self._channels = {c.id: c for c in channels}
        self.user = FakeMember(1000, "봇")

    def get_guild(self, guild_id):
        return self._guild if guild_id == self._guild.id else None

    def get_channel(self, cid):
        return self._channels.get(cid)


class FakeCtx:
    def __init__(self, guild, vc, channel):
        self.guild, self.voice_client, self.channel = guild, vc, channel
        self.responses = []
        self.deferred = False

    async def defer(self, ephemeral=False):
        self.deferred = True

    async def respond(self, text, ephemeral=False):
        self.responses.append(text)


class State:
    def __init__(self, channel):
        self.channel = channel


class Task:
    def __init__(self, sentence):
        self.sentence = sentence

    def to_dict(self):
        return {"task": "와이어프레임 그리기", "assignee_member_id": None, "due_date": "2026-09-18",
                "assignee_mention": None, "source_sentence": self.sentence, "assignee_type": "first",
                "due_raw": "내일", "due_status": "certain"}


def first_person_extractor(transcript, names, today, workspace_id=None):
    return [Task(transcript.segments[0].text)]


async def _run(command, cog, ctx):
    """슬래시 명령 객체의 본체를 Cog 에 묶어 부른다. 봇 없이 Cog 만 만들었을 때의 호출법."""
    return await command.callback(cog, ctx)


def _setup(tmp_path, *, handoff=None):
    room = FakeVoiceChannel()
    vc = FakeVC(room)
    members = {1: FakeMember(1, "민수"), 2: FakeMember(2, "서연")}
    guild = FakeGuild(members, vc)
    for m in members.values():
        m.guild = guild
    channel = FakeTextChannel()
    bot = FakeBot(guild, channels=[channel])
    bot.user.guild = guild
    cog = A.RecordingCog(bot, recordings_dir=tmp_path / "recordings", handoff_factory=lambda: handoff)
    return cog, guild, vc, channel, FakeCtx(guild, vc, channel)


def _worker(tmp_path, *, extractor=None, handoff=None):
    """봇이 저장한 회의를 처리하는 워커. 알림은 봇이 읽는 우편함에 쓴다."""
    from capture.worker import Worker

    return Worker(tmp_path / "recordings", transcripts_dir=tmp_path / "transcripts",
                  stt_factory=lambda: (EchoStt(), "echo", 1), gate_factory=lambda: None,
                  extractor_factory=lambda: extractor, handoff_factory=lambda: handoff, interval_s=3600.0, debug=False)


def _tone(ms, sr=16_000):
    t = np.arange(int(sr * ms / 1000)) / sr
    return (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def _manifest(tmp_path, rec):
    return json.loads((tmp_path / "recordings" / f"session_{rec.meeting_id}.json").read_text(encoding="utf-8"))


async def test_record_writes_a_recording_manifest_and_announces(tmp_path):
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    await _run(A.RecordingCog.record, cog, ctx)
    assert isinstance(vc.started[0], StreamingSink)
    assert ctx.responses == [A.NOTICE]
    rec = cog._active[GUILD_ID]
    assert rec.meeting_id == f"{GUILD_ID}_{rec.ts}"
    m = _manifest(tmp_path, rec)
    assert m["status"] == "recording" and m["speakers"] == [] and m["meeting_dir"] == rec.meeting_id
    assert m["session"] == rec.meeting_id and m["guild_id"] == str(GUILD_ID) and m["text_channel_id"] == str(TEXT_ID)
    assert m["voice_channel_id"] == str(ROOM_ID) and m["timezone"] == "Asia/Seoul" and m["be"] == {}
    await _run(A.RecordingCog.leave, cog, ctx)
    assert "녹음 중" in ctx.responses[-1] and vc.disconnected == 0     # 녹음 중 퇴장은 거절
    rec.flush_task.cancel()


async def test_record_during_a_deploy_restart_does_not_start_recording(tmp_path):
    """배포는 녹음 확인부터 봇 재시작까지 재시작 잠금을 쥔다(#215). 그 사이 /record 는 곧 끊길 녹음을 시작하지 않는다."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    deploy = R.try_restart_lock(tmp_path / "recordings")        # 배포 스크립트의 flock 자리
    await _run(A.RecordingCog.record, cog, ctx)
    assert ctx.responses == [A.DEPLOYING_NOTICE] and vc.started is None and GUILD_ID not in cog._active
    assert not list((tmp_path / "recordings").glob("session_*"))
    deploy.release()
    await _run(A.RecordingCog.record, cog, ctx)                  # 배포가 끝나면 시작한다
    assert ctx.responses[-1] == A.NOTICE and vc.started is not None
    cog._active[GUILD_ID].flush_task.cancel()


async def test_record_holds_the_restart_lock_until_the_recording_manifest_and_meeting_lock_exist(tmp_path, monkeypatch):
    """배포는 재시작 잠금을 잡은 뒤 recording 매니페스트의 회의 잠금이 잡혀 있으면 녹음 중으로 보고 재시작을 건너뛴다.
    그래서 봇은 회의 잠금을 잡고 매니페스트를 쓰기 전에는 재시작 잠금을 놓지 않는다(#215)."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    recordings = tmp_path / "recordings"
    seen = []
    real = R.try_restart_lock

    def spy(d):
        seen.append(("잡음", [p.name for p in d.glob("session_*.json")]))
        lock = real(d)
        let_go = lock.release

        def release():
            m = next(d.glob("session_*.json"))
            seen.append(("놓음", json.loads(m.read_text(encoding="utf-8"))["status"], R.try_lock(m) is None))
            let_go()

        lock.release = release
        return lock

    monkeypatch.setattr(A, "try_restart_lock", spy)
    await _run(A.RecordingCog.record, cog, ctx)
    assert seen == [("잡음", []), ("놓음", "recording", True)]
    free = R.try_restart_lock(recordings)                        # /record 가 끝나면 놓여 있다
    assert free is not None
    free.release()
    cog._active[GUILD_ID].flush_task.cancel()


async def test_record_starts_without_a_restart_lock_file_and_leaves_one(tmp_path):
    """배포가 한 번도 돌지 않아 잠금 파일이 없어도 녹음은 시작한다(#215)."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    assert not (tmp_path / "recordings" / "restart.lock").exists()
    await _run(A.RecordingCog.record, cog, ctx)
    assert ctx.responses == [A.NOTICE] and (tmp_path / "recordings" / "restart.lock").exists()
    cog._active[GUILD_ID].flush_task.cancel()


async def test_stop_saves_the_tracks_and_the_workers_notes_reach_the_channel(tmp_path):
    """봇은 저장까지 하고 워커를 찌른다. 워커가 단계마다 우편함에 쓴 알림을 봇이 그 채널에 올린다(결정 기록 0026)."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    hooked = []

    async def hook(manifest, path):
        hooked.append((manifest, path))

    cog.on_session_saved = hook
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    # 패킷 대신 sink 훅으로 샘플을 넣는다. 위치는 도착 시각(ms)이다
    rec.sink.on_samples(1, _tone(2000), 0)
    rec.sink.on_samples(2, _tone(3000), 5000)
    rec.sink.on_samples(1, _tone(2000), 10_000)
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    m = _manifest(tmp_path, rec)
    assert m["status"] == "saved" and [e["display_name"] for e in m["speakers"]] == ["민수", "서연"]
    assert len(hooked) == 1 and hooked[0][0]["status"] == "saved"
    assert (tmp_path / "recordings" / ".worker" / "nudge").exists()             # 워커를 찔렀다
    assert channel.sent[-1][0].startswith("✅ 녹음을 저장했습니다(화자 2명). 처리 진행은 이 채널에 올라옵니다(앞에 0건)")
    assert not R.is_locked(R.manifest_path(tmp_path / "recordings", rec.meeting_id))   # 잠금을 놓았다
    await _worker(tmp_path).run_pass()
    await cog._drain_outbox()
    texts = [t for t, _ in channel.sent]
    assert [t.split(" ", 1)[0] for t in texts[-3:]] == ["⏳", "📝", "ℹ️"]           # 시작, 전사, 건너뛴 단계
    assert not list((tmp_path / "recordings" / ".worker" / "outbox").glob("*.json"))   # 올린 알림은 지운다
    assert GUILD_ID not in cog._active and rec.meeting_id not in cog._processing and vc.started is None


async def test_record_creates_the_be_meeting_and_the_worker_hands_the_tasks_off(tmp_path):
    fake = FakeBe()
    fake.guilds = {str(GUILD_ID): "ws-1"}           # 이 서버는 웹에서 ws-1 에 연결돼 있다
    handoff = H.Handoff(H.BeClient("http://be", session=fake, service_token="svc-token"))
    cog, guild, vc, channel, ctx = _setup(tmp_path, handoff=handoff)
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    assert rec.be["meeting_id"] == "m1" and _manifest(tmp_path, rec)["be"]["meeting_id"] == "m1"
    assert rec.workspace_id == "ws-1" and _manifest(tmp_path, rec)["workspace_id"] == "ws-1"
    assert fake.calls[0][:2] == ("GET", f"/integrations/discord/guilds/{GUILD_ID}/workspace")
    assert fake.calls[1][2]["title"].startswith("회의방 ") and fake.calls[1][2]["workspace_id"] == "ws-1"
    rec.sink.on_samples(1, _tone(2000), 0)
    rec.sink.on_samples(2, _tone(3000), 5000)
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    await _worker(tmp_path, extractor=first_person_extractor, handoff=handoff).run_pass()
    m = _manifest(tmp_path, rec)
    assert m["status"] == "handed_off" and set(m["stages"]) == {"transcribed", "sourced", "extracted", "handed_off"}
    assert [c[1] for c in fake.calls] == [f"/integrations/discord/guilds/{GUILD_ID}/workspace", "/meetings",
                                          "/meetings/m1/end", "/meetings/m1/sources", "/extractions"]
    sent = fake.calls[4][2]["items"][0]
    assert sent["evidence_speaker"] == "1" and sent["assignee_type"] == "first" and sent["assignee_raw"] is None
    await cog._drain_outbox()
    assert [t.split(" ", 1)[0] for t, _ in channel.sent][-5:] == ["⏳", "📝", "🗂", "📋", "📨"]


async def test_be_being_down_at_record_does_not_stop_the_recording(tmp_path):
    fake = FakeBe()
    fake.guilds = {str(GUILD_ID): "ws-1"}           # 이 서버는 웹에서 ws-1 에 연결돼 있다
    fake.down = True
    handoff = H.Handoff(H.BeClient("http://be", session=fake, service_token="svc-token"))
    cog, guild, vc, channel, ctx = _setup(tmp_path, handoff=handoff)
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    assert "meeting_id" not in rec.be and "NETWORK" in rec.be["error"] and vc.started is not None
    rec.sink.on_samples(1, _tone(2000), 0)
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    fake.down = False                                           # 워커가 처리할 때는 BE 가 살아났다
    await _worker(tmp_path, extractor=first_person_extractor, handoff=handoff).run_pass()
    m = _manifest(tmp_path, rec)
    assert m["status"] == "handed_off" and m["be"]["meeting_id"] == "m1"     # 인계 단계가 회의를 만들었다
    assert m["workspace_id"] == "ws-1"                                       # 처리할 때 다시 물어 찾았다


def test_the_unconnected_notices_say_who_connects_it_and_where():
    """연결은 PM 이 웹 온보딩의 디스코드 연결 단계에서 한다. 설정 화면에는 아직 디스코드 연결이 없다(#199)."""
    from capture.notify import NOT_CONNECTED_WAIT

    for text in (A.NOT_CONNECTED_REFUSED, NOT_CONNECTED_WAIT):
        assert "PM" in text and "온보딩" in text and "설정" not in text


async def test_record_in_an_unconnected_server_refuses_and_says_how_to_connect(tmp_path):
    """봇은 서버에 있는데 웹에서 연결이 없다(#199). 녹음을 시작하지 않고, 회의 전에 누가 어디서 연결하는지 알린다."""
    fake = FakeBe()                                             # 이 서버는 연결이 없다
    handoff = H.Handoff(H.BeClient("http://be", session=fake, service_token="svc-token"))
    cog, guild, vc, channel, ctx = _setup(tmp_path, handoff=handoff)
    await _run(A.RecordingCog.record, cog, ctx)
    assert ctx.deferred and ctx.responses == [A.NOT_CONNECTED_REFUSED]   # BE 를 묻는 동안 3초 응답 기한을 넘기지 않는다
    assert vc.started is None and GUILD_ID not in cog._active
    assert not list((tmp_path / "recordings").glob("session_*"))        # 매니페스트도 회의 잠금도 남기지 않는다
    assert [c[1] for c in fake.calls] == [f"/integrations/discord/guilds/{GUILD_ID}/workspace"]


class SlowHandoff:
    """워크스페이스 조회가 풀어 줄 때까지 걸리는 인계. 조회 중에 다른 /record 가 들어오는 틈을 만든다."""

    def __init__(self):
        self.release = threading.Event()
        self.asked = 0

    def workspace(self, meta):
        self.asked += 1
        self.release.wait(5)
        meta["workspace_id"] = "ws-1"
        return "ws-1"

    def start(self, meta, *, title=None):
        return meta.setdefault("be", {})


async def test_two_records_while_the_workspace_is_looked_up_start_only_one_recording(tmp_path):
    """녹음 전에 BE 를 묻는 동안 같은 서버의 /record 가 하나 더 와도 녹음은 하나만 시작한다(#199)."""
    handoff = SlowHandoff()
    cog, guild, vc, channel, ctx = _setup(tmp_path, handoff=handoff)
    other = FakeCtx(guild, vc, channel)
    first = asyncio.create_task(_run(A.RecordingCog.record, cog, ctx))
    second = asyncio.create_task(_run(A.RecordingCog.record, cog, other))
    for _ in range(200):
        if handoff.asked == 2:
            break
        await asyncio.sleep(0.01)
    assert handoff.asked == 2                                   # 둘 다 조회까지 왔다
    handoff.release.set()
    await asyncio.gather(first, second)
    assert sorted([ctx.responses, other.responses]) == sorted([[A.NOTICE], ["이미 녹음 중입니다. `/stop` 으로 먼저 종료하세요."]])
    assert len(list((tmp_path / "recordings").glob("session_*.json"))) == 1
    cog._active[GUILD_ID].flush_task.cancel()


async def test_a_failing_channel_does_not_block_the_save_or_the_done_signal(tmp_path):
    """저장 완료 알림이 실패해도 매니페스트는 saved 이고 잠금은 놓이고 done 은 켜진다."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    rec.sink.on_samples(1, _tone(2000), 0)
    channel.fail_first = 5
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    assert _manifest(tmp_path, rec)["status"] == "saved" and rec.meeting_id not in cog._processing
    assert not R.is_locked(R.manifest_path(tmp_path / "recordings", rec.meeting_id))


async def test_a_note_that_cannot_be_posted_waits_for_the_next_round_and_an_old_one_is_dropped(tmp_path):
    """우편함 알림을 올리지 못하면 순서를 지키려고 거기서 멈추고 다음 바퀴에 다시 올린다. 오래된 것은 버린다."""
    from capture.notify import FileOutbox

    cog, guild, vc, channel, ctx = _setup(tmp_path)
    box = FileOutbox(tmp_path / "recordings")
    box.send(str(TEXT_ID), "하나")
    box.send(str(TEXT_ID), "둘")
    channel.fail_first = 1
    await cog._drain_outbox()
    assert channel.sent == [] and len(list(box.dir.glob("*.json"))) == 2
    await cog._drain_outbox()
    assert [t for t, _ in channel.sent] == ["하나", "둘"] and not list(box.dir.glob("*.json"))
    box.send(str(TEXT_ID), "지난 알림")
    (old,) = box.dir.glob("*.json")
    note = json.loads(old.read_text(encoding="utf-8"))
    note["at"] -= A.OUTBOX_MAX_AGE_S + 1
    old.write_text(json.dumps(note, ensure_ascii=False), encoding="utf-8")
    box.send("123456", "볼 수 없는 채널")
    await cog._drain_outbox()
    assert [t for t, _ in channel.sent] == ["하나", "둘"] and not list(box.dir.glob("*.json"))


async def test_a_channel_that_keeps_failing_does_not_hold_back_other_channels(tmp_path):
    """한 채널이 계속 실패해도 다른 채널의 알림은 같은 바퀴에 올라간다. 실패한 채널의 알림은 순서대로 남는다."""
    from capture.notify import FileOutbox

    cog, guild, vc, channel, ctx = _setup(tmp_path)
    other = FakeTextChannel(cid=901)
    cog.bot._channels[901] = other
    box = FileOutbox(tmp_path / "recordings")
    box.send(str(TEXT_ID), "하나")
    box.send("901", "다른 서버")
    box.send(str(TEXT_ID), "둘")
    channel.fail_first = 10
    await cog._drain_outbox()
    assert [t for t, _ in other.sent] == ["다른 서버"] and channel.sent == []
    assert len(list(box.dir.glob("*.json"))) == 2
    channel.fail_first = 0
    await cog._drain_outbox()
    assert [t for t, _ in channel.sent] == ["하나", "둘"] and not list(box.dir.glob("*.json"))


async def test_a_note_the_channel_refuses_is_dropped_instead_of_retried(tmp_path):
    """권한이 없거나(403) 첨부가 너무 크면(413) 다시 보내도 같다. 2초마다 다시 보내면 디스코드의 잘못된 요청 한도에 닿는다."""
    import types

    from capture.notify import FileOutbox

    cog, guild, vc, channel, ctx = _setup(tmp_path)
    tries = []

    async def refuse(text, file=None):
        tries.append(text)
        raise A.discord.Forbidden(types.SimpleNamespace(status=403, reason="Forbidden"), "Missing Permissions")

    channel.send = refuse
    box = FileOutbox(tmp_path / "recordings")
    box.send(str(TEXT_ID), "하나")
    box.send(str(TEXT_ID), "둘")
    await cog._drain_outbox()
    await cog._drain_outbox()
    assert tries == ["하나", "둘"] and not list(box.dir.glob("*.json"))


async def test_an_attachment_that_cannot_be_read_still_posts_the_text(tmp_path):
    """디버그 알림의 회의록 파일을 열지 못해도 글은 올린다."""
    from capture.notify import FileOutbox

    cog, guild, vc, channel, ctx = _setup(tmp_path)
    box = FileOutbox(tmp_path / "recordings")
    box.send(str(TEXT_ID), "📝 전사를 마쳤습니다. 줄 3개.", file=tmp_path)          # 파일이 아니라 폴더다
    await cog._drain_outbox()
    assert channel.sent == [("📝 전사를 마쳤습니다. 줄 3개.", None)] and not list(box.dir.glob("*.json"))


async def test_end_waits_for_its_own_session_and_keeps_a_new_recording_alive(tmp_path):
    """앞 회의를 저장하는 중에 새 녹음이 시작되면 /end 는 그 연결을 끊지 않는다."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    started = asyncio.Event()
    release = threading.Event()
    cog.bot.loop = asyncio.get_running_loop()
    await _run(A.RecordingCog.record, cog, ctx)
    first = cog._active[GUILD_ID]
    real_close = first.pool.close

    def slow_close():
        cog.bot.loop.call_soon_threadsafe(started.set)
        release.wait(5)
        return real_close()

    first.pool.close = slow_close
    first.sink.on_samples(1, _tone(2000), 0)
    end_task = asyncio.create_task(_run(A.RecordingCog.end, cog, ctx))
    await asyncio.wait_for(started.wait(), 5)                   # 앞 회의를 저장하는 중이다
    assert first.meeting_id in cog._processing and GUILD_ID not in cog._active
    await _run(A.RecordingCog.record, cog, ctx)                 # 그 사이 새 녹음
    second = cog._active[GUILD_ID]
    assert second is not first and vc.started is not None
    release.set()
    await asyncio.wait_for(end_task, 20)
    assert vc.disconnected == 0 and cog._active[GUILD_ID] is second      # 새 녹음은 산다
    assert any("새 녹음이 시작돼" in t for t, _ in channel.sent)
    second.flush_task.cancel()


async def test_late_joiner_is_told_once_and_bot_leaving_finishes(tmp_path):
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    late = FakeMember(3, "지민", guild)
    await cog.on_voice_state_update(late, State(None), State(vc.channel))
    await cog.on_voice_state_update(late, State(None), State(vc.channel))
    assert sum(1 for t, _ in channel.sent if t.startswith("<@3>")) == 1
    # 봇이 방에서 빠지면 /stop 과 같은 경로로 끝난다
    await cog.on_voice_state_update(cog.bot.user, State(vc.channel), State(None))
    await asyncio.wait_for(rec.done.wait(), 5)
    assert GUILD_ID not in cog._active


# ── 판단 경로 항목. 워커 테스트(test_worker.py)가 같이 쓴다 ─────────────────────────────────────────

def _judge_item(title, **over):
    base = {"action": "create", "target_task_id": None, "category": "decision", "task_title": title, "due_date": None,
            "status": None, "assignee_type": "first", "assignee_raw": None, "doc_text": f"{title}을 민수가 하기로 함",
            "evidence_quote": "제가 할게요.", "evidence_speaker": "1", "evidence_at_ms": 0}
    base.update(over)
    return base


async def test_record_keeps_the_server_member_names_for_the_name_hint(tmp_path):
    """이름 힌트(#195). 회의에 없는 사람도 이름으로 불리며 일을 맡으므로 서버 멤버 전체를 남긴다. 봇 계정은 뺀다."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    helper = FakeMember(3, "녹음봇", guild)
    helper.bot = True
    guild._members[3] = helper
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    assert _manifest(tmp_path, rec)["hint_names"] == ["민수", "서연"]
    rec.flush_task.cancel()
