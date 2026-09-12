from capture.timeline import Reorderer, is_noise_packet


def test_decoded_silence_frame_is_noise():
    """디스코드 침묵 프레임은 is_opus() 가 False 인 경로에서 이미 디코딩되어 온다
    — 3840바이트(20ms 스테레오 48kHz) 전부 0으로 풀린다. 원문 오퍼스 바이트는
    여기까지 오지 않는다."""
    assert is_noise_packet(b"\x00" * 3840) is True


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


def test_reorderer_breaks_ties_by_arrival_order():
    """RTP 가 같으면 도착 순서를 따른다."""
    r = Reorderer(window=8)
    r.push(1_000, "a")
    r.push(1_000, "b")
    assert r.flush() == ["a", "b"]


def test_reorderer_keeps_unreadable_packet_in_arrival_position():
    """RTP 를 못 읽는 패킷 하나가 스트림 중간에 섞여도 제자리에 남아야 한다.

    도착 순번(패킷당 +1)을 키로 쓰면 실제 RTP 델타(패킷당 +960)보다 훨씬 작아서
    앞선 음성 패킷들을 제치고 먼저 나간다.
    """
    r = Reorderer()
    base = 1_000
    out = []
    out += r.push(base, "a")
    out += r.push(base + 960, "b")
    out += r.push(base + 1920, "c")
    out += r.push(None, "x")          # RTP 를 못 읽은 패킷
    out += r.push(base + 2880, "d")
    out += r.push(base + 3840, "e")
    out += r.flush()
    assert out == ["a", "b", "c", "x", "d", "e"]


def test_reorderer_reanchors_when_origin_jumps_backward():
    """재접속. 새 원점이 더 작아도 이전 세션의 꼬리가 먼저 나가야 한다."""
    r = Reorderer()
    out = []
    for i, name in enumerate(["a", "b", "c", "d"]):
        out += r.push(900_000_000 + i * 960, name)
    for i, name in enumerate(["e", "f", "g", "h"]):
        out += r.push(1_000 + i * 960, name)
    out += r.flush()
    assert out == ["a", "b", "c", "d", "e", "f", "g", "h"]


def test_reorderer_reanchors_when_origin_jumps_forward():
    """재접속. 새 원점이 더 큰 경우도 같게 동작한다."""
    r = Reorderer()
    out = []
    for i, name in enumerate(["a", "b", "c", "d"]):
        out += r.push(1_000 + i * 960, name)
    for i, name in enumerate(["e", "f", "g", "h"]):
        out += r.push(900_000_000 + i * 960, name)
    out += r.flush()
    assert out == ["a", "b", "c", "d", "e", "f", "g", "h"]


def test_long_continuous_stream_does_not_reanchor():
    """20,000개의 정상적인 연속 패킷은 거짓 재고정을 트리거하지 않아야 한다."""
    r = Reorderer(window=16)
    out = []
    for i in range(20_000):
        result = r.push(i * 960, i)
        out += result
        # 처음 16번 push는 window를 채우지 못해 아무것도 반환하지 않음
        if i < 16:
            assert len(result) == 0, f"push {i}: expected empty, got {len(result)}"
        # 그 이후는 매번 정확히 1개씩 반환 (창이 차서)
        else:
            assert len(result) == 1, f"push {i}: expected 1, got {len(result)}"
    # 마지막으로 남은 것들 모두 출력
    out += r.flush()
    # 결과가 정렬 순서대로 0부터 19,999까지여야 함
    assert out == list(range(20_000))
