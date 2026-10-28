"""교차 대화 합성(stt/eval/capacity/interleave.py)과 회의록 순서 채점(stt/eval/capacity/order.py)."""

import json

import numpy as np
import soundfile as sf

from stt.eval.capacity import interleave as I
from stt.eval.capacity import order as O

SR = 16_000


def tone(ms, amp=0.3):
    t = np.arange(int(SR * ms / 1000)) / SR
    return (amp * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def silence(ms):
    return np.zeros(int(SR * ms / 1000), dtype=np.float32)


def _aligned(tmp_path):
    """정렬본 모양. 민수가 먼저 길게 두 마디, 그다음 서연이 두 마디."""
    src = tmp_path / "src"
    src.mkdir()
    sf.write(str(src / "민수.wav"), np.concatenate([silence(500), tone(1_000), silence(1_500), tone(1_000),
                                                     silence(6_000)]), SR, subtype="PCM_16")
    sf.write(str(src / "서연.wav"), np.concatenate([silence(5_000), tone(1_000), silence(1_500), tone(1_000),
                                                     silence(1_500)]), SR, subtype="PCM_16")
    (src / "truth_by_speaker.json").write_text(json.dumps({"민수": "하나 둘", "서연": "셋 넷"}, ensure_ascii=False),
                                               encoding="utf-8")
    (src / "truth_aligned.json").write_text(json.dumps([
        {"seq": 0, "speaker": "민수", "text": "하나 둘", "start": 0.5, "end": 4.0},
        {"seq": 1, "speaker": "서연", "text": "셋 넷", "start": 5.0, "end": 8.5}], ensure_ascii=False), encoding="utf-8")
    return src


def test_interleaving_alternates_speakers_and_keeps_each_speakers_clips_in_order(tmp_path):
    out = tmp_path / "out"
    meta = I.build_interleaved(_aligned(tmp_path), out, per_turn=1, gap_s=0.8)
    placed = json.loads((out / "truth_aligned.json").read_text(encoding="utf-8"))
    assert [p["speaker"] for p in placed] == ["민수", "서연", "민수", "서연"]
    assert [p["src_start"] for p in placed if p["speaker"] == "민수"] == sorted(
        p["src_start"] for p in placed if p["speaker"] == "민수")
    assert all(b["start"] - a["end"] >= 0.79 for a, b in zip(placed, placed[1:]))      # 겹치지 않고 0.8초씩 띄운다
    assert json.loads((out / "truth_by_speaker.json").read_text(encoding="utf-8")) == {"민수": "하나 둘", "서연": "셋 넷"}
    a, sr = sf.read(str(out / "민수.wav"), dtype="float32")
    b, _ = sf.read(str(out / "서연.wav"), dtype="float32")
    assert sr == SR and len(a) == len(b) and meta["placements"] == 4
    # 서연의 첫 마디 자리에는 민수 트랙이 조용하다
    s, e = int(placed[1]["start"] * SR), int(placed[1]["end"] * SR)
    assert np.abs(a[s:e]).max() < 1e-3 < np.abs(b[s:e]).max()


TRUTH = [{"speaker": "a", "start": 0.0, "end": 1.0}, {"speaker": "b", "start": 3.0, "end": 4.0},
         {"speaker": "a", "start": 6.0, "end": 7.0}]


def test_a_line_that_skips_another_speakers_turn_is_a_jump_and_an_inversion():
    packed = [{"speaker": "a", "start": 0.0, "end": 7.0, "text": "하나예요. 셋이에요.", "seq": 1},
              {"speaker": "b", "start": 3.0, "end": 4.0, "text": "둘이에요.", "seq": 2}]
    m = O.measure(packed, TRUTH)
    assert (m["lines"], m["jumps"], m["speaker_seq_edits"], m["sentence_inversions"]) == (2, 1, 1, 1)


def test_lines_in_speaking_order_have_no_jumps_or_inversions():
    ordered = [{"speaker": "a", "start": 0.0, "end": 1.0, "text": "하나예요.", "seq": 1},
               {"speaker": "b", "start": 3.0, "end": 4.0, "text": "둘이에요.", "seq": 2},
               {"speaker": "a", "start": 6.0, "end": 7.0, "text": "셋이에요.", "seq": 3}]
    m = O.measure(ordered, TRUTH)
    assert (m["lines"], m["jumps"], m["speaker_seq_edits"], m["sentence_inversions"]) == (3, 0, 0, 0)


def test_without_truth_jumps_are_counted_against_the_other_speakers_lines():
    """실녹음처럼 정답 자리가 없으면 다른 화자 줄의 시작으로 센다. 정답에 견주는 두 지표는 비운다."""
    packed = [{"speaker": "a", "start": 0.0, "end": 7.0, "text": "하나예요.", "seq": 1},
              {"speaker": "b", "start": 3.0, "end": 4.0, "text": "둘이에요.", "seq": 2}]
    m = O.measure(packed, None)
    assert m["jumps"] == 1 and m["speaker_seq_edits"] is None and m["sentence_inversions"] is None
