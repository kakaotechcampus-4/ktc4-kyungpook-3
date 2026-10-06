import json
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_member, get_current_user, require_member, require_pm
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import ApprovalRequest, ApprovalStatus, ApprovalType, ChangeSource, ExtractionItem, Member, Task, TaskStatus, User
from app.schemas.approval import (
    ApprovalCreateRequest,
    ApprovalListResponse,
    ApprovalResolveRequest,
    ApprovalResponse,
)
from app.services.tasks import apply_task_updates, create_task, parse_date

router = APIRouter(prefix="/approvals", tags=["approvals"])

_TASK_UPDATE_FIELDS = {"title", "assignee_member_id", "status", "progress", "blocker", "due_date"}


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


def _comparable(value: object) -> object:
    """task 필드 값을 payload에 저장된 모양(날짜는 ISO 문자열)으로 맞춘다."""
    return value.isoformat() if isinstance(value, date) else value


def _find_conflicts(task: Task, proposed: dict[str, object], base_values: object) -> list[dict]:
    """제안 뒤에 같은 필드가 바뀌었으면 그 필드를 돌려준다.

    지금 값이 제안할 때 비교한 값(base_values)과 다르면 충돌이다. 다만 지금 값이 이미 제안 값과 같으면
    덮어써도 잃는 것이 없으므로 충돌로 보지 않는다. base_values가 없는 요청(이 기능 전에 만들어진 요청,
    수동 생성)과 base_values에 없는 필드는 비교할 기준이 없어 확인하지 않는다.
    """
    if not isinstance(base_values, dict):
        return []
    conflicts = []
    for field, proposed_value in proposed.items():
        if field not in base_values:
            continue
        current = _comparable(getattr(task, field))
        if current != base_values[field] and current != proposed_value:
            conflicts.append({
                "field": field,
                "base": base_values[field],
                "current": current,
                "proposed": proposed_value,
            })
    return conflicts


