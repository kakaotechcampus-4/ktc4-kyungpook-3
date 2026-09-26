"""녹음 Cog. 가짜 디스코드 객체로 /record → 트랙 → /stop → 전사 → 추출 → 인계 → 게시 흐름을 본다. 모델은 안 쓴다."""

import asyncio
import json
import threading
import time

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


class FakeTextChannel:
    def __init__(self, cid=TEXT_ID):
        self.id = cid
        self.sent = []
        self.fail_first = 0        # 처음 몇 번의 send 를 실패시킨다

    async def send(self, text, file=None):
        if self.fail_first > 0:
            self.fail_first -= 1
            raise RuntimeError("디스코드 429")
        self.sent.append((text, file))


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

    async def respond(self, text, ephemeral=False):
        self.responses.append(text)


class State:
    def __init__(self, channel):
        self.channel = channel


class Task:
    def __init__(self, sentence):
        self.sentence = sentence

    def to_dict(self):
        return {"task": "와이어프레임 그리기", "assignee_member_id": None, "due_date": "2026-09-18", "confidence": 1.0,
                "assignee_mention": None, "source_sentence": self.sentence, "assignee_type": "first",
                "due_raw": "내일", "due_status": "certain"}


def first_person_extractor(transcript, names, today):
    return [Task(transcript.segments[0].text)]


async def _run(command, cog, ctx):
    """슬래시 명령 객체의 본체를 Cog 에 묶어 부른다. 봇 없이 Cog 만 만들었을 때의 호출법."""
    return await command.callback(cog, ctx)


def _setup(tmp_path, *, extractor=None, handoff=None):
    room = FakeVoiceChannel()
    vc = FakeVC(room)
    members = {1: FakeMember(1, "민수"), 2: FakeMember(2, "서연")}
    guild = FakeGuild(members, vc)
    for m in members.values():
        m.guild = guild
    channel = FakeTextChannel()
    bot = FakeBot(guild, channels=[channel])
    bot.user.guild = guild
    cog = A.RecordingCog(bot, recordings_dir=tmp_path / "recordings", transcripts_dir=tmp_path / "transcripts",
                         stt_factory=lambda: (EchoStt(), "echo", 1), gate_factory=lambda: None,
                         extractor_factory=lambda: extractor, handoff_factory=lambda: handoff)
    return cog, guild, vc, channel, FakeCtx(guild, vc, channel)


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


async def test_stop_closes_tracks_transcribes_and_posts_the_script(tmp_path):
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
    assert m["status"] == "transcribed" and m["transcript"] == f"{rec.meeting_id}/transcript.md"
    assert [e["display_name"] for e in m["speakers"]] == ["민수", "서연"]
    assert "transcribed" in m["stages"]
    assert len(hooked) == 1 and hooked[0][0]["status"] == "transcribed"
    texts = [t for t, _ in channel.sent]
    assert texts[0].startswith("✅ 저장 완료") and texts[1].startswith("📝 회의록")
    assert channel.sent[1][1] is not None                       # 회의록 파일을 붙였다
    assert texts[2].startswith("ℹ️ 할일 추출은 건너뜁니다")       # LLM 설정이 없다
    contract = json.loads((tmp_path / "transcripts" / f"session_{rec.meeting_id}.transcript.json").read_text(encoding="utf-8"))
    assert [s["speaker"] for s in contract["segments"]] == ["1", "2", "1"]
    assert GUILD_ID not in cog._active and rec.meeting_id not in cog._processing and vc.started is None


