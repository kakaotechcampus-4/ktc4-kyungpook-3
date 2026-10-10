"""전사 백엔드 공통 계약.

API 와 로컬 모델을 같은 모양 뒤에 둔다. 벤치마크가 두 백엔드에 같은 입력을
넣을 수 있어야 하고, API 장애 때 로컬로 갈아 끼워도 게시기가 그대로 돌아야
한다.
"""

from __future__ import annotations

import re
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


HINT_PEOPLE_MAX = 15   # 세 꼴로 넣으면 15명에 약 170토큰. 위스퍼는 프롬프트 뒤쪽 224토큰만 본다(20명이면 231토큰)


def name_forms(display_name: str) -> list[str]:
    """표시 이름 하나를 프롬프트에 넣을 꼴들로 바꾼다. 부르는 이름에 님을 붙인 꼴, 뗀 꼴, 성 포함 이름 순이다.

    한글 세 글자는 첫 글자를 성으로 보고 뗀다. 두 글자는 성인지 이름인지 알 수 없어 그대로 두고, 한글이
    아니면(아이디 꼴) 넣지 않는다. 성 포함 이름만 넣으면 9/29 이름 자리 4개 중 1개, 부르는 이름을 넣으면
    3개를 고쳤고, 세 꼴을 다 넣어도 나빠지지 않았다(결정 기록 0020).
    """
    n = (display_name or "").strip()
    if not re.fullmatch(r"[가-힣]+", n):
        return []
    given = n[1:] if len(n) == 3 else n
    return [f"{given}님", given] + ([n] if given != n else [])


def hint_prompt(display_names: list[str]) -> str | None:
    """표시 이름 목록으로 이름 프롬프트 글을 만든다. "재환님, 재환, 유재환, 김환님, 김환." 처럼 사람마다 묶는다.

    겹치는 꼴은 한 번만 넣고, 넣을 꼴이 있는 사람만 HINT_PEOPLE_MAX 명까지 센다. 넣을 것이 없으면 None 이다.
    """
    forms: list[str] = []
    people = 0
    for name in display_names:
        new = [f for f in name_forms(name) if f not in forms]
        if not new:
            continue
        if people == HINT_PEOPLE_MAX:
            break
        forms += new
        people += 1
    return ", ".join(forms) + "." if forms else None


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
