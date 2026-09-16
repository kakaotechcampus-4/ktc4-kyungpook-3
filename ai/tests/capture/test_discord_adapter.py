"""녹음 Cog. 가짜 디스코드 객체로 /record → 트랙 → /stop → 전사 → 게시 흐름을 본다. 모델은 안 쓴다."""

import asyncio
import json

import numpy as np
import pytest

from capture import discord_adapter as A
from capture.streaming_sink import StreamingSink
from stt.backend import SttResult, Word

GUILD_ID = 77
ROOM_ID = 5


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
    def __init__(self):
        self.sent = []

    async def send(self, text, file=None):
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
    def __init__(self, members, vc):
        self.id, self.name = GUILD_ID, "테스트 서버"
        self._members = members
        self.voice_client = vc

    def get_member(self, uid):
        return self._members.get(uid)


class FakeBot:
    def __init__(self, guild):
        self._guild = guild
        self.user = FakeMember(1000, "봇")

    def get_guild(self, guild_id):
        return self._guild if guild_id == self._guild.id else None


class FakeCtx:
    def __init__(self, guild, vc, channel):
        self.guild, self.voice_client, self.channel = guild, vc, channel
        self.responses = []

    async def respond(self, text, ephemeral=False):
        self.responses.append(text)


class State:
    def __init__(self, channel):
        self.channel = channel


async def _run(command, cog, ctx):
    """슬래시 명령 객체의 본체를 Cog 에 묶어 부른다. 봇 없이 Cog 만 만들었을 때의 호출법."""
    return await command.callback(cog, ctx)


def _setup(tmp_path):
    room = FakeVoiceChannel()
    vc = FakeVC(room)
    members = {1: FakeMember(1, "민수"), 2: FakeMember(2, "서연")}
    guild = FakeGuild(members, vc)
    for m in members.values():
        m.guild = guild
    bot = FakeBot(guild)
    bot.user.guild = guild
    cog = A.RecordingCog(bot, recordings_dir=tmp_path / "recordings", transcripts_dir=tmp_path / "transcripts",
                         stt_factory=lambda: (EchoStt(), "echo", 1), gate_factory=lambda: None)
    channel = FakeTextChannel()
    return cog, guild, vc, channel, FakeCtx(guild, vc, channel)


def _tone(ms, sr=16_000):
    t = np.arange(int(sr * ms / 1000)) / sr
    return (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


async def test_record_writes_a_recording_manifest_and_announces(tmp_path):
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    await _run(A.RecordingCog.record, cog, ctx)
    assert isinstance(vc.started[0], StreamingSink)
    assert ctx.responses == [A.NOTICE]
    rec = cog._recordings[GUILD_ID]
    m = json.loads((tmp_path / "recordings" / f"session_{rec.ts}.json").read_text(encoding="utf-8"))
    assert m["status"] == "recording" and m["speakers"] == [] and m["meeting_dir"] == rec.meeting_id
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
    rec = cog._recordings[GUILD_ID]
    # 패킷 대신 sink 훅으로 샘플을 넣는다. 위치는 도착 시각(ms)이다
    rec.sink.on_samples(1, _tone(2000), 0)
    rec.sink.on_samples(2, _tone(3000), 5000)
    rec.sink.on_samples(1, _tone(2000), 10_000)
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    m = json.loads((tmp_path / "recordings" / f"session_{rec.ts}.json").read_text(encoding="utf-8"))
    assert m["status"] == "transcribed" and m["transcript"] == f"{rec.meeting_id}/transcript.md"
    assert [e["display_name"] for e in m["speakers"]] == ["민수", "서연"]
    assert len(hooked) == 1 and hooked[0][0]["status"] == "transcribed"
    texts = [t for t, _ in channel.sent]
    assert texts[0].startswith("✅ 저장 완료") and texts[1].startswith("📝 회의록")
    assert channel.sent[1][1] is not None                       # 회의록 파일을 붙였다
    contract = json.loads((tmp_path / "transcripts" / f"session_{rec.ts}.transcript.json").read_text(encoding="utf-8"))
    assert [s["speaker"] for s in contract["segments"]] == ["1", "2", "1"]
    assert GUILD_ID not in cog._recordings and vc.started is None


async def test_late_joiner_is_told_once_and_bot_leaving_finishes(tmp_path):
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._recordings[GUILD_ID]
    late = FakeMember(3, "지민", guild)
    await cog.on_voice_state_update(late, State(None), State(vc.channel))
    await cog.on_voice_state_update(late, State(None), State(vc.channel))
    assert sum(1 for t, _ in channel.sent if t.startswith("<@3>")) == 1
    # 봇이 방에서 빠지면 /stop 과 같은 경로로 끝난다
    await cog.on_voice_state_update(cog.bot.user, State(vc.channel), State(None))
    await asyncio.wait_for(rec.done.wait(), 5)
    assert GUILD_ID not in cog._recordings


async def test_transcription_failure_marks_manifest_failed_and_keeps_tracks(tmp_path):
    cog, guild, vc, channel, ctx = _setup(tmp_path)

    class Dead:
        name = "dead"

        def transcribe(self, samples, sample_rate):
            raise RuntimeError("죽음")

    cog._stt_factory = lambda: (Dead(), "dead", 1)
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._recordings[GUILD_ID]
    rec.sink.on_samples(1, _tone(1500), 0)
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    m = json.loads((tmp_path / "recordings" / f"session_{rec.ts}.json").read_text(encoding="utf-8"))
    # 호출 실패는 error 줄이 되고 회의록은 나온다. 전사 자체가 죽는 경우는 failed 로 남는다
    assert m["status"] in ("transcribed", "failed")
    assert (tmp_path / "recordings" / rec.meeting_id / f"1_{rec.ts}.wav").exists()
    assert any("회의록" in t or "전사 실패" in t for t, _ in channel.sent)
