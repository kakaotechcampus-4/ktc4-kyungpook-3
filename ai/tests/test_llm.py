"""재시도 없는 호출 한 번(generate_json_once). 요약이 시간 상한과 재시도를 스스로 정할 때 쓴다.

Elice 게이트웨이는 스트리밍이 아닌 응답을 2000 토큰(추론 포함)에서 자른다. 그래서 모든 호출을 스트리밍으로 받는다.
"""

import threading
import time
from types import SimpleNamespace

import pytest

import llm
from llm import FakeLLM, LLMReply, MLAPIClient, NullLLM


class APIConnectionError(Exception):
    """openai.APIConnectionError 자리. 스트림을 읽다 연결이 끊기면 SDK 가 이 이름으로 낸다."""


class _Stream:
    """openai Stream 자리. 조각을 차례로 내고, close 와 with 를 받는다. 조각 자리에 예외를 두면 그때 낸다."""

    def __init__(self, chunks):
        self.chunks = chunks
        self.closed = False

    def __iter__(self):
        for chunk in self.chunks:
            if isinstance(chunk, Exception):
                raise chunk
            yield chunk

    def close(self):
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class _Stalled(_Stream):
    """조각 하나를 내고 닫힐 때까지 멈춘다. 게이트웨이가 멈추거나 keepalive 만 보내는 경우다."""

    def __init__(self, chunks):
        super().__init__(chunks)
        self._closed = threading.Event()

    def __iter__(self):
        yield self.chunks[0]
        self._closed.wait(10)

    def close(self):
        super().close()
        self._closed.set()


class _Sdk:
    """OpenAI SDK 자리. with_options 로 받은 값과 create 인자를 남긴다. response 가 list 의 list 면 호출마다 차례로 준다."""

    def __init__(self, response=None, error=None, streams=None):
        self.response = response
        self.error = error
        self.streams = list(streams or [])
        self.options = []
        self.creates = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def with_options(self, **kw):
        self.options.append(kw)
        return self

    def _create(self, **kw):
        self.creates.append(kw)
        if self.error is not None:
            raise self.error
        return self.streams.pop(0) if self.streams else _Stream(self.response)


def _client(sdk):
    client = MLAPIClient.__new__(MLAPIClient)
    client.name, client.model, client.max_retries, client.calls, client._client = "luna", "gpt-5.6-luna", 2, 0, sdk
    return client


def _response(content, *, finish="stop", usage=True, reasoning=7):
    """스트리밍 응답 조각들. 본문을 두 조각으로 나누고, 마지막 조각은 choices 없이 usage 만 싣는다."""
    u = None
    if usage:
        details = SimpleNamespace(reasoning_tokens=reasoning)
        u = SimpleNamespace(prompt_tokens=100, completion_tokens=20, completion_tokens_details=details)
    half = len(content) // 2
    chunks = [SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=part), finish_reason=None)],
                              usage=None) for part in (content[:half], content[half:])]
    chunks.append(SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=None), finish_reason=finish)],
                                  usage=None))
    chunks.append(SimpleNamespace(choices=[], usage=u))
    return chunks


def test_one_call_with_the_given_timeout_and_no_sdk_retries():
    sdk = _Sdk(_response('{"overview": "x"}'))
    reply = _client(sdk).generate_json_once("p", timeout_s=300.0, reasoning_effort="low")
    assert [(o["timeout"].read, o["max_retries"]) for o in sdk.options] == [(llm.READ_IDLE_S, 0)]
    assert len(sdk.creates) == 1 and sdk.creates[0]["reasoning_effort"] == "low"
    assert sdk.creates[0]["response_format"] == {"type": "json_object"}
    assert sdk.creates[0]["stream"] is True and sdk.creates[0]["stream_options"] == {"include_usage": True}
    assert reply.data == {"overview": "x"} and reply.finish_reason == "stop"
    assert (reply.prompt_tokens, reply.completion_tokens, reply.reasoning_tokens) == (100, 20, 7)
    assert reply.elapsed_s >= 0


def test_an_sdk_error_is_a_reply_without_data_and_is_not_retried():
    sdk = _Sdk(error=RuntimeError("503 overloaded"))
    reply = _client(sdk).generate_json_once("p", timeout_s=1.0)
    assert reply.data is None and reply.finish_reason is None and reply.prompt_tokens is None
    assert len(sdk.creates) == 1


def test_broken_json_keeps_the_usage_because_the_call_was_paid_for():
    reply = _client(_Sdk(_response("not json", finish="length"))).generate_json_once("p", timeout_s=1.0)
    assert reply.data is None and reply.finish_reason == "length" and reply.prompt_tokens == 100


@pytest.mark.parametrize("response", [_response('{"a": 1}', usage=False), _response('{"a": 1}', reasoning=None)])
def test_missing_usage_fields_are_none(response):
    reply = _client(_Sdk(response)).generate_json_once("p", timeout_s=1.0)
    assert reply.data == {"a": 1} and reply.reasoning_tokens is None


def test_generate_json_still_retries_a_transient_error(monkeypatch):
    monkeypatch.setattr("llm.time.sleep", lambda s: None)
    sdk = _Sdk(error=RuntimeError("429 rate_limit"))
    assert _client(sdk).generate_json("p") is None
    assert len(sdk.creates) == 3


