"""동시 요청 관문(#701). 들어온 요청 수를 DB 연결 풀보다 작게 막아 스레드풀과 연결 풀이 서로 기다리지 않게 한다."""
import asyncio

from app.core import database
from app.core.request_gate import REQUEST_GATE_LIMIT, RequestGateMiddleware


class Counting:
    """안에 동시에 들어와 있는 요청 수의 최고치를 센다. 요청마다 release 가 열릴 때까지 머문다."""

    def __init__(self):
        self.inside = 0
        self.peak = 0
        self.release = asyncio.Event()

    async def __call__(self, scope, receive, send):
        self.inside += 1
        self.peak = max(self.peak, self.inside)
        await self.release.wait()
        self.inside -= 1


def _scope(kind="http"):
    return {"type": kind, "method": "GET", "path": "/api/v1/tasks", "headers": []}


def test_http_requests_beyond_limit_wait_outside():
    async def scenario():
        inner = Counting()
        gate = RequestGateMiddleware(inner, limit=2)
        calls = [asyncio.create_task(gate(_scope(), None, None)) for _ in range(5)]
        await asyncio.sleep(0.05)
        assert inner.peak == 2
        inner.release.set()
        await asyncio.wait_for(asyncio.gather(*calls), timeout=1)
        return inner

    inner = asyncio.run(scenario())
    assert inner.peak == 2
    assert inner.inside == 0


def test_websocket_does_not_wait_for_gate():
    async def scenario():
        inner = Counting()
        gate = RequestGateMiddleware(inner, limit=1)
        held = asyncio.create_task(gate(_scope(), None, None))
        await asyncio.sleep(0.01)
        socket = asyncio.create_task(gate(_scope("websocket"), None, None))
        await asyncio.sleep(0.01)
        peak = inner.peak
        inner.release.set()
        await asyncio.gather(held, socket)
        return peak

    assert asyncio.run(scenario()) == 2


def test_gate_leaves_connections_for_background_workers():
    # 같은 프로세스의 리마인드·Notion·임베딩·sweeper 워커와 웹소켓도 연결을 쓴다
    assert REQUEST_GATE_LIMIT < database.POOL_SIZE + database.MAX_OVERFLOW
