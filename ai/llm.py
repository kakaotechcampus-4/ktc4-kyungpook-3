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
import threading
import time
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from shared.config import settings

Which = Literal["terra", "luna"]
ALLOWED_MODELS = ("gpt-5.6-terra", "gpt-5.6-luna")
CALL_ATTEMPTS = 2  # 판단·초안이 실패한 호출을 그 자리에서 다시 하는 횟수까지 센 시도 수(#624)
# generate_json 한 번의 전체 시간 상한. 재시도까지 이 안에서 한다. 4분 회의 1단계가 약 20초, 스트리밍은 초당 100토큰 남짓.
# 상한 직전에 받은 조각 뒤로 게이트웨이가 멈추면 READ_IDLE_S 만큼 더 걸린다. 판단·초안은 실패하면 CALL_ATTEMPTS 번까지
# 부르므로 finding 하나의 최악은 (이 값 + READ_IDLE_S) 의 네 배다(0061)
GENERATE_TIMEOUT_S = 300.0
# 조각 사이 대기 상한. 타이머의 close 는 이미 막힌 읽기를 풀지 못해 이 값이 지나야 돌아온다. 실측한 조각 사이 최대
# 공백은 8.6초(출력 3711 토큰), 첫 조각 전 추론 시간은 1단계가 약 20초라 넉넉히 둔다
READ_IDLE_S = 60.0


@dataclass(frozen=True)
class LLMReply:
    """호출 한 번의 결과. 호출이나 파싱이 실패하면 data 가 None 이다. 파싱만 실패했으면 토큰은 남는다."""

    data: dict[str, Any] | None
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    reasoning_tokens: int | None = None
    elapsed_s: float = 0.0


class LLMClient(Protocol):
    name: str
    model: str

    def generate_json(self, prompt: str, *, reasoning_effort: str = "medium") -> dict[str, Any] | None: ...

    def generate_json_once(self, prompt: str, *, timeout_s: float, reasoning_effort: str = "medium") -> LLMReply: ...


class NullLLM:
    """LLM 을 쓰지 않는 모드. 항상 None → 호출자가 규칙 기반으로 처리."""

    name = "off"
    model = "off"

    def generate_json(self, prompt: str, *, reasoning_effort: str = "medium") -> dict[str, Any] | None:
        return None

    def generate_json_once(self, prompt: str, *, timeout_s: float, reasoning_effort: str = "medium") -> LLMReply:
        return LLMReply(None)


class FakeLLM:
    """테스트용. 미리 정해둔 응답을 순서대로 돌려주고 프롬프트를 기록."""

    name = "fake"
    model = "fake"

    def __init__(self, responses: list[dict[str, Any] | LLMReply | None] | None = None):
        self.responses = list(responses or [])
        self.prompts: list[str] = []

    def generate_json(self, prompt: str, *, reasoning_effort: str = "medium") -> dict[str, Any] | None:
        self.prompts.append(prompt)
        if not self.responses:
            return None
        return self.responses.pop(0)

    def generate_json_once(self, prompt: str, *, timeout_s: float, reasoning_effort: str = "medium") -> LLMReply:
        self.prompts.append(prompt)
        reply = self.responses.pop(0) if self.responses else None
        if reply is None:
            return LLMReply(None)
        return reply if isinstance(reply, LLMReply) else LLMReply(reply, finish_reason="stop")


