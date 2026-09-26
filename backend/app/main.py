import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import approvals, extractions, meetings, members, tasks, workspaces, auth, integrations
from app.core.errors import AppError, Envelope, ErrorCode, failure, success
from app.services import notion_sync

logger = logging.getLogger(__name__)

# Notion 반영 대기열을 훑는 주기(초). 0 이하면 워커를 띄우지 않는다.
NOTION_SYNC_INTERVAL_SECONDS = float(os.getenv("NOTION_SYNC_INTERVAL_SECONDS", "5"))


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if NOTION_SYNC_INTERVAL_SECONDS <= 0:
        yield
        return
    thread, stop_event = notion_sync.start_worker(NOTION_SYNC_INTERVAL_SECONDS)
    try:
        yield
    finally:
        stop_event.set()
        thread.join(timeout=5)


app = FastAPI(
    title="Manager's Manager API",
    version="0.1.0",
    description="회의 → 추출 → 매칭 → 게이트 파이프라인 백엔드",
    lifespan=lifespan,
)

API_PREFIX = "/api/v1"
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(workspaces.router, prefix=API_PREFIX)
app.include_router(members.router, prefix=API_PREFIX)
app.include_router(meetings.router, prefix=API_PREFIX)
app.include_router(extractions.router, prefix=API_PREFIX)
app.include_router(approvals.router, prefix=API_PREFIX)
app.include_router(tasks.router, prefix=API_PREFIX)
app.include_router(integrations.router, prefix=API_PREFIX)


@app.exception_handler(AppError)
async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=failure(exc.code, exc.message, exc.details),
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    _: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content=failure(
            ErrorCode.INVALID_REQUEST,
            details={
                "fields": [
                    {"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()
                ]
            },
        ),
    )


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = (
        ErrorCode.INVALID_REQUEST
        if exc.status_code < 500
        else ErrorCode.INTERNAL_ERROR
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=failure(code, str(exc.detail)),
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content=failure(ErrorCode.INTERNAL_ERROR),
    )


@app.get("/health", response_model=Envelope[dict[str, str]])
async def health() -> dict[str, Any]:
    return success({"status": "ok"})

