"""회의 녹음 섞기(#659). 화자별 wav 트랙을 샘플 0 에 맞춰 하나의 m4a 로 만든다."""

import av
import numpy as np
import pytest
import soundfile as sf

from capture.audio_mix import SAMPLE_RATE, mix_to_m4a


def _wav(path, seconds, *, bursts=(), amp=0.5, rate=SAMPLE_RATE):
    """무음 트랙에 0.1초 사인 버스트를 (시작 초) 위치마다 얹는다."""
    x = np.zeros(int(seconds * rate), dtype=np.float32)
    for at in bursts:
        n = int(0.1 * rate)
        t = np.arange(n) / rate
        x[int(at * rate):int(at * rate) + n] = amp * np.sin(2 * np.pi * 440 * t)
    sf.write(str(path), x, rate, subtype="PCM_16")
    return path


def _decode(path):
    chunks = []
    with av.open(str(path)) as c:
        stream = c.streams.audio[0]
        for frame in c.decode(stream):
            chunks.append(frame.to_ndarray().reshape(-1))
        rate = stream.rate
    return np.concatenate(chunks).astype(np.float32), rate


def _rms(x, rate, at):
    """at 초를 가운데로 ±50ms 창의 RMS."""
    lo, hi = int((at - 0.05) * rate), int((at + 0.15) * rate)
    return float(np.sqrt(np.mean(x[lo:hi] ** 2)))


def test_mix_aligns_tracks_at_sample_zero(tmp_path):
    a = _wav(tmp_path / "a.wav", 1.0, bursts=[0.2])
    b = _wav(tmp_path / "b.wav", 2.0, bursts=[1.5])
    dest = tmp_path / "mix.m4a"
    size = mix_to_m4a([a, b], dest)
    assert size == dest.stat().st_size > 0
    assert not dest.with_suffix(".part").exists()
    x, rate = _decode(dest)
    assert rate == SAMPLE_RATE
    assert abs(len(x) / rate - 2.0) <= 0.05
    quiet = _rms(x, rate, 0.8)
    assert _rms(x, rate, 0.2) >= 10 * quiet
    assert _rms(x, rate, 1.5) >= 10 * quiet


def test_mix_rejects_non_16k(tmp_path):
    a = _wav(tmp_path / "a.wav", 1.0, bursts=[0.2], rate=48000)
    with pytest.raises(ValueError):
        mix_to_m4a([a], tmp_path / "mix.m4a")
    assert not (tmp_path / "mix.m4a").exists()


def test_mix_scales_down_clipping(tmp_path):
    a = _wav(tmp_path / "a.wav", 1.0, bursts=[0.1, 0.4, 0.7], amp=0.9)   # 같은 자리 같은 파형이라 합이 1.8 까지 간다
    b = _wav(tmp_path / "b.wav", 1.0, bursts=[0.1, 0.4, 0.7], amp=0.9)
    dest = tmp_path / "mix.m4a"
    mix_to_m4a([a, b], dest)
    x, _ = _decode(dest)
    assert float(np.max(np.abs(x))) <= 1.0
    assert float(np.max(np.abs(x))) > 0.5   # 지워지지 않고 줄어들기만 했다


def test_mix_without_tracks_is_an_error(tmp_path):
    with pytest.raises(ValueError):
        mix_to_m4a([], tmp_path / "mix.m4a")