async def test_record_creates_the_be_meeting_and_stop_hands_the_tasks_off(tmp_path):
    fake = FakeBe()
    handoff = H.Handoff(H.BeClient("http://be", session=fake), "ws-1")
    cog, guild, vc, channel, ctx = _setup(tmp_path, extractor=first_person_extractor, handoff=handoff)
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    assert rec.be["meeting_id"] == "m1" and _manifest(tmp_path, rec)["be"]["meeting_id"] == "m1"
    assert fake.calls[0][2]["title"].startswith("회의방 ")
    rec.sink.on_samples(1, _tone(2000), 0)
    rec.sink.on_samples(2, _tone(3000), 5000)
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    m = _manifest(tmp_path, rec)
    assert m["status"] == "handed_off" and set(m["stages"]) == {"transcribed", "extracted", "handed_off"}
    assert m["be"] == {"meeting_id": "m1", "status": "done", "extraction_id": "e-m1", "item_count": 1}
    assert [c[1] for c in fake.calls] == ["/meetings", "/meetings/m1/end", "/extractions"]
    sent = fake.calls[2][2]["items"][0]
    assert sent["evidence_speaker"] == "1" and sent["assignee_type"] == "first" and sent["assignee_raw"] is None
    texts = [t for t, _ in channel.sent]
    assert texts[1].startswith("📝 회의록") and texts[2].startswith("📋 할일 1건") and texts[3].startswith("📨 BE 인계 완료")


async def test_be_being_down_at_record_does_not_stop_the_recording(tmp_path):
    fake = FakeBe()
    fake.down = True
    handoff = H.Handoff(H.BeClient("http://be", session=fake), "ws-1")
    cog, guild, vc, channel, ctx = _setup(tmp_path, extractor=first_person_extractor, handoff=handoff)
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    assert "meeting_id" not in rec.be and "NETWORK" in rec.be["error"] and vc.started is not None
    fake.down = False                                           # 회의가 끝날 때는 BE 가 살아났다
    rec.sink.on_samples(1, _tone(2000), 0)
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    m = _manifest(tmp_path, rec)
    assert m["status"] == "handed_off" and m["be"]["meeting_id"] == "m1"     # 인계 단계가 회의를 만들었다


async def test_channel_failures_do_not_block_processing_or_the_done_signal(tmp_path):
    """저장 완료 알림과 회의록 게시가 둘 다 실패해도 전사는 돌고 상태는 맞고 done 은 켜진다."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    rec.sink.on_samples(1, _tone(2000), 0)
    channel.fail_first = 2
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    m = _manifest(tmp_path, rec)
    assert m["status"] == "transcribed" and (tmp_path / "recordings" / rec.meeting_id / "transcript.md").exists()
    assert channel.sent and channel.sent[0][0].startswith("ℹ️")     # 뒤의 알림은 정상적으로 나갔다
    assert rec.meeting_id not in cog._processing


async def test_end_waits_for_its_own_session_and_keeps_a_new_recording_alive(tmp_path, monkeypatch):
    """앞 회의의 후처리 중에 새 녹음이 시작되면 /end 는 그 연결을 끊지 않는다."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    started = asyncio.Event()
    release = threading.Event()
    real = A.process_session

    def slow(*args, **kwargs):
        cog.bot.loop.call_soon_threadsafe(started.set)
        release.wait(5)
        return real(*args, **kwargs)

    monkeypatch.setattr(A, "process_session", slow)
    cog.bot.loop = asyncio.get_running_loop()
    await _run(A.RecordingCog.record, cog, ctx)
    first = cog._active[GUILD_ID]
    first.sink.on_samples(1, _tone(2000), 0)
    end_task = asyncio.create_task(_run(A.RecordingCog.end, cog, ctx))
    await asyncio.wait_for(started.wait(), 5)                   # 앞 회의가 후처리에 들어갔다
    assert first.meeting_id in cog._processing and GUILD_ID not in cog._active
    await _run(A.RecordingCog.record, cog, ctx)                 # 그 사이 새 녹음
    second = cog._active[GUILD_ID]
    assert second is not first and vc.started is not None
    release.set()
    await asyncio.wait_for(end_task, 20)
    assert vc.disconnected == 0 and cog._active[GUILD_ID] is second      # 새 녹음은 산다
    assert any("새 녹음이 시작돼" in t for t, _ in channel.sent)
    second.flush_task.cancel()


