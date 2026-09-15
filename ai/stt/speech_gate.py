"""전사 앞에 세우는 두 번째 관문. 말이 아닌 오디오를 백엔드로 보내지 않는다.

에너지 VAD 는 배경음악의 희미한 보컬과 작게 말하는 사람을 가르지 못한다. 둘이
같은 진폭에 있기 때문이다. 그 오디오가 위스퍼까지 가면 아무도 하지 않은 문장이
나오고("자막 제공 및 ...", "다음 영상에서 만나요!") 회의록에는 실제 팀원의 발언으로
남는다. 그 줄은 다음 단계에서 할일이 되어 사람에게 배정된다. 빠진 줄보다 나쁘다.

임계는 이 프로젝트 오디오에서 재서 정했다. threshold 0.95 에서 골든셋 실제 발화
18건의 말 비율은 최소 75%, 5퍼센타일 83%, 중앙값 97% 였고, 환각을 만든 클립 세
건은 42% / 0% / 33%, 숨소리 한 건은 0% 였다. 42% 와 75% 사이가 비어 있어 0.60 에
자른다. VadOptions 의 두 0 은 바꾸면 안 된다 — 패딩과 최소 길이가 붙으면 비율
자체가 달라져 이 수치가 의미를 잃는다.

무엇을 재지 않았는지는 decision_log/0005-speech-gate-before-stt.md 에 적어 두었다.

모델은 처음 쓸 때 한 번만 올린다. 워커 여럿이 같이 부르므로 적재와 판정을 같은
잠금 안에 둔다 — faster_whisper 의 get_vad_model 은 lru_cache 지만 lru_cache 는
감싼 함수가 도는 동안을 잠그지 않아서, 찬 캐시를 두 스레드가 같이 만나면 모델이
두 번 올라간다.
"""

from __future__ import annotations

import threading

import numpy as np

ENABLED = True
THRESHOLD = 0.95
MIN_SPEECH_RATIO = 0.60


def _load_silero():
    from faster_whisper.vad import get_vad_model

    return get_vad_model()


def _silero_spans(pcm: np.ndarray, sample_rate: int, threshold: float) -> list[dict]:
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    return get_speech_timestamps(
        pcm,
        VadOptions(threshold=threshold, min_speech_duration_ms=0, speech_pad_ms=0),
        sampling_rate=sample_rate,
    )


class SpeechGate:
    """발화 하나를 받아 전사할지 말지 답한다. 스레드 여럿이 같이 불러도 된다.

    enabled 를 끄면 전부 통과시키고 모델도 올리지 않는다. "왜 내 말이 안 나왔냐"는
    물음이 들어왔을 때 이 필터를 빼고 같은 회의를 다시 돌릴 수 있어야 한다.
    """

    def __init__(
        self,
        *,
        enabled: bool | None = None,
        threshold: float = THRESHOLD,
        min_ratio: float = MIN_SPEECH_RATIO,
        load_model=_load_silero,
        speech_spans=_silero_spans,
    ) -> None:
        self.enabled = ENABLED if enabled is None else enabled
        self.threshold = threshold
        self.min_ratio = min_ratio
        self._load_model = load_model
        self._speech_spans = speech_spans

        self._lock = threading.Lock()
        self._model = None
        self._loaded = False

        self.passed = 0
        self.rejected = 0
        self.errors = 0

    @property
    def model_loaded(self) -> bool:
        return self._loaded

    def speech_ratio(self, pcm: np.ndarray, sample_rate: int) -> float:
        if len(pcm) == 0:
            return 0.0
        with self._lock:
            if not self._loaded:
                self._model = self._load_model()
                self._loaded = True
            spans = self._speech_spans(pcm, sample_rate, self.threshold)
        speech = sum(s["end"] - s["start"] for s in spans)
        return speech / len(pcm)

    def accepts(self, pcm: np.ndarray, sample_rate: int, tag: str = "") -> bool:
        if not self.enabled:
            return True

        try:
            ratio = self.speech_ratio(pcm, sample_rate)
        except Exception as e:
            # 여기서 발화를 버리면 필터 하나가 고장 난 값으로 회의록을 지운다.
            # 지어낸 줄보다 사라진 말이 나쁘다. 통과시키고 센다.
            with self._lock:
                self.errors += 1
            print(f"[speech_gate] 판정 실패 ({type(e).__name__}: {e}) — "
                  f"{tag or '발화'} 를 그대로 전사한다", flush=True)
            return True

        if ratio >= self.min_ratio:
            with self._lock:
                self.passed += 1
            return True

        with self._lock:
            self.rejected += 1
        print(f"[speech_gate] 거름: {tag or '발화'} {len(pcm) / sample_rate:.2f}초 · "
              f"말 비율 {ratio:.2f} < {self.min_ratio:.2f}", flush=True)
        return False

    def summary(self) -> str:
        """종료 요약에 넣는 한 줄. 거른 것이 없어도 적는다 — 조용히 지우는 필터를 만들지 않는다."""
        if not self.enabled:
            return "말 필터 꺼짐 (speech_gate.ENABLED)"
        checked = self.passed + self.rejected + self.errors
        return (f"말 필터 · 거름 {self.rejected}건 / 검사 {checked}건 · 오류 {self.errors}건 "
                f"(말 비율 {self.min_ratio:.2f} 미만은 거른다)")
