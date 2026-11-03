"""Jev 판정 API 래퍼. Elice MLAPI 위의 typesafe/jev (POST /v1/decisions).

Terra·Luna 와 달리 문장을 생성하지 않는다. 판단할 상황(state)과 질문(questions)을 주면 질문마다
정해 둔 선택지 중 하나와 선택지별 확률(probabilities)을 돌려준다. 그래서 OpenAI 호환 클라이언트
(llm.py)로 부를 수 없고 따로 둔다.

원칙은 llm.py 와 같다: 키가 없거나 호출·응답이 실패하면 None. 호출자는 None 을 "확인 못 함"으로 처리한다.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Protocol

from shared.config import settings

MODEL = "typesafe/jev-latest"


class JevClient(Protocol):
    name: str

    def decide(self, state: str, questions: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
        """질문 키 → 답(dict: choice, probabilities, confidence). 실패면 None."""
        ...


class NullJev:
    """Jev 를 쓰지 않는 모드. 항상 None."""

    name = "off"

    def decide(self, state: str, questions: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
        return None


class FakeJev:
    """테스트용. 미리 정해 둔 answers 를 순서대로 돌려주고 요청을 기록한다."""

    name = "fake"

    def __init__(self, answers: list[dict[str, Any] | None] | None = None):
        self.answers = list(answers or [])
        self.calls: list[tuple[str, dict[str, dict[str, Any]]]] = []

    def decide(self, state: str, questions: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
        self.calls.append((state, questions))
        return self.answers.pop(0) if self.answers else None


class MLAPIJev:
    def __init__(self, api_key: str, base_url: str, max_retries: int = 2, timeout: float = 60):
        self.name = "jev"
        # .env 의 주소는 다른 MLAPI 와 같이 /v1 로 끝난다
        self._url = base_url.rstrip("/").removesuffix("/v1") + "/v1/decisions"
        self._headers = {"Authorization": f"Bearer {api_key}", "content-type": "application/json",
                         "accept": "application/json"}
        self.max_retries = max_retries
        self.timeout = timeout
        self.calls = 0

    def decide(self, state: str, questions: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
        body = json.dumps({"model": MODEL, "state": state, "questions": questions}).encode()
        delay = 2.0
        for attempt in range(self.max_retries + 1):
            self.calls += 1
            req = urllib.request.Request(self._url, data=body, headers=self._headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    answers = json.loads(resp.read().decode("utf-8")).get("answers")
                return answers if isinstance(answers, dict) else None
            except urllib.error.HTTPError as e:
                if attempt < self.max_retries and e.code in (429, 503):
                    time.sleep(delay)
                    delay *= 2
                    continue
                msg = f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:120]}"
            except Exception as e:  # 네트워크·JSON 오류
                msg = f"{type(e).__name__}: {str(e)[:120]}"
            print(f"[jev] 호출 실패 → 확인 못 함: {msg}", file=sys.stderr)
            return None
        return None


_cached: JevClient | None = None


def get_jev() -> JevClient:
    """키가 없거나 PM_AGENT_LLM=off 면 NullJev."""
    global _cached
    if _cached is None:
        s = settings()
        if (s.llm_mode or "").lower() != "off" and s.jev_api_key:
            _cached = MLAPIJev(s.jev_api_key, s.jev_base_url)
        else:
            _cached = NullJev()
    return _cached
