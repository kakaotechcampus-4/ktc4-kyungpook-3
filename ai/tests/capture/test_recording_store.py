import json
import wave
from types import SimpleNamespace

from capture.recording_store import (
    PCM_CHANNELS,
    PCM_RATE,
    PCM_SAMPLE_WIDTH,
    Track,
    key_to_user_id,
    pcm_duration_sec,
    save_session,
    silence_padding,
    to_wav_bytes,
)


def test_key_to_user_id_handles_all_pycord_variants():
    assert key_to_user_id(None) is None
    assert key_to_user_id(12345) == 12345
    assert key_to_user_id(SimpleNamespace(id=777)) == 777
    assert key_to_user_id(SimpleNamespace(name="no id")) is None


def test_silence_padding_matches_gap_duration():
    assert silence_padding(0) == b""
    assert silence_padding(-1) == b""
    one_sec = silence_padding(1.0)
    assert len(one_sec) == PCM_RATE * PCM_CHANNELS * PCM_SAMPLE_WIDTH
    assert one_sec == b"\x00" * len(one_sec)
    assert pcm_duration_sec(one_sec) == 1.0


def test_to_wav_bytes_wraps_raw_pcm_and_keeps_existing_wav():
    raw = b"\x00\x00" * PCM_CHANNELS * PCM_RATE  # 1초 무음
    wav = to_wav_bytes(raw)
    assert wav[:4] == b"RIFF"
    assert to_wav_bytes(wav) is wav  # 이미 WAV 면 그대로


def test_save_session_writes_per_speaker_wav_and_manifest(tmp_path):
    one_sec = b"\x00\x00" * PCM_CHANNELS * PCM_RATE
    tracks = [
        Track(user_id="111", display_name="민수", raw=one_sec * 2),
        Track(user_id="222", display_name="서연", raw=one_sec),
        Track(user_id="333", display_name="빈트랙", raw=b""),
    ]
    manifest_path, manifest = save_session(tracks, tmp_path, ts=1700000000, guild="g", channel="c", library_version="x")

    assert manifest_path == tmp_path / "session_1700000000.json"
    assert manifest["session"] == "1700000000"
    assert [s["user_id"] for s in manifest["speakers"]] == ["111", "222"]  # 빈 트랙 제외
    assert manifest["speakers"][0]["duration_sec"] == 2.0
    assert manifest["speakers"][1]["duration_sec"] == 1.0

    with wave.open(str(tmp_path / "111_1700000000.wav"), "rb") as w:
        assert w.getframerate() == PCM_RATE and w.getnchannels() == PCM_CHANNELS

    on_disk = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert on_disk == manifest
