"""골든 정렬본 채점(stt/eval/golden.py). 가짜 백엔드와 합성 톤만 쓴다."""

import json

import numpy as np
import soundfile as sf

from stt import batch as B
from stt.eval import golden
from stt.lines import Line

SR = 16_000


def _session(tmp_path):
    s = tmp_path / "tiny-aligned"
    s.mkdir()
    (s / "truth_by_speaker.json").write_text(json.dumps({"a": "안녕하세요 반갑습니다", "b": "네 좋아요"},
                                                        ensure_ascii=False), encoding="utf-8")
    (s / "truth_aligned.json").write_text(json.dumps([
        {"seq": 0, "speaker": "a", "text": "안녕하세요 반갑습니다", "start": 1.0, "end": 3.0},
        {"seq": 1, "speaker": "b", "text": "네 좋아요", "start": 4.0, "end": 5.0}], ensure_ascii=False), encoding="utf-8")
    t = np.arange(SR) / SR
    tone = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    silence = lambda sec: np.zeros(int(SR * sec), dtype=np.float32)  # noqa: E731
    sf.write(str(s / "a.wav"), np.concatenate([silence(1), tone, tone, silence(4)]), SR, subtype="PCM_16")
    sf.write(str(s / "b.wav"), np.concatenate([silence(4), tone, silence(3)]), SR, subtype="PCM_16")
    return s


def _line(spk, a_ms, b_ms, text):
    return Line(speaker_id=spk, speaker_name=spk, turn_id="", seq=0, start_ms=a_ms, end_ms=b_ms, text=text, final=True)


def test_session_metrics_scores_lines_against_the_aligned_truth(tmp_path):
    s = _session(tmp_path)
    stats = B.BatchStats(mode="chunk", backend="fake", tracks=2, track_s=16.0)
    m = golden.session_metrics(s, [_line("a", 1000, 3000, "안녕하세요 반갑습니다"), _line("b", 4000, 5000, "")],
                               stats, backend_kind="local")
    assert m["cer_by_speaker"] == {"a": 0.0, "b": 1.0}
    assert m["lost_utterances"] == "1/2" and m["order_edits"] == 1 and m["krw"] == 0.0
    assert m["hyp_by_speaker"] == {"a": "안녕하세요 반갑습니다", "b": ""}


class FixedStt:
    name = "fake/fixed"

    def transcribe(self, samples, sample_rate):
        from stt.backend import SttResult, Word
        return SttResult(text="안녕하세요", words=[Word("안녕하세요", 0.1, 0.6)])


def test_score_accepts_a_prebuilt_backend_and_keeps_its_output_file(tmp_path):
    s = _session(tmp_path)
    out = golden.score(s, "chunk", "local", "x", False, 1, True, backend=FixedStt(), out_dir=tmp_path / "out")
    assert out["backend"] == "fake/fixed" and out["calls"] == 2
    saved = json.loads((tmp_path / "out" / "score_chunk_local-x.json").read_text(encoding="utf-8"))
    assert saved["hyp_by_speaker"]["a"] == "안녕하세요"
