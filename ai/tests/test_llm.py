"""재시도 없는 호출 한 번(generate_json_once). 요약이 시간 상한과 재시도를 스스로 정할 때 쓴다."""

from types import SimpleNamespace

import pytest

from llm import FakeLLM, LLMReply, MLAPIClient, NullLLM


class _Sdk:
    """OpenAI SDK 자리. with_options 로 받은 값과 create 인자를 남긴다."""

    def __init__(self, response=None, error=None):
        self.response = response
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
        return self.response


def _client(sdk):
    client = MLAPIClient.__new__(MLAPIClient)
    client.name, client.model, client.max_retries, client.calls, client._client = "luna", "gpt-5.6-luna", 2, 0, sdk
    return client


def _response(content, *, finish="stop", usage=True, reasoning=7):
    u = None
    if usage:
        details = SimpleNamespace(reasoning_tokens=reasoning)
        u = SimpleNamespace(prompt_tokens=100, completion_tokens=20, completion_tokens_details=details)
    choice = SimpleNamespace(message=SimpleNamespace(content=content), finish_reason=finish)
    return SimpleNamespace(choices=[choice], usage=u)


def test_one_call_with_the_given_timeout_and_no_sdk_retries():
    sdk = _Sdk(_response('{"overview": "x"}'))
    reply = _client(sdk).generate_json_once("p", timeout_s=300.0, reasoning_effort="low")
    assert sdk.options == [{"timeout": 300.0, "max_retries": 0}]
    assert len(sdk.creates) == 1 and sdk.creates[0]["reasoning_effort"] == "low"
    assert sdk.creates[0]["response_format"] == {"type": "json_object"}
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
    assert len(sdk.creates) == 3 and sdk.options == []


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