def test_generate_json_streams_so_the_gateway_does_not_cut_at_2000():
    sdk = _Sdk(_response('{"findings": []}'))
    assert _client(sdk).generate_json("p", reasoning_effort="low") == {"findings": []}
    assert sdk.creates[0]["stream"] is True and sdk.creates[0]["reasoning_effort"] == "low"


def test_generate_json_drops_a_cut_reply_even_if_it_parses(capsys):
    # 잘린 JSON 이 우연히 닫혀 파싱돼도 뒤쪽 항목이 빠져 있다
    assert _client(_Sdk(_response('{"findings": []}', finish="length"))).generate_json("p") is None
    assert "length" in capsys.readouterr().err


def test_a_stream_past_the_deadline_is_a_reply_without_data(monkeypatch):
    sdk = _Sdk(_response('{"a": 1}'))
    # 시작 시각을 잰 뒤에는 5초가 지난 것으로 보인다. SDK 의 timeout 은 조각 사이에만 걸려 이걸 못 잡는다
    ticks = iter([0.0, 0.0])
    monkeypatch.setattr("llm.time.monotonic", lambda: next(ticks, 5.0))
    reply = _client(sdk).generate_json_once("p", timeout_s=1.0)
    assert reply.data is None and len(sdk.creates) == 1


def test_null_llm_replies_without_data():
    reply = NullLLM().generate_json_once("p", timeout_s=1.0)
    assert reply == LLMReply(None)


def test_fake_llm_hands_out_dicts_and_replies_in_order_and_records_the_prompt():
    length = LLMReply({"overview": "x"}, finish_reason="length")
    fake = FakeLLM([{"a": 1}, length, None])
    first = fake.generate_json_once("one", timeout_s=1.0)
    assert first.data == {"a": 1} and first.finish_reason == "stop"
    assert fake.generate_json_once("two", timeout_s=1.0) is length
    assert fake.generate_json_once("three", timeout_s=1.0) == LLMReply(None)
    assert fake.generate_json_once("four", timeout_s=1.0) == LLMReply(None)
    assert fake.prompts == ["one", "two", "three", "four"]


def test_the_timer_closes_a_stalled_stream_at_the_deadline():
    # 조각이 더 오지 않으면 조각마다 보는 상한은 걸리지 않는다. 타이머가 상한에 스트림을 닫는다(#624 리뷰).
    # 실제 SDK 는 이미 막힌 읽기를 close 로 풀지 못해 조각 사이 대기(READ_IDLE_S)가 끝나야 돌아온다. 그 상한은 아래 테스트
    stalled = _Stalled(_response('{"a": 1}'))
    started = time.monotonic()
    reply = _client(_Sdk(streams=[stalled])).generate_json_once("p", timeout_s=0.3)
    assert reply.data is None and stalled.closed
    assert time.monotonic() - started < 3


def test_a_connection_dropped_mid_stream_is_retried(monkeypatch):
    # 스트리밍이면 SDK 는 헤더까지만 다시 한다. 본문을 읽다 끊기면 여기서 다시 한다
    monkeypatch.setattr("llm.time.sleep", lambda s: None)
    dropped = _Stream([APIConnectionError("Connection error.")])
    sdk = _Sdk(streams=[dropped, _Stream(_response('{"a": 1}'))])
    assert _client(sdk).generate_json("p") == {"a": 1}
    assert len(sdk.creates) == 2 and all(o["max_retries"] == 0 for o in sdk.options)


def test_generate_json_retries_share_one_deadline(monkeypatch):
    # 시도마다 상한을 새로 잡으면 재시도가 겹쳐 상한의 몇 배가 된다. 남은 시간이 없으면 더 하지 않는다
    monkeypatch.setattr("llm.time.sleep", lambda s: None)
    monkeypatch.setattr("llm.GENERATE_TIMEOUT_S", 300.0)
    ticks = iter([0.0, 0.0, 0.0, 400.0])
    monkeypatch.setattr("llm.time.monotonic", lambda: next(ticks, 400.0))
    sdk = _Sdk(error=RuntimeError("429 rate_limit"))
    assert _client(sdk).generate_json("p") is None
    assert len(sdk.creates) == 1


def test_the_wait_between_chunks_is_capped_apart_from_the_whole_deadline():
    # 막힌 읽기는 조각 사이 대기가 끝나야 풀린다. 그 대기를 전체 상한(300초)과 같게 두면 상한의 두 배가 걸린다
    sdk = _Sdk(_response('{"a": 1}'))
    _client(sdk).generate_json_once("p", timeout_s=300.0)
    (options,) = sdk.options
    assert options["max_retries"] == 0
    assert options["timeout"].read == llm.READ_IDLE_S < 300.0


class _StatusError(Exception):
    def __init__(self, status_code):
        super().__init__(f"Error code: {status_code}")
        self.status_code = status_code


@pytest.mark.parametrize("status", [500, 502, 504, 408, 429])
def test_a_retryable_http_status_is_retried_like_the_sdk_did(status, monkeypatch):
    # SDK 재시도를 껐으니 SDK 가 다시 하던 응답(408·409·429·5xx)은 여기서 다시 한다. 문구가 아니라 상태 코드로 본다
    monkeypatch.setattr("llm.time.sleep", lambda s: None)
    sdk = _Sdk(error=_StatusError(status))
    assert _client(sdk).generate_json("p") is None
    assert len(sdk.creates) == 3


def test_a_client_error_is_not_retried(monkeypatch):
    sdk = _Sdk(error=_StatusError(400))
    assert _client(sdk).generate_json("p") is None
    assert len(sdk.creates) == 1
