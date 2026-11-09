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
    """cause 는 실패 원인이다. service(연결·타임아웃·5xx·이상한 응답), auth(401·402·403), request(그 밖의 4xx,
    그 음성의 문제), config(키·주소·인증서 설정). GPU 전환(stt/failover.py)은 service 와 auth 만 장애 표본으로 센다."""

    def __init__(self, message: str = "", cause: str = "service") -> None:
        super().__init__(message)
        self.cause = cause


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


def member_forms(name: str, aliases=()) -> list[str]:
    """PM 이 온보딩에서 정한 이름(BE) 하나를 프롬프트에 넣을 꼴들로 바꾼다. 부르는 이름에 님, 부르는 이름, 실명,
    한글 별칭 순이다.

    실명이라 두 글자 이름도 첫 글자를 성으로 본다(디스코드 표시 이름은 성인지 알 수 없어 name_forms 가 떼지 않는다).
    네 글자는 앞 두 글자를 성으로 본다. 한글이 아니면 넣지 않는다. 부르는 이름을 실명보다 먼저 두는 꼴이 실명을
    먼저 두는 꼴보다 6인 m01 CER 이 1.06pt 낮았다(결정 기록 0024).
    """
    n = (name or "").strip()
    if not re.fullmatch(r"[가-힣]{2,}", n):
        return []
    given = n[2:] if len(n) == 4 else n[1:]
    forms = [f"{given}님", given, n]
    for a in aliases or ():
        a = (a or "").strip()
        if re.fullmatch(r"[가-힣]+", a) and a not in forms:
            forms.append(a)
    return forms


def _people_prompt(people: list[list[str]]) -> str | None:
    """사람마다의 꼴 목록을 프롬프트 글 하나로. 겹치는 꼴은 한 번만 넣고, 넣을 꼴이 있는 사람만 HINT_PEOPLE_MAX 명까지 센다."""
    forms: list[str] = []
    count = 0
    for person in people:
        new = [f for f in person if f not in forms]
        if not new:
            continue
        if count == HINT_PEOPLE_MAX:
            break
        forms += new
        count += 1
    return ", ".join(forms) + "." if forms else None


def hint_prompt(display_names: list[str]) -> str | None:
    """표시 이름 목록으로 이름 프롬프트 글을 만든다. "재환님, 재환, 유재환, 김환님, 김환." 처럼 사람마다 묶는다.

    겹치는 꼴은 한 번만 넣고, 넣을 꼴이 있는 사람만 HINT_PEOPLE_MAX 명까지 센다. 넣을 것이 없으면 None 이다.
    """
    return _people_prompt([name_forms(name) for name in display_names])


def member_prompt(members: list[dict]) -> str | None:
    """BE 팀원 목록([{"name", "aliases"}])으로 이름 프롬프트 글을 만든다. "동우님, 동우, 김동우, 환님, 환, 김환." 처럼."""
    return _people_prompt([member_forms(m.get("name") or "", m.get("aliases") or ()) for m in members])


PROMPT_MIN_S = 1.5   # 운영에서 이보다 짧은 묶음은 프롬프트 없이 보낸다. 그 밑에서 프롬프트의 이름을 되풀이하는 환각이 났다(0030)


class Prompted:
    """회의마다 다른 프롬프트를 백엔드 호출에 싣는 감싸개. 백엔드 자체는 프로세스에서 같이 쓰므로 바꾸지 않는다.

    transcribe 말고 다른 속성(name, reclip_unmapped 등)은 안의 백엔드 것을 그대로 보인다.
    """

    def __init__(self, inner, prompt: str, *, min_s: float = 0.0) -> None:
        self.inner = inner
        self.prompt = prompt
        self.min_s = min_s     # 이보다 짧은 묶음은 프롬프트 없이 보낸다. 운영은 PROMPT_MIN_S

    takes_context = True   # batch.run 이 짧은 묶음을 나중에 앞 줄(context)과 함께 보낸다(0031)

    def transcribe(self, samples: np.ndarray, sample_rate: int, context: str | None = None) -> SttResult:
        """min_s 보다 짧은 묶음은 이름 대신 앞 줄을 프롬프트로 싣고, 앞 줄이 없으면 프롬프트 없이 보낸다."""
        prompt = self.prompt if len(samples) >= sample_rate * self.min_s else context
        return self.inner.transcribe(samples, sample_rate, prompt=prompt)

    def __getattr__(self, name: str):
        return getattr(self.inner, name)
