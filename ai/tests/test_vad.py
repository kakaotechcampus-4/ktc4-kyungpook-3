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

    역방향 조각은 진행 중인 발화에 이어 붙는다. 발화 시작은 이미 고정돼 있으므로
    되감기는 끝 시각이 시작보다 앞으로 가는 것으로 드러난다. 그게 없어야 한다.
    """
    v = vad()
    got = feed_packets(v, tone(1_000), 10_000)   # 발화 1: 10.0 ~ 11.0초
    got += feed_packets(v, tone(1_000), 20_000)  # 9초 공백 → 발화 1 닫힘. 발화 2 시작
    got += feed_packets(v, tone(1_000), 500)     # 과거 오프셋. 발화 2 에 이어 붙어야 한다
    got += v.flush()

    assert len(got) == 2
    (s1, e1), (s2, e2) = times(got)
    assert s1 == pytest.approx(10_000, abs=2 * FRAME_MS)
    assert e1 == pytest.approx(11_000, abs=2 * FRAME_MS)
    assert s2 == pytest.approx(20_000, abs=2 * FRAME_MS)
    # 역방향 1초가 이어 붙었으니 발화 2 는 20.0 ~ 22.0초다. 되감겼다면 끝이 1.5초 근처가 된다
    assert e2 == pytest.approx(22_000, abs=2 * FRAME_MS)
    assert all(e >= s for s, e in times(got))


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
    # 진행 중이던 발화가 없을 때 pending_start_ms 는 0
    assert v.pending_start_ms == 0
    feed_packets(v, tone(2_000), 5_000)
    assert v.pending_ms >= 1_500
    # 진행 중일 때는 발화 시작 시각을 보고한다
    assert v.pending_start_ms == pytest.approx(5_000, abs=2 * FRAME_MS)


def test_sweep_closes_an_utterance_when_packets_stop():
    """디스코드는 말을 멈추면 패킷을 끊는다. 다음 패킷을 기다리면 그때까지 안 닫힌다.

    _on_gap 은 뒤에 온 패킷이 공백을 알려 줄 때만 불린다. 그 화자가 다시 말하지 않으면
    발화가 열린 채로 남아 회의 중 화면에 안 뜬다. sweep 은 벽시계 쪽에서 그 자리를 메운다.
    """
    v = vad()
    assert feed_packets(v, tone(1_000), 0) == []      # 아직 말하는 중
    assert v.pending_ms > 0

    assert v.sweep(1_000 + SILENCE_HOLD_MS - FRAME_MS) is None   # 한도 직전
    u = v.sweep(1_000 + SILENCE_HOLD_MS)                         # 한도
    assert u is not None
    assert u.start_ms == 0
    assert u.end_ms <= 1_000          # 끝은 마지막으로 말이 있던 프레임이다
    assert v.pending_ms == 0


def test_sweep_is_quiet_when_nothing_is_open():
    """열린 발화가 없으면 아무 일도 하지 않는다. 주기적으로 불리는 함수라 조용해야 한다."""
    v = vad()
    assert v.sweep(10_000) is None
    feed_packets(v, tone(1_000), 0)
    v.sweep(1_000 + SILENCE_HOLD_MS)
    assert v.sweep(50_000) is None       # 이미 닫힌 뒤


def test_sweep_does_not_double_count_a_later_gap():
    """한도에 못 미친 sweep 이 침묵을 적립해 두면 뒤에 온 패킷의 _on_gap 이 이중으로 센다."""
    v = vad()
    feed_packets(v, tone(1_000), 0)
    half = SILENCE_HOLD_MS // 2
    assert v.sweep(1_000 + half) is None          # 한도 미달
    # 한도의 절반만 더 흐른 시점에 패킷이 오면 아직 닫히면 안 된다.
    out = feed_packets(v, tone(200), 1_000 + half + FRAME_MS)
    assert out == []
