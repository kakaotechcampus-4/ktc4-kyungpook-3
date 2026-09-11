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


class RampCheckStt(FakeStt):
    """백엔드에 실제로 도착한 샘플이 단조 증가인지 기록한다.

    발화가 하나 나왔다는 것만으로는 STT 가 받은 오디오가 제 순서인지 알 수 없다.
    램프를 쓰면 샘플이 한 조각이라도 뒤바뀐 순간 diff 에 음수가 찍힌다.
    """

    name = "ramp-check"

    def __init__(self):
        super().__init__()
        self.monotonic = []
        self.edges = []

    def transcribe(self, samples, sample_rate):
        # int16 왕복 때문에 이웃 샘플이 같은 값으로 뭉칠 수 있어 부동소수 오차만 허용한다.
        self.monotonic.append(bool(np.all(np.diff(samples) >= -1e-6)))
        self.edges.append((float(samples[0]), float(samples[-1])))
        return super().transcribe(samples, sample_rate)


def tone(ms, amp=0.3, freq=220.0):
    t = np.arange(int(SR * ms / 1000)) / SR
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def ramp(ms, lo=0.3, hi=0.9):
    """전 구간 단조 증가하는 신호.

    진폭이 lo 아래로 내려가지 않아 VAD 가 중간에 끊지 않는다. 0 을 지나는 램프를
    쓰면 가운데가 SPEECH_RMS 아래로 내려가 발화가 둘로 쪼개진다.
    """
    n = int(SR * ms / 1000)
    return (lo + (hi - lo) * np.linspace(0.0, 1.0, n, dtype=np.float32)).astype(np.float32)


def silence(ms):
    return np.zeros(int(SR * ms / 1000), dtype=np.float32)


def run(tracks, stt=None, **session_kw):
    """실제 봇과 같은 sink 를 쓴다. 하니스는 시계만 주입한다."""
    lines = []
    stt = stt if stt is not None else FakeStt()
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
    """침묵 구간에 Opus 침묵 프레임이 오는 경우. 공백 대신 잡음 패킷이 온다.

    침묵 프레임은 하류에 아무 흔적도 남기면 안 된다. 그래서 프레임을 안 보내는
    쪽과 발화 수·시작·끝이 전부 같은지 본다. 잡음 카운터만 보면 프레임이 발화를
    밀어도 통과한다.
    """
    def track(emit_silence):
        return ReplayTrack(user_id=1, name="A",
                           samples=np.concatenate([silence(24_000), tone(3_000)]),
                           silent_below=0.001, emit_silence_frames=emit_silence, ssrc=11)

    finals, _, sink = run([track(True)])
    plain, _, plain_sink = run([track(False)])

    assert sink.noise_packets > 0
    assert plain_sink.noise_packets == 0
    assert sink.packets == plain_sink.packets
    assert len(finals) == len(plain) == 1
    assert finals[0].start_ms == plain[0].start_ms
    assert finals[0].end_ms == plain[0].end_ms
    assert 23_000 <= finals[0].start_ms <= 25_000


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
    """UDP 순서 뒤바뀜. 버리지 않고 RTP 로 정렬해서 STT 에 넘긴다.

    인접 패킷 쌍이 뒤바뀐 채로 도착하지만, 재정렬 창을 지나고 나면 백엔드가 받는
    샘플은 원본 램프 그대로여야 한다. 발화 개수나 길이만 보면 재정렬을 통째로
    빼도, 과거 패킷을 버려도 통과한다.
    """
    stt = RampCheckStt()
    tr = ReplayTrack(user_id=1, name="A", samples=ramp(3_000), ssrc=11, shuffle_pairs=True)
    finals, _, _ = run([tr], stt=stt)

    assert len(finals) == 1
    assert stt.calls == 1
    assert stt.monotonic == [True]

    first, last = stt.edges[0]
    assert abs(first - 0.3) < 1e-3   # 램프의 처음과 끝이 그대로 들어왔다 (버린 패킷 없음)
    assert abs(last - 0.9) < 1e-3

    # 첫 패킷이 두 번째 패킷보다 늦게 도착해 시간축이 20ms 에서 시작한다.
    # 재정렬을 빼면 0, 과거 패킷을 버리면 40 이 된다.
    assert finals[0].start_ms == 20
    assert finals[0].end_ms == 3_020


def test_packet_loss_does_not_split_utterance():
    tr = ReplayTrack(user_id=1, name="A", samples=tone(3_000), drop_rate=0.05, ssrc=11)
    finals, _, _ = run([tr])
    assert len(finals) == 1


def test_api_called_once_per_utterance_in_six_person_meeting():
    finals, stt, _ = run(six_speakers())
    assert stt.calls == len(finals) == 6
