import hmac
import logging
import os
from datetime import datetime, timedelta, timezone
from types import ModuleType

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Integration, Member, MemberRole
from app.api.deps import get_current_member, get_current_pm, get_current_user, require_member, require_service_token
from app.schemas.workspace import DiscordGuildWorkspaceResponse
from app.services import discord, discord_oauth, notion, notion_connect, notion_oauth, oauth_state

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces", tags=["integrations"])
# OAuth callback 전용. Notion에 등록하는 redirect URI는 한 글자도 달라질 수 없어서 workspace_id를 넣지 못한다.
# 그래서 `/workspaces/{id}/...` 아래가 아닌 고정 경로에 두고, 어느 워크스페이스인지는 서명한 state에서 꺼낸다.
callback_router = APIRouter(prefix="/integrations", tags=["integrations"])
# 디스코드 녹음 봇이 사용자 세션 없이 부르는 경로. 라우터 전체를 서비스 토큰으로 막는다.
bot_router = APIRouter(
    prefix="/integrations", tags=["integrations"], dependencies=[Depends(require_service_token)]
)

# Notion callback은 토큰만 저장하고, 대상 DB는 응답 뒤 백그라운드 작업이 찾아 붙인다. 그 작업은 길어야
# WAIT_TIMEOUT_SECONDS 뒤 DB를 붙이거나, 실패하면 토큰을 비운다. 이 시간이 지나도 DB가 없으면 서버 재시작 등으로
# 작업이 사라진 것으로 보고 끊긴 것으로 내려준다.
NOTION_CONNECTING_TIMEOUT = timedelta(seconds=notion_connect.WAIT_TIMEOUT_SECONDS + 60)


def _notion_status(integration: Integration, now: datetime) -> dict:
    """연결 행이 있을 때의 Notion 상태. 행이 없으면(연결한 적 없음, PM이 끊음) 부르지 않는다 — `not_connected`다.

    DB를 찾지 못했거나 찾는 작업이 사라진 연결은 `revoked`로 내려 PM이 다시 연결하게 한다.
    """
    connected = {
        "status": "connected",
        "display_name": "Notion 연결됨",
        "connected_at": integration.created_at.isoformat() if integration.created_at else None,
    }
    if integration.provider_channel_id:
        return connected
    revoked = {"status": "revoked", "display_name": "Notion DB 연결 실패", "connected_at": None}
    if not integration.access_token:
        # DB 찾기가 실패해 토큰을 비웠다(`notion_connect.attach_template_database`).
        return revoked
    updated_at = integration.updated_at
    if updated_at is not None and updated_at.tzinfo is None:
        # SQLite는 시간대 없이 돌려준다. 저장한 값은 UTC다.
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    if updated_at is not None and now - updated_at <= NOTION_CONNECTING_TIMEOUT:
        # 임시: 프론트는 `connecting`을 모르는 값으로 보고 `not_connected`로 바꿔, OAuth 직후 매번 "연결 실패"를 띄운다.
        # 프론트가 받을 준비가 될 때까지 `connected`로 내려준다. 찾는 사이 만든 Task도 DB가 붙으면 반영되므로
        # (`notion_sync`) 표시만 다르다. 프론트가 대응하면 아래로 바꾼다.
        # return {"status": "connecting", "display_name": "Notion 준비 중", "connected_at": None}
        return connected
    return revoked


@router.get("/{workspace_id}/integrations", response_model=Envelope[dict])
def get_integrations(
    workspace_id: str,
    member = Depends(get_current_member),
    db: Session = Depends(get_db)
) -> dict:
    integrations = db.query(Integration).filter(Integration.workspace_id == workspace_id).all()

    resp = {
        "discord": {"status": "not_connected", "display_name": None, "connected_at": None},
        "notion": {"status": "not_connected", "display_name": None, "connected_at": None}
    }

    now = datetime.now(timezone.utc)
    for i in integrations:
        if i.provider == "notion":
            resp["notion"] = _notion_status(i, now)
        elif i.provider in resp:
            resp[i.provider] = {
                "status": "connected",
                "display_name": f"{i.provider.capitalize()} 연결됨",
                "connected_at": i.created_at.isoformat() if i.created_at else None
            }
            
    return success(resp)

