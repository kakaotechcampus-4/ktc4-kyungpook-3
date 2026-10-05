"""BE 응답 측정기(stt/eval/capacity/probe.py). 네트워크 대신 opener 를 바꿔 넣는다."""

import json
import signal
import time
import urllib.error

from stt.eval.capacity import probe as P


class _Resp:
    def __init__(self, status, wait=0.0):
        self.status = status
        self.wait = wait

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        time.sleep(self.wait)    # 본문을 읽는 시간도 응답 시간에 든다
        return b'{"status":"UP"}'


def test_ok_response_records_status_and_time_including_the_body():
    seen = {}

    def opener(url, timeout):
        seen.update(url=url, timeout=timeout)
        return _Resp(200, wait=0.02)

    got = P.probe_once("http://127.0.0.1:8000/health", opener=opener)
    assert got["status"] == 200
    assert "error" not in got
    assert got["ms"] >= 20
    assert isinstance(got["ts"], float)
    assert seen == {"url": "http://127.0.0.1:8000/health", "timeout": 5}


def test_http_error_code_is_a_status_not_an_error():
    def opener(url, timeout):
        raise urllib.error.HTTPError(url, 503, "x", {}, None)

    got = P.probe_once("http://h/health", opener=opener)
    assert got["status"] == 503
    assert "error" not in got


def test_connection_failure_and_timeout_are_errors_with_time():
    def refused(url, timeout):
        raise urllib.error.URLError("[Errno 111] Connection refused")

    def slow(url, timeout):
        raise TimeoutError("timed out")

    a = P.probe_once("http://h/health", opener=refused)
    assert a["error"].startswith("URLError")
    assert "status" not in a
    assert a["ms"] >= 0

    b = P.probe_once("http://h/health", opener=slow)
    assert b["error"] == "TimeoutError: timed out"


def test_main_writes_one_line_per_probe_and_ends_on_sigterm(tmp_path, monkeypatch):
    urls = []
    monkeypatch.setattr(P, "probe_once", lambda url: urls.append(url) or {"ts": 1.0, "ms": 2.0, "status": 200})
    slept = []

    def sleep(sec):
        slept.append(sec)
        if len(slept) == 2:
            signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)

    monkeypatch.setattr(P.time, "sleep", sleep)
    before = signal.getsignal(signal.SIGTERM)
    out = tmp_path / "p.jsonl"
    assert P.main(["--out", str(out)]) == 0

    lines = [json.loads(x) for x in out.read_text(encoding="utf-8").splitlines()]
    assert lines == [{"ts": 1.0, "ms": 2.0, "status": 200}] * 2
    assert urls == ["http://127.0.0.1:8000/health"] * 2
    assert all(0 <= s <= 1.0 for s in slept)
    assert signal.getsignal(signal.SIGTERM) == before
