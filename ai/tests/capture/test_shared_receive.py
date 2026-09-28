"""수신 공용 계층. 운영 녹음기(RecordingCog)가 실시간 경로와 같은 공용 조각을 실제로 쓰는지 본다.

공용 조각은 capture/voice_client.py(재연결 키 갱신, SSRC 가드), capture/streaming_sink.py(수신과
재정렬 창 드레인), capture/track_writer.py(화자별 트랙)다. 실시간 쪽은
tests/capture/realtime/test_realtime_adapter.py 가 같은 자리를 본다. 가짜 디스코드 객체를 쓰고 모델은 안 쓴다.
"""

import json
import types

import numpy as np
import pytest

from capture import voice_client
from capture.discord_adapter import RecordingCog
from stt.backend import SttResult
from tests.capture.replay import ReplayTrack, replay

GUILD_ID = 31
ROOM_ID = 32


class _Stt:
    name = "fake"

    def transcribe(self, samples, sample_rate):
        return SttResult(text="말", words=[])


class _Room:
    def __init__(self):
        self.id, self.name = ROOM_ID, "회의방"
        self.connected_with = None

    async def connect(self, *, cls=None):
        self.connected_with = cls
        return _VoiceClient(self)


class _VoiceClient:
    """start_recording 으로 sink 를 받기만 한다. 녹음 정지는 부르지 않는다."""

    def __init__(self, channel):
        self.channel = channel
        self.recording = None

    def is_connected(self):
        return True

    def is_recording(self):
        return self.recording is not None

    def start_recording(self, sink, callback, *args):
        self.recording = (sink, callback, args)


class _Member:
    def __init__(self, uid, name, guild):
        self.id, self.display_name, self.guild = uid, name, guild
        self.mention = f"<@{uid}>"


class _Guild:
    def __init__(self):
        self.id, self.name = GUILD_ID, "테스트 서버"

    def get_member(self, uid):
        return None


class _TextChannel:
    id = 900

    def __init__(self):
        self.sent = []

    async def send(self, text, file=None):
        self.sent.append(text)


class _Bot:
    def __init__(self, guild):
        self._guild = guild
        self.user = _Member(1000, "봇", guild)

    def get_guild(self, gid):
        return self._guild if gid == self._guild.id else None

    def get_channel(self, cid):
        return None


class _Ctx:
    def __init__(self, guild, room, vc):
        self.guild, self.voice_client, self.channel = guild, vc, _TextChannel()
        self.author = types.SimpleNamespace(voice=types.SimpleNamespace(channel=room))
        self.responses = []

    async def respond(self, text, ephemeral=False):
        self.responses.append(text)


def _cog(tmp_path, guild):
    return RecordingCog(_Bot(guild), recordings_dir=tmp_path / "recordings",
                        transcripts_dir=tmp_path / "transcripts",
                        stt_factory=lambda: (_Stt(), "fake", 1), gate_factory=lambda: None,
                        extractor_factory=lambda: None, handoff_factory=lambda: None)


def _tone(ms, sr=16_000):
    t = np.arange(int(sr * ms / 1000)) / sr
    return (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


async def test_join_connects_through_the_shared_voice_client(tmp_path):
    """배치 /join 도 SafeVoiceClient 로 붙어야 재연결 키 갱신과 SSRC 가드가 운영 경로에 걸린다.

    RecordingCog 에는 그 처리가 따로 없다. 일반 VoiceClient 로 붙으면 녹음 중 재연결 뒤 복호화기가
    낡은 키로 모든 패킷을 버리고, 녹음 전에 사람이 나가면 음성 WS 폴러가 죽는다.
    """
    guild, room = _Guild(), _Room()
    await RecordingCog.join.callback(_cog(tmp_path, guild), _Ctx(guild, room, None))
    assert room.connected_with is voice_client.SafeVoiceClient


async def test_bot_leaving_the_room_still_drains_the_reorder_window_into_the_track(tmp_path):
    """봇이 방에서 빠지면 stop_recording 없이 종료로 간다. 그 길에도 공용 sink 의 드레인이 있어야 한다.

    재정렬 창은 17번째 패킷이 와야 첫 패킷을 내보낸다 (capture/timeline.py). 패킷 10개(200ms)는
    전부 창 안에 있어서, 종료가 창을 비우지 않으면 회의 끝 200ms 가 트랙에서 빠진다. 실시간 쪽
    test_bot_kicked_from_the_room_keeps_the_last_reorder_window 와 같은 자리다.
    """
    guild, room = _Guild(), _Room()
    ctx = _Ctx(guild, room, _VoiceClient(room))
    cog = _cog(tmp_path, guild)
    await RecordingCog.record.callback(cog, ctx)
    rec = cog._active[GUILD_ID]
    released = []
    submit = rec.sink.on_samples
    rec.sink.on_samples = lambda uid, s, at: (released.append(len(s)), submit(uid, s, at))

    replay([ReplayTrack(user_id=7, name="민수", samples=_tone(200))], rec.sink.write)
    assert released == []                        # 아직 전부 창 안에 있다

    here, gone = types.SimpleNamespace(channel=room), types.SimpleNamespace(channel=None)
    await cog.on_voice_state_update(cog.bot.user, here, gone)

    assert sum(released) == 3200                 # 20ms 10개 = 16kHz 3200 샘플
    manifest = json.loads((tmp_path / "recordings" / f"session_{rec.meeting_id}.json").read_text(encoding="utf-8"))
    assert [s["user_id"] for s in manifest["speakers"]] == ["7"]
    assert manifest["speakers"][0]["duration_sec"] == pytest.approx(0.2, abs=0.03)
