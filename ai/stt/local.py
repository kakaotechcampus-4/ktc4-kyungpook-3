"""로컬 faster-whisper 전사. 부분 전사와 API 폴백에 쓴다.

부분 전사는 화면에 "말하는 중" 을 보여주는 용도라 최종본이 덮어쓴다.
그래서 작은 모델로 충분하고, 무료라 몇 번을 돌려도 비용이 들지 않는다.
"""

from __future__ import annotations

import numpy as np

from stt.backend import SttResult, Word


class LocalStt:
    def __init__(self, model_size: str = "base", compute_type: str = "int8", language: str = "ko"):
        self.name = f"local/{model_size}-{compute_type}"
        self.model_size = model_size
        self.compute_type = compute_type
        self.language = language
        self._model = None

    def _load(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(self.model_size, device="cpu", compute_type=self.compute_type)
        return self._model

    def transcribe(self, samples: np.ndarray, sample_rate: int) -> SttResult:
        model = self._load()
        segments, _ = model.transcribe(
            samples, language=self.language, beam_size=1, vad_filter=False, word_timestamps=True
        )
        words: list[Word] = []
        texts: list[str] = []
        for s in segments:
            texts.append(s.text.strip())
            for w in s.words or []:
                words.append(Word(text=w.word.strip(), start_s=w.start, end_s=w.end))
        return SttResult(text=" ".join(t for t in texts if t).strip(), words=words)
