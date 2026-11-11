"""스위치 HTTP 클라이언트. 가짜 Lambda(HTTPS, 자체 서명)에 실제 requests 로 보낸다."""

import json

import pytest

from stt.failover import ServerView
from stt.gpu_switch import GpuSwitch, SwitchError
from tests.stt.fake_servers import FakeHttps, cert_pair

GOOD = "fake"


@pytest.fixture
def lam(tmp_path):
    cert, key = cert_pair(tmp_path)
    answers = []

    def respond(method, path, headers, body):
        if headers.get("Authorization") != f"Bearer {GOOD}":
            return 401, b"", "application/json"
        status, payload = answers.pop(0) if answers else (200, {"state": "off", "launched_at": None, "stop_at": None,
                                                                  "refused": None, "used_min": 0, "cap_min": 900})
        return status, payload if isinstance(payload, bytes) else json.dumps(payload).encode(), "application/json"

    server = FakeHttps(cert, key, respond)
    server.answers = answers
    yield server, cert
    server.close()


def test_it_posts_the_action_with_the_bearer_and_reads_the_view(lam):
    server, cert = lam
    server.answers.append((200, {"state": "running", "launched_at": 1000, "stop_at": 11800, "refused": None,
                                 "used_min": 12, "cap_min": 900}))
    view = GpuSwitch(server.url, GOOD, ca_bundle=str(cert)).call("on")
    assert view == ServerView(state="running", launched_at=1000.0, stop_at=11800.0, refused=None, used_min=12,
                              cap_min=900)
    assert json.loads(server.requests[0]["body"]) == {"action": "on"}


@pytest.mark.parametrize("refused", ["limit", "capacity", "spent", "not_ready", "stopping"])
def test_refusals_come_through(lam, refused):
    server, cert = lam
    server.answers.append((200, {"state": "off", "launched_at": None, "stop_at": None, "refused": refused,
                                 "used_min": 0, "cap_min": 900}))
    assert GpuSwitch(server.url, GOOD, ca_bundle=str(cert)).call("on").refused == refused


def test_a_rejected_bearer_is_a_switch_error_that_does_not_leak_it(lam):
    server, cert = lam
    with pytest.raises(SwitchError) as e:
        GpuSwitch(server.url, "not-the-one", ca_bundle=str(cert)).call("status")
    assert "401" in str(e.value) and "not-the-one" not in str(e.value)


@pytest.mark.parametrize("payload", [b"<html>", {"state": "pending"}, {"state": "running", "refused": "nope"},
                                     {"launched_at": 1}, [1, 2]])
def test_an_unreadable_answer_is_a_switch_error(lam, payload):
    server, cert = lam
    server.answers.append((200, payload))
    with pytest.raises(SwitchError):
        GpuSwitch(server.url, GOOD, ca_bundle=str(cert)).call("status")


def test_a_server_error_is_a_switch_error(lam):
    server, cert = lam
    server.answers.append((500, {"error": "two instances"}))
    with pytest.raises(SwitchError):
        GpuSwitch(server.url, GOOD, ca_bundle=str(cert)).call("on")


def test_an_unreachable_switch_is_a_switch_error():
    with pytest.raises(SwitchError):
        GpuSwitch("https://127.0.0.1:9", GOOD, timeout=2).call("status")


def test_an_untrusted_certificate_is_a_switch_error(lam):
    server, _ = lam
    with pytest.raises(SwitchError):
        GpuSwitch(server.url, GOOD).call("status")


def test_a_plain_http_switch_is_refused_before_sending():
    with pytest.raises(SwitchError):
        GpuSwitch("http://switch.example", GOOD).call("on")
