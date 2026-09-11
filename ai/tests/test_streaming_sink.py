import discord
import numpy as np

from capture.streaming_sink import StreamingSink
from capture.timeline import OPUS_SILENCE, REORDER_WINDOW
from stt.backend import SttResult
from stt.session import Session
from tests.replay import (
    PACKET_MS,
    FakeMember,
    FakePacket,
    FakeVoiceData,
    ReplayTrack,
    _to_discord_bytes,
    replay,
)

SR = 16_000


class FakeStt:
    name = "fake"

    def transcribe(self, samples, sample_rate):
        return SttResult(text="x", words=[])


class FeedCountingSession(Session):
    """sink 가 session.feed 를 실제로 부른 횟수를 센다.

    줄이 안 나온 것과 sink 가 아직 아무것도 안 넘긴 것은 다르다. 재정렬 창이
    잡고 있는지 보려면 넘긴 횟수를 직접 세야 한다.
    """

    def __init__(self, *args, **kwargs):
        self.feeds = 0
        super().__init__(*args, **kwargs)

    def feed(self, speaker_id, speaker_name, samples, offset_ms):
        self.feeds += 1
        super().feed(speaker_id, speaker_name, samples, offset_ms)


def tone(ms, amp=0.3):
    t = np.arange(int(SR * ms / 1000)) / SR
    return (amp * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def test_sink_write_reaches_session():
    lines = []
    session = Session(final_stt=FakeStt(), on_line=lines.append, workers=1)
    clock = {"now_ms": 0}
    sink = StreamingSink(session, now_ms=lambda: clock["now_ms"])
    replay([ReplayTrack(user_id=7, name="김환", samples=tone(1_500), ssrc=70)], sink.write, clock=clock)
    sink.drain()
    session.close()
    assert any(ln.final and ln.speaker_id == "7" for ln in lines)


def test_is_opus_is_false():
    # py-cord 는 is_opus() 가 False 일 때만 디코딩된 48kHz 스테레오 PCM 을 write() 로 넘긴다.
    assert StreamingSink(session=None).is_opus() is False


def test_sink_ignores_empty_pcm():
    session = Session(final_stt=FakeStt(), on_line=lambda _: None, workers=1)
    sink = StreamingSink(session)
    m = FakeMember(1, "A")
    sink.write(FakeVoiceData(FakePacket(0, 1), m, b""), m)
    # 빈 페이로드는 is_noise_packet 에 닿기 전에 write() 가 먼저 돌려보낸다. 잡음으로도 안 센다.
    assert sink.packets == 0
    assert sink.noise_packets == 0
    # 뒤이어 정상 패킷이 세어져야 write() 가 통째로 no-op 인 경우를 잡는다.
    sink.write(FakeVoiceData(FakePacket(960, 1), m, _to_discord_bytes(tone(PACKET_MS))), m)
    session.close()
    assert sink.packets == 1
    assert sink.noise_packets == 0


def test_silence_frame_is_counted_as_noise_not_audio():
    """디스코드가 보내는 Opus 침묵 프레임. py-cord 는 이걸 sink 까지 넘긴다."""
    session = Session(final_stt=FakeStt(), on_line=lambda _: None, workers=1)
    sink = StreamingSink(session)
    m = FakeMember(1, "A")
    sink.write(FakeVoiceData(FakePacket(0, 1), m, OPUS_SILENCE), m)
    sink.write(FakeVoiceData(FakePacket(960, 1), m, b"\x00" * 3839 + b"\x01"), m)
    session.close()
    assert sink.packets == 0
    assert sink.noise_packets == 2


def test_cleanup_drains_pending_packets():
    """py-cord 가 stop_recording 뒤에 부르는 cleanup. 재정렬 창을 비워야 한다.

    창 크기만큼만 넣으면 sink 는 아직 session 에 아무것도 넘기지 않는다. cleanup 이
    drain 을 안 하면 화자마다 마지막 발언이 통째로 사라진다. 화자를 둘 두는 이유는
    drain 이 창 하나가 아니라 전부를 비우는지 보기 위해서다.

    창 크기 × 20ms 가 MIN_SPEECH_MS 이상이어야 발화로 확정된다. 지금은 16 × 20 = 320ms
    로 딱 걸쳐 있으니 창을 줄이면 이 테스트부터 깨진다.
    """
    held = REORDER_WINDOW
    lines = []
    session = FeedCountingSession(final_stt=FakeStt(), on_line=lines.append, workers=1)
    clock = {"now_ms": 0}
    sink = StreamingSink(session, now_ms=lambda: clock["now_ms"])
    tracks = [
        ReplayTrack(user_id=5, name="박", samples=tone(1_000)[: held * 320], ssrc=50),
        ReplayTrack(user_id=6, name="최", samples=tone(1_000)[: held * 320], ssrc=60),
    ]
    replay(tracks, sink.write, clock=clock)

    assert sink.packets == 2 * held
    assert session.feeds == 0      # 전부 재정렬 창에 잡혀 있다
    assert not [ln for ln in lines if ln.final]
    assert sink.finished is False

    sink.cleanup()
    session.close()

    assert session.feeds == 2 * held
    finals = [ln for ln in lines if ln.final]
    assert {ln.speaker_id for ln in finals} == {"5", "6"}
    assert len(finals) == 2
    assert sink.finished is True


def test_arrival_time_is_the_position():
    """RTP 원점이 무엇이든 위치는 now_ms 가 정한다."""
    lines = []
    session = Session(final_stt=FakeStt(), on_line=lines.append, workers=1)
    clock = {"now_ms": 0}
    sink = StreamingSink(session, now_ms=lambda: clock["now_ms"])
    tr = ReplayTrack(user_id=1, name="A", samples=tone(1_000), start_ms=42_000,
                     ssrc=11, rtp_origin=0xDEADBEEF)
    replay([tr], sink.write, clock=clock)
    sink.drain()
    session.close()
    finals = [ln for ln in lines if ln.final]
    assert len(finals) == 1
    assert 41_500 <= finals[0].start_ms <= 42_500


def test_level_report_mentions_threshold():
    session = Session(final_stt=FakeStt(), on_line=lambda _: None, workers=1)
    sink = StreamingSink(session)
    session.close()
    assert "임계" in sink.level_report()


def test_sink_is_a_pycord_sink():
    sink = StreamingSink(session=None)
    assert isinstance(sink, discord.sinks.Sink)
    assert sink.vc is None and sink.audio_data == {} and sink.finished is False
