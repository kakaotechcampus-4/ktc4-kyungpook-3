import numpy as np

from capture.streaming_sink import StreamingSink
from capture.timeline import OPUS_SILENCE
from stt.backend import SttResult
from stt.session import Session
from tests.replay import FakeMember, FakePacket, FakeVoiceData, ReplayTrack, replay

SR = 16_000


class FakeStt:
    name = "fake"

    def transcribe(self, samples, sample_rate):
        return SttResult(text="x", words=[])


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


def test_sink_ignores_empty_pcm():
    session = Session(final_stt=FakeStt(), on_line=lambda _: None, workers=1)
    sink = StreamingSink(session)
    sink.write(FakeVoiceData(FakePacket(0, 1), FakeMember(1, "A"), b""), FakeMember(1, "A"))
    session.close()
    assert sink.packets == 0


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
