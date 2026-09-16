"""LLM 호출 래퍼. Elice MLAPI(OpenAI 호환) 위의 GPT-5.6 Terra/Luna만 사용합니다.

원칙
  - 모든 호출은 JSON 응답을 요구하고 dict 로 반환합니다. 실패(키 없음/네트워크/파싱 실패)는 None.
  - 호출자는 None 을 받으면 규칙 기반 폴백으로 동작해야 합니다 → API 키 없이도 전 단계가 실행/테스트 가능해야 하므로.
  - Terra(판단)와 Luna(초안)는 base_url·api_key 가 서로 다른 별개의 엔드포인트다 — 모델 이름만
    바꾸는 파라미터가 아니라 get_llm(which) 로 아예 다른 클라이언트를 가져온다.
"""

from __future__ import annotations

import json
import re
import sys
import time
from typing import Any, Literal, Protocol

from shared.config import settings

Which = Literal["terra", "luna"]
ALLOWED_MODELS = ("gpt-5.6-terra", "gpt-5.6-luna")


class LLMClient(Protocol):
    name: str

    def generate_json(self, prompt: str, *, reasoning_effort: str = "medium") -> dict[str, Any] | None: ...


class NullLLM:
    """LLM 을 쓰지 않는 모드. 항상 None → 호출자가 규칙 기반으로 처리."""

    name = "off"

    def generate_json(self, prompt: str, *, reasoning_effort: str = "medium") -> dict[str, Any] | None:
        return None


class FakeLLM:
    """테스트용. 미리 정해둔 응답을 순서대로 돌려주고 프롬프트를 기록."""

    name = "fake"

    def __init__(self, responses: list[dict[str, Any] | None] | None = None):
        self.responses = list(responses or [])
        self.prompts: list[str] = []

    def generate_json(self, prompt: str, *, reasoning_effort: str = "medium") -> dict[str, Any] | None:
        self.prompts.append(prompt)
        if not self.responses:
            return None
        return self.responses.pop(0)


def _extract_json(text: str) -> dict[str, Any] | None:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, flags=re.S)
        if not m:
            return None
        try:
            obj = json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
    return obj if isinstance(obj, dict) else {"items": obj}


class MLAPIClient:
    """Elice MLAPI(OpenAI 호환 SDK) 클라이언트. Terra/Luna 는 base_url·api_key·model 이 각자 다르다."""

    def __init__(self, which: Which, api_key: str, base_url: str, max_retries: int = 2):
        model = f"gpt-5.6-{which}"
        if model not in ALLOWED_MODELS:
            raise ValueError(f"허용되지 않은 모델: {model}. 사용 가능: {ALLOWED_MODELS}")
        from openai import OpenAI  # 지연 import: 설치 안 돼 있어도 나머지 모듈은 동작

        self.name = which
        self.model = model
        self._client = OpenAI(base_url=base_url, api_key=api_key)
        self.max_retries = max_retries
        self.calls = 0

    def generate_json(self, prompt: str, *, reasoning_effort: str = "medium") -> dict[str, Any] | None:
        """reasoning_effort: none | low | medium | high. 이 모델은 temperature 커스텀을 지원하지 않는다
        (기본값 1 고정) — 결정성/속도는 reasoning_effort 로 조절한다."""
        delay = 2.0
        for attempt in range(self.max_retries + 1):
            try:
                self.calls += 1
                resp = self._client.chat.completions.create(
                    model=self.model,
                    messages=[{"role": "user", "content": prompt}],
                    reasoning_effort=reasoning_effort,
                    response_format={"type": "json_object"},
                )
                return _extract_json(resp.choices[0].message.content or "")
            except Exception as e:  # 429(속도 제한) 등 일시적 오류는 잠깐 쉬고 재시도
                msg = str(e)
                transient = "429" in msg or "rate_limit" in msg.lower() or "503" in msg or "overloaded" in msg.lower()
                if attempt < self.max_retries and transient:
                    time.sleep(delay)
                    delay *= 2
                    continue
                print(f"[llm] {self.model} 호출 실패 → 규칙 기반 폴백: {msg[:120]}", file=sys.stderr)
                return None
        return None


_cached: dict[str, LLMClient] = {}


def get_llm(which: Which, *, force: str | None = None) -> LLMClient:
    """설정에 따라 Terra 또는 Luna LLM 클라이언트를 돌려줍니다.

    which: "terra" | "luna" — 어떤 모듈이 호출하는지(엔드포인트가 다름).
    force: "off" | None(설정값 따름). 해당 티어의 API 키가 없으면 항상 NullLLM.
    """
    if force is None and which in _cached:
        return _cached[which]
    s = settings()
    mode = (force or s.llm_mode or "").lower()
    api_key = s.terra_api_key if which == "terra" else s.luna_api_key
    base_url = s.terra_base_url if which == "terra" else s.luna_base_url
    client: LLMClient
    if mode != "off" and api_key:
        try:
            client = MLAPIClient(which, api_key, base_url)
        except ImportError:
            print("[llm] openai 미설치 → 규칙 기반 폴백 (pip install openai)", file=sys.stderr)
            client = NullLLM()
    else:
        client = NullLLM()
    if force is None:
        _cached[which] = client
    return client
