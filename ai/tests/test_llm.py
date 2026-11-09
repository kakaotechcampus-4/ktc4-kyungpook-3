"""재시도 없는 호출 한 번(generate_json_once). 요약이 시간 상한과 재시도를 스스로 정할 때 쓴다.
스트리밍으로 받고, 시간 상한은 읽기 한 번이 아니라 호출 전체에 건다."""

import threading
import time
from types import SimpleNamespace

import pytest

from llm import FakeLLM, LLMReply, MLAPIClient, NullLLM
from shared.schemas import SummaryInput
from summary.summarize import summarize

# Elice 게이트웨이가 스트리밍이 아닌 답에 받는 가장 큰 출력 상한. 넘으면 400 이고 스트리밍을 하라고 한다(2026-11-10 확인)
GATEWAY_NON_STREAMING_CAP = 2000


class _Stream:
    """SDK 의 Stream 자리. 조각을 하나씩 내고, gate 가 있으면 그 조각 앞에서 풀릴 때까지 막힌다."""

    def __init__(self, chunks, gate_at=None):
        self.chunks, self.gate_at = list(chunks), gate_at
        self.gate = threading.Event()
        self.read = 0
        self.closed = threading.Event()

    def __iter__(self):
        return self

    def __next__(self):
        if self.read == self.gate_at:
            assert self.gate.wait(5)
        if self.read >= len(self.chunks):
            raise StopIteration
        self.read += 1
        return self.chunks[self.read - 1]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        self.closed.set()


class _Sdk:
    """OpenAI SDK 자리. with_options 로 받은 값과 create 인자를 남긴다."""

    def __init__(self, stream=None, error=None):
        self.stream = stream
        self.error = error
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
        return self.stream


def _client(sdk):
    client = MLAPIClient.__new__(MLAPIClient)
    client.name, client.model, client.max_retries, client.calls, client._client = "luna", "gpt-5.6-luna", 2, 0, sdk
    return client


def _piece(content=None, finish=None):
    return SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=content), finish_reason=finish)],
                           usage=None)


def _usage(reasoning=7):
    details = SimpleNamespace(reasoning_tokens=reasoning)
    usage = SimpleNamespace(prompt_tokens=100, completion_tokens=20, completion_tokens_details=details)
    return SimpleNamespace(choices=[], usage=usage)     # include_usage 의 마지막 조각은 choices 가 비어 있다


def _chunks(content, *, finish="stop", usage=True, reasoning=7):
    pieces = [_piece(None)] + [_piece(content[i:i + 3]) for i in range(0, len(content), 3)] + [_piece(None, finish)]
    return pieces + ([_usage(reasoning)] if usage else [])


def test_one_streamed_call_assembles_the_json_and_keeps_finish_and_usage():
    sdk = _Sdk(_Stream(_chunks('{"overview": "회의 정리"}')))
    reply = _client(sdk).generate_json_once("p", timeout_s=300.0, max_completion_tokens=8000, reasoning_effort="low")
    assert sdk.options == [{"timeout": 300.0, "max_retries": 0}]
    assert len(sdk.creates) == 1
    sent = sdk.creates[0]
    assert sent["stream"] is True and sent["stream_options"] == {"include_usage": True}
    assert sent["max_completion_tokens"] == 8000 and sent["reasoning_effort"] == "low"
    assert sent["response_format"] == {"type": "json_object"}
    assert reply.data == {"overview": "회의 정리"} and reply.finish_reason == "stop"
    assert (reply.prompt_tokens, reply.completion_tokens, reply.reasoning_tokens) == (100, 20, 7)
    assert reply.elapsed_s >= 0 and sdk.stream.closed.is_set()


def test_a_length_finish_keeps_the_usage_because_the_call_was_paid_for():
    reply = _client(_Sdk(_Stream(_chunks('{"overview": "잘', finish="length")))).generate_json_once(
        "p", timeout_s=1.0, max_completion_tokens=1)
    assert reply.data is None and reply.finish_reason == "length" and reply.completion_tokens == 20


