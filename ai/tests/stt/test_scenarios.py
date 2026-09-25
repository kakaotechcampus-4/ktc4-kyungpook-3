"""재배치 합성 회의(stt/eval/scenarios.py). 정렬본 조각을 다시 놓는 순수 로직과, 가짜 전사로 만든 작은 회의."""

import json

import numpy as np
import pytest
import soundfile as sf

from stt.backend import SttResult, Word
from stt.eval import scenarios as SC

SR = 16_000


# ─────────────────────────────────────────── 배치
def test_place_puts_each_piece_after_the_previous_end_plus_gap():
    got = SC.place([("a", 1.0), ("b", 0.3), ("a", 0.5)], [2.0, 1.0, 1.5])
    assert got == [(1.0, 3.0), (3.3, 4.3), (4.8, 6.3)]


def test_place_allows_overlap_between_speakers_but_not_within_one_voice():
    assert SC.place([("a", 0.5), ("b", -1.0)], [3.0, 2.0]) == [(0.5, 3.5), (2.5, 4.5)]
    with pytest.raises(ValueError):
        SC.place([("a", 0.5), ("a", -1.0)], [3.0, 2.0])


# ─────────────────────────────────────────── 정답 조각
def test_raw_positions_map_normalized_characters_back_to_the_text():
    raw = "네, 저부터."
    pos = SC.raw_positions(raw)
    assert pos == [0, 3, 4, 5, len(raw)]             # 네 저 부 터, 끝


def test_anchor_range_is_counted_in_normalized_characters():
    raw = "자, 오늘은 회의. 네 맞아요, 그래서"
    assert SC.anchor_range(raw, "네 맞아요,") == (6, 10)
    with pytest.raises(ValueError):
        SC.anchor_range(raw, "없는 말")


def test_word_spans_follow_the_reference_even_with_recognition_errors():
    spans = SC.word_spans("오늘 회의는 여기서 마칩니다", ["오늘", "회이는", "여기서", "마칩니다"])
    assert spans == [(0, 2), (2, 5), (5, 8), (8, 12)]


def test_select_words_by_span_midpoint():
    spans = [(0, 2), (2, 5), (5, 8), (8, 12)]
    assert SC.select_words(spans, 2, 8) == (1, 2)
    assert SC.select_words(spans, 20, 22) is None


# ─────────────────────────────────────────── 작은 회의 하나 만들기
def _burst(sec):
    t = np.arange(int(SR * sec)) / SR
    return (0.3 * np.sin(2 * np.pi * 200 * t)).astype(np.float32)


class WordStt:
    """0.5초 소리 넷(0.5초 간격)이 단어 넷이라고 답한다. 시각은 보낸 조각 기준."""

    name = "fake/words"

    def transcribe(self, samples, sample_rate):
        texts = ["하나", "둘.", "셋", "넷."]
        return SttResult(text=" ".join(texts), words=[Word(t, i * 1.0, i * 1.0 + 0.5) for i, t in enumerate(texts)])


def test_build_writes_a_session_with_the_piece_audio_and_its_truth(tmp_path):
    src = tmp_path / "src-aligned"
    src.mkdir()
    z = lambda s: np.zeros(int(SR * s), dtype=np.float32)  # noqa: E731
    audio = np.concatenate([z(1.0), _burst(0.5), z(0.5), _burst(0.5), z(0.5), _burst(0.5), z(0.5), _burst(0.5), z(2)])
    sf.write(str(src / "가.wav"), audio, SR, subtype="PCM_16")
    (src / "truth_by_speaker.json").write_text(json.dumps({"가": "하나 둘. 셋 넷."}, ensure_ascii=False), encoding="utf-8")
    lib = SC.Library({"src-aligned": src}, WordStt(), gate=False)
    spec = {"name": "tiny", "description": "뒤 두 단어만", "pieces": [
        {"speaker": "가", "src": "src-aligned", "text": "셋 넷.", "gap": 2.0}]}
    out = SC.build(spec, lib, tmp_path / "scen")
    truth = json.loads((out / "truth_aligned.json").read_text(encoding="utf-8"))
    assert [(t["speaker"], t["text"]) for t in truth] == [("가", "셋 넷.")]
    assert truth[0]["start"] == 2.0
    wav, sr = sf.read(str(out / "가.wav"), dtype="float32")
    assert np.abs(wav[: int(SR * 1.9)]).max() == 0                 # 앞 2초는 무음
    assert np.abs(wav[int(SR * 2.0): int(SR * 3.6)]).max() > 0.1   # 조각 소리
    meta = json.loads((out / "meta.json").read_text(encoding="utf-8"))
    assert meta["kind"] == "synthetic-rearranged" and "합성" in meta["timeline"]
