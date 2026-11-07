"""대화 신호 웹소켓. 본문은 보내지 않고, FE 는 신호를 받으면 기존 조회를 다시 부른다(권한 검사를 조회 한 곳에 둔다)."""
import asyncio
from datetime import datetime

from fastapi import APIRouter, WebSocket
from fastapi.concurrency import run_in_threadpool
from starlette.websockets import WebSocketDisconnect

from app.api.deps import authenticate, require_member
from app.core.database import SessionLocal
from app.core.errors import AppError
from app.services import thread_signals
from app.services.thread_signals import CLOSE_TRY_AGAIN_LATER, Connection

CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403
REVALIDATE_SECONDS = 30

router = APIRouter(prefix="/workspaces/{workspace_id}/messages", tags=["messages"])


def _same_origin(websocket: WebSocket) -> bool:
    """브라우저는 다른 사이트의 소켓 요청에도 쿠키를 실어 보낸다. 스킴은 프록시 앞뒤로 달라 보지 않는다."""
    origin, host = websocket.headers.get("origin"), websocket.headers.get("host")
    return bool(origin and host) and origin.partition("://")[2].lower() == host.lower()


def _authorize(token: str | None, workspace_id: str) -> tuple[str, datetime] | int:
    """(member_id, 세션 만료 시각), 안 되면 닫을 코드. 세션을 바로 닫아 소켓이 풀 연결을 잡고 있지 않게 한다."""
    with SessionLocal() as db:
        session = authenticate(db, token)
        if session is None:
            return CLOSE_UNAUTHENTICATED
        user, expires_at = session
        try:
            return require_member(db, user, workspace_id).member_id, expires_at
        except AppError:
            return CLOSE_FORBIDDEN


async def _until_disconnect(websocket: WebSocket) -> None:
    """receive 를 늘 걸어 두어야 끊김과 ping 시간 초과가 여기로 드러난다. 클라이언트가 보낸 글은 버린다."""
    while (await websocket.receive())["type"] != "websocket.disconnect":
        pass


async def _send_signals(websocket: WebSocket, conn: Connection) -> None:
    while True:
        thread_id = await conn.outbox.get()
        await websocket.send_json({"type": "thread_updated", "thread_id": thread_id})


async def _until_outbox_overflows(conn: Connection) -> int:
    await conn.overflowed.wait()
    return CLOSE_TRY_AGAIN_LATER


async def _until_access_ends(conn: Connection) -> int:
    while True:
        await asyncio.sleep(REVALIDATE_SECONDS)
        access = await run_in_threadpool(_authorize, conn.session_token, conn.workspace_id)
        if isinstance(access, int):
            return access


async def _serve(websocket: WebSocket, conn: Connection) -> int | None:
    """연결이 끝날 때까지 돈다. 서버가 닫을 때는 코드를, 상대가 먼저 끊었으면 None 을 돌려준다."""
    tasks = [
        asyncio.create_task(_until_disconnect(websocket)),
        asyncio.create_task(_send_signals(websocket, conn)),
        asyncio.create_task(_until_outbox_overflows(conn)),
        asyncio.create_task(_until_access_ends(conn)),
    ]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in tasks:
            task.cancel()
    await asyncio.wait(tasks)
    results = [task.result() for task in done]
    return None if None in results else results[0]


@router.websocket("/ws")
async def message_socket(websocket: WebSocket, workspace_id: str) -> None:
    if not _same_origin(websocket):
        await websocket.close()
        return

    token = websocket.cookies.get("session_token")
    access = await run_in_threadpool(_authorize, token, workspace_id)
    if isinstance(access, int):
        # 받기 전에 닫으면 브라우저가 코드를 읽지 못해 FE 가 다시 붙을지 가를 수 없다.
        await websocket.accept()
        await websocket.close(access)
        return

    member_id, expires_at = access
    conn = Connection(workspace_id, member_id, token, expires_at, asyncio.get_running_loop())
    # 받기 전에 등록한다. FE 는 열리자마자 조회하므로 그 뒤의 글은 신호로 받아야 빈틈이 없다.
    thread_signals.register(conn)
    try:
        await websocket.accept()
        code = await _serve(websocket, conn)
        if code is not None:
            await websocket.close(code)
    except WebSocketDisconnect:
        pass
    finally:
        thread_signals.unregister(conn)
