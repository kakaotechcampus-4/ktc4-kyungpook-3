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


NAME_PROMPT_MAX = 20   # 프롬프트에 넣는 이름 수 상한. 위스퍼는 프롬프트와 출력을 합쳐 한 호출에 448토큰까지 다룬다


def name_prompt(names: list[str]) -> str | None:
    """팀 멤버의 부르는 이름으로 프롬프트 글을 만든다. "동우님, 재환님." 처럼 회의에서 부르는 꼴로 적는다(#195).

    빈 이름과 겹치는 이름은 뺀다. 이름이 없으면 None 이라 프롬프트를 보내지 않는다.
    """
    seen: list[str] = []
    for n in names:
        n = (n or "").strip()
        if n and n not in seen:
            seen.append(n)
    seen = seen[:NAME_PROMPT_MAX]
    return ", ".join(f"{n}님" for n in seen) + "." if seen else None


class Prompted:
    """회의마다 다른 프롬프트를 백엔드 호출에 싣는 감싸개. 백엔드 자체는 프로세스에서 같이 쓰므로 바꾸지 않는다.

    transcribe 말고 다른 속성(name, reclip_unmapped 등)은 안의 백엔드 것을 그대로 보인다.
    """

    def __init__(self, inner, prompt: str) -> None:
        self.inner = inner
        self.prompt = prompt

    def transcribe(self, samples: np.ndarray, sample_rate: int) -> SttResult:
        return self.inner.transcribe(samples, sample_rate, prompt=self.prompt)

    def __getattr__(self, name: str):
        return getattr(self.inner, name)
