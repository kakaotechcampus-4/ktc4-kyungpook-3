import hmac
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Integration, MemberRole
from app.api.deps import get_current_member, get_current_user, require_member
from app.services import notion, notion_connect, notion_oauth

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces", tags=["integrations"])
# OAuth callback 전용. Notion에 등록하는 redirect URI는 한 글자도 달라질 수 없어서 workspace_id를 넣지 못한다.
# 그래서 `/workspaces/{id}/...` 아래가 아닌 고정 경로에 두고, 어느 워크스페이스인지는 서명한 state에서 꺼낸다.
callback_router = APIRouter(prefix="/integrations", tags=["integrations"])

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
    
    for i in integrations:
        if i.provider in resp:
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
    member = Depends(get_current_member),
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
    integration = db.query(Integration).filter(
        Integration.workspace_id == workspace_id,
        Integration.provider == "discord",
    ).first()
    if integration is None:
        raise AppError(ErrorCode.INTEGRATION_NOT_CONNECTED, details={"provider": "discord"})

    # 향후 Discord API 연동 시 실제 멤버 목록으로 교체
    items = [
        {"discord_user_id": "disc_01", "username": "discordUser1", "display_name": "Discord User 1", "avatar_url": None, "is_bot": False},
        {"discord_user_id": "disc_02", "username": "discordUser2", "display_name": "Discord User 2", "avatar_url": None, "is_bot": False},
    ]
    return success({"items": items, "total": len(items)})


# ---------- Notion OAuth 연결 (start → Notion 허용 화면 → callback) ----------
#
# 둘 다 페이지 이동으로 들어오므로 결과는 항상 앱 화면으로의 302다
# (`?oauth=notion&oauth_result=success|cancelled|failed`). JSON 오류를 띄우지 않는다.
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
    return_path = notion_oauth.safe_return_path(state)
    try:
        user = get_current_user(request, db)
        member = require_member(db, user, workspace_id)
        if member.role != MemberRole.PM:
            raise AppError(ErrorCode.FORBIDDEN, "Only PM can connect Notion")
        signed_state, nonce = notion_oauth.sign_state(workspace_id, user.user_id, return_path)
        location = notion_oauth.authorize_url(signed_state)
    except AppError as exc:
        logger.info("Notion 연결 시작 실패 reason=%s", exc.code)
        return RedirectResponse(notion_oauth.frontend_return_url(return_path, "failed"), status_code=302)
    except notion_oauth.OAuthConfigError as exc:
        logger.error("Notion 연결 시작 실패 reason=config: %s", exc)
        return RedirectResponse(notion_oauth.frontend_return_url(return_path, "failed"), status_code=302)

    response = RedirectResponse(location, status_code=302)
    # state 안의 nonce와 짝을 이루는 쿠키. callback에서 둘을 맞춰 보고 지운다(state 재사용 방지).
    response.set_cookie(
        notion_oauth.NONCE_COOKIE,
        nonce,
        max_age=notion_oauth.STATE_TTL_SECONDS,
        path=notion_oauth.CALLBACK_PATH,
        httponly=True,
        secure=True,
        samesite="lax",
    )
    return response


def _finish_notion_callback(return_path: str, result: str, reason: str) -> RedirectResponse:
    logger.info("Notion 연결 callback result=%s reason=%s", result, reason)
    response = RedirectResponse(notion_oauth.frontend_return_url(return_path, result), status_code=302)
    # 결과와 상관없이 짝 쿠키를 지운다. 같은 state로 다시 들어와도 통과하지 못한다.
    response.delete_cookie(
        notion_oauth.NONCE_COOKIE, path=notion_oauth.CALLBACK_PATH, httponly=True, secure=True, samesite="lax"
    )
    return response


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
    finish = _finish_notion_callback
    try:
        payload = notion_oauth.verify_state(state)
    except notion_oauth.OAuthConfigError as exc:
        logger.error("Notion 연결 callback 설정 오류: %s", exc)
        return finish("/", "failed", "config")
    if payload is None:
        return finish("/", "failed", "invalid_state")
    path = payload.return_path

    cookie_nonce = request.cookies.get(notion_oauth.NONCE_COOKIE, "")
    if not hmac.compare_digest(cookie_nonce.encode(), payload.nonce.encode()):
        return finish(path, "failed", "nonce_mismatch")

    if error:
        # 허용 화면에서 취소하면 access_denied가 온다. error 값은 주소창에서 바꿀 수 있으니 로그에 그대로 남기지 않는다.
        if error == "access_denied":
            return finish(path, "cancelled", "access_denied")
        return finish(path, "failed", "notion_error")

    try:
        user = get_current_user(request, db)
        if user.user_id != payload.user_id:
            return finish(path, "failed", "user_mismatch")
        member = require_member(db, user, payload.workspace_id)
    except AppError as exc:
        return finish(path, "failed", str(exc.code))
    if member.role != MemberRole.PM:
        return finish(path, "failed", "not_pm")

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
        except notion.NotionWriteError:
            keep_database = False

    if integration is None:
        integration = Integration(workspace_id=payload.workspace_id, provider="notion")
        db.add(integration)
    integration.access_token = token.access_token
    integration.refresh_token = token.refresh_token
    if not keep_database:
        integration.provider_channel_id = None
        # 읽을 때 이미 None이었으면 SQLAlchemy가 UPDATE에서 이 열을 뺀다. 그 사이 이전 작업이 저장한 DB ID도 확실히 비운다.
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
