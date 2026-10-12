"""합성 긴 회의(stt/eval/capacity/synth.py). 정렬본 회의를 화자별로 번갈아 이어 붙여 목표 길이를 넘긴다."""

import json

import numpy as np
import pytest
import soundfile as sf

from stt.eval.capacity import synth as S

SR = 16_000


def _tone(path, seconds, hz, *, sr=SR, channels=1):
    path.parent.mkdir(parents=True, exist_ok=True)
    t = np.arange(int(seconds * sr)) / sr
    a = (0.3 * np.sin(2 * np.pi * hz * t)).astype(np.float32)
    if channels > 1:
        a = np.stack([a] * channels, axis=1)
    sf.write(str(path), a, sr, subtype="PCM_16")
    return sf.read(str(path), dtype="int16")[0]


def _read(path):
    return sf.read(str(path), dtype="int16")[0]


def test_repeats_alternate_sources_until_target_without_cutting_the_last(tmp_path):
    """1.0초, 1.5초, 간격 0.5초, 목표 5초. a 1.0, 간격 1.5, b 3.0, 간격 3.5, a 4.5, 간격 5.0, b 6.5 에서 멈춘다.
    목표에서 자르면 5.0초, 한 번 더 붙이면 8.0초가 된다."""
    a = _tone(tmp_path / "m01" / "김동우.wav", 1.0, 220)
    b = _tone(tmp_path / "m02" / "김동우.wav", 1.5, 330)
    meta = S.build_long_meeting([tmp_path / "m01", tmp_path / "m02"], tmp_path / "out", target_s=5.0, gap_s=0.5)

    out = _read(tmp_path / "out" / "김동우.wav")
    gap = np.zeros(SR // 2, dtype=np.int16)
    assert np.array_equal(out, np.concatenate([a, gap, b, gap, a, gap, b]))
    assert meta["repeats"] == 4
    assert meta["track_s"] == 6.5


def test_stops_when_the_total_lands_exactly_on_target(tmp_path):
    """a 1.0, 간격 1.5, b 3.0. 목표 3.0 이면 거기서 멈춘다."""
    _tone(tmp_path / "m01" / "x.wav", 1.0, 220)
    _tone(tmp_path / "m02" / "x.wav", 1.5, 330)
    meta = S.build_long_meeting([tmp_path / "m01", tmp_path / "m02"], tmp_path / "out", target_s=3.0, gap_s=0.5)
    assert meta["repeats"] == 2
    assert len(_read(tmp_path / "out" / "x.wav")) == 3 * SR


def test_shorter_track_is_padded_with_silence_so_speakers_stay_aligned(tmp_path):
    """같은 소스 안에서 짧은 트랙은 가장 긴 트랙에 맞춰 무음을 채운다. 그래야 다음 반복이 화자마다 같은 시각에 시작한다."""
    x1 = _tone(tmp_path / "m01" / "x.wav", 1.0, 220)
    y1 = _tone(tmp_path / "m01" / "y.wav", 0.75, 440)
    x2 = _tone(tmp_path / "m02" / "x.wav", 0.5, 330)
    y2 = _tone(tmp_path / "m02" / "y.wav", 0.5, 550)
    S.build_long_meeting([tmp_path / "m01", tmp_path / "m02"], tmp_path / "out", target_s=1.5, gap_s=0.25)

    x, y = _read(tmp_path / "out" / "x.wav"), _read(tmp_path / "out" / "y.wav")
    assert len(x) == len(y) == int(1.75 * SR)
    gap = np.zeros(SR // 4, dtype=np.int16)
    assert np.array_equal(x, np.concatenate([x1, gap, x2]))
    assert np.array_equal(y, np.concatenate([y1, np.zeros(SR // 4, dtype=np.int16), gap, y2]))


def test_only_speakers_present_in_every_source_are_written(tmp_path):
    for name in ("x", "y", "z"):
        _tone(tmp_path / "m01" / f"{name}.wav", 0.5, 220)
    for name in ("x", "y"):
        _tone(tmp_path / "m02" / f"{name}.wav", 0.5, 330)
    S.build_long_meeting([tmp_path / "m01", tmp_path / "m02"], tmp_path / "out", target_s=1.0, gap_s=0.1)
    assert sorted(p.name for p in (tmp_path / "out").glob("*.wav")) == ["x.wav", "y.wav"]


def test_meta_marks_the_meeting_as_synthetic_and_is_written_next_to_tracks(tmp_path):
    _tone(tmp_path / "meeting-01-aligned" / "x.wav", 1.0, 220)
    _tone(tmp_path / "meeting-02-aligned" / "x.wav", 1.5, 330)
    meta = S.build_long_meeting([tmp_path / "meeting-01-aligned", tmp_path / "meeting-02-aligned"],
                                tmp_path / "out", target_s=5.0, gap_s=0.5)
    assert meta == {
        "kind": "synthetic-loop",
        "sources": ["meeting-01-aligned", "meeting-02-aligned"],
        "repeats": 4,
        "gap_s": 0.5,
        "target_s": 5.0,
        "track_s": 6.5,
        "sample_rate": SR,
        "timeline": "합성. 정렬본을 반복해 이어 붙임. 정확도 지표로 쓰지 않는다",
    }
    assert json.loads((tmp_path / "out" / "meta.json").read_text(encoding="utf-8")) == meta


@pytest.mark.parametrize("other", [{"sr": 8_000}, {"channels": 2}], ids=["sample_rate", "channels"])
def test_sources_with_different_format_are_refused_before_writing(tmp_path, other):
    _tone(tmp_path / "m01" / "x.wav", 0.5, 220)
    _tone(tmp_path / "m02" / "x.wav", 0.5, 330, **other)
    with pytest.raises(ValueError):
        S.build_long_meeting([tmp_path / "m01", tmp_path / "m02"], tmp_path / "out", target_s=2.0, gap_s=0.1)
    assert not list((tmp_path / "out").glob("*.wav"))


def test_main_takes_minutes_and_gap(tmp_path):
    _tone(tmp_path / "m01" / "x.wav", 1.0, 220)
    _tone(tmp_path / "m02" / "x.wav", 1.5, 330)
    S.main(["--source", str(tmp_path / "m01"), "--source", str(tmp_path / "m02"),
            "--out", str(tmp_path / "out"), "--minutes", str(5 / 60), "--gap", "0.5"])
    meta = json.loads((tmp_path / "out" / "meta.json").read_text(encoding="utf-8"))
    assert (meta["repeats"], meta["track_s"]) == (4, 6.5)
