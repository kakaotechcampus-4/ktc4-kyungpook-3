from types import SimpleNamespace

import numpy as np
import pytest
import requests

from stt.backend import SttError, SttResult, Word

SAMPLES = np.zeros(16_000, dtype=np.float32)


def _response(payload):
    """requests.Response 대역. transcribe 는 status_code 와 json() 만 본다."""
    return lambda *a, **k: SimpleNamespace(status_code=200, json=lambda: payload)


def test_result_joins_words_when_text_missing():
    r = SttResult.from_words([Word("안녕", 0.0, 0.4), Word("하세요", 0.4, 0.9)])
    assert r.text == "안녕 하세요"


def test_result_keeps_explicit_text():
    r = SttResult(text="안녕하세요", words=[])
    assert r.text == "안녕하세요"


def test_confirmed_prefix_of_two_runs():
    """LocalAgreement-2: 연속 두 가설의 최장 공통 단어 접두사만 확정한다."""
    from stt.backend import confirmed_prefix

    a = [Word("이번", 0.0, 0.3), Word("주에", 0.3, 0.6), Word("큐", 0.6, 0.9)]
    b = [Word("이번", 0.0, 0.3), Word("주에", 0.3, 0.6), Word("규", 0.6, 0.9)]
    assert [w.text for w in confirmed_prefix(a, b)] == ["이번", "주에"]


def test_confirmed_prefix_empty_when_first_word_differs():
    from stt.backend import confirmed_prefix

    a = [Word("이번", 0.0, 0.3)]
    b = [Word("저번", 0.0, 0.3)]
    assert confirmed_prefix(a, b) == []


def test_confirmed_prefix_handles_empty():
    from stt.backend import confirmed_prefix

    assert confirmed_prefix([], [Word("x", 0.0, 0.1)]) == []


def test_elice_requires_key(monkeypatch):
    from stt.elice import EliceStt

    monkeypatch.delenv("ELICE_API_KEY", raising=False)
    monkeypatch.setattr(
        requests, "post", lambda *a, **k: pytest.fail("키가 없으면 요청을 보내면 안 된다")
    )
    with pytest.raises(SttError):
        EliceStt().transcribe(np.zeros(16_000, dtype=np.float32), 16_000)


def test_elice_wraps_request_failure(monkeypatch):
    """requests 예외는 OSError 계열이라 감싸지 않으면 호출자의 except SttError 를 지나친다."""
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")

    def boom(*a, **k):
        raise requests.ConnectionError("연결 실패")

    monkeypatch.setattr(requests, "post", boom)
    with pytest.raises(SttError) as e:
        EliceStt().transcribe(SAMPLES, 16_000)
    assert "ConnectionError" in str(e.value)


def test_elice_wraps_non_json_body(monkeypatch):
    """200 인데 본문이 JSON 이 아니면 r.json() 이 ValueError 를 던진다."""
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")

    def not_json():
        raise ValueError("Expecting value: line 1 column 1 (char 0)")

    monkeypatch.setattr(
        requests, "post", lambda *a, **k: SimpleNamespace(status_code=200, json=not_json)
    )
    with pytest.raises(SttError) as e:
        EliceStt().transcribe(SAMPLES, 16_000)
    assert "JSON" in str(e.value)


def test_elice_caps_server_reason(monkeypatch):
    """서버가 준 reason 도 상태코드 경로와 같이 200자에서 자른다."""
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setattr(
        requests, "post", _response({"_result": {"status": "error", "reason": "실" * 500}})
    )
    with pytest.raises(SttError) as e:
        EliceStt().transcribe(SAMPLES, 16_000)
    assert len(str(e.value)) == 200


def test_elice_parses_chunks_and_skips_bad_timestamps(monkeypatch):
    """timestamp 가 None 이거나 원소가 하나면 그 청크만 버리고 text 는 그대로 둔다."""
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setattr(
        requests,
        "post",
        _response(
            {
                "_result": {"status": "ok"},
                "transcript": {
                    "text": "안녕 하세요 반갑습니다",
                    "chunks": [
                        {"timestamp": [0.0, 0.4], "text": " 안녕"},
                        {"timestamp": [None, 0.9], "text": " 하세요"},
                        {"timestamp": [0.9], "text": " 반갑습니다"},
                    ],
                },
            }
        ),
    )
    r = EliceStt().transcribe(SAMPLES, 16_000)
    assert r.text == "안녕 하세요 반갑습니다"
    assert [w.text for w in r.words] == ["안녕"]


def test_local_transcribe_collects_words(monkeypatch):
    """세그먼트 텍스트를 잇고 단어를 공백 없이 모은다. words 가 없는 세그먼트도 그냥 지나간다."""
    from stt.local import LocalStt

    seg = SimpleNamespace(
        text=" 안녕하세요",
        words=[
            SimpleNamespace(word=" 안녕", start=0.0, end=0.5),
            SimpleNamespace(word="하세요", start=0.5, end=0.9),
        ],
    )
    silent = SimpleNamespace(text="  ", words=None)
    fake_model = SimpleNamespace(transcribe=lambda *a, **k: (iter([seg, silent]), None))
    monkeypatch.setattr(LocalStt, "_load", lambda self: fake_model)

    r = LocalStt().transcribe(SAMPLES, 16_000)
    assert r.text == "안녕하세요"
    assert [(w.text, w.start_s, w.end_s) for w in r.words] == [
        ("안녕", 0.0, 0.5),
        ("하세요", 0.5, 0.9),
    ]
