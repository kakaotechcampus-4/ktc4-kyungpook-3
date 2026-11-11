"""외부 모니터링(Grafana Synthetic Monitoring)이 부르는 DB 확인용 health ready(#675). FE·AI 는 부르지 않는다."""
import logging
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.services import health

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/ready", response_model=Envelope[dict[str, str]])
def ready(db: Session = Depends(get_db)) -> dict[str, Any]:
    try:
        health.check_database(db)
    except SQLAlchemyError as exc:
        # 예외 메시지에는 호스트·계정이 들어갈 수 있어 클래스 이름만 남긴다.
        logger.warning("health ready: database unavailable (%s)", type(exc).__name__)
        raise AppError(ErrorCode.DATABASE_UNAVAILABLE) from None
    return success({"status": "ok"})
