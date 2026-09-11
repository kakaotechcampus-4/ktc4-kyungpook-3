import asyncio
import json

import discord
import numpy as np
import pytest

import capture.discord_adapter as adapter
from capture.discord_adapter import RecordingCog, SafeVoiceClient, _TrackPool, required_intents
from stt.backend import SttResult
from tests.replay import ReplayTrack, replay

SR = 16_000


def _vc(reader):
    """게이트웨이 없이 _remove_ssrc 만 부르기 위한 최소 인스턴스."""
    vc = SafeVoiceClient.__new__(SafeVoiceClient)
    vc._reader = reader
    vc._id_to_ssrc = {7: 123}
    vc._ssrc_to_id = {123: 7}
    return vc


def test_remove_ssrc_survives_a_missing_reader():
    """녹음 전에 사람이 나가는 경로. 원본은 여기서 AttributeError 를 내고 WS 폴러가 죽는다."""
    vc = _vc(discord.utils.MISSING)
    vc._remove_ssrc(user_id=7)
    assert vc._ssrc_to_id == {}
    assert vc._id_to_ssrc == {}


def test_remove_ssrc_still_drops_the_speaking_timer_entry():
    """가드가 정상 경로까지 건너뛰면 안 된다."""

    class _Timer:
        def __init__(self):
            self.dropped = []

        def drop_ssrc(self, ssrc):
            self.dropped.append(ssrc)

    class _Reader:
        def __init__(self):
            self.speaking_timer = _Timer()

    vc = _vc(_Reader())
    vc._remove_ssrc(user_id=7)
    assert vc._reader.speaking_timer.dropped == [123]
    assert vc._ssrc_to_id == {}


def test_track_pool_writes_one_wav_per_speaker(tmp_path):
    pool = _TrackPool(tmp_path / "42_1700", ts=1700)
    pool.submit(7, np.full(1600, 0.2, dtype=np.float32), 0)
    pool.submit(8, np.full(1600, 0.2, dtype=np.float32), 500)
    pool.submit(7, np.full(1600, 0.2, dtype=np.float32), 1000)
    entries = pool.close()

    assert sorted(e["file"] for e in entries) == ["42_1700/7_1700.wav", "42_1700/8_1700.wav"]
    assert (tmp_path / "42_1700" / "7_1700.wav").exists()
    by_uid = {e["user_id"]: e for e in entries}
    # 7번은 0~0.1초와 1.0~1.1초. 사이는 무음으로 채워진다.
    assert by_uid["7"]["duration_sec"] == pytest.approx(1.1, abs=0.02)
    assert by_uid["8"]["duration_sec"] == pytest.approx(0.6, abs=0.02)
    assert set(by_uid["7"]) == {"user_id", "display_name", "file", "duration_sec"}


def test_track_pool_drops_instead_of_blocking_when_the_queue_is_full(tmp_path):
    """큐가 차면 버리고 센다. submit 은 이벤트 루프에서 불리므로 절대 막히면 안 된다."""
    pool = _TrackPool(tmp_path / "g", ts=1)
    pool._q.put(None)                     # 쓰기 스레드를 먼저 세워 큐가 안 비게 한다
    pool._thread.join(timeout=5)
    assert not pool._thread.is_alive()

    chunk = np.zeros(320, dtype=np.float32)
    for _ in range(pool.QUEUE_MAX):
        pool.submit(7, chunk, 0)
    assert pool.dropped == 0
    pool.submit(7, chunk, 0)              # 여기서 넘친다
    assert pool.dropped == 1

    pool._q.get_nowait()                  # close 의 센티넬 자리를 하나 비운다
    assert pool.close() == []             # 스레드가 죽어 있어도 돌아온다


def test_required_intents_does_not_ask_for_message_content():
    """특권 인텐트를 쓰지도 않으면서 켜면 포털 미설정 시 봇이 기동 즉시 죽는다."""
    i = required_intents()
    assert i.members is True
    assert i.voice_states is True
    assert i.message_content is False


