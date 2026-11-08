"""EliceStt 의 명시적 주소(SttEndpoint)와 실패 원인(SttError.cause). GPU 길은 환경 변수가 아니라 이 값으로 간다."""

from types import SimpleNamespace

import numpy as np
import pytest
import requests

from stt.backend import SttError

SAMPLES = np.zeros(16_000, dtype=np.float32)
URL = "https://mlapi.example/abc"
GPU = "https://gpu.example"


def _env(monkeypatch):
    monkeypatch.setenv("ELICE_API_KEY", "env-key")
    monkeypatch.setenv("ELICE_STT_BASE_URL", URL)
    monkeypatch.delenv("ELICE_STT_CA_BUNDLE", raising=False)


def _capture(monkeypatch, status=200, payload=None, text=""):
    seen = {}

    def post(url, **kwargs):
        seen.update(url=url, **kwargs)
        return SimpleNamespace(status_code=status, text=text, json=lambda: payload if payload is not None else {"text": " 네"})

    monkeypatch.setattr(requests, "post", post)
    return seen


def test_an_explicit_endpoint_wins_over_the_environment(monkeypatch, tmp_path):
    from stt.elice import EliceStt, SttEndpoint

    _env(monkeypatch)
    ca = tmp_path / "ca.pem"
    ca.write_text("x")
    seen = _capture(monkeypatch)
    EliceStt(endpoint=SttEndpoint(base_url=GPU + "/", api_key="gpu-key", ca_bundle=str(ca))).transcribe(SAMPLES, 16_000)
    assert seen["url"] == GPU + "/v1/audio/transcriptions"
    assert seen["headers"]["Authorization"] == "Bearer gpu-key"
    assert seen["verify"] == str(ca)


def test_without_an_endpoint_the_environment_is_read_on_every_call(monkeypatch):
    from stt.elice import EliceStt

    _env(monkeypatch)
    seen = _capture(monkeypatch)
    stt = EliceStt()
    stt.transcribe(SAMPLES, 16_000)
    assert seen["url"].startswith(URL)
    monkeypatch.setenv("ELICE_STT_BASE_URL", "https://other.example")
    stt.transcribe(SAMPLES, 16_000)
    assert seen["url"].startswith("https://other.example")


def test_an_explicit_endpoint_must_be_https(monkeypatch):
    from stt.elice import EliceStt, SttEndpoint

    monkeypatch.setattr(requests, "post", lambda *a, **k: pytest.fail("http 로 키를 보내면 안 된다"))
    with pytest.raises(SttError) as e:
        EliceStt(endpoint=SttEndpoint(base_url="http://gpu.example", api_key="k", ca_bundle=None)).transcribe(SAMPLES, 16_000)
    assert e.value.cause == "config"


def test_an_stt_error_without_a_cause_is_a_service_failure():
    assert SttError("x").cause == "service"


@pytest.mark.parametrize("status, cause", [(500, "service"), (502, "service"), (503, "service"), (408, "service"),
                                           (429, "service"), (401, "auth"), (402, "auth"), (403, "auth"),
                                           (400, "request"), (413, "request"), (422, "request")])
def test_http_status_sets_the_cause(monkeypatch, status, cause):
    from stt.elice import EliceStt

    _env(monkeypatch)
    _capture(monkeypatch, status=status, text="nope")
    with pytest.raises(SttError) as e:
        EliceStt().transcribe(SAMPLES, 16_000)
    assert e.value.cause == cause


def test_a_dropped_connection_is_a_service_failure(monkeypatch):
    from stt.elice import EliceStt

    _env(monkeypatch)

    def boom(*a, **k):
        raise requests.ConnectionError("reset")

    monkeypatch.setattr(requests, "post", boom)
    with pytest.raises(SttError) as e:
        EliceStt().transcribe(SAMPLES, 16_000)
    assert e.value.cause == "service"


@pytest.mark.parametrize("payload", [{"error": "x"}, ["not", "a", "dict"]])
def test_a_200_without_text_is_a_service_failure(monkeypatch, payload):
    from stt.elice import EliceStt

    _env(monkeypatch)
    _capture(monkeypatch, payload=payload)
    with pytest.raises(SttError) as e:
        EliceStt().transcribe(SAMPLES, 16_000)
    assert e.value.cause == "service"


def test_a_200_html_page_is_a_service_failure(monkeypatch):
    from stt.elice import EliceStt

    _env(monkeypatch)

    def post(url, **kwargs):
        def bad():
            raise ValueError("html")
        return SimpleNamespace(status_code=200, text="<html>", json=bad)

    monkeypatch.setattr(requests, "post", post)
    with pytest.raises(SttError) as e:
        EliceStt().transcribe(SAMPLES, 16_000)
    assert e.value.cause == "service"


@pytest.mark.parametrize("env", [{"ELICE_API_KEY": ""}, {"ELICE_STT_BASE_URL": ""},
                                 {"ELICE_STT_BASE_URL": "http://mlapi.example"},
                                 {"ELICE_STT_CA_BUNDLE": "/no/such/ca.pem"}])
def test_missing_settings_are_config_failures(monkeypatch, env):
    from stt.elice import EliceStt

    _env(monkeypatch)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(requests, "post", lambda *a, **k: pytest.fail("설정이 틀리면 보내지 않는다"))
    with pytest.raises(SttError) as e:
        EliceStt().transcribe(SAMPLES, 16_000)
    assert e.value.cause == "config"