@router.delete("/{workspace_id}/integrations/{provider}", status_code=204)
def delete_integration(
    workspace_id: str,
    provider: str,
    member = Depends(get_current_pm),
    db: Session = Depends(get_db)
) -> None:
    integration = db.query(Integration).filter(
        Integration.workspace_id == workspace_id,
        Integration.provider == provider
    ).first()
    
    if integration:
        db.delete(integration)
        db.commit()
    return


@router.get("/{workspace_id}/discord/members", response_model=Envelope[dict])
def list_discord_members(
    workspace_id: str,
    member = Depends(get_current_member),
    db: Session = Depends(get_db)
) -> dict:
    """연결한 Discord 서버의 사용자(봇 포함). 온보딩의 팀원 매핑 화면이 쓴다. 봇은 프론트가 걸러 낸다."""
    integration = db.query(Integration).filter(
        Integration.workspace_id == workspace_id,
        Integration.provider == "discord",
    ).first()
    if integration is None or not integration.provider_channel_id:
        raise AppError(ErrorCode.INTEGRATION_NOT_CONNECTED, details={"provider": "discord"})

    bot_token = os.getenv("DISCORD_BOT_TOKEN", "")
    if not bot_token:
        logger.error("DISCORD_BOT_TOKEN이 없어 Discord 사용자 목록을 읽지 못했습니다")
        raise AppError(
            ErrorCode.DISCORD_API_FAILED, details={"status": None, "reason": "bot_token_missing"}
        )
    try:
        items = discord.list_guild_members(bot_token, integration.provider_channel_id)
    except discord.DiscordApiError as exc:
        # 401은 봇 토큰, 403은 Server Members Intent나 권한, 404는 봇이 서버에 없는 경우가 많다
        logger.warning(
            "Discord 사용자 목록 조회 실패 workspace_id=%s status=%s reason=%s",
            workspace_id, exc.status_code, exc.reason,
        )
        raise AppError(ErrorCode.DISCORD_API_FAILED, details={"status": exc.status_code}) from None
    return success({"items": items, "total": len(items)})


# ---------- OAuth 연결 공통 (start → 제공자 허용 화면 → callback) ----------
#
# 둘 다 페이지 이동으로 들어오므로 결과는 항상 앱 화면으로의 302다
# (`?oauth=<provider>&oauth_result=success|cancelled|failed`). JSON 오류를 띄우지 않는다.
# 제공자 모듈(notion_oauth·discord_oauth)은 sign_state·verify_state·authorize_url·frontend_return_url과
# PROVIDER·NONCE_COOKIE·CALLBACK_PATH를 같은 이름으로 내보낸다.

_PROVIDER_LABELS = {notion_oauth.PROVIDER: "Notion", discord_oauth.PROVIDER: "Discord"}


def _start_connection(
    oauth: ModuleType, workspace_id: str, request: Request, state: str, db: Session
) -> RedirectResponse:
    """PM이면 제공자 허용 화면으로, 아니면 앱 복귀 주소로 실패를 알리며 보낸다."""
    label = _PROVIDER_LABELS[oauth.PROVIDER]
    return_path = oauth_state.safe_return_path(state)
    try:
        user = get_current_user(request, db)
        member = require_member(db, user, workspace_id)
        if member.role != MemberRole.PM:
            raise AppError(ErrorCode.FORBIDDEN, f"Only PM can connect {label}")
        signed_state, nonce = oauth.sign_state(workspace_id, user.user_id, return_path)
        location = oauth.authorize_url(signed_state)
    except AppError as exc:
        logger.warning("%s 연결 시작 실패 reason=%s", label, exc.code)
        return RedirectResponse(oauth.frontend_return_url(return_path, "failed"), status_code=302)
    except oauth_state.OAuthConfigError as exc:
        logger.error("%s 연결 시작 실패 reason=config: %s", label, exc)
        return RedirectResponse(oauth.frontend_return_url(return_path, "failed"), status_code=302)

    response = RedirectResponse(location, status_code=302)
    # state 안의 nonce와 짝을 이루는 쿠키. callback에서 둘을 맞춰 보고 지운다(state 재사용 방지).
    response.set_cookie(
        oauth.NONCE_COOKIE,
        nonce,
        max_age=oauth_state.STATE_TTL_SECONDS,
        path=oauth.CALLBACK_PATH,
        httponly=True,
        secure=True,
        samesite="lax",
    )
    return response


