"""배치 전사(stt/batch.py). 백엔드는 가짜라 API 도 모델도 안 쓴다."""

import numpy as np
import soundfile as sf

from stt import batch as B
from stt.backend import SttResult, Word

SR = 16_000


def tone(ms, amp=0.3):
    t = np.arange(int(SR * ms / 1000)) / SR
    return (amp * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def silence(ms):
    return np.zeros(int(SR * ms / 1000), dtype=np.float32)


def write_track(path, parts):
    sf.write(str(path), np.concatenate(parts), SR, subtype="PCM_16")


class EchoStt:
    """받은 오디오 길이를 텍스트로, 단어 시각은 0.5초마다 하나씩. 되매핑을 검증하는 데 쓴다."""

    name = "echo"

    def __init__(self, words=True):
        self.calls = []
        self.words = words

    def transcribe(self, samples, sample_rate):
        dur = len(samples) / sample_rate
        self.calls.append(dur)
        ws = []
        if self.words:
            t = 0.25
            while t < dur:
                ws.append(Word(text=f"w{t:.2f}", start_s=t - 0.05, end_s=t + 0.05))
                t += 0.5
        return SttResult(text=f"({dur:.1f}s)", words=ws)


class FailingStt:
    name = "dead"

    def transcribe(self, samples, sample_rate):
        raise RuntimeError("죽음")


# ─────────────────────────────────────────────────── 자르기·시간축
def test_cut_keeps_absolute_meeting_time(tmp_path):
    """트랙 안의 샘플 위치가 회의 시각이다. 앞 무음 5초는 start_ms 5000 으로 나와야 한다."""
    p = tmp_path / "7_100.wav"
    write_track(p, [silence(5_000), tone(1_500), silence(2_000)])
    utts = B.cut(B.load_track(p), "7")
    assert len(utts) == 1
    assert 4_900 <= utts[0].start_ms <= 5_100
    assert 6_400 <= utts[0].end_ms <= 6_600


def test_discover_reads_uid_from_filename_and_manifest_names(tmp_path):
    write_track(tmp_path / "111_500.wav", [tone(500)])
    write_track(tmp_path / "222_500.wav", [tone(500)])
    (tmp_path.parent / "session_500.json").write_text(
        '{"speakers":[{"user_id":"111","display_name":"김환"}]}', encoding="utf-8")
    tracks = B.discover(tmp_path, B.load_names(tmp_path))
    assert [(t.speaker_id, t.speaker_name) for t in tracks] == [("111", "김환"), ("222", "222")]


def test_discover_accepts_golden_style_names(tmp_path):
    write_track(tmp_path / "유재환.wav", [tone(500)])
    (t,) = B.discover(tmp_path)
    assert (t.speaker_id, t.speaker_name) == ("유재환", "유재환")


# ─────────────────────────────────────────────────── 묶음
def _utts(*spans):
    """(start_s, dur_s) → Utterance. 회의 시각을 그대로 들고 있다."""
    from stt.vad import Utterance
    out = []
    for i, (s, d) in enumerate(spans, 1):
        out.append(Utterance(speaker_id="1", pcm=tone(d * 1000), sample_rate=SR,
                             start_ms=int(s * 1000), end_ms=int((s + d) * 1000), seq=i))
    return out


def test_chunks_respect_max_length_and_keep_pieces_in_order():
    utts = _utts((0, 10), (20, 10), (40, 10), (60, 5))
    chunks = B.build_chunks(utts, max_s=25.0, gap_s=0.2)
    assert [len(c.pieces) for c in chunks] == [2, 2]
    assert [u.start_ms for _, u in chunks[0].pieces] == [0, 20_000]
    # 묶음 길이 = 클립 합 + 클립마다 gap
    assert abs(len(chunks[0].pcm) / SR - (10 + 0.2 + 10 + 0.2)) < 0.01


def test_chunk_time_maps_back_to_meeting_time():
    utts = _utts((100, 2), (130, 3))
    (c,) = B.build_chunks(utts, max_s=28.0, gap_s=0.2)
    u, abs_s = c.to_absolute(0.5)
    assert u.start_ms == 100_000 and abs(abs_s - 100.5) < 1e-6
    u, abs_s = c.to_absolute(2.2 + 1.0)          # 첫 클립 2초 + gap 0.2 뒤 1초
    assert u.start_ms == 130_000 and abs(abs_s - 131.0) < 1e-6


# ─────────────────────────────────────────────────── 모드별 run
def _session(tmp_path):
    """화자 둘. A 는 0~2초·10~12초, B 는 5~8초. 정답 순서는 A, B, A."""
    write_track(tmp_path / "a.wav", [tone(2_000), silence(8_000), tone(2_000), silence(1_000)])
    write_track(tmp_path / "b.wav", [silence(5_000), tone(3_000), silence(5_000)])
    return B.discover(tmp_path)


def test_clip_mode_one_call_per_clip_and_global_seq(tmp_path):
    stt = EchoStt()
    lines, stats = B.run(_session(tmp_path), stt, mode="clip", gate=None, workers=2)
    assert stats.clips == 3 and stats.calls == 3
    assert [ln.speaker_id for ln in lines] == ["a", "b", "a"]      # start 로 정렬
    assert [ln.seq for ln in lines] == [1, 2, 3]                   # 회의 전체 순번
    assert all(ln.text for ln in lines)


def test_chunk_mode_joins_a_speakers_clips_and_remaps_words(tmp_path):
    stt = EchoStt()
    lines, stats = B.run(_session(tmp_path), stt, mode="chunk", gate=None, workers=1)
    assert stats.calls == 2                       # 화자마다 묶음 하나
    a = [ln for ln in lines if ln.speaker_id == "a"]
    assert len(a) == 2 and all(ln.text for ln in a)   # 단어가 두 클립에 나뉘어 붙었다
    assert stats.unmapped == 0
    # 묶음은 침묵을 뺐다: A 의 두 클립(2초+2초, 꼬리 100ms 씩)+gap 만 보냈다. 꼬리 침묵 800ms 는 안 간다
    assert 4.0 < max(stt.calls) < 5.0


def test_chunk_mode_without_word_times_puts_text_on_first_clip(tmp_path):
    stt = EchoStt(words=False)
    lines, stats = B.run(_session(tmp_path), stt, mode="chunk", gate=None, workers=1)
    a = [ln for ln in lines if ln.speaker_id == "a"]
    assert a[0].text and not a[1].text
    assert stats.unmapped == 2      # 화자 a, b 묶음 둘 다 단어 시각이 없다


def test_track_mode_counts_words_in_silence_as_hallucination(tmp_path):
    """VAD 가 말이 없다고 본 자리(A 의 2~10초 무음)에 놓인 단어는 버리고 센다."""
    stt = EchoStt()   # 0.5초마다 단어를 만들어 무음에도 단어가 생긴다
    lines, stats = B.run(_session(tmp_path)[:1], stt, mode="track", gate=None)
    assert stats.calls == 1 and stats.hallucinated_words > 0
    kept = " ".join(ln.text for ln in lines).split()
    assert all(0.0 <= float(w[1:]) <= 2.3 or 9.7 <= float(w[1:]) <= 12.3 for w in kept)


def test_failed_calls_become_error_lines_not_text(tmp_path):
    lines, stats = B.run(_session(tmp_path), FailingStt(), mode="clip", gate=None, workers=1)
    assert stats.failed == 3
    assert all(ln.error and ln.text == "" for ln in lines)


def test_gate_counts_rejections(tmp_path):
    class RejectAll:
        def accepts(self, pcm, sr, tag="", speech_s=None):
            return False

    lines, stats = B.run(_session(tmp_path), EchoStt(), mode="clip", gate=RejectAll(), workers=1)
    assert stats.gated == 3 and stats.clips == 0 and lines == []


def test_summary_has_percentiles():
    st = B.BatchStats(mode="clip", backend="x")
    st.transcribe_s = [1, 2, 3, 4, 20]
    s = st.summary()
    assert s["transcribe_p50_s"] == 3 and s["transcribe_p95_s"] == 20 and s["transcribe_max_s"] == 20
