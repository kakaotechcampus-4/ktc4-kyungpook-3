import numpy as np

from capture.streaming_sink import StreamingSink
from stt.backend import SttResult
from stt.session import Session
from tests.replay import ReplayTrack, replay

SR = 16_000


class FakeStt:
    name = "fake"

    def __init__(self):
        self.calls = 0

    def transcribe(self, samples, sample_rate):
        self.calls += 1
        return SttResult(text=f"{len(samples) / sample_rate:.1f}초", words=[])


def tone(ms, amp=0.3, freq=220.0):
    t = np.arange(int(SR * ms / 1000)) / SR
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def silence(ms):
    return np.zeros(int(SR * ms / 1000), dtype=np.float32)


def run(tracks, **session_kw):
    """실제 봇과 같은 sink 를 쓴다. 하니스는 시계만 주입한다."""
    lines = []
    stt = FakeStt()
    s = Session(final_stt=stt, on_line=lines.append, workers=2, **session_kw)
    clock = {"now_ms": 0}
    sink = StreamingSink(s, now_ms=lambda: clock["now_ms"])
    replay(tracks, sink.write, clock=clock)
    sink.drain()
    s.close()
    return [ln for ln in lines if ln.final], stt, sink


def six_speakers(ms=2_000):
    return [
        ReplayTrack(user_id=i, name=f"p{i}", samples=tone(ms, freq=200 + 20 * i), ssrc=100 + i)
        for i in range(6)
    ]


def test_six_speakers_produce_six_tracks():
    finals, _, _ = run(six_speakers())
    assert {ln.speaker_id for ln in finals} == {str(i) for i in range(6)}


def test_interruption_keeps_both_utterances():
    a = ReplayTrack(user_id=1, name="A", samples=tone(4_000), start_ms=0, ssrc=11)
    b = ReplayTrack(user_id=2, name="B", samples=tone(1_500, freq=330), start_ms=1_500, ssrc=22)
    finals, _, _ = run([a, b])
    assert {ln.speaker_id for ln in finals} == {"1", "2"}


def test_long_silence_keeps_meeting_clock():
    """앞에 24초 침묵. 패킷이 안 오므로 시각이 앞당겨지면 안 된다."""
    tr = ReplayTrack(user_id=1, name="A",
                     samples=np.concatenate([silence(24_000), tone(3_000)]),
                     silent_below=0.001, ssrc=11)
    finals, _, _ = run([tr])
    assert len(finals) == 1
    assert 23_000 <= finals[0].start_ms <= 25_000


def test_silence_frames_do_not_create_utterances():
    """침묵 구간에 Opus 침묵 프레임이 오는 경우. 공백 대신 잡음 패킷이 온다."""
    tr = ReplayTrack(user_id=1, name="A",
                     samples=np.concatenate([silence(24_000), tone(3_000)]),
                     silent_below=0.001, emit_silence_frames=True, ssrc=11)
    finals, _, sink = run([tr])
    assert len(finals) == 1
    assert 23_000 <= finals[0].start_ms <= 25_000
    assert sink.noise_packets > 0


def test_rejoin_does_not_rewind_timestamps():
    """재접속하면 SSRC 와 RTP 원점이 바뀐다. 위치는 도착 시각이라 영향이 없어야 한다."""
    first = ReplayTrack(user_id=1, name="A", samples=tone(2_000), start_ms=0,
                        ssrc=11, rtp_origin=1_000)
    rejoin = ReplayTrack(user_id=1, name="A", samples=tone(2_000), start_ms=20_000,
                         ssrc=99, rtp_origin=888_888_888)
    finals, _, _ = run([first, rejoin])
    starts = [ln.start_ms for ln in sorted(finals, key=lambda x: x.seq)]
    assert starts == sorted(starts)
    assert len(finals) == 2
    assert 19_500 <= starts[1] <= 20_500


def test_out_of_order_packets_are_reordered():
    """UDP 순서 뒤바뀜. 버리지 않고 RTP 로 정렬한다. 발화가 쪼개지면 안 된다."""
    tr = ReplayTrack(user_id=1, name="A", samples=tone(3_000), ssrc=11, shuffle_pairs=True)
    finals, _, _ = run([tr])
    assert len(finals) == 1
    assert 2_500 <= (finals[0].end_ms - finals[0].start_ms) <= 3_200


def test_packet_loss_does_not_split_utterance():
    tr = ReplayTrack(user_id=1, name="A", samples=tone(3_000), drop_rate=0.05, ssrc=11)
    finals, _, _ = run([tr])
    assert len(finals) == 1


def test_api_called_once_per_utterance_in_six_person_meeting():
    finals, stt, _ = run(six_speakers())
    assert stt.calls == len(finals) == 6