def test_an_sdk_error_is_a_reply_without_data_and_is_not_retried():
    sdk = _Sdk(error=RuntimeError("503 overloaded"))
    reply = _client(sdk).generate_json_once("p", timeout_s=1.0, max_completion_tokens=1)
    assert reply.data is None and reply.finish_reason is None and reply.prompt_tokens is None
    assert len(sdk.creates) == 1


@pytest.mark.parametrize("chunks", [_chunks('{"a": 1}', usage=False), _chunks('{"a": 1}', reasoning=None)])
def test_missing_usage_fields_are_none(chunks):
    reply = _client(_Sdk(_Stream(chunks))).generate_json_once("p", timeout_s=1.0, max_completion_tokens=1)
    assert reply.data == {"a": 1} and reply.reasoning_tokens is None


def test_the_deadline_bounds_the_whole_call_even_while_a_read_is_blocked():
    stream = _Stream(_chunks('{"overview": "늦은 답"}'), gate_at=3)
    started = time.monotonic()
    reply = _client(_Sdk(stream)).generate_json_once("p", timeout_s=0.2, max_completion_tokens=1)
    assert time.monotonic() - started < 1.5
    assert reply.data is None and reply.finish_reason is None
    stream.gate.set()                                   # 막힌 읽기가 풀리면 더 읽지 않고 닫는다
    assert stream.closed.wait(2) and stream.read == 4


def test_the_deadline_also_bounds_the_wait_before_the_first_chunk():
    release = threading.Event()

    class SilentSdk(_Sdk):                              # 게이트웨이는 추론이 끝나야 응답 머리를 보낸다(2026-11-10 측정)
        def _create(self, **kw):
            assert release.wait(5)
            return super()._create(**kw)

    sdk = SilentSdk(_Stream(_chunks('{"a": 1}')))
    started = time.monotonic()
    reply = _client(sdk).generate_json_once("p", timeout_s=0.2, max_completion_tokens=1)
    assert time.monotonic() - started < 1.5 and reply.data is None
    release.set()
    assert sdk.stream.closed.wait(2) and sdk.stream.read <= 1


def test_generate_json_still_retries_a_transient_error(monkeypatch):
    monkeypatch.setattr("llm.time.sleep", lambda s: None)
    sdk = _Sdk(error=RuntimeError("429 rate_limit"))
    assert _client(sdk).generate_json("p") is None
    assert len(sdk.creates) == 3 and sdk.options == []


def test_null_llm_replies_without_data():
    reply = NullLLM().generate_json_once("p", timeout_s=1.0, max_completion_tokens=1)
    assert reply == LLMReply(None)


def test_fake_llm_hands_out_dicts_and_replies_in_order_and_records_the_prompt():
    length = LLMReply({"overview": "x"}, finish_reason="length")
    fake = FakeLLM([{"a": 1}, length, None])
    first = fake.generate_json_once("one", timeout_s=1.0, max_completion_tokens=1)
    assert first.data == {"a": 1} and first.finish_reason == "stop"
    assert fake.generate_json_once("two", timeout_s=1.0, max_completion_tokens=1) is length
    assert fake.generate_json_once("three", timeout_s=1.0, max_completion_tokens=1) == LLMReply(None)
    assert fake.generate_json_once("four", timeout_s=1.0, max_completion_tokens=1) == LLMReply(None)
    assert fake.prompts == ["one", "two", "three", "four"]


def test_the_summary_request_streams_so_the_gateway_accepts_a_cap_above_its_non_streaming_ceiling():
    sdk = _Sdk(_Stream(_chunks('{"overview": "x", "key_points": []}')))
    summary_input = SummaryInput(extraction_id="e", meeting_id="m", workspace_id="w", title=None,
                                 started_at="2026-11-05T05:00:00Z", lines=[], items=[], topics=[], decisions=[],
                                 identity_epoch=0)
    attempt = summarize(summary_input, _client(sdk), attempt=1)
    assert attempt.draft is not None and sdk.creates[0]["stream"] is True
    assert sdk.creates[0]["max_completion_tokens"] > GATEWAY_NON_STREAMING_CAP
