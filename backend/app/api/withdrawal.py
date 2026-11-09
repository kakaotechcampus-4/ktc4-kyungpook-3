from dataclasses import asdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_service_token
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import User
from app.schemas.withdrawal import (
    PrivacyCleanupAck, PrivacyCleanupAckResponse, PrivacyCleanupClaimResponse,
    WithdrawalPlanResponse, WithdrawalResponse,
)
from app.services import account_withdrawal, discord_oauth, kakao_oauth, notion_oauth, sessions

router = APIRouter(tags=["withdrawal"])
bot_router = APIRouter(prefix="/bot/privacy-cleanups", tags=["privacy-cleanup"], dependencies=[Depends(require_service_token)])


@router.get("/auth/withdrawal-plan", response_model=Envelope[WithdrawalPlanResponse])
def withdrawal_plan(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    result = account_withdrawal.plan(db, user.user_id)
    return success({"workspaces": [asdict(row) for row in result.workspaces], "blocked_workspace_ids": list(result.blocked_workspace_ids)})


@router.delete("/auth/me", status_code=202, response_model=Envelope[WithdrawalResponse])
def withdraw(
    request: Request, response: Response,
    x_withdrawal_key: str = Header(..., min_length=32, max_length=128),
    x_withdrawal_account_id: str | None = Header(None),
    db: Session = Depends(get_db),
) -> dict:
    db.info["read_only_request"] = False
    prior = account_withdrawal.find_receipt(db, x_withdrawal_key)
    if prior is not None:
        # 다른 계정으로 로그인한 뒤 옛 영수증을 재요청해도 그 계정의 쿠키는 만지지 않는다.
        return success(prior.model_dump(mode="json"))
    if not x_withdrawal_account_id:
        raise AppError(ErrorCode.INVALID_REQUEST, message="탈퇴할 계정 식별자가 필요합니다.")
    session = sessions.find_session(db, request.cookies.get("session_token", ""))
    if session is None:
        raise AppError(ErrorCode.UNAUTHENTICATED)
    until = session.expires_at
    if (until.replace(tzinfo=timezone.utc) if until.tzinfo is None else until) <= datetime.now(timezone.utc):
        raise AppError(ErrorCode.UNAUTHENTICATED)
    if session.user_id != x_withdrawal_account_id:
        raise AppError(ErrorCode.WITHDRAWAL_ACCOUNT_CHANGED)
    result = account_withdrawal.withdraw(db, session.user_id, x_withdrawal_key)
    response.delete_cookie("session_token", secure=True, httponly=True, samesite="lax")
    response.delete_cookie(kakao_oauth.PENDING_COOKIE, path=kakao_oauth.PENDING_PATH, secure=True, httponly=True, samesite="lax")
    for oauth in (kakao_oauth, discord_oauth, notion_oauth):
        response.delete_cookie(oauth.NONCE_COOKIE, path=oauth.CALLBACK_PATH, secure=True, httponly=True, samesite="lax")
    return success(result.model_dump(mode="json"))


@router.get("/auth/withdrawals/{withdrawal_id}", response_model=Envelope[WithdrawalResponse])
def withdrawal_receipt(withdrawal_id: str, x_withdrawal_key: str = Header(..., min_length=32, max_length=128), db: Session = Depends(get_db)) -> dict:
    result = account_withdrawal.find_receipt(db, x_withdrawal_key, withdrawal_id)
    if result is None:
        raise AppError(ErrorCode.UNAUTHENTICATED)
    return success(result.model_dump(mode="json"))


@bot_router.post("/claim", response_model=Envelope[PrivacyCleanupClaimResponse])
def claim(db: Session = Depends(get_db)) -> dict:
    return success({"item": account_withdrawal.claim_cleanup(db)})


@bot_router.post("/{cleanup_id}/ack", response_model=Envelope[PrivacyCleanupAckResponse])
def ack(cleanup_id: str, body: PrivacyCleanupAck, db: Session = Depends(get_db)) -> dict:
    return success(account_withdrawal.ack_cleanup(db, cleanup_id, body.claim_token))
