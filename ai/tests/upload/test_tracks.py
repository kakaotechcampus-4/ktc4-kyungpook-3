from __future__ import annotations

import av
import numpy as np
import pytest
import soundfile as sf

from stt.transcribe import parse_wav_stem
from upload.diarize import Segment
from upload.tracks import load_mono_16k, speaker_label_id, to_wav_16k, write_virtual_tracks

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


def _encode(path, codec, rate, layout, seconds=2.0):
    """PyAV 로 사인파를 인코딩해 파일을 만든다(float 평면 프레임)."""
    n_ch = 2 if layout == "stereo" else 1
    t = np.arange(int(rate * seconds)) / rate
    sig = (0.4 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    data = np.tile(sig, (n_ch, 1))
    with av.open(str(path), "w") as out:
        stream = out.add_stream(codec, rate=rate)
        stream.layout = layout
        step = 1024
        for i in range(0, data.shape[1] - step + 1, step):
            frame = av.AudioFrame.from_ndarray(np.ascontiguousarray(data[:, i:i + step]), format="fltp", layout=layout)
            frame.sample_rate = rate
            frame.pts = i
            for pkt in stream.encode(frame):
                out.mux(pkt)
        for pkt in stream.encode(None):
            out.mux(pkt)


@pytest.mark.parametrize("name,codec,rate,layout", [
    ("x.m4a", "aac", 44100, "stereo"),
    ("x.webm", "libopus", 48000, "stereo"),
])
def test_load_compressed_formats_as_16k_mono(tmp_path, name, codec, rate, layout):
    p = tmp_path / name
    _encode(p, codec, rate, layout)
    audio, total = load_mono_16k(p)
    assert audio.ndim == 1 and audio.dtype == np.float32
    assert total == len(audio) / SR == pytest.approx(2.0, abs=0.15)
    assert 0.2 < abs(audio).max() < 0.6  # 440Hz 사인이 살아 있다


def test_broken_file_raises_value_error(tmp_path):
    p = tmp_path / "bad.m4a"
    p.write_bytes(b"not audio at all" * 100)
    with pytest.raises(ValueError):
        load_mono_16k(p)


def test_empty_file_raises_value_error(tmp_path):
    p = tmp_path / "empty.wav"
    p.write_bytes(b"")
    with pytest.raises(ValueError):
        load_mono_16k(p)


def test_to_wav_16k_writes_16k_mono_pcm16(tmp_path):
    src = tmp_path / "x.wav"
    n = 44100 * 2
    sf.write(src, np.zeros((n, 2), dtype=np.float32) + 0.2, 44100, subtype="PCM_16")
    dst = tmp_path / "out.wav"
    to_wav_16k(src, dst)
    info = sf.info(dst)
    assert (info.samplerate, info.channels, info.subtype) == (SR, 1, "PCM_16")
    assert info.duration == pytest.approx(2.0, abs=1 / SR * 2)


def _many_small_chunks(total):
    """잘게 쪼갠 디코딩 조각(초기 버퍼를 여러 번 넘기게). 값은 위치를 알 수 있게 오름차순."""
    data = np.arange(total, dtype=np.float32) / total

    def fake(path, **_):
        for i in range(0, total, 1000):
            yield data[i:i + 1000]

    return data, fake


def test_to_wav_16k_streams_chunks_without_building_the_whole_array(tmp_path, monkeypatch):
    from upload import tracks
    data, fake = _many_small_chunks(5000)
    monkeypatch.setattr(tracks, "_decode_mono_16k", fake)
    monkeypatch.setattr(tracks.np, "concatenate", lambda *a, **k: pytest.fail("전체 배열을 만들면 안 된다"))
    dst = tmp_path / "out.wav"
    assert to_wav_16k(tmp_path / "ignored", dst) == pytest.approx(5000 / SR)
    got, sr = sf.read(dst, dtype="float32")
    assert sr == SR and len(got) == 5000 and np.allclose(got, data, atol=1e-4)


def test_to_wav_16k_of_nothing_is_a_valueerror_and_leaves_no_file(tmp_path, monkeypatch):
    from upload import tracks
    monkeypatch.setattr(tracks, "_decode_mono_16k", lambda path, **_: iter(()))
    dst = tmp_path / "out.wav"
    with pytest.raises(ValueError):
        to_wav_16k(tmp_path / "ignored", dst)
    assert not dst.exists()


def test_load_mono_16k_keeps_every_sample_when_the_buffer_has_to_grow(tmp_path, monkeypatch):
    from upload import tracks
    total = 3_000_000   # 처음 잡는 버퍼보다 길다
    data, fake = _many_small_chunks(total)
    monkeypatch.setattr(tracks, "_decode_mono_16k", fake)
    monkeypatch.setattr(tracks.np, "concatenate", lambda *a, **k: pytest.fail("리스트를 이어 붙이면 안 된다"))
    got, secs = load_mono_16k(tmp_path / "ignored")
    assert got.dtype == np.float32 and len(got) == total and secs == pytest.approx(total / SR)
    assert np.array_equal(got, data)


def test_to_wav_16k_stops_decoding_past_the_cap_and_leaves_no_file(tmp_path, monkeypatch):
    from upload import tracks
    pulled = []

    def endless(path, **_):
        while True:   # 끝없이 긴 오디오
            pulled.append(1000)
            yield np.zeros(1000, dtype=np.float32)

    monkeypatch.setattr(tracks, "_decode_mono_16k", endless)
    dst = tmp_path / "out.wav"
    with pytest.raises(ValueError, match="길다"):
        to_wav_16k(tmp_path / "ignored", dst, max_seconds=1)
    assert not dst.exists()
    assert sum(pulled) <= SR + 1000   # 상한을 넘긴 조각에서 멈춘다


def test_to_wav_16k_at_the_cap_is_kept_whole(tmp_path, monkeypatch):
    from upload import tracks
    data, fake = _many_small_chunks(SR)
    monkeypatch.setattr(tracks, "_decode_mono_16k", fake)
    dst = tmp_path / "out.wav"
    assert to_wav_16k(tmp_path / "ignored", dst, max_seconds=1) == pytest.approx(1.0)
    assert len(sf.read(dst)[0]) == SR


@pytest.mark.parametrize("suffix,fmt,codec,rate", [
    (".mp3", "mp3", "libmp3lame", 44100), (".m4a", "mp4", "aac", 44100),
    (".ogg", "ogg", "libopus", 48000), (".webm", "webm", "libopus", 48000),
])
def test_to_wav_16k_decodes_each_upload_container_with_its_named_format(tmp_path, suffix, fmt, codec, rate):
    src = tmp_path / f"source{suffix}"
    _encode(src, codec, rate, "mono")
    assert to_wav_16k(src, tmp_path / "out.wav", format=fmt) == pytest.approx(2.0, abs=0.15)


def test_to_wav_16k_decodes_wav_with_its_named_format(tmp_path):
    src = tmp_path / "source.wav"
    sf.write(src, np.zeros(SR, dtype=np.float32) + 0.2, SR, subtype="PCM_16")
    assert to_wav_16k(src, tmp_path / "out.wav", format="wav") == pytest.approx(1.0)


def test_to_wav_16k_rejects_a_file_that_is_not_the_named_format(tmp_path):
    src = tmp_path / "source.ogg"
    sf.write(src, np.zeros(SR, dtype=np.float32), SR, format="WAV", subtype="PCM_16")   # 이름만 ogg 인 wav
    with pytest.raises(ValueError):
        to_wav_16k(src, tmp_path / "out.wav", format="ogg")
