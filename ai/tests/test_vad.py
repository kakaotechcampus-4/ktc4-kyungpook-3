import numpy as np
import pytest

from stt.vad import FRAME_MS, SILENCE_HOLD_MS, StreamingVAD

SR = 16_000
PACKET_MS = 20


def tone(ms: int, freq: float = 220.0, amp: float = 0.3) -> np.ndarray:
    t = np.arange(int(SR * ms / 1000)) / SR
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def silence(ms: int) -> np.ndarray:
    return np.zeros(int(SR * ms / 1000), dtype=np.float32)


def vad() -> StreamingVAD:
    return StreamingVAD(speaker_id="1", sample_rate=SR)


def feed_packets(v: StreamingVAD, samples: np.ndarray, start_ms: int) -> list:
    """20ms 패킷으로 쪼개 offset_ms 와 함께 넣는다. 디스코드 수신부와 같은 모양."""
    n = int(SR * PACKET_MS / 1000)
    out = []
    for i in range(0, len(samples) - n + 1, n):
        out += v.feed(samples[i : i + n], start_ms + i * 1000 // SR)
    return out


def times(utts) -> list[tuple[int, int]]:
    return [(u.start_ms, u.end_ms) for u in utts]


def test_live_input_matches_file_input():
    """디스코드는 무음에 패킷을 안 보낸다. 두 입력이 같은 시각을 내야 한다."""
    lead_ms, speech_ms = 24_000, 3_800
    speech = tone(speech_ms)

    a = vad()
    got_a = a.feed(np.concatenate([silence(lead_ms), speech, silence(2_000)])) + a.flush()

    b = vad()
    got_b = feed_packets(b, speech, lead_ms) + b.flush()

    assert times(got_a) == times(got_b)
    assert len(got_b) == 1
    start, end = times(got_b)[0]
    assert start == pytest.approx(lead_ms, abs=2 * FRAME_MS)
    assert end == pytest.approx(lead_ms + speech_ms, abs=2 * FRAME_MS)


def test_gap_does_not_inflate_end_ms():
    v = vad()
    got = feed_packets(v, tone(1_500), 0)
    got += feed_packets(v, tone(1_000), 30_000)
    got += v.flush()

    assert len(got) == 2
    (s1, e1), (s2, _) = times(got)
    assert e1 == pytest.approx(1_500, abs=2 * FRAME_MS)
    assert s2 == pytest.approx(30_000, abs=2 * FRAME_MS)


def test_short_gap_keeps_one_utterance():
    gap = SILENCE_HOLD_MS // 2
    v = vad()
    got = feed_packets(v, tone(1_000), 0)
    got += feed_packets(v, tone(1_000), 1_000 + gap)
    got += v.flush()
    assert len(got) == 1


def test_backwards_offset_does_not_rewind():
    """과거를 가리키는 offset_ms 가 와도 시간축은 뒤로 가지 않는다.

    역방향 조각은 진행 중인 발화에 이어 붙는다. 이걸 존중해 시간축을 되돌리면
    500ms 근처에서 시작하는 발화가 생긴다. 그런 시작이 없어야 한다.
    """
    v = vad()
    got = feed_packets(v, tone(1_000), 10_000)   # 발화 1: 10.0 ~ 11.0초
    got += feed_packets(v, tone(1_000), 20_000)  # 9초 공백 → 발화 1 닫힘. 발화 2 시작
    got += feed_packets(v, tone(1_000), 500)     # 과거 오프셋. 발화 2 에 이어 붙어야 한다
    got += v.flush()

    starts = [s for s, _ in times(got)]
    assert len(got) == 2
    assert starts[0] == pytest.approx(10_000, abs=2 * FRAME_MS)
    assert starts[1] == pytest.approx(20_000, abs=2 * FRAME_MS)
    assert all(s >= 10_000 - 2 * FRAME_MS for s in starts)


def test_cough_is_dropped():
    """MIN_SPEECH_MS 보다 짧은 소리는 버린다."""
    v = vad()
    got = feed_packets(v, tone(200), 1_000)
    got += v.flush()
    assert got == []


def test_long_monologue_is_split_at_cap():
    v = vad()
    got = feed_packets(v, tone(30_000), 0)
    got += v.flush()
    assert len(got) >= 2


def test_seq_increases():
    v = vad()
    got = feed_packets(v, tone(1_000), 0)
    got += feed_packets(v, tone(1_000), 5_000)
    got += v.flush()
    assert [u.seq for u in got] == [1, 2]


def test_pending_ms_reports_in_flight_speech():
    v = vad()
    feed_packets(v, tone(2_000), 0)
    assert v.pending_ms >= 1_500
