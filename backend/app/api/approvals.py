import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError, ErrorCode, success
from app.models import ApprovalRequest, ApprovalStatus
from app.schemas.approval import (
    ApprovalCreateRequest,
    ApprovalListResponse,
    ApprovalResolveRequest,
    ApprovalResponse,
)

router = APIRouter(prefix="/approvals", tags=["approvals"])


def _to_response(row: ApprovalRequest) -> ApprovalResponse:
    """DB 모델 → Pydantic 응답 변환. payload JSON 파싱 포함."""
    return ApprovalResponse(
        approval_id=row.approval_id,
        workspace_id=row.workspace_id,
        type=row.type,
        payload=json.loads(row.payload),
        related_task_id=row.related_task_id,
        requested_by=row.requested_by,
        status=row.status,
        resolved_by=row.resolved_by,
        created_at=row.created_at,
        resolved_at=row.resolved_at,
    )


@router.post("", status_code=201)
def create_approval(
    payload: ApprovalCreateRequest,
    db: Session = Depends(get_db),
) -> dict:
    """승인 요청을 생성한다 (AI → BE)."""
    approval = ApprovalRequest(
        workspace_id=payload.workspace_id,
        type=str(payload.type),
        payload=json.dumps(payload.payload, ensure_ascii=False),
        related_task_id=payload.related_task_id,
        requested_by=payload.requested_by,
    )
    db.add(approval)
    db.commit()
    db.refresh(approval)

    return success(_to_response(approval).model_dump(mode="json"))


@router.get("")
def list_approvals(
    workspace_id: str = Query(..., description="워크스페이스 ID"),
    status: ApprovalStatus | None = Query(None, description="상태 필터"),
    db: Session = Depends(get_db),
) -> dict:
    """승인 요청 목록을 조회한다. status 로 필터 가능."""
    stmt = select(ApprovalRequest).where(
        ApprovalRequest.workspace_id == workspace_id
    )
    if status is not None:
        stmt = stmt.where(ApprovalRequest.status == str(status))
    stmt = stmt.order_by(ApprovalRequest.created_at.desc())

    rows = db.execute(stmt).scalars().all()

    count_stmt = select(func.count()).select_from(ApprovalRequest).where(
        ApprovalRequest.workspace_id == workspace_id
    )
    if status is not None:
        count_stmt = count_stmt.where(ApprovalRequest.status == str(status))
    total = db.execute(count_stmt).scalar() or 0

    return success(
        ApprovalListResponse(
            items=[_to_response(r) for r in rows],
            total=total,
        ).model_dump(mode="json")
    )


@router.get("/{approval_id}")
def get_approval(approval_id: str, db: Session = Depends(get_db)) -> dict:
    """승인 요청 단건을 조회한다."""
    approval = db.get(ApprovalRequest, approval_id)
    if approval is None:
        raise AppError(
            ErrorCode.APPROVAL_NOT_FOUND,
            details={"approval_id": approval_id},
        )
    return success(_to_response(approval).model_dump(mode="json"))


@router.patch("/{approval_id}")
def resolve_approval(
    approval_id: str,
    payload: ApprovalResolveRequest,
    db: Session = Depends(get_db),
) -> dict:
    """PM이 승인 요청을 승인/반려한다."""
    approval = db.get(ApprovalRequest, approval_id)
    if approval is None:
        raise AppError(
            ErrorCode.APPROVAL_NOT_FOUND,
            details={"approval_id": approval_id},
        )

    if approval.status != str(ApprovalStatus.PENDING):
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="이미 처리된 승인 요청입니다.",
            details={"current_status": approval.status},
        )

    if payload.status == ApprovalStatus.PENDING:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="pending 상태로 변경할 수 없습니다.",
        )

    from datetime import datetime, timezone

    approval.status = str(payload.status)
    approval.resolved_by = payload.resolved_by
    approval.resolved_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(approval)

    return success(_to_response(approval).model_dump(mode="json"))