def _finish_callback(oauth: ModuleType, return_path: str, result: str, reason: str) -> RedirectResponse:
    """callback 결과를 로그로 남기고 앱 복귀 주소로 보낸다. 짝 쿠키는 결과와 상관없이 지운다."""
    # 성공·취소는 정상 흐름이라 info, 실패는 이유를 찾을 수 있게 경고로 남긴다.
    log = logger.warning if result == "failed" else logger.info
    log("%s 연결 callback result=%s reason=%s", _PROVIDER_LABELS[oauth.PROVIDER], result, reason)
    response = RedirectResponse(oauth.frontend_return_url(return_path, result), status_code=302)
    # 같은 state로 다시 들어와도 통과하지 못한다.
    response.delete_cookie(oauth.NONCE_COOKIE, path=oauth.CALLBACK_PATH, httponly=True, secure=True, samesite="lax")
    return response


def _check_callback(
    oauth: ModuleType, request: Request, db: Session, state: str, error: str
) -> tuple[oauth_state.StatePayload, Member] | RedirectResponse:
    """callback의 공통 확인. 통과하면 (state 내용, 연결하는 PM)이고, 아니면 앱으로 돌려보낼 응답이다.

    순서: state 서명·만료 → 짝 쿠키 → 제공자 오류(취소) → 로그인 사용자가 시작한 사람인지 → 아직 PM인지.
    """
    try:
        payload = oauth.verify_state(state)
    except oauth_state.OAuthConfigError as exc:
        logger.error("%s 연결 callback 설정 오류: %s", _PROVIDER_LABELS[oauth.PROVIDER], exc)
        return _finish_callback(oauth, "/", "failed", "config")
    if payload is None:
        return _finish_callback(oauth, "/", "failed", "invalid_state")
    path = payload.return_path

    cookie_nonce = request.cookies.get(oauth.NONCE_COOKIE, "")
    if not hmac.compare_digest(cookie_nonce.encode(), payload.nonce.encode()):
        return _finish_callback(oauth, path, "failed", "nonce_mismatch")

    if error:
        # 허용 화면에서 취소하면 access_denied가 온다. error 값은 주소창에서 바꿀 수 있으니 로그에 그대로 남기지 않는다.
        if error == "access_denied":
            return _finish_callback(oauth, path, "cancelled", "access_denied")
        return _finish_callback(oauth, path, "failed", f"{oauth.PROVIDER}_error")

    try:
        user = get_current_user(request, db)
        if user.user_id != payload.user_id:
            return _finish_callback(oauth, path, "failed", "user_mismatch")
        member = require_member(db, user, payload.workspace_id)
    except AppError as exc:
        return _finish_callback(oauth, path, "failed", str(exc.code))
    if member.role != MemberRole.PM:
        return _finish_callback(oauth, path, "failed", "not_pm")
    return payload, member


# ---------- Notion 연결 ----------
#
# callback은 토큰만 저장하고 바로 돌려보낸다. 템플릿 복제가 끝나야 대상 DB를 찾을 수 있어서,
# 그 일은 응답 뒤에 `notion_connect.attach_template_database()`가 한다.


