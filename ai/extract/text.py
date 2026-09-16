"""추출 전 텍스트 처리 — 문장 분리와 이름 패턴.

LLM 이 판단할 단위를 자르고(split_sentences), LLM 이 뽑은 담당자를 원문으로 교차검증하는
데(find_explicit_name) 쓴다. 둘 다 "같은 입력이면 같은 결과"가 보장돼야 하는 일이라
LLM 이 아니라 코드가 맡는다.
"""

from __future__ import annotations

import re

# 문장 종결(.!?) 단위로 스플릿. 구분자 자체는 버린다.
_SENTENCE_RE = re.compile(r"[^.!?]+[.!?]?")

# "OO님" 형태 — 조사 유무와 무관하게 이름만 뽑는다
_NAME_RE = re.compile(r"([가-힣]{2,4})님")


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_RE.findall(text) if s.strip()]


def find_explicit_name(sentence: str) -> str | None:
    """문장에 "OO님" 형태로 이름이 **원문 그대로** 박혀 있으면 그 이름을 돌려준다.

    LLM 이 thirdname 이라고 분류했는데 여기서 같은 이름을 못 찾으면 근거가 약한 것으로 보고
    상태를 inferred 로 낮춘다(extract/llm.py 의 혼합 검증).
    """
    m = _NAME_RE.search(sentence)
    return m.group(1) if m else None
