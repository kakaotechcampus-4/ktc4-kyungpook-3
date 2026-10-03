"""오디오 내용 해시 캐시(stt/eval/sttcache.py). 가짜 백엔드만 쓴다."""

import numpy as np
import pytest

from stt.backend import SttResult, Word
from stt.eval.sttcache import CachedStt


class CountingStt:
    name = "fake/model-b5"
    reclip_unmapped = True

    def __init__(self, fail=False):
        self.n = 0
        self.fail = fail

    def transcribe(self, samples, sample_rate):
        self.n += 1
        if self.fail:
            raise RuntimeError("서버 멈춤")
        return SttResult(text=f"길이{len(samples)}", words=[Word("길이", 0.0, 0.5)])


def pcm(n, v=0.1):
    return np.full(n, v, dtype=np.float32)


def test_same_audio_is_sent_once_and_the_first_duration_is_kept(tmp_path):
    inner = CountingStt()
    c = CachedStt(inner, tmp_path)
    a = c.transcribe(pcm(1600), 16_000)
    b = c.transcribe(pcm(1600), 16_000)
    assert inner.n == 1 and a.text == b.text and b.words == [Word("길이", 0.0, 0.5)]
    first, second = c.calls
    assert (first["cached"], second["cached"]) == (False, True)
    assert second["dt"] == first["dt"] and second["audio_s"] == 0.1


def test_cache_survives_a_new_wrapper_on_the_same_directory(tmp_path):
    CachedStt(CountingStt(), tmp_path).transcribe(pcm(800), 16_000)
    inner = CountingStt()
    CachedStt(inner, tmp_path).transcribe(pcm(800), 16_000)
    assert inner.n == 0


def test_different_audio_or_options_miss(tmp_path):
    inner = CountingStt()
    CachedStt(inner, tmp_path).transcribe(pcm(800), 16_000)
    CachedStt(inner, tmp_path).transcribe(pcm(800, 0.2), 16_000)
    CachedStt(inner, tmp_path, key_extra="prompt=참석자").transcribe(pcm(800), 16_000)
    assert inner.n == 3


def test_read_false_always_calls_the_backend(tmp_path):
    """원격 반복 측정용. 같은 입력도 매번 보낸다."""
    inner = CountingStt()
    c = CachedStt(inner, tmp_path, read=False)
    c.transcribe(pcm(800), 16_000)
    c.transcribe(pcm(800), 16_000)
    assert inner.n == 2 and [x["cached"] for x in c.calls] == [False, False]


def test_failures_are_logged_reraised_and_not_cached(tmp_path):
    c = CachedStt(CountingStt(fail=True), tmp_path)
    with pytest.raises(RuntimeError):
        c.transcribe(pcm(800), 16_000)
    assert c.calls[0]["error"] == "RuntimeError"
    inner = CountingStt()
    CachedStt(inner, tmp_path).transcribe(pcm(800), 16_000)
    assert inner.n == 1


def test_fingerprint_depends_on_inputs_not_on_call_order(tmp_path):
    x, y = CachedStt(CountingStt(), tmp_path), CachedStt(CountingStt(), tmp_path)
    x.transcribe(pcm(800), 16_000)
    x.transcribe(pcm(1600), 16_000)
    y.transcribe(pcm(1600), 16_000)
    y.transcribe(pcm(800), 16_000)
    assert x.fingerprint() == y.fingerprint()
    y.transcribe(pcm(400), 16_000)
    assert x.fingerprint() != y.fingerprint()


def test_wrapper_exposes_what_batch_run_reads():
    c = CachedStt(CountingStt(), None)
    assert c.name == "fake/model-b5" and c.reclip_unmapped is True
