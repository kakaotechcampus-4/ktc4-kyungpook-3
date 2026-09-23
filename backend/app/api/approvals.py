import json
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, update
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import ApprovalRequest, ApprovalStatus, ApprovalType, ChangeSource, ExtractionItem, Task, TaskStatus
from app.schemas.approval import (
    ApprovalCreateRequest,
    ApprovalListResponse,
    ApprovalResolveRequest,
    ApprovalResponse,
)
from app.services.tasks import apply_task_updates, create_task, validate_task_fields

router = APIRouter(prefix="/approvals", tags=["approvals"])

_TASK_UPDATE_FIELDS = {"title", "assignee_member_id", "status", "progress", "blocker", "due_date"}


def _parse_date(value: object) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _get_linkable_extraction_item(
    db: Session, approval: ApprovalRequest, extraction_item_id: str
) -> ExtractionItem | None:
    """payload의 extraction_item_id가 이 승인 요청에서 나온 추출 항목인지 검증한다.

    다른 워크스페이스의 추출 항목이나 다른 승인 요청의 추출 항목에
    Task ID가 기록되지 않도록 소속 워크스페이스와 approval_id를 확인한다.
    """
    ext_item = db.get(ExtractionItem, extraction_item_id)
    if ext_item is None:
        return None

    item_workspace_id = ext_item.extraction.meeting.workspace_id
    if item_workspace_id != approval.workspace_id:
        raise AppError(
            ErrorCode.WORKSPACE_MISMATCH,
            message="승인 요청의 워크스페이스와 추출 항목의 워크스페이스가 다릅니다.",
            details={
                "extraction_item_id": extraction_item_id,
                "approval_workspace_id": approval.workspace_id,
                "extraction_item_workspace_id": item_workspace_id,
            },
        )
    if ext_item.approval_id != approval.approval_id:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="추출 항목이 이 승인 요청에 연결되어 있지 않습니다.",
            details={
                "extraction_item_id": extraction_item_id,
                "approval_id": approval.approval_id,
                "extraction_item_approval_id": ext_item.approval_id,
            },
        )
    return ext_item


def _apply_approval(db: Session, approval: ApprovalRequest) -> None:
    """승인된 요청을 실제 Task 생성/수정으로 반영한다."""
    payload = json.loads(approval.payload)

    if approval.type == str(ApprovalType.TASK_CREATE):
        # Task를 만들기 전에 연결 대상부터 검증한다.
        extraction_item_id = payload.get("extraction_item_id")
        ext_item = (
            _get_linkable_extraction_item(db, approval, extraction_item_id)
            if extraction_item_id
            else None
        )

        title = payload.get("task_title") or payload.get("title") or ""
        create_fields: dict[str, object] = {"title": title}
        if payload.get("status") is not None:
            create_fields["status"] = payload["status"]
        if payload.get("progress") is not None:
            create_fields["progress"] = payload["progress"]
        validate_task_fields(create_fields)

        task = create_task(
            db,
            workspace_id=approval.workspace_id,
            title=create_fields["title"],
            meeting_id=payload.get("meeting_id"),
            assignee_member_id=payload.get("assignee_member_id"),
            due_date=_parse_date(payload.get("due_date")),
            status=create_fields.get("status", str(TaskStatus.TODO)),
            progress=create_fields.get("progress"),
            change_source=str(ChangeSource.MEETING if payload.get("meeting_id") else ChangeSource.MANUAL),
            changed_by=approval.resolved_by,
            is_auto=False,
        )
        approval.related_task_id = task.task_id

        if ext_item is not None:
            ext_item.task_id = task.task_id

    elif approval.type == str(ApprovalType.TASK_UPDATE):
        if approval.related_task_id is None:
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                message="task_update 승인 요청에 related_task_id가 없습니다.",
                details={"approval_id": approval.approval_id},
            )
        task = db.get(Task, approval.related_task_id)
        if task is None:
            raise AppError(
                ErrorCode.TASK_NOT_FOUND, details={"task_id": approval.related_task_id}
            )
        if task.workspace_id != approval.workspace_id:
            raise AppError(
                ErrorCode.WORKSPACE_MISMATCH,
                message="승인 요청의 워크스페이스와 대상 태스크의 워크스페이스가 다릅니다.",
                details={
                    "approval_workspace_id": approval.workspace_id,
                    "task_workspace_id": task.workspace_id,
                },
            )
        updates = {k: v for k, v in payload.items() if k in _TASK_UPDATE_FIELDS}
        if "due_date" in updates:
            updates["due_date"] = _parse_date(updates["due_date"])
        apply_task_updates(
            db,
            task,
            updates,
            change_source=str(ChangeSource.MEETING),
            changed_by=approval.resolved_by,
            is_auto=False,
        )

    # REMINDER_DM: 태스크에 반영할 내용이 없다 — 실제 발송은 알림 채널(디스코드 봇)의 책임


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


@router.post("", status_code=201, response_model=Envelope[ApprovalResponse])
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


@router.get("", response_model=Envelope[ApprovalListResponse])
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


@router.get("/{approval_id}", response_model=Envelope[ApprovalResponse])
def get_approval(approval_id: str, db: Session = Depends(get_db)) -> dict:
    """승인 요청 단건을 조회한다."""
    approval = db.get(ApprovalRequest, approval_id)
    if approval is None:
        raise AppError(
            ErrorCode.APPROVAL_NOT_FOUND,
            details={"approval_id": approval_id},
        )
    return success(_to_response(approval).model_dump(mode="json"))


@router.patch("/{approval_id}", response_model=Envelope[ApprovalResponse])
def resolve_approval(
    approval_id: str,
    payload: ApprovalResolveRequest,
    db: Session = Depends(get_db),
) -> dict:
    """PM이 승인 요청을 승인/반려한다."""
    if payload.status == ApprovalStatus.PENDING:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="pending 상태로 변경할 수 없습니다.",
        )

    stmt = (
        update(ApprovalRequest)
        .where(
            ApprovalRequest.approval_id == approval_id,
            ApprovalRequest.status == str(ApprovalStatus.PENDING),
        )
        .values(
            status=str(payload.status),
            resolved_by=payload.resolved_by,
            resolved_at=datetime.now(timezone.utc),
        )
    )
    result = db.execute(stmt)

    if result.rowcount == 0:
        approval = db.get(ApprovalRequest, approval_id)
        if approval is None:
            raise AppError(
                ErrorCode.APPROVAL_NOT_FOUND,
                details={"approval_id": approval_id},
            )
        raise AppError(
            ErrorCode.APPROVAL_ALREADY_RESOLVED,
            details={"approval_id": approval_id, "current_status": approval.status},
        )

    approval = db.get(ApprovalRequest, approval_id)

    if payload.status == ApprovalStatus.APPROVED:
        _apply_approval(db, approval)

    db.commit()
    db.refresh(approval)
    return success(_to_response(approval).model_dump(mode="json"))
