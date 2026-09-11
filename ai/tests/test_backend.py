import numpy as np
import pytest

from stt.backend import SttError, SttResult, Word


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
    with pytest.raises(SttError):
        EliceStt().transcribe(np.zeros(16_000, dtype=np.float32), 16_000)
