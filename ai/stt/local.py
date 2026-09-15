"""로컬 faster-whisper 전사. API 장애 시 폴백으로 쓴다.

API 가 죽으면 회의가 통째로 빈다. 정확도는 떨어져도 무료라 비용 걱정 없이
돌릴 수 있으니, 빈 회의록보다는 낫다는 판단이다.
"""

from __future__ import annotations

import numpy as np

from stt.backend import SttResult, Word


class LocalStt:
    def __init__(self, model_size: str = "base", compute_type: str = "int8", language: str = "ko",
                 track_mode: bool = False):
        """track_mode 는 배치 경로용이다. beam 5 로 정확도를 사고, 무음 구간에서 앞 문장을
        반복하는 것을 condition_on_previous_text=False 와 hallucination_silence_threshold 로
        누른다(treesoop/whisper_transcription 이 같은 두 옵션을 쓴다). 실시간 경로는 클립이
        짧아 beam 1 이면 되고 무음이 안 들어가므로 기본값 그대로다.
        """
        self.name = f"local/{model_size}-{compute_type}" + ("-track" if track_mode else "")
        self.model_size = model_size
        self.compute_type = compute_type
        self.language = language
        self.track_mode = track_mode
        self._model = None

    def _load(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(self.model_size, device="cpu", compute_type=self.compute_type)
        return self._model

    def transcribe(self, samples: np.ndarray, sample_rate: int) -> SttResult:
        model = self._load()
        kw = dict(language=self.language, beam_size=1, vad_filter=False, word_timestamps=True)
        if self.track_mode:
            kw.update(beam_size=5, condition_on_previous_text=False, hallucination_silence_threshold=1.0)
        segments, _ = model.transcribe(samples, **kw)
        words: list[Word] = []
        texts: list[str] = []
        for s in segments:
            texts.append(s.text.strip())
            for w in s.words or []:
                words.append(Word(text=w.word.strip(), start_s=w.start, end_s=w.end))
        return SttResult(text=" ".join(t for t in texts if t).strip(), words=words)
