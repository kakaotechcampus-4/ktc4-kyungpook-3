"""로컬 faster-whisper 전사. API 장애 시 폴백이자 종료 후 배치 전사의 한 축이다.

API 가 죽으면 회의가 통째로 빈다. 정확도는 떨어져도 무료라 비용 걱정 없이
돌릴 수 있으니, 빈 회의록보다는 낫다는 판단이다.
"""

from __future__ import annotations

import numpy as np

from stt.backend import SttResult, Word


class LocalStt:
    def __init__(self, model_size: str = "base", compute_type: str = "int8", language: str = "ko",
                 track_mode: bool = False, *, beam_size: int | None = None,
                 condition_on_previous_text: bool | None = None,
                 hallucination_silence_threshold: float | None = None):
        """옵션 셋이 전사 결과를 가른다. 값을 안 주면 경로별 기본값이다.

        beam_size: 실시간 클립은 1 (짧아서 빔이 시간만 든다), 배치는 5.
        condition_on_previous_text: 30초 창을 넘는 오디오에서 앞 창의 텍스트를 다음 창의
          프롬프트로 준다. 무음 창에서 앞 문장을 반복하는 원인이라 트랙 통째 전사에서는 끈다.
          28초 안의 묶음은 창이 하나라 이 값이 결과를 바꾸지 않는다.
        hallucination_silence_threshold: 단어 시각 기준으로 이 길이(초) 넘는 무음 뒤의 세그먼트를
          환각으로 보고 건너뛴다. 트랙 통째 전사에서만 1.0 으로 켠다.
        track_mode=True 는 위 셋을 (5, False, 1.0) 으로 두는 줄임말이다.
        """
        self.model_size = model_size
        self.compute_type = compute_type
        self.language = language
        self.beam_size = beam_size if beam_size is not None else (5 if track_mode else 1)
        self.condition_on_previous_text = (condition_on_previous_text if condition_on_previous_text is not None
                                           else (not track_mode))
        self.hallucination_silence_threshold = (hallucination_silence_threshold
                                                if hallucination_silence_threshold is not None
                                                else (1.0 if track_mode else None))
        flags = f"-b{self.beam_size}"
        if not self.condition_on_previous_text:
            flags += "-nocond"
        if self.hallucination_silence_threshold is not None:
            flags += f"-hst{self.hallucination_silence_threshold:g}"
        self.name = f"local/{model_size}-{compute_type}{flags}"
        self._model = None

    def _load(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(self.model_size, device="cpu", compute_type=self.compute_type)
        return self._model

    def transcribe(self, samples: np.ndarray, sample_rate: int) -> SttResult:
        model = self._load()
        kw = dict(language=self.language, beam_size=self.beam_size, vad_filter=False, word_timestamps=True,
                  condition_on_previous_text=self.condition_on_previous_text)
        if self.hallucination_silence_threshold is not None:
            kw["hallucination_silence_threshold"] = self.hallucination_silence_threshold
        segments, _ = model.transcribe(samples, **kw)
        words: list[Word] = []
        texts: list[str] = []
        for s in segments:
            texts.append(s.text.strip())
            for w in s.words or []:
                words.append(Word(text=w.word.strip(), start_s=w.start, end_s=w.end))
        return SttResult(text=" ".join(t for t in texts if t).strip(), words=words)
