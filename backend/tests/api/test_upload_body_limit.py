"""업로드 본문 크기 제한 미들웨어를 ASGI 로 바로 부른다. TestClient 는 본문을 한 번에 보내 조각 수신을 못 본다."""
import asyncio
import json

import pytest

from app.core import upload_limit
from app.core.upload_limit import UploadBodyLimitMiddleware

UPLOAD_PATH = "/api/v1/workspaces/ws-1/meetings/upload"


@pytest.fixture(autouse=True)
def tiny_limit(monkeypatch):
    monkeypatch.setenv("UPLOAD_MAX_BYTES", "100")
    monkeypatch.setattr(upload_limit, "MULTIPART_OVERHEAD_BYTES", 0)


def _scope(path=UPLOAD_PATH, method="POST", headers=()):
    return {"type": "http", "method": method, "path": path, "headers": list(headers)}


class ReadAll:
    """본문을 끝까지 읽고 200 을 보내는 앱. 받은 바이트 수를 센다."""

    def __init__(self):
        self.received = 0
        self.called = False

    async def __call__(self, scope, receive, send):
        self.called = True
        while True:
            message = await receive()
            self.received += len(message.get("body", b""))
            if not message.get("more_body"):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})


def _endless_receive(chunk=b"x" * 30):
    calls = {"n": 0}

    async def receive():
        calls["n"] += 1
        return {"type": "http.request", "body": chunk, "more_body": True}

    return receive, calls


def _run(app, scope, receive):
    sent = []

    async def send(message):
        sent.append(message)

    asyncio.run(app(scope, receive, send))
    return sent


def _status_and_body(sent):
    start = next(m for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return start["status"], json.loads(body) if body else None


def test_content_length_over_limit_rejects_without_reading_body():
    inner = ReadAll()

    async def receive():
        raise AssertionError("본문을 읽으면 안 된다")

    sent = _run(UploadBodyLimitMiddleware(inner), _scope(headers=[(b"content-length", b"101")]), receive)

    status, body = _status_and_body(sent)
    assert status == 413
    assert body["error"]["code"] == "AUDIO_TOO_LARGE"
    assert body["error"]["details"] == {"max_bytes": 100}
    assert not inner.called


def test_endless_chunked_body_is_cut_at_limit():
    inner = ReadAll()
    receive, calls = _endless_receive()

    sent = _run(UploadBodyLimitMiddleware(inner), _scope(), receive)

    status, body = _status_and_body(sent)
    assert status == 413
    assert body["error"]["code"] == "AUDIO_TOO_LARGE"
    # 한도를 넘긴 조각은 앱에 넘기지 않고, 그 뒤로는 더 받지 않는다
    assert inner.received <= 100
    assert calls["n"] == 4


def test_app_error_response_is_replaced_by_413():
    """앱이 본문 오류를 자기 응답(예: 400)으로 바꿔 보내도 413 하나만 나간다."""

    async def app(scope, receive, send):
        try:
            while True:
                await receive()
        except Exception:
            await send({"type": "http.response.start", "status": 400, "headers": []})
            await send({"type": "http.response.body", "body": b"{}"})

    receive, _ = _endless_receive()
    sent = _run(UploadBodyLimitMiddleware(app), _scope(), receive)

    assert [m["status"] for m in sent if m["type"] == "http.response.start"] == [413]


def test_body_at_limit_passes_through():
    inner = ReadAll()
    messages = iter([
        {"type": "http.request", "body": b"x" * 60, "more_body": True},
        {"type": "http.request", "body": b"x" * 40, "more_body": False},
    ])

    async def receive():
        return next(messages)

    sent = _run(UploadBodyLimitMiddleware(inner), _scope(headers=[(b"content-length", b"100")]), receive)

    assert _status_and_body(sent)[0] == 200
    assert inner.received == 100


@pytest.mark.parametrize("scope", [
    _scope(path="/api/v1/workspaces/ws-1/meetings"),
    _scope(path="/api/v1/uploads/ws-1/file"),
    _scope(method="GET", headers=[(b"content-length", b"999")]),
])
def test_other_requests_are_not_limited(scope):
    inner = ReadAll()
    messages = iter([
        {"type": "http.request", "body": b"x" * 500, "more_body": False},
    ])

    async def receive():
        return next(messages)

    sent = _run(UploadBodyLimitMiddleware(inner), scope, receive)

    assert _status_and_body(sent)[0] == 200
    assert inner.received == 500
