from __future__ import annotations

import pytest

from upload.diarize import PyannoteAiDiarizer, Segment, normalize


def S(a, b, label="A"):
    return Segment(a, b, label)


def test_normalize_clamps_to_total_and_drops_empty():
    out = normalize([S(8, 12), S(11, 13), S(5, 5, "B"), S(6, 4, "B")], 10.0)
    assert out == [S(8, 10)]


def test_normalize_merges_same_label_overlap_and_adjacent():
    out = normalize([S(0, 2), S(1.5, 3), S(3, 4), S(6, 7)], 10.0)
    assert out == [S(0, 4), S(6, 7)]


def test_normalize_keeps_overlap_between_different_labels():
    out = normalize([S(1, 3, "A"), S(2.5, 5, "B")], 10.0)
    assert out == [S(1, 3, "A"), S(2.5, 5, "B")]


class HttpErr(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.response = type("R", (), {"status_code": code})()


class FakeResp:
    def __init__(self, payload=None, status=200):
        self._p, self.status_code = payload or {}, status

    def json(self):
        return self._p

    def raise_for_status(self):
        if self.status_code >= 400:
            raise HttpErr(self.status_code)


class FakeSession:
    def __init__(self, polls):
        self.calls, self.polls = [], list(polls)

    def post(self, url, **kw):
        self.calls.append(("POST", url, kw))
        if url.endswith("/v1/media/input"):
            return FakeResp({"url": "https://signed.example/up"}, 201)
        return FakeResp({"jobId": "J1", "status": "created"})

    def put(self, url, **kw):
        self.calls.append(("PUT", url, kw))
        return FakeResp()

    def get(self, url, **kw):
        self.calls.append(("GET", url, kw))
        item = self.polls.pop(0)
        if isinstance(item, BaseException):
            raise item
        if isinstance(item, int):
            return FakeResp({}, item)
        return FakeResp(item)


def _make(tmp_path, polls, **kw):
    f = tmp_path / "a.wav"
    f.write_bytes(b"RIFFxx")
    sess = FakeSession(polls)
    sleeps: list[float] = []
    d = PyannoteAiDiarizer(api_key="K", session=sess, sleep=sleeps.append, **kw)
    return d, sess, sleeps, f


def test_pyannote_flow_uploads_creates_job_polls_and_parses(tmp_path):
    ok = {"status": "succeeded", "output": {"diarization": [
        {"speaker": "SPEAKER_00", "start": 0.5, "end": 2.0},
        {"speaker": "SPEAKER_01", "start": 2.0, "end": 3.0}]}}
    d, sess, sleeps, f = _make(tmp_path, [{"status": "running"}, ok])
    segs = d.diarize(f)
    assert segs == [Segment(0.5, 2.0, "SPEAKER_00"), Segment(2.0, 3.0, "SPEAKER_01")]
    assert [c[0] for c in sess.calls] == ["POST", "PUT", "POST", "GET", "GET"]
    media_url = sess.calls[0][2]["json"]["url"]
    assert media_url.startswith("media://")
    assert sess.calls[1][1] == "https://signed.example/up"
    assert sess.calls[2][2]["json"]["url"] == media_url
    assert sess.calls[3][1].endswith("/v1/jobs/J1")
    assert all(c[2]["headers"]["Authorization"] == "Bearer K" for c in sess.calls if c[0] != "PUT")
    assert len(sleeps) == 1


@pytest.mark.parametrize("status", ["failed", "canceled"])
def test_pyannote_failed_job_raises(tmp_path, status):
    d, *_ , f = _make(tmp_path, [{"status": status}])
    with pytest.raises(RuntimeError):
        d.diarize(f)


def test_pyannote_poll_timeout_raises(tmp_path):
    d, _s, _sl, f = _make(tmp_path, [{"status": "running"}] * 50, timeout_s=25, poll_s=10)
    with pytest.raises(TimeoutError):
        d.diarize(f)


def test_pyannote_requires_key(tmp_path, monkeypatch):
    monkeypatch.delenv("PYANNOTEAI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="PYANNOTEAI_API_KEY"):
        PyannoteAiDiarizer(session=FakeSession([])).diarize(tmp_path / "x.wav")


OK = {"status": "succeeded", "output": {"diarization": [{"speaker": "A", "start": 0, "end": 1}]}}


def test_every_request_has_a_timeout(tmp_path):
    d, sess, _sl, f = _make(tmp_path, [OK])
    d.diarize(f)
    assert len(sess.calls) == 4 and all(c[2].get("timeout") for c in sess.calls)


def test_transient_poll_errors_are_retried(tmp_path):
    import requests

    polls = [503, 429, requests.ConnectionError("x"), requests.Timeout("t"), OK]
    d, sess, sleeps, f = _make(tmp_path, polls, poll_retries=5)
    assert d.diarize(f) == [Segment(0, 1, "A")]
    assert [c[0] for c in sess.calls].count("GET") == 5 and len(sleeps) == 4


def test_poll_errors_beyond_retry_limit_raise(tmp_path):
    d, sess, _sl, f = _make(tmp_path, [503, 503, 503, OK], poll_retries=2)
    with pytest.raises(HttpErr):
        d.diarize(f)
    assert [c[0] for c in sess.calls].count("GET") == 3


def test_non_transient_poll_error_is_not_retried(tmp_path):
    d, sess, _sl, f = _make(tmp_path, [401, OK], poll_retries=5)
    with pytest.raises(HttpErr):
        d.diarize(f)
    assert [c[0] for c in sess.calls].count("GET") == 1
