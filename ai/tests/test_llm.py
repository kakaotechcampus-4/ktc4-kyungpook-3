"""재시도 없는 호출 한 번(generate_json_once). 요약이 시간 상한과 재시도를 스스로 정할 때 쓴다.

Elice 게이트웨이는 스트리밍이 아닌 응답을 2000 토큰(추론 포함)에서 자른다. 그래서 모든 호출을 스트리밍으로 받는다.
"""

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
        return iter(self.response)


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
    assert sdk.options == [{"timeout": 300.0, "max_retries": 0}]
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