# ----------------------------------------------------------------- Cog 본문
# 게이트웨이 없이 /record 와 _finish_meeting 본문을 돌린다. 아래 대역은 py-cord 가
# 주는 객체 중 이 두 경로가 실제로 읽는 속성만 흉내낸다.

GUILD_ID = 42
ROOM_ID = 99


class _FakeStt:
    name = "fake"

    def transcribe(self, samples, sample_rate):
        return SttResult(text="마지막 발언", words=[])


class _FakeMessage:
    def __init__(self, content):
        self.content = content

    async def edit(self, content):
        self.content = content


class _FakeTextChannel:
    def __init__(self, name="일반"):
        self.name = name
        self.mention = f"#{name}"
        self.sent: list[str] = []

    async def send(self, text):
        self.sent.append(text)
        return _FakeMessage(text)

    def summaries(self) -> list[str]:
        return [m for m in self.sent if m.startswith("⏹")]


class _FakePerms:
    view_channel = True
    connect = True


class _FakeVoiceClient:
    def __init__(self, channel):
        self.channel = channel
        self.secret_key: list[int] = []
        self.started: list[tuple] = []
        self.disconnected = 0

    def is_connected(self):
        return True

    def is_recording(self):
        return bool(self.started)

    def start_recording(self, sink, callback, *args):
        self.started.append((sink, callback, args))

    def stop_recording(self):
        self.started.clear()

    async def disconnect(self, *, force=False):
        self.disconnected += 1


class _FakeVoiceChannel:
    def __init__(self, vc_box):
        self.id = ROOM_ID
        self.name = "회의방"
        self._vc_box = vc_box

    def permissions_for(self, member):
        return _FakePerms()

    async def connect(self, *, cls=None):
        # 실제 음성 핸드셰이크처럼 루프에 제어권을 넘긴다. 길드 락이 없으면
        # 같은 길드의 /record 두 번이 여기서 서로를 추월한다.
        await asyncio.sleep(0.01)
        return self._vc_box[0]


class _FakeMember:
    def __init__(self, uid, name):
        self.id = uid
        self.display_name = name


class _FakeGuild:
    def __init__(self, members):
        self.id = GUILD_ID
        self.name = "테스트 서버"
        self.me = object()
        self.voice_client = None
        self._members = members

    def get_member(self, uid):
        return self._members.get(uid)


class _FakeVoiceState:
    def __init__(self, channel):
        self.channel = channel


class _FakeAuthor:
    def __init__(self, room):
        self.id = 1
        self.voice = _FakeVoiceState(room)


class _FakeCtx:
    def __init__(self, guild, room, text_channel):
        self.guild = guild
        self.author = _FakeAuthor(room)
        self.channel = text_channel
        self.voice_client = None
        self.responses: list[str] = []

    async def defer(self):
        pass

    async def respond(self, text, ephemeral=False):
        self.responses.append(text)


class _FakeBot:
    def __init__(self, guild):
        self._guild = guild
        self.user = _FakeMember(1000, "봇")

    def get_guild(self, guild_id):
        return self._guild if guild_id == self._guild.id else None

    def get_channel(self, channel_id):
        return None

    @property
    def loop(self):
        return asyncio.get_running_loop()


