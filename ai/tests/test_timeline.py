import numpy as np

from capture.timeline import OPUS_SILENCE, Reorderer, is_noise_packet


def test_opus_silence_frame_is_noise():
    assert is_noise_packet(OPUS_SILENCE) is True


def test_almost_all_zero_packet_is_noise():
    # Cloudflare 보이스 서버가 보내는 쓰레기 패킷. 한 바이트 빼고 전부 0
    assert is_noise_packet(b"\x00" * 100 + b"\x05") is True


def test_empty_packet_is_noise():
    assert is_noise_packet(b"") is True


def test_real_audio_is_not_noise():
    assert is_noise_packet(bytes(range(1, 200))) is False


def test_reorderer_passes_through_when_in_order():
    r = Reorderer(window=4)
    assert r.push(100, "a") == []
    assert r.push(200, "b") == []
    assert r.push(300, "c") == []
    assert r.push(400, "d") == []
    # 창이 찼으므로 가장 오래된 것부터 나온다
    assert r.push(500, "e") == ["a"]


def test_reorderer_sorts_out_of_order_packets():
    r = Reorderer(window=3)
    r.push(300, "c")
    r.push(100, "a")
    r.push(200, "b")
    out = r.push(400, "d") + r.flush()
    assert out == ["a", "b", "c", "d"]


def test_reorderer_flush_empties_window():
    r = Reorderer(window=8)
    r.push(100, "a")
    r.push(200, "b")
    assert r.flush() == ["a", "b"]
    assert r.flush() == []


def test_reorderer_without_rtp_keeps_arrival_order():
    """RTP 를 못 읽는 경우. 도착 순서를 그대로 유지한다."""
    r = Reorderer(window=2)
    out = []
    for x in ["a", "b", "c", "d"]:
        out += r.push(None, x)
    out += r.flush()
    assert out == ["a", "b", "c", "d"]


def test_reorderer_handles_wraparound_without_reordering_everything():
    """32비트 랩어라운드. 거대한 역방향 점프를 정렬 기준으로 믿으면 안 된다."""
    r = Reorderer(window=4)
    r.push(0xFFFFFF00, "a")
    r.push(0xFFFFFFF0, "b")
    r.push(0x00000010, "c")   # 랩어라운드
    out = r.push(0x00000100, "d") + r.flush()
    assert out == ["a", "b", "c", "d"]
