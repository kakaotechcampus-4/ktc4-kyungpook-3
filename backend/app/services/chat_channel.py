"""채팅 수집 채널 설정(#428)에 쓰는 Discord 연결 조회와 오류 변환."""
import logging
import os

from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import Integration
from app.services import discord

logger = logging.getLogger(__name__)

ON_NOTICE = (
    "이 채널 대화는 매일 09:00(KST)에 Manager's Manager 가 읽어 task 추가·수정 제안에 씁니다. "
    "제안은 PM 승인 뒤에만 반영됩니다."
)
OFF_NOTICE = "이 채널 대화 수집을 껐습니다."


def bot_token() -> str:
    """봇 토큰. 비어 있으면 Discord 를 부를 수 없으니 502 로 알린다."""
    token = os.getenv("DISCORD_BOT_TOKEN", "")
    if not token:
        logger.error("DISCORD_BOT_TOKEN이 없어 Discord 를 호출하지 못했습니다")
        raise AppError(
            ErrorCode.DISCORD_API_FAILED, details={"status": None, "reason": "bot_token_missing"}
        )
    return token


def connected_discord(db: Session, workspace_id: str, *, lock: bool = False) -> Integration:
    """연결된 Discord 행. 없거나 서버 ID 가 비었으면 409. lock 이면 행을 FOR UPDATE 로 잡는다."""
    query = db.query(Integration).filter(
        Integration.workspace_id == workspace_id, Integration.provider == "discord"
    )
    if lock:
        query = query.with_for_update()
    integration = query.first()
    if integration is None or not integration.provider_channel_id:
        raise AppError(ErrorCode.INTEGRATION_NOT_CONNECTED, details={"provider": "discord"})
    return integration


def to_app_error(exc: discord.DiscordApiError, *, channel_id: str | None, need: str | None) -> AppError:
    """Discord 오류를 앱 오류로. 403 은 need(read|send)가 있을 때, 404 는 channel_id 가 있을 때만 채널 오류로 본다."""
    if exc.status_code == 403 and need:
        return AppError(
            ErrorCode.DISCORD_CHANNEL_NOT_ACCESSIBLE,
            details={"channel_id": channel_id, "need": need, "discord_code": exc.discord_code},
        )
    if exc.status_code == 404 and channel_id:
        return AppError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND, details={"channel_id": channel_id})
    return AppError(ErrorCode.DISCORD_API_FAILED, details={"status": exc.status_code, "reason": exc.reason})


def list_channels(db: Session, workspace_id: str) -> list[dict]:
    """연결한 서버의 텍스트 채널 `[{"channel_id", "name"}]`."""
    integration = connected_discord(db, workspace_id)
    token = bot_token()
    try:
        return discord.list_text_channels(token, integration.provider_channel_id)
    except discord.DiscordApiError as exc:
        logger.warning(
            "Discord 채널 목록 조회 실패 workspace_id=%s status=%s reason=%s",
            workspace_id, exc.status_code, exc.reason,
        )
        raise to_app_error(exc, channel_id=None, need=None) from None