async def test_post_processing_runs_one_meeting_at_a_time(tmp_path, monkeypatch):
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    seen = []

    def guarded(*args, **kwargs):
        seen.append(cog._post_sem.locked())
        time.sleep(0.05)
        return R.process_session(*args, **kwargs)

    monkeypatch.setattr(A, "process_session", guarded)
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    rec.sink.on_samples(1, _tone(1500), 0)
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    assert seen == [True] and cog._post_sem._value == 1          # 후처리는 세마포어 안에서 돌고 끝나면 돌려준다


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


async def test_transcription_failure_marks_manifest_failed_and_keeps_tracks(tmp_path):
    cog, guild, vc, channel, ctx = _setup(tmp_path)

    class Dead:
        name = "dead"

        def transcribe(self, samples, sample_rate):
            raise RuntimeError("죽음")

    cog._stt_factory = lambda: (Dead(), "dead", 1)
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    rec.sink.on_samples(1, _tone(1500), 0)
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 30)
    m = _manifest(tmp_path, rec)
    # 호출 실패는 error 줄이 되고 회의는 partial 로 남는다. 전사 자체가 죽는 경우는 failed 다
    assert m["status"] in ("partial", "failed")
    assert (tmp_path / "recordings" / rec.meeting_id / f"1_{rec.ts}.wav").exists()
    assert any("전사 실패" in t for t, _ in channel.sent)


async def test_recover_reports_only_sessions_that_moved_and_posts_to_their_channel(tmp_path):
    cog, guild, vc, channel, ctx = _setup(tmp_path, extractor=first_person_extractor)
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    rec.sink.on_samples(1, _tone(2000), 0)
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    assert _manifest(tmp_path, rec)["status"] == "extracted"     # BE 설정이 없어 여기까지
    channel.sent.clear()
    await _run(A.RecordingCog.recover_cmd, cog, ctx)             # 아직도 BE 가 없다. 조용하다
    assert [t for t, _ in channel.sent] == ["마저 처리할 녹음이 없습니다. 설정이 없어 멈춘 회의 1개는 그대로입니다."]
    fake = FakeBe()
    cog._handoff_factory = lambda: H.Handoff(H.BeClient("http://be", session=fake), "ws-1")
    other = FakeTextChannel(cid=901)                             # 명령은 다른 채널에서 쳤다
    ctx2 = FakeCtx(guild, vc, other)
    await _run(A.RecordingCog.recover_cmd, cog, ctx2)            # BE 가 생겼다. 인계만 하고 원래 채널에 알린다
    texts = [t for t, _ in channel.sent]
    assert texts[1] == f"세션 `{rec.meeting_id}`" and texts[2].startswith("📨 BE 인계 완료")
    assert other.sent == []
    assert _manifest(tmp_path, rec)["status"] == "handed_off"


async def test_recover_only_touches_this_guilds_meetings(tmp_path):
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    for gid in ("77", "88"):
        meeting = tmp_path / "recordings" / f"{gid}_500"
        meeting.mkdir(parents=True)
        import soundfile as sf
        sf.write(str(meeting / "1_500.wav"), _tone(2000), 16_000, subtype="PCM_16")
        R.write_status(tmp_path / "recordings", f"{gid}_500", status=R.STATUS_SAVED,
                       entries=[{"user_id": "1", "display_name": "민수", "file": f"{gid}_500/1_500.wav", "duration_sec": 2.0}],
                       guild="g", channel="c", library_version="x", started_at="2026-09-16T00:00:00Z",
                       meeting_dir=f"{gid}_500", extra={"guild_id": gid, "text_channel_id": str(TEXT_ID)})
    await _run(A.RecordingCog.recover_cmd, cog, ctx)
    assert [t for t, _ in channel.sent][0] == "세션 `77_500`"
    assert json.loads((tmp_path / "recordings" / "session_88_500.json").read_text(encoding="utf-8"))["status"] == "saved"


