import numpy as np

from capture.audio import TARGET_SR, pcm_to_mono16k, to_wav_bytes


def test_one_discord_packet_becomes_320_samples():
    # 디스코드 20ms 패킷 = 48kHz 스테레오 int16 = 960프레임 * 2ch * 2byte
    data = (np.zeros(960 * 2, dtype="<i2")).tobytes()
    out = pcm_to_mono16k(data)
    assert out.shape == (320,)
    assert out.dtype == np.float32


def test_empty_input_returns_empty():
    assert pcm_to_mono16k(b"").size == 0


def test_truncated_packet_does_not_crash():
    # 4바이트 배수가 아닌 입력
    out = pcm_to_mono16k(b"\x01\x02\x03")
    assert out.size == 0


def test_amplitude_is_normalised():
    loud = np.full(960 * 2, 16384, dtype="<i2").tobytes()
    out = pcm_to_mono16k(loud)
    assert 0.4 < float(out.mean()) < 0.6


def test_channels_are_averaged_not_picked():
    # 좌우 진폭이 다른 패킷. 한쪽 채널만 읽으면 0.25(L) 나 0.75(R) 가 나오고,
    # 두 채널을 평균해야 0.5 가 나온다. 값이 유일한 판별 조건이라 shape 만 보면 못 잡는다.
    frames = np.zeros((960, 2), dtype="<i2")
    frames[:, 0] = 8192
    frames[:, 1] = 24576
    out = pcm_to_mono16k(frames.reshape(-1).tobytes())
    assert out.shape == (320,)
    expected = ((8192 + 24576) / 2) / 32768.0  # 0.5
    np.testing.assert_allclose(out, expected, atol=1e-6)


def test_wav_roundtrip_preserves_length():
    import io
    import soundfile as sf

    samples = np.sin(np.arange(TARGET_SR) / 100).astype(np.float32)
    wav = to_wav_bytes(samples)
    back, sr = sf.read(io.BytesIO(wav), dtype="float32")
    assert sr == TARGET_SR
    assert len(back) == len(samples)
