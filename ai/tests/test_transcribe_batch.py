"""stt/transcribe.py 가 배치 경로(stt/batch.py)로 위임할 때 재환님 출력 형식을 지키는지. 모델은 안 쓴다."""

import numpy as np
import soundfile as sf

from stt import transcribe as T
from stt.backend import SttResult, Word

SR = 16_000


def _tone(ms):
    t = np.arange(int(SR * ms / 1000)) / SR
    return (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def _silence(ms):
    return np.zeros(int(SR * ms / 1000), dtype=np.float32)


class EchoStt:
    """받은 오디오 길이를 텍스트로, 단어 시각은 0.5초마다 하나씩."""

    name = "echo"
    compute_type = "int8"
    language = "ko"

    def transcribe(self, samples, sample_rate):
        dur = len(samples) / sample_rate
        ws = []
        t = 0.25
        while t < dur:
            ws.append(Word(text=f"w{t:.2f}", start_s=t - 0.05, end_s=t + 0.05))
            t += 0.5
        return SttResult(text=" ".join(w.text for w in ws), words=ws)


def _session(tmp_path):
    """화자 1 은 0~2초·10~12초, 화자 2 는 5~8초. 순서는 1, 2, 1."""
    a, b = tmp_path / "1_500.wav", tmp_path / "2_500.wav"
    sf.write(str(a), np.concatenate([_tone(2000), _silence(8000), _tone(2000), _silence(1000)]), SR, subtype="PCM_16")
    sf.write(str(b), np.concatenate([_silence(5000), _tone(3000), _silence(5000)]), SR, subtype="PCM_16")
    return [a, b]


def test_batch_session_keeps_per_file_schema_and_meeting_time(tmp_path):
    wavs = _session(tmp_path)
    results, summary = T.transcribe_session_batch(wavs, {"1": "민수"}, EchoStt(), mode="chunk",
                                                  model_name="echo", gate=None, workers=1)
    r1, r2 = results[wavs[0]], results[wavs[1]]
    assert r1["speaker_id"] == "1" and r1["speaker"] == "민수" and r2["speaker"] == "2"
    assert r1["audio_duration_sec"] == 13.0 and r1["clips"] == 2 and r1["failed"] == 0
    # segments 의 start 는 파일 안 위치 = 회의 시각. 화자 2 의 발화는 5초 근처에서 시작해야 한다
    assert 4.8 <= r2["segments"][0]["start"] <= 5.2
    assert [round(s["start"]) for s in r1["segments"]] == [0, 10]
    assert all(s["text"] for s in r1["segments"]) and r1["text"]
    assert r1["sec_per_audio_min"] is not None and r1["transcribe_sec"] >= 0
    assert summary["mode"] == "chunk" and summary["calls"] == 2 and summary["tracks"] == 2


def test_batch_session_merges_into_time_ordered_transcript(tmp_path):
    wavs = _session(tmp_path)
    results, _ = T.transcribe_session_batch(wavs, {}, EchoStt(), mode="clip", model_name="echo", gate=None, workers=2)
    out = tmp_path / "out"
    out.mkdir()
    import json
    for w, r in results.items():
        (out / f"{w.stem}__echo.json").write_text(json.dumps(r, ensure_ascii=False), encoding="utf-8")
    merged = T.build_session_transcript(out, "500", "echo")
    d = json.loads(merged.read_text(encoding="utf-8"))
    assert [s["speaker"] for s in d["segments"]] == ["1", "2", "1"]
    assert d["speakers"] == {"1": "1", "2": "2"}