async def test_recover_leaves_the_session_being_recorded_alone(tmp_path):
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    rec.sink.on_samples(1, _tone(2000), 0)
    await asyncio.sleep(0.3)                                          # 트랙 파일이 생길 시간
    pending = [p.name for p in R.pending_sessions(tmp_path / "recordings")]
    assert pending == [f"session_{rec.meeting_id}.json"]              # 전제: 복구 목록에 보이는 상태다
    await _run(A.RecordingCog.recover_cmd, cog, ctx)
    assert GUILD_ID in cog._active and _manifest(tmp_path, rec)["status"] == "recording"
    assert all(not t.startswith("세션 `") for t, _ in channel.sent)
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    assert _manifest(tmp_path, rec)["status"] == "transcribed"


async def test_recover_excludes_sessions_in_post_processing(tmp_path, monkeypatch):
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    cog._post_sem = asyncio.Semaphore(2)                              # 동시 후처리를 허용했을 때
    started = asyncio.Event()
    release = threading.Event()
    real = A.process_session

    def slow(*args, **kwargs):
        cog.bot.loop.call_soon_threadsafe(started.set)
        release.wait(5)
        return real(*args, **kwargs)

    monkeypatch.setattr(A, "process_session", slow)
    cog.bot.loop = asyncio.get_running_loop()
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    rec.sink.on_samples(1, _tone(2000), 0)
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(started.wait(), 5)
    assert rec.meeting_id in cog._processing
    pending = [p.name for p in R.pending_sessions(tmp_path / "recordings")]
    assert pending == [f"session_{rec.meeting_id}.json"]              # 전제: 복구 목록에 보이는 상태다
    recovered = []

    def watching(*args, **kwargs):
        recovered.append(args[1]["session"])
        return real(*args, **kwargs)

    monkeypatch.setattr(R, "process_session", watching)               # 복구 경로(recover_one)가 부르는 것
    await _run(A.RecordingCog.recover_cmd, cog, ctx)
    assert recovered == []
    release.set()
    await asyncio.wait_for(rec.done.wait(), 20)


async def test_end_after_stop_waits_for_post_processing_before_leaving(tmp_path, monkeypatch):
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    started = asyncio.Event()
    release = threading.Event()
    real = A.process_session

    def slow(*args, **kwargs):
        cog.bot.loop.call_soon_threadsafe(started.set)
        release.wait(5)
        return real(*args, **kwargs)

    monkeypatch.setattr(A, "process_session", slow)
    cog.bot.loop = asyncio.get_running_loop()
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    rec.sink.on_samples(1, _tone(2000), 0)
    await _run(A.RecordingCog.stop, cog, ctx)                         # 녹음은 끝났고 후처리가 도는 중
    await asyncio.wait_for(started.wait(), 5)
    end_task = asyncio.create_task(_run(A.RecordingCog.end, cog, ctx))
    await asyncio.sleep(0.3)
    assert vc.disconnected == 0                                       # 후처리가 끝나기 전에는 안 나간다
    release.set()
    await asyncio.wait_for(end_task, 20)
    assert vc.disconnected == 1 and rec.done.is_set()


async def test_report_says_how_many_units_a_partial_meeting_is_missing(tmp_path):
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    md = tmp_path / "transcript.md"
    md.write_text("# 회의록\n", encoding="utf-8")
    result = {"session": "77_500", "status": "extracted", "ran": ["retried", "extracted"], "skipped": {}, "error": None,
              "failed_stage": None, "transcribe": {"markdown": str(md), "failed": 1, "summary": None, "lines": 3},
              "retried": 1, "tasks": [], "be": None, "speakers": 2, "text_channel_id": str(TEXT_ID),
              "partial": True, "missing_units": 1}
    await cog._report(channel, "77_500", result)
    assert any("빠진 구간 1개" in t for t, _ in channel.sent)
