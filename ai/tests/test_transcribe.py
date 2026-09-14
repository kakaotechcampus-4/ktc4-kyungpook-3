import json
import wave

from stt import transcribe as T


def _wav(path, seconds=1.0, rate=16000):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))


def test_stem_parsing():
    assert T.parse_wav_stem("528123830867066880_1788526909") == ("528123830867066880", "1788526909")
    assert T.parse_transcript_stem("528_1788__small") == ("528", "1788", "small")
    assert T.parse_transcript_stem("528_1788") == ("528", "1788", "?")


def test_collect_wavs_filters_by_session_and_dedupes(tmp_path):
    a, b = tmp_path / "1_100.wav", tmp_path / "2_200.wav"
    _wav(a), _wav(b)
    (tmp_path / "note.txt").write_text("x")
    assert T.collect_wavs([str(tmp_path), str(a)], None) == [a, b]
    assert T.collect_wavs([str(tmp_path)], "200") == [b]


def test_transcribe_file_emits_speaker_tagged_segments(tmp_path):
    """faster-whisper 없이 스텁 모델로 출력 스키마만 확인."""
    wav = tmp_path / "42_1000.wav"
    _wav(wav, seconds=2.0)

    class Seg:
        def __init__(self, s, e, t): self.start, self.end, self.text = s, e, t

    class Model:
        def transcribe(self, path, **kw):
            return iter([Seg(0.0, 1.0, " 안녕하세요 "), Seg(1.0, 2.0, "테스트")]), type("I", (), {"duration": 2.0, "language_probability": 0.99})()

    r = T.transcribe_file(Model(), wav, model_name="small", device="cpu", compute_type="int8",
                          language="ko", beam_size=5, vad=False)
    assert r["speaker_id"] == "42"
    assert r["segments"] == [
        {"speaker": "42", "start": 0.0, "end": 1.0, "text": "안녕하세요"},
        {"speaker": "42", "start": 1.0, "end": 2.0, "text": "테스트"},
    ]
    assert r["text"] == "안녕하세요 테스트"
    assert r["audio_duration_sec"] == 2.0
    assert r["sec_per_audio_min"] is not None


def test_build_session_transcript_merges_speakers_in_time_order(tmp_path):
    def dump(name, speaker_id, speaker, segs):
        (tmp_path / name).write_text(json.dumps({"speaker_id": speaker_id, "speaker": speaker, "segments": segs}), encoding="utf-8")

    dump("1_500__small.json", "1", "민수", [{"speaker": "1", "start": 0.0, "end": 2.0, "text": "A"},
                                           {"speaker": "1", "start": 5.0, "end": 6.0, "text": "C"}])
    dump("2_500__small.json", "2", "서연", [{"speaker": "2", "start": 2.5, "end": 4.0, "text": "B"}])
    dump("2_999__small.json", "2", "서연", [{"speaker": "2", "start": 0.0, "end": 1.0, "text": "other session"}])

    out = T.build_session_transcript(tmp_path, "500", "small")
    d = json.loads(out.read_text(encoding="utf-8"))
    assert out.name == "session_500.transcript.json"
    assert [s["text"] for s in d["segments"]] == ["A", "B", "C"]
    assert d["speakers"] == {"1": "민수", "2": "서연"}
    assert T.build_session_transcript(tmp_path, "404", "small") is None


def test_timing_summary_verdicts(tmp_path):
    (tmp_path / "1_500__small.json").write_text(json.dumps({"speaker": "민수", "audio_file": "1_500.wav", "model": "small",
        "device": "cpu", "compute_type": "int8", "audio_duration_sec": 60.0, "transcribe_sec": 9.0, "sec_per_audio_min": 9.0}))
    (tmp_path / "1_500__medium.json").write_text(json.dumps({"speaker": "민수", "audio_file": "1_500.wav", "model": "medium",
        "device": "cpu", "compute_type": "int8", "audio_duration_sec": 60.0, "transcribe_sec": 40.0, "sec_per_audio_min": 40.0}))
    (tmp_path / "session_500.transcript.json").write_text("{}")  # 병합 파일은 무시돼야 함
    rows = T.collect_timing_rows(tmp_path)
    assert len(rows) == 2
    out = tmp_path / "timing.md"
    T.write_timing_summary(rows, out)
    md = out.read_text(encoding="utf-8")
    assert "| medium |" in md and "FAIL" in md and "PASS" in md