def _tone(ms, amp=0.3):
    t = np.arange(int(SR * ms / 1000)) / SR
    return (amp * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


async def _start_one(tmp_path, monkeypatch, sessions_made=None):
    """/record 한 번을 끝까지 돌리고 (cog, ctx, meeting, text_channel, vc) 를 준다."""

    def _stt_factory():
        if sessions_made is not None:
            sessions_made.append(1)
        return _FakeStt()

    monkeypatch.setattr(adapter, "EliceStt", _stt_factory)
    guild = _FakeGuild({7: _FakeMember(7, "김환")})
    vc_box = []
    room = _FakeVoiceChannel(vc_box)
    vc = _FakeVoiceClient(room)
    vc_box.append(vc)
    guild.voice_client = vc
    text = _FakeTextChannel()
    bot = _FakeBot(guild)
    cog = RecordingCog(bot, recordings_dir=tmp_path)
    ctx = _FakeCtx(guild, room, text)
    await RecordingCog.record.callback(cog, ctx)
    return cog, ctx, cog._meetings[GUILD_ID], text, vc


async def test_finish_keeps_the_last_utterance_because_the_snapshot_follows_close(
    tmp_path, monkeypatch
):
    """스냅샷은 session.close() **뒤** 여야 한다.

    뒤에 무음이 없는 발화 하나만 흘린다. VAD 는 이걸 확정하지 않으므로 close() 만이
    이 줄을 on_line 으로 내보낸다 (stt/session.py:144-175). 스냅샷을 close() 앞에서
    찍으면 그 줄은 ledger.closed 에 걸려 late 로만 세어지고 회의록에서 통째로 빠진다.
    회의마다 마지막 발언 하나가 조용히 사라지는 자리다.
    """
    cog, _ctx, meeting, _text, _vc = await _start_one(tmp_path, monkeypatch)
    replay([ReplayTrack(user_id=7, name="김환", samples=_tone(1_200), ssrc=70)], meeting.sink.write)
    assert meeting.ledger.lines == []      # close() 전에는 확정된 줄이 없다
    meeting.sink.cleanup()                 # py-cord 가 stop_recording 안에서 하는 일

    await cog._finish_meeting(GUILD_ID)

    jsonl = meeting.out_dir / "transcript.jsonl"
    records = [json.loads(x) for x in jsonl.read_text(encoding="utf-8").splitlines()]
    assert [r["text"] for r in records] == ["마지막 발언"]
    assert meeting.ledger.late == 0


async def test_finish_meeting_runs_once_even_when_called_twice(tmp_path, monkeypatch):
    """/stop 과 py-cord 콜백이 겹쳐도 마무리는 한 번이다.

    표에서 pop 으로 꺼내는 것이 그 관문이다. get 으로 바꾸면 두 번째 호출이 트랙을
    다시 닫고 매니페스트와 회의록을 다시 쓰고 종료 요약을 한 번 더 올린다.
    """
    cog, _ctx, meeting, text, vc = await _start_one(tmp_path, monkeypatch)
    replay([ReplayTrack(user_id=7, name="김환", samples=_tone(1_200), ssrc=70)], meeting.sink.write)
    meeting.sink.cleanup()

    await cog._finish_meeting(GUILD_ID)
    await cog._finish_meeting(GUILD_ID)

    assert len(text.summaries()) == 1
    assert vc.disconnected == 1
    assert GUILD_ID not in cog._meetings


async def test_two_concurrent_records_start_one_meeting(tmp_path, monkeypatch):
    """같은 길드의 /record 두 번이 겹쳐도 회의는 하나다.

    가드(`_meetings.get`)와 표 대입 사이에 connect() 라는 await 가 있다. 길드 락이
    없으면 둘 다 가드를 통과해 세션과 트랙 스레드와 게시 태스크가 두 벌 생기고,
    표에는 나중 것만 남아 앞의 한 벌이 통째로 샌다.
    """
    made: list[int] = []
    cog, ctx1, _meeting, _text, vc = await _start_one(tmp_path, monkeypatch, sessions_made=made)
    # 첫 번째는 이미 끝났다. 여기서부터 두 번을 진짜로 겹친다.
    await cog._finish_meeting(GUILD_ID)
    made.clear()
    vc.started.clear()

    ctx_a = _FakeCtx(ctx1.guild, ctx1.author.voice.channel, _FakeTextChannel())
    ctx_b = _FakeCtx(ctx1.guild, ctx1.author.voice.channel, _FakeTextChannel())
    await asyncio.gather(
        RecordingCog.record.callback(cog, ctx_a),
        RecordingCog.record.callback(cog, ctx_b),
    )

    assert len(made) == 1                      # 세션이 한 벌만 만들어졌다
    assert len(vc.started) == 1
    assert len(cog._meetings) == 1
    assert any("이미" in r for r in ctx_b.responses)

    await cog._finish_meeting(GUILD_ID)
