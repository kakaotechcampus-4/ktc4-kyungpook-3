"""템플릿 복제가 끝나면 노션 연결에 대상 데이터베이스를 채운다.

OAuth callback은 토큰만 저장하고 바로 응답한다. Notion이 템플릿을 사용자 워크스페이스에 복제하는 데
십몇 초가 걸려서, 그 자리에서 기다리면 사용자가 멈춘 화면을 보기 때문이다. 대신 응답 뒤에
`BackgroundTasks`가 `attach_template_database()`를 부른다.

- 복제가 끝날 때까지 `POLL_INTERVAL_SECONDS`마다 다시 보고, `WAIT_TIMEOUT_SECONDS`가 지나면 포기한다.
- 찾은 DB의 속성이 워커가 쓰는 속성과 맞으면 `provider_channel_id`에 저장한다. 이때부터 워커가 반영한다.
  같은 트랜잭션에서 워크스페이스의 모든 Task에 확인 요청을 쌓는다(`notion_sync.enqueue_workspace_sync`).
- 실패하면 행은 남기고 토큰만 비운다. "연결됨인데 반영은 안 되는" 반쪽 연결을 남기지 않으면서, 행이 없는
  "연결한 적 없음"과 구분해 PM에게 끊김(`revoked`)으로 알린다. 다시 연결하면 callback이 새 토큰을 채운다.

저장이든 토큰 비우기든 행의 토큰이 시작할 때와 같을 때만 한다. 그 사이 다시 연결했다면 새 연결은 새 작업이 맡는다.
기다리는 동안에는 DB 세션을 열어 두지 않고, 마지막에 한 번만 연다.
"""
import logging
import time
from collections.abc import Callable
from enum import StrEnum

import httpx
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models import Integration
from app.services import notion, notion_sync

logger = logging.getLogger(__name__)

WAIT_TIMEOUT_SECONDS = 60
POLL_INTERVAL_SECONDS = 2


class AttachResult(StrEnum):
    ATTACHED = "attached"
    TEMPLATE_NOT_READY = "template_not_ready"  # 기다려도 복제가 끝나지 않았다
    DATABASE_NOT_FOUND = "database_not_found"  # 복제는 끝났는데 페이지 바로 아래에 DB가 없다
    SCHEMA_MISMATCH = "schema_mismatch"  # DB 속성이 워커가 쓰는 속성과 다르다
    NOTION_ERROR = "notion_error"  # 다시 해도 소용없는 Notion 오류(권한 등)
    SUPERSEDED = "superseded"  # 그 사이 연결이 지워졌거나 다시 연결됐거나, 이미 DB가 채워졌다


def attach_template_database(
    workspace_id: str,
    access_token: str,
    page_id: str,
    *,
    timeout: float = WAIT_TIMEOUT_SECONDS,
    interval: float = POLL_INTERVAL_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    session_factory: Callable[[], Session] = SessionLocal,
    transport: httpx.BaseTransport | None = None,
) -> AttachResult:
    result, database_id = _wait_for_database(access_token, page_id, timeout, interval, sleep, clock, transport)

    # 토큰 확인과 저장·토큰 비우기를 한 문장으로 한다. 읽은 뒤 따로 쓰면 그 사이 다시 연결한 새 행을 덮을 수 있다.
    same_connection = (
        Integration.workspace_id == workspace_id,
        Integration.provider == "notion",
        Integration.access_token == access_token,
    )
    if result is AttachResult.ATTACHED:
        statement = update(Integration).where(*same_connection).values(provider_channel_id=database_id)
    else:
        statement = (
            update(Integration)
            .where(*same_connection, Integration.provider_channel_id.is_(None))
            .values(access_token=None, refresh_token=None)
        )
    with session_factory() as db:
        changed = db.execute(statement).rowcount
        if result is AttachResult.ATTACHED and changed == 1:
            # 새 DB가 붙었다. DB ID 저장과 같은 트랜잭션에서 모든 Task에 확인 요청을 쌓는다. 이 저장이 실패하면
            # DB ID도 함께 되돌려져 "DB 없음"으로 남고, 연동 조회가 2분 뒤 끊김(revoked)으로 알린다.
            notion_sync.enqueue_workspace_sync(db, workspace_id)
        db.commit()
    if changed == 0:
        result = AttachResult.SUPERSEDED

    # 화면에는 끊김으로만 보이고 이유는 나가지 않는다. 이유를 찾을 수 있게 경고로 남긴다(info는 기본 설정에서 보이지 않는다).
    if result is AttachResult.ATTACHED:
        logger.info("Notion 대상 DB 연결 workspace_id=%s result=%s", workspace_id, result)
    else:
        logger.warning("Notion 대상 DB 연결 실패 workspace_id=%s result=%s", workspace_id, result)
    return result


def _wait_for_database(
    access_token: str,
    page_id: str,
    timeout: float,
    interval: float,
    sleep: Callable[[float], None],
    clock: Callable[[], float],
    transport: httpx.BaseTransport | None,
) -> tuple[AttachResult, str | None]:
    deadline = clock() + timeout
    while True:
        # 이번에 실패하면 시간이 다 됐을 때 이 이유로 끝난다
        waiting_for = AttachResult.TEMPLATE_NOT_READY
        try:
            database_id = notion.find_template_database(access_token, page_id, transport=transport)
            if database_id is None:
                return AttachResult.DATABASE_NOT_FOUND, None
            problems = notion.verify_database_schema(access_token, database_id, transport=transport)
            if problems:
                logger.warning("Notion 템플릿 DB 속성 불일치: %s", "; ".join(problems))
                return AttachResult.SCHEMA_MISMATCH, None
            return AttachResult.ATTACHED, database_id
        except notion.TemplateNotReady:
            pass
        except notion.NotionWriteError as exc:
            if not exc.retryable:
                logger.warning("Notion 템플릿 DB 조회 실패 status=%s: %s", exc.status_code, exc.reason)
                return AttachResult.NOTION_ERROR, None
            waiting_for = AttachResult.NOTION_ERROR
        except Exception:
            # 예상 못 한 오류(예: JSON이 아닌 응답)로 여기서 멈추면 토큰만 있는 반쪽 연결이 남는다.
            logger.exception("Notion 템플릿 DB 조회 중 예상하지 못한 오류")
            return AttachResult.NOTION_ERROR, None

        if clock() + interval > deadline:
            return waiting_for, None
        sleep(interval)
