"""전사 백엔드 공통 계약.

API 와 로컬 모델을 같은 모양 뒤에 둔다. 벤치마크가 두 백엔드에 같은 입력을
넣을 수 있어야 하고, API 장애 때 로컬로 갈아 끼워도 게시기가 그대로 돌아야
한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

import numpy as np


class SttError(RuntimeError):
    pass


@dataclass(frozen=True)
class Word:
    text: str
    start_s: float
    end_s: float


@dataclass
class SttResult:
    text: str
    words: list[Word] = field(default_factory=list)

    @classmethod
    def from_words(cls, words: list[Word]) -> "SttResult":
        return cls(text=" ".join(w.text for w in words).strip(), words=list(words))


class SttBackend(Protocol):
    name: str

    def transcribe(self, samples: np.ndarray, sample_rate: int) -> SttResult: ...
