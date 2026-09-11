"""전사 백엔드 공통 계약.

API 와 로컬 모델을 같은 모양 뒤에 둔다. 벤치마크가 두 백엔드에 같은 입력을
넣을 수 있어야 하고, 부분 전사(로컬)와 최종 전사(API)가 같은 타입을 돌려줘야
게시기가 하나로 처리한다.
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


def confirmed_prefix(prev: list[Word], cur: list[Word]) -> list[Word]:
    """LocalAgreement-2. 연속 두 가설이 일치하는 단어 접두사만 확정한다.

    whisper_streaming(UFAL) 의 방식이다. 확정된 지점에서 오디오 버퍼를 잘라내면
    재전사 길이에 상한이 생기고, 절단점이 항상 단어 끝이라 경계에서 단어가 깨지지
    않는다. 시계 눈금으로 자르면 그게 깨진다.
    """
    out: list[Word] = []
    for a, b in zip(prev, cur):
        if a.text != b.text:
            break
        out.append(b)
    return out
