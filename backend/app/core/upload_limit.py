"""녹음 업로드 본문을 다 받기 전에 크기를 넘으면 413 으로 끊는다.

FastAPI 는 multipart 본문을 끝까지 받아 임시 파일에 쓴 뒤에야 인증과 핸들러의 용량 검사를 돈다.
그래서 이 경로만 본문이 들어오는 동안 크기를 재고, 넘으면 인증 전에 끊는다. 핸들러의 파일 크기 검사는
그대로 두고, 여기서는 파일 한도에 multipart 머리 몫을 더한 값만 본다. 스트리밍을 지키려고 순수 ASGI 로 짰다.
"""
import re

from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import ERROR_STATUS, ErrorCode, failure
from app.services import upload_storage

# 파일 말고 제목·참석자·경계 문자열 몫. 실제로는 수 KB 라 넉넉히 잡았다
MULTIPART_OVERHEAD_BYTES = 1024 * 1024
_UPLOAD_PATH = re.compile(r"/api/v1/workspaces/[^/]+/meetings/upload/?")


class _BodyTooLarge(Exception):
    pass


class UploadBodyLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or not _UPLOAD_PATH.fullmatch(scope["path"]):
            await self.app(scope, receive, send)
            return

        max_bytes = upload_storage.max_bytes()
        limit = max_bytes + MULTIPART_OVERHEAD_BYTES
        reject = JSONResponse(
            status_code=ERROR_STATUS[ErrorCode.AUDIO_TOO_LARGE],
            content=failure(ErrorCode.AUDIO_TOO_LARGE, details={"max_bytes": max_bytes}),
            # 남은 본문을 읽지 않도록 연결을 닫게 한다
            headers={"connection": "close"},
        )

        content_length = dict(scope["headers"]).get(b"content-length", b"")
        if content_length.isdigit() and int(content_length) > limit:
            await reject(scope, receive, send)
            return

        received = 0
        exceeded = False
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received, exceeded
            if exceeded:
                raise _BodyTooLarge
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    exceeded = True
                    raise _BodyTooLarge
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal response_started
            # 한도를 넘긴 뒤 앱이 본문 오류로 보내는 응답(400 등)은 버리고 413 하나만 보낸다
            if exceeded:
                return
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except _BodyTooLarge:
            pass
        if exceeded and not response_started:
            await reject(scope, receive, send)
