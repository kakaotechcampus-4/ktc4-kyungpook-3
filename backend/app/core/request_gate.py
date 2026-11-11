"""동시에 처리하는 HTTP 요청 수를 DB 연결 풀보다 작게 막는다(#701).

인증 의존성과 엔드포인트가 동기 함수라 요청 하나가 단계마다 스레드풀(40개) 차례를 따로 기다리고,
첫 쿼리에서 받은 연결은 끝날 때까지 쥔다. 진행 중인 요청이 스레드 수를 넘으면 연결을 쥔 요청은
스레드를, 스레드를 잡은 요청은 연결을 기다려 풀 대기 시간(30초)이 끝날 때까지 멈춘다.
관문 밖에서 기다리는 요청은 스레드도 연결도 잡지 않아서 들어온 요청은 연결을 반드시 받는다.
웹소켓은 오래 열려 있어 관문에 넣지 않는다.
"""
import asyncio

from starlette.types import ASGIApp, Receive, Scope, Send

# DB 연결 풀(app.core.database.POOL_SIZE + MAX_OVERFLOW = 40)보다 작게 잡아 백그라운드 워커 몫을 남긴다
REQUEST_GATE_LIMIT = 30


class RequestGateMiddleware:
    def __init__(self, app: ASGIApp, limit: int = REQUEST_GATE_LIMIT) -> None:
        self.app = app
        self.slots = asyncio.Semaphore(limit)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        async with self.slots:
            await self.app(scope, receive, send)
