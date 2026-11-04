from __future__ import annotations

import numpy as np
import pytest
import soundfile as sf

from stt.transcribe import parse_wav_stem
from upload.diarize import Segment
from upload.tracks import load_mono_16k, speaker_label_id, write_virtual_tracks

SR = 16000


def _signal():
    rng = np.random.default_rng(0)
    return (rng.uniform(0.1, 0.5, 10 * SR)).astype(np.float32)


def _read(p):
    d, sr = sf.read(p, dtype="float32")
    return d, sr


def test_virtual_tracks_have_only_own_segments(tmp_path):
    a = _signal()
    segs = [Segment(1, 3, "A"), Segment(2.5, 5, "B"), Segment(6, 7, "A")]
    entries = write_virtual_tracks(a, segs, tmp_path, "20260101T000000")
    assert {e["user_id"] for e in entries} == {"A", "B"}
    tracks = {e["user_id"]: _read(tmp_path / e["file"]) for e in entries}
    ta, sra = tracks["A"]
    tb, _ = tracks["B"]
    assert sra == SR and ta.ndim == 1 and len(ta) == len(a) == len(tb)
    info = sf.info(tmp_path / entries[0]["file"])
    assert info.subtype == "PCM_16"
    for t, ranges in ((ta, [(1, 3), (6, 7)]), (tb, [(2.5, 5)])):
        mask = np.zeros(len(a), bool)
        for s, e in ranges:
            mask[int(s * SR):int(e * SR)] = True
        assert np.allclose(t[mask], a[mask], atol=1e-4)
        assert np.all(t[~mask] == 0)
    ov = slice(int(2.5 * SR), 3 * SR)
    assert np.allclose(ta[ov], a[ov], atol=1e-4) and np.allclose(tb[ov], a[ov], atol=1e-4)


def test_duration_and_file_name_in_entries(tmp_path):
    entries = write_virtual_tracks(_signal(), [Segment(1, 3, "A")], tmp_path, "T1")
    e = entries[0]
    assert e["file"] == "A_T1.wav"
    assert e["duration_sec"] == pytest.approx(10.0)


def test_label_without_segments_makes_no_file(tmp_path):
    write_virtual_tracks(_signal(), [Segment(1, 3, "A")], tmp_path, "T")
    assert [p.name for p in tmp_path.glob("*.wav")] == ["A_T.wav"]


def test_segments_past_end_are_clamped(tmp_path):
    a = _signal()
    (e,) = write_virtual_tracks(a, [Segment(9, 12, "A")], tmp_path, "T")
    t, _ = _read(tmp_path / e["file"])
    assert len(t) == len(a)
    assert np.allclose(t[9 * SR:], a[9 * SR:], atol=1e-4)


def test_load_48k_stereo_becomes_16k_mono(tmp_path):
    n = 48000 * 2
    t = np.arange(n) / 48000
    st = np.stack([0.5 * np.sin(2 * np.pi * 440 * t), np.zeros(n)], axis=1)
    p = tmp_path / "x.wav"
    sf.write(p, st, 48000, subtype="PCM_16")
    audio, total = load_mono_16k(p)
    assert audio.ndim == 1 and len(audio) == 2 * SR and total == pytest.approx(2.0)
    assert abs(audio).max() == pytest.approx(0.25, abs=0.02)  # 채널 평균


def test_speaker_label_id_drops_underscore_and_stays_distinct():
    ids = [speaker_label_id("SPEAKER_00"), speaker_label_id("SPEAKER_01")]
    assert ids == ["SPEAKER00", "SPEAKER01"]
    assert "_" not in "".join(ids)


def test_numeric_only_result_is_prefixed():
    assert speaker_label_id("0_1") == "S01"
    assert speaker_label_id("12") == "S12"


def test_empty_label_rejected():
    with pytest.raises(ValueError):
        speaker_label_id("___")


def test_labels_parse_as_distinct_ids_from_wav_stem(tmp_path):
    segs = [Segment(1, 2, "SPEAKER_00"), Segment(3, 4, "SPEAKER_01")]
    entries = write_virtual_tracks(_signal(), segs, tmp_path, "20260101T000000")
    got = {parse_wav_stem((tmp_path / e["file"]).stem)[0] for e in entries}
    assert got == {"SPEAKER00", "SPEAKER01"} == {e["user_id"] for e in entries}


@pytest.mark.parametrize("a,b", [("SPEAKER_00", "SPEAKER0_0"), ("S1", "1")])
def test_distinct_labels_folding_to_same_id_are_rejected(tmp_path, a, b):
    segs = [Segment(1, 2, a), Segment(3, 4, b)]
    with pytest.raises(ValueError, match="같은 id"):
        write_virtual_tracks(_signal(), segs, tmp_path, "T")
    assert not list(tmp_path.glob("*.wav"))


def test_load_44k_rounds_length_to_16k_frames(tmp_path):
    n = 44100 * 3 + 7
    p = tmp_path / "x.wav"
    sf.write(p, (0.3 * np.sin(np.arange(n) / 20)).astype(np.float32), 44100, subtype="PCM_16")
    audio, total = load_mono_16k(p)
    assert len(audio) == -(-n * 160 // 441) and total == len(audio) / SR
    assert total == pytest.approx(n / 44100, abs=1 / SR)


def test_load_flac(tmp_path):
    p = tmp_path / "x.flac"
    sf.write(p, np.full(SR, 0.25, dtype=np.float32), SR, format="FLAC")
    audio, total = load_mono_16k(p)
    assert len(audio) == SR and total == pytest.approx(1.0)
