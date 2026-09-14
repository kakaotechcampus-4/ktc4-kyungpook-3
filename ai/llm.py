"""LLM 호출 래퍼. Google Gemini 무료 티어(gemini-2.5-flash / flash-lite)만 사용합니다.

원칙
  - 모든 호출은 JSON 응답을 요구하고 dict 로 반환합니다. 실패(키 없음/네트워크/파싱 실패)는 None.
  - 호출자는 None 을 받으면 규칙 기반 폴백으로 동작해야 합니다 → API 키 없이도 전 단계가 실행/테스트 가능.
  - 유료 모델/유료 API 는 여기서 원천 차단합니다 (ALLOWED_MODELS).
"""

from __future__ import annotations

import json
import re
import sys
import time
from typing import Any, Protocol

from shared.config import settings

ALLOWED_MODELS = ("gemini-2.5-flash-lite", "gemini-2.5-flash")


class LLMClient(Protocol):
    name: str

    def generate_json(self, prompt: str, *, temperature: float = 0.0) -> dict[str, Any] | None: ...


class NullLLM:
    """LLM 을 쓰지 않는 모드. 항상 None → 호출자가 규칙 기반으로 처리."""

    name = "off"

    def generate_json(self, prompt: str, *, temperature: float = 0.0) -> dict[str, Any] | None:
        return None


class FakeLLM:
    """테스트용. 미리 정해둔 응답을 순서대로 돌려주고 프롬프트를 기록."""

    name = "fake"

    def __init__(self, responses: list[dict[str, Any] | None] | None = None):
        self.responses = list(responses or [])
        self.prompts: list[str] = []

    def generate_json(self, prompt: str, *, temperature: float = 0.0) -> dict[str, Any] | None:
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


class GeminiClient:
    name = "gemini"

    def __init__(self, api_key: str, model: str = "gemini-2.5-flash-lite", max_retries: int = 2):
        if model not in ALLOWED_MODELS:
            raise ValueError(f"허용되지 않은 모델: {model}. 무료 티어 모델만 사용: {ALLOWED_MODELS}")
        from google import genai  # 지연 import: 설치 안 돼 있어도 나머지 모듈은 동작

        self._genai = genai
        self._client = genai.Client(api_key=api_key)
        self.model = model
        self.max_retries = max_retries
        self.calls = 0

    def generate_json(self, prompt: str, *, temperature: float = 0.0) -> dict[str, Any] | None:
        from google.genai import types

        cfg = types.GenerateContentConfig(response_mime_type="application/json", temperature=temperature)
        delay = 2.0
        for attempt in range(self.max_retries + 1):
            try:
                self.calls += 1
                resp = self._client.models.generate_content(model=self.model, contents=prompt, config=cfg)
                return _extract_json(resp.text or "")
            except Exception as e:  # 429(무료 티어 분당 제한) 포함 — 잠깐 쉬고 재시도
                msg = str(e)
                transient = "429" in msg or "RESOURCE_EXHAUSTED" in msg or "503" in msg or "UNAVAILABLE" in msg
                if attempt < self.max_retries and transient:
                    time.sleep(delay)
                    delay *= 2
                    continue
                print(f"[llm] {self.model} 호출 실패 → 규칙 기반 폴백: {msg[:120]}", file=sys.stderr)
                return None
        return None


_cached: LLMClient | None = None


def get_llm(force: str | None = None) -> LLMClient:
    """설정에 따라 LLM 클라이언트를 돌려줍니다.

    force: "off" | "gemini" | None(설정값 따름). GEMINI_API_KEY 가 없으면 항상 NullLLM.
    """
    global _cached
    if force is None and _cached is not None:
        return _cached
    s = settings()
    mode = (force or s.llm_mode or ("gemini" if s.gemini_api_key else "off")).lower()
    client: LLMClient
    if mode == "gemini" and s.gemini_api_key:
        try:
            client = GeminiClient(s.gemini_api_key, s.gemini_model)
        except ImportError:
            print("[llm] google-genai 미설치 → 규칙 기반 폴백 (pip install google-genai)", file=sys.stderr)
            client = NullLLM()
    else:
        client = NullLLM()
    if force is None:
        _cached = client
    return client