@router.get("/{workspace_id}/integrations/notion/start")
def start_notion_connection(
    workspace_id: str,
    request: Request,
    state: str = "/",
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Notion 허용 화면으로 보낸다. `state`는 끝나고 돌아올 앱 안 경로다(D-158)."""
    return _start_connection(notion_oauth, workspace_id, request, state, db)


@callback_router.get("/notion/callback")
def notion_oauth_callback(
    request: Request,
    background_tasks: BackgroundTasks,
    state: str = "",
    code: str = "",
    error: str = "",
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Notion이 허용(또는 취소) 뒤에 브라우저를 돌려보내는 주소."""
    checked = _check_callback(notion_oauth, request, db, state, error)
    if isinstance(checked, RedirectResponse):
        return checked
    payload, _ = checked
    path = payload.return_path

    def finish(return_path: str, result: str, reason: str) -> RedirectResponse:
        return _finish_callback(notion_oauth, return_path, result, reason)

    if not code:
        return finish(path, "failed", "missing_code")
    try:
        token = notion_oauth.exchange_code(code)
    except (notion_oauth.NotionOAuthError, notion_oauth.OAuthConfigError) as exc:
        logger.warning("Notion 토큰 교환 실패: %s", exc)
        return finish(path, "failed", "token_exchange")

    if token.duplicated_template_id is None:
        # 허용 화면에서 템플릿 대신 기존 페이지를 골랐다. DB를 놓을 곳을 정할 수 없어 받지 않는다.
        return finish(path, "failed", "template_not_used")

    integration = notion.get_notion_integration(db, payload.workspace_id)
    keep_database = False
    if integration is not None and integration.provider_channel_id:
        # 다시 연결: 쓰던 DB를 새 토큰으로도 쓸 수 있으면 그대로 둔다. 이미 반영된 Task 페이지와 이어진다.
        try:
            keep_database = not notion.verify_database_schema(
                token.access_token, integration.provider_channel_id
            )
        except notion.NotionWriteError as exc:
            if exc.retryable:
                # Notion이 잠깐 응답하지 못했다. 쓰던 DB를 못 쓴다고 단정하면 멀쩡한 연결이 새 DB로 바뀌므로
                # 아무것도 바꾸지 않고 실패로 돌려보낸다. 잠시 뒤 다시 연결하면 된다.
                return finish(path, "failed", "verify_database_unavailable")
            keep_database = False
        except Exception:
            # 예상 못 한 응답(예: JSON이 아닌 본문)이다. 500 화면 대신 실패로 돌려보내고 기존 연결은 그대로 둔다.
            logger.exception("Notion 재연결 DB 확인 중 예상하지 못한 오류")
            return finish(path, "failed", "verify_database_error")

    if integration is None:
        integration = Integration(workspace_id=payload.workspace_id, provider="notion")
        db.add(integration)
    integration.access_token = token.access_token
    integration.refresh_token = token.refresh_token
    if not keep_database:
        integration.provider_channel_id = None
    # 이 callback이 정한 DB ID(새 토큰으로 확인한 DB 또는 None)를 UPDATE에 항상 넣는다. 읽을 때와 같은 값이면
    # SQLAlchemy가 이 열을 빼서, 그 사이 다른 callback이나 이전 작업이 쓴 DB ID가 새 토큰과 함께 남을 수 있다.
    flag_modified(integration, "provider_channel_id")
    try:
        db.commit()
    except IntegrityError:
        # 같은 워크스페이스의 callback이 동시에 두 번 들어와 행이 이미 생겼다.
        db.rollback()
        return finish(path, "failed", "concurrent_connect")

    if keep_database:
        return finish(path, "success", "kept_database")
    background_tasks.add_task(
        notion_connect.attach_template_database,
        payload.workspace_id,
        token.access_token,
        token.duplicated_template_id,
    )
    return finish(path, "success", "waiting_for_template")


# ---------- Discord 연결 (봇 초대) ----------
#
# 허용 화면에서 PM이 봇을 들일 서버를 고른다. callback은 code를 토큰으로 바꿔 Discord가 확인해 준 서버 ID를
# integration(provider=discord)의 provider_channel_id에 둔다. 받은 사용자 토큰은 쓰지 않아 저장하지 않는다.
# 서버 사용자 목록은 이 ID와 봇 토큰으로 읽는다(`GET .../discord/members`).


@router.get("/{workspace_id}/integrations/discord/start")
def start_discord_connection(
    workspace_id: str,
    request: Request,
    state: str = "/",
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """봇을 서버에 들이는 Discord 허용 화면으로 보낸다. `state`는 끝나고 돌아올 앱 안 경로다(D-158)."""
    return _start_connection(discord_oauth, workspace_id, request, state, db)


def _discord_guild_owner(db: Session, guild_id: str, workspace_id: str) -> str | None:
    """이 서버를 이미 연결한 다른 워크스페이스. 없으면 None이다."""
    return db.execute(
        select(Integration.workspace_id).where(
            Integration.provider == discord_oauth.PROVIDER,
            Integration.provider_channel_id == guild_id,
            Integration.workspace_id != workspace_id,
        ).limit(1)
    ).scalar_one_or_none()


@callback_router.get("/discord/callback")
def discord_oauth_callback(
    request: Request,
    state: str = "",
    code: str = "",
    error: str = "",
    guild_id: str = "",
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Discord가 봇 초대 허용(또는 취소) 뒤에 브라우저를 돌려보내는 주소."""
    checked = _check_callback(discord_oauth, request, db, state, error)
    if isinstance(checked, RedirectResponse):
        return checked
    payload, _ = checked
    path = payload.return_path

    def finish(result: str, reason: str) -> RedirectResponse:
        return _finish_callback(discord_oauth, path, result, reason)

    if not code:
        return finish("failed", "missing_code")
    try:
        guild = discord_oauth.exchange_code(code)
    except (discord_oauth.DiscordOAuthError, oauth_state.OAuthConfigError) as exc:
        logger.warning("Discord 토큰 교환 실패: %s", exc)
        return finish("failed", "token_exchange")
    # 주소의 guild_id는 사용자가 바꿀 수 있다. Discord가 토큰 응답으로 확인해 준 서버만 믿고, 둘이 다르면 받지 않는다.
    if guild_id and guild_id != guild.guild_id:
        return finish("failed", "guild_mismatch")

    # 한 서버는 한 워크스페이스에만 연결한다. 다른 워크스페이스의 서버를 가져오지 않는다.
    if _discord_guild_owner(db, guild.guild_id, payload.workspace_id) is not None:
        return finish("failed", "guild_already_linked")

    integration = db.query(Integration).filter(
        Integration.workspace_id == payload.workspace_id,
        Integration.provider == discord_oauth.PROVIDER,
    ).first()
    if integration is None:
        integration = Integration(workspace_id=payload.workspace_id, provider=discord_oauth.PROVIDER)
        db.add(integration)
    integration.provider_channel_id = guild.guild_id
    try:
        db.commit()
    except IntegrityError:
        # 같은 서버를 다른 워크스페이스가 동시에 연결했거나, 같은 워크스페이스의 callback이 겹쳐 행이 이미 생겼다.
        db.rollback()
        if _discord_guild_owner(db, guild.guild_id, payload.workspace_id) is not None:
            return finish("failed", "guild_already_linked")
        return finish("failed", "concurrent_connect")
    return finish("success", "connected")


@bot_router.get(
    "/discord/guilds/{guild_id}/workspace",
    response_model=Envelope[DiscordGuildWorkspaceResponse],
)
def get_discord_guild_workspace(guild_id: str, db: Session = Depends(get_db)) -> dict:
    """이 디스코드 서버를 연결한 워크스페이스. 봇이 `/record` 때 회의를 보낼 워크스페이스를 정한다(#180).

    한 서버는 한 워크스페이스에만 연결되므로(uq_integration_discord_guild) 결과는 하나다. 연결이 없으면
    409 `INTEGRATION_NOT_CONNECTED`다. 봇은 이 코드로 "웹에서 서버를 연결해 달라" 고 안내한다.
    """
    workspace_id = db.execute(
        select(Integration.workspace_id).where(
            Integration.provider == discord_oauth.PROVIDER,
            Integration.provider_channel_id == guild_id,
        )
    ).scalar_one_or_none()
    if workspace_id is None:
        raise AppError(
            ErrorCode.INTEGRATION_NOT_CONNECTED, details={"provider": "discord", "guild_id": guild_id}
        )
    return success({"guild_id": guild_id, "workspace_id": workspace_id})