def _transient(e: Exception) -> bool:
    """다시 해 볼 만한 실패. SDK 재시도를 끄므로 SDK 가 다시 하던 것(연결 오류, 408·409·429·5xx)을 여기서 본다.

    스트리밍이면 SDK 는 헤더를 받을 때까지만 다시 하므로 본문을 읽다 끊긴 연결도 여기서 다시 한다.
    """
    names = {c.__name__ for c in type(e).__mro__}
    if names & {"APIConnectionError", "APITimeoutError"}:
        return True
    status = getattr(e, "status_code", None)
    if isinstance(status, int):
        return status in (408, 409, 429) or status >= 500
    msg = str(e)
    return "429" in msg or "rate_limit" in msg.lower() or "503" in msg or "overloaded" in msg.lower()


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

    def _stream(self, prompt: str, *, reasoning_effort: str, timeout_s: float) -> LLMReply:
        """스트리밍으로 받은 응답 하나. 게이트웨이는 스트리밍이 아닌 응답을 2000 토큰(추론 포함)에서 자른다(0061).

        SDK 의 timeout 은 조각 사이 대기에만 걸린다. 게이트웨이가 keepalive 만 보내면 끝나지 않으므로, 시작부터
        timeout_s 가 지나면 타이머가 스트림을 닫고 TimeoutError 를 낸다. 이미 막힌 읽기는 close 로 풀리지 않아
        조각 사이 대기(READ_IDLE_S)가 끝나야 돌아온다. 그래서 상한 뒤 최대 READ_IDLE_S 가 더 걸린다. SDK 재시도는 끈다.
        """
        # openai 가 내보내는 Timeout 을 쓴다. 그 밑의 HTTP 패키지는 버전마다 다르다(3.48 은 httpx 가 아니라 httpx2)
        from openai import Timeout

        started = time.monotonic()
        deadline = started + timeout_s
        timeout = Timeout(timeout_s, read=min(timeout_s, READ_IDLE_S))
        stream = self._client.with_options(timeout=timeout, max_retries=0).chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            reasoning_effort=reasoning_effort,
            response_format={"type": "json_object"},
            stream=True,
            stream_options={"include_usage": True},
        )
        timer = threading.Timer(max(0.0, deadline - time.monotonic()), stream.close)
        timer.daemon = True
        timer.start()
        parts: list[str] = []
        finish, usage = None, None
        try:
            with stream:
                for chunk in stream:
                    if time.monotonic() > deadline:
                        break
                    if chunk.choices:
                        choice = chunk.choices[0]
                        if choice.delta is not None and choice.delta.content:
                            parts.append(choice.delta.content)
                        finish = choice.finish_reason or finish
                    if chunk.usage is not None:
                        usage = chunk.usage
        except Exception:
            if time.monotonic() <= deadline:
                raise
        finally:
            timer.cancel()
        if time.monotonic() > deadline:  # 타이머가 닫아 조용히 끝났거나, 닫힌 뒤 읽다 실패했다
            raise TimeoutError(f"{timeout_s:.0f}초 안에 응답이 끝나지 않았다")
        if finish != "stop":
            print(f"[llm] {self.model} 응답이 끝까지 오지 않았다: finish_reason={finish} "
                  f"출력 {getattr(usage, 'completion_tokens', None)}", file=sys.stderr)
        return LLMReply(
            _extract_json("".join(parts)),
            finish_reason=finish,
            prompt_tokens=getattr(usage, "prompt_tokens", None),
            completion_tokens=getattr(usage, "completion_tokens", None),
            reasoning_tokens=getattr(getattr(usage, "completion_tokens_details", None), "reasoning_tokens", None),
            elapsed_s=time.monotonic() - started,
        )

    def generate_json(self, prompt: str, *, reasoning_effort: str = "medium") -> dict[str, Any] | None:
        """reasoning_effort: none | low | medium | high. 이 모델은 temperature 커스텀을 지원하지 않는다
        (기본값 1 고정) — 결정성/속도는 reasoning_effort 로 조절한다. 잘린 응답(finish_reason=length)은 None.
        재시도까지 GENERATE_TIMEOUT_S 안에서 한다."""
        deadline = time.monotonic() + GENERATE_TIMEOUT_S
        delay = 2.0
        for attempt in range(self.max_retries + 1):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                self.calls += 1
                reply = self._stream(prompt, reasoning_effort=reasoning_effort, timeout_s=remaining)
                return None if reply.finish_reason == "length" else reply.data
            except Exception as e:  # 429(속도 제한)·끊긴 연결 등 일시적 오류는 잠깐 쉬고 재시도
                if attempt < self.max_retries and _transient(e):
                    time.sleep(delay)
                    delay *= 2
                    continue
                print(f"[llm] {self.model} 호출 실패 → 규칙 기반 폴백: {str(e)[:120]}", file=sys.stderr)
                return None
        print(f"[llm] {self.model} {GENERATE_TIMEOUT_S:.0f}초 안에 끝내지 못해 그만둔다", file=sys.stderr)
        return None

    def generate_json_once(self, prompt: str, *, timeout_s: float, reasoning_effort: str = "medium") -> LLMReply:
        """재시도 없는 호출 한 번. 예외를 내지 않는다. 시간 상한과 재시도를 호출자가 정할 때 쓴다."""
        started = time.monotonic()
        self.calls += 1
        try:
            return self._stream(prompt, reasoning_effort=reasoning_effort, timeout_s=timeout_s)
        except Exception as e:  # noqa: BLE001 - 어떤 실패든 호출자에게는 data 가 없는 답이다
            print(f"[llm] {self.model} 호출 실패: {str(e)[:120]}", file=sys.stderr)
            return LLMReply(None, elapsed_s=time.monotonic() - started)


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
