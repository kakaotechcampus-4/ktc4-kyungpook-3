"""FLEURS 채점기의 앞뒤 무음 떼기. 말 필터에는 이것을 주고 전사에는 원본을 준다."""

import numpy as np

from stt.eval.fleurs import trim_edges

SR = 16_000


def test_trim_edges_removes_leading_and_trailing_silence_only():
    t = np.arange(SR) / SR
    tone = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    pause = np.zeros(SR // 2, dtype=np.float32)
    audio = np.concatenate([np.zeros(2 * SR, dtype=np.float32), tone, pause, tone, np.zeros(3 * SR, dtype=np.float32)])
    out = trim_edges(audio, SR)
    assert abs(len(out) / SR - 2.5) < 0.05          # 말 1초 + 쉼 0.5초 + 말 1초. 안쪽 쉼은 남는다


def test_trim_edges_keeps_all_silence_input_as_is():
    audio = np.zeros(SR, dtype=np.float32)
    assert len(trim_edges(audio, SR)) == SR
