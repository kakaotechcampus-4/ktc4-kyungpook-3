import numpy as np
import soundfile as sf
import wave

from capture.track_writer import MAX_GAP_MS, TrackWriter


def ramp(n, sr=16_000):
    return np.linspace(-0.5, 0.5, n, dtype=np.float32)


def test_gap_is_filled_with_silence(tmp_path):
    w = TrackWriter(tmp_path / "a.wav")
    w.write_at(ramp(1600), offset_ms=0)          # 0.0~0.1s
    w.write_at(ramp(1600), offset_ms=500)        # 0.5~0.6s → 0.1~0.5 는 무음
    dur = w.close()
    data, sr = sf.read(tmp_path / "a.wav", dtype="float32")
    assert sr == 16_000
    assert abs(dur - 0.6) < 1e-3
    assert len(data) == 9600
    assert np.all(data[1600:8000] == 0)
    assert not np.all(data[8000:] == 0)


def test_oversized_gap_is_counted_not_filled(tmp_path):
    w = TrackWriter(tmp_path / "a.wav")
    w.write_at(ramp(160), offset_ms=0)
    w.write_at(ramp(160), offset_ms=MAX_GAP_MS + 10_000)
    w.close()
    data, _ = sf.read(tmp_path / "a.wav", dtype="float32")
    assert len(data) == 320
    assert w.oversized_gaps == 1


def test_backwards_offset_is_appended_and_counted(tmp_path):
    w = TrackWriter(tmp_path / "a.wav")
    w.write_at(ramp(1600), offset_ms=1000)
    w.write_at(ramp(160), offset_ms=200)
    w.close()
    data, _ = sf.read(tmp_path / "a.wav", dtype="float32")
    assert len(data) == 16_000 + 1600 + 160
    assert w.backwards == 1


def test_write_after_close_is_ignored(tmp_path):
    w = TrackWriter(tmp_path / "a.wav")
    w.write_at(ramp(160), offset_ms=0)
    w.close()
    w.write_at(ramp(160), offset_ms=100)
    data, _ = sf.read(tmp_path / "a.wav", dtype="float32")
    assert len(data) == 160


def test_file_is_readable_by_wave_module(tmp_path):
    w = TrackWriter(tmp_path / "a.wav")
    w.write_at(ramp(1600), offset_ms=0)
    w.close()
    with wave.open(str(tmp_path / "a.wav"), "rb") as f:
        assert f.getframerate() == 16_000
        assert f.getnchannels() == 1
        assert f.getsampwidth() == 2
        assert f.getnframes() == 1600