def _apply_approval(
    db: Session, approval: ApprovalRequest, *, confirm_task_version: int | None = None
) -> None:
    """승인된 요청을 실제 Task 생성/수정으로 반영한다.

    task_update는 제안 뒤에 같은 필드가 바뀌었으면 반영하지 않고 APPROVAL_CONFLICT를 낸다.
    PM이 그 충돌을 본 task 버전(confirm_task_version)을 보내면, task가 그 버전 그대로일 때만 덮어쓴다.
    """
    payload = json.loads(approval.payload)

    if approval.type == str(ApprovalType.TASK_CREATE):
        # Task를 만들기 전에 연결 대상부터 검증한다.
        extraction_item_id = payload.get("extraction_item_id")
        ext_item = (
            _get_linkable_extraction_item(db, approval, extraction_item_id)
            if extraction_item_id
            else None
        )

        # 제목·status·progress 검증은 create_task가 공통으로 수행한다.
        task = create_task(
            db,
            workspace_id=approval.workspace_id,
            title=payload.get("task_title") or payload.get("title") or "",
            meeting_id=payload.get("meeting_id"),
            assignee_member_id=payload.get("assignee_member_id"),
            due_date=parse_date(payload.get("due_date"), field="due_date"),
            status=payload.get("status") or str(TaskStatus.TODO),
            progress=payload.get("progress"),
            change_source=str(ChangeSource.MEETING if payload.get("meeting_id") else ChangeSource.MANUAL),
            changed_by=approval.resolved_by,
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
        # 확인과 반영 사이에 PM의 직접 수정이 끼어들지 않도록 task 행을 커밋까지 잠근다.
        task = db.execute(
            select(Task)
            .where(Task.task_id == approval.related_task_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
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
        conflicts = _find_conflicts(task, updates, payload.get("base_values"))
        # 확인한 뒤에 또 바뀌었으면 PM이 보지 못한 값이라 다시 확인받는다
        if conflicts and confirm_task_version != task.version:
            raise AppError(
                ErrorCode.APPROVAL_CONFLICT,
                details={
                    "approval_id": approval.approval_id,
                    "task_id": task.task_id,
                    "task_version": task.version,
                    "conflicts": conflicts,
                },
            )
        if "due_date" in updates:
            updates["due_date"] = parse_date(updates["due_date"], field="due_date")
        apply_task_updates(
            db,
            task,
            updates,
            change_source=str(ChangeSource.MEETING),
            changed_by=approval.resolved_by,
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
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """승인 요청을 생성한다. 워크스페이스 팀원이면 누구나 만들 수 있다.

    일반 팀원은 할일을 직접 바꾸지 못하고 이 요청으로 PM의 승인을 받는다. 요청자는 바디의 requested_by가
    아니라 로그인한 팀원으로 기록한다. 바디 값을 믿으면 다른 팀원 이름으로 요청을 올릴 수 있다.
    """
    member = require_member(db, user, payload.workspace_id)
    if payload.related_task_id is not None:
        # 승인할 때도 확인하지만(_apply_approval), 다른 워크스페이스의 task를 가리키는 요청이 PM 목록에 쌓이지 않게 먼저 막는다
        task = db.get(Task, payload.related_task_id)
        if task is None:
            raise AppError(ErrorCode.TASK_NOT_FOUND, details={"task_id": payload.related_task_id})
        if task.workspace_id != payload.workspace_id:
            raise AppError(
                ErrorCode.WORKSPACE_MISMATCH,
                details={"approval_workspace_id": payload.workspace_id, "task_workspace_id": task.workspace_id},
            )
    approval = ApprovalRequest(
        workspace_id=payload.workspace_id,
        type=str(payload.type),
        payload=json.dumps(payload.payload, ensure_ascii=False),
        related_task_id=payload.related_task_id,
        requested_by=member.member_id,
    )
    db.add(approval)
    db.commit()
    db.refresh(approval)

    return success(_to_response(approval).model_dump(mode="json"))


@router.get("", response_model=Envelope[ApprovalListResponse])
def list_approvals(
    workspace_id: str = Query(..., description="워크스페이스 ID"),
    status: ApprovalStatus | None = Query(None, description="상태 필터"),
    _member: Member = Depends(get_current_member),
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
def get_approval(
    approval_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """승인 요청 단건을 조회한다."""
    approval = db.get(ApprovalRequest, approval_id)
    if approval is None:
        raise AppError(
            ErrorCode.APPROVAL_NOT_FOUND,
            details={"approval_id": approval_id},
        )
    require_member(db, user, approval.workspace_id)
    return success(_to_response(approval).model_dump(mode="json"))


@router.patch("/{approval_id}", response_model=Envelope[ApprovalResponse])
def resolve_approval(
    approval_id: str,
    payload: ApprovalResolveRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """PM이 승인 요청을 승인/반려한다."""
    if payload.status == ApprovalStatus.PENDING:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="pending 상태로 변경할 수 없습니다.",
        )

    # 상태를 바꾸는 조건부 UPDATE보다 먼저 권한(소속·PM)을 확인해야 권한 없는 요청이 아무것도 바꾸지 못한다.
    target = db.get(ApprovalRequest, approval_id)
    if target is None:
        raise AppError(
            ErrorCode.APPROVAL_NOT_FOUND,
            details={"approval_id": approval_id},
        )
    member = require_pm(db, user, target.workspace_id)

    stmt = (
        update(ApprovalRequest)
        .where(
            ApprovalRequest.approval_id == approval_id,
            ApprovalRequest.status == str(ApprovalStatus.PENDING),
        )
        .values(
            status=str(payload.status),
            resolved_by=member.member_id,
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
        try:
            _apply_approval(db, approval, confirm_task_version=payload.confirm_task_version)
        except AppError:
            # 반영하지 못했으면 승인 처리도 되돌려 pending으로 남긴다. 충돌을 확인한 PM이 다시 처리할 수 있다
            db.rollback()
            raise

    db.commit()
    db.refresh(approval)
    return success(_to_response(approval).model_dump(mode="json"))
