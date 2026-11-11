import hashlib
import json
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_member, get_current_user, require_member, require_pm
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import ApprovalRequest, ApprovalStatus, ApprovalType, AsrTitleQueue, ChangeSource, ExtractionItem, Meeting, MeetingSource, Member, MemberRole, Task, TaskStatus, User
from app.schemas.approval import (
    ApprovalCreateRequest,
    ApprovalListResponse,
    ApprovalResolveRequest,
    ApprovalResponse,
)
from app.services import replies
from app.services.alias_learning import (
    alias_lookup_forms,
    approval_alias_texts,
    learn_alias,
    learnable_alias_text,
)
from app.services.pending_merge import assignee_item_of
from app.services.tasks import (
    apply_task_updates,
    create_task,
    log_manual_edit,
    log_scope_change,
    parse_date,
    validate_task_fields,
)

router = APIRouter(prefix="/approvals", tags=["approvals"])

_TASK_UPDATE_FIELDS = {"title", "assignee_member_id", "status", "blocker", "due_date"}

# 승인하면서 PM이 고칠 수 있는 필드. 승인 유형마다 다르다
# 예외: 담당자 줄이 있는 답장 카드(task_update)는 assignee_member_id 도 고칠 수 있다(_normalize_overrides)
_EDITABLE_FIELDS: dict[str, frozenset[str]] = {
    str(ApprovalType.TASK_CREATE): frozenset({"task_title", "assignee_member_id", "due_date"}),
    str(ApprovalType.TASK_UPDATE): frozenset({"status", "due_date"}),
}
# null 은 "미정"으로 두겠다는 뜻이다. 값이 꼭 있어야 하는 필드(task_title, status)는 null 을 받지 않는다
_UNDETERMINABLE_FIELDS = frozenset({"due_date", "assignee_member_id"})

# 제안에 그 필드가 없다는 표시. 제안이 null 인 것과 구분한다
_ABSENT = object()


def _change_source(db: Session, meeting_id: str | None, default: ChangeSource) -> str:
    """채팅 회의에서 나온 항목이면 이력 출처를 chat으로, 아니면 default로 남긴다."""
    meeting = db.get(Meeting, meeting_id) if meeting_id else None
    return str(ChangeSource.CHAT if meeting and meeting.source == MeetingSource.CHAT else default)


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


def _normalize_edit(field: str, value: object) -> object:
    """고친 값 하나를 검증하고 payload에 저장하는 모양(날짜는 ISO 문자열)으로 맞춘다."""
    if value is None:
        if field not in _UNDETERMINABLE_FIELDS:
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                message=f"{field}는 미정(null)으로 둘 수 없습니다.",
                details={"field": field},
            )
        return None
    if field == "due_date":
        return parse_date(value, field=field).isoformat()
    if field == "assignee_member_id":
        if not isinstance(value, str):
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                message="assignee_member_id는 문자열이어야 합니다.",
                details={"field": field},
            )
        return value
    # task_title 은 Task.title 과 같은 검증을 받는다
    key = "title" if field == "task_title" else field
    checked = {key: value}
    validate_task_fields(checked)
    return checked[key]


def _normalize_overrides(
    db: Session, approval: ApprovalRequest, status: ApprovalStatus, overrides: dict[str, object] | None
) -> dict[str, object]:
    """승인하면서 고친 값을 검증한다. 상태를 바꾸기 전에 불러야 잘못된 요청이 아무것도 커밋하지 못한다."""
    if not overrides:
        return {}
    if status != ApprovalStatus.APPROVED:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="고친 값(task_overrides)은 승인할 때만 보낼 수 있습니다.",
            details={"status": str(status)},
        )
    approval_type = approval.type
    allowed = _EDITABLE_FIELDS.get(approval_type, frozenset())
    # 담당자 줄이 있는 답장 카드만 PM 이 담당자를 고를 수 있다. 키가 없으면 줄을 찾지 않는다
    if (
        approval_type == str(ApprovalType.TASK_UPDATE)
        and "assignee_member_id" in overrides
        and replies.has_assignee_line(db, approval.approval_id)
    ):
        allowed = allowed | {"assignee_member_id"}
    outside = sorted(set(overrides) - allowed)
    if outside:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message=f"{approval_type} 승인에서 고칠 수 없는 필드입니다: {', '.join(outside)}",
            details={"fields": outside, "allowed": sorted(allowed)},
        )
    return {field: _normalize_edit(field, value) for field, value in overrides.items()}


def _changed_overrides(overrides: dict[str, object], proposal: dict[str, object]) -> dict[str, object]:
    """고친 값 중 제안과 다른 것만 돌려준다. 제안의 날짜가 형식이 틀려도 비교는 그대로 한다(그 값을 고치는 중일 수 있다)."""
    changed = {}
    for field, value in overrides.items():
        proposed = proposal.get(field, _ABSENT)
        if field == "due_date" and proposed not in (None, _ABSENT):
            try:
                proposed = parse_date(proposed, field=field).isoformat()
            except AppError:
                pass
        if value != proposed:
            changed[field] = value
    return changed


def _comparable(value: object) -> object:
    """task 필드 값을 payload에 저장된 모양(날짜는 ISO 문자열)으로 맞춘다."""
    return value.isoformat() if isinstance(value, date) else value


def _find_conflicts(task: Task, proposed: dict[str, object], base_values: object) -> list[dict]:
    """제안 뒤에 같은 필드가 바뀌었으면 그 필드를 돌려준다.

    지금 값이 제안할 때 비교한 값(base_values)과 다르면 충돌이다. 다만 지금 값이 이미 제안 값과 같으면
    덮어써도 잃는 것이 없으므로 충돌로 보지 않는다. base_values가 없는 요청(이 기능 전에 만들어진 요청,
    base_values를 보내지 않은 수동 생성)과 base_values에 없는 필드는 비교할 기준이 없어 확인하지 않는다.
    수동 생성(POST /approvals)은 받은 payload를 그대로 저장하므로 base_values를 보내면 확인한다.
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


def _find_target_change(task: Task, base_title: object) -> dict | None:
    """AI가 이 task를 고를 때 본 제목(base_title)과 지금 제목이 다르면 충돌 항목을 돌려준다(#185).

    제목은 바꿀 값이 아니라 대상 확인용이라 _find_conflicts와 따로 본다. 제안 값이 없으므로
    "이미 제안 값과 같으면 충돌 아님" 예외도 없다. 다르면 항상 PM이 다시 확인한다.
    base_title이 없는 요청(이 기능 전에 만들어진 요청, base_title을 보내지 않은 수동 생성)은 기준이 없어
    확인하지 않는다. 수동 생성도 payload에 base_title을 넣으면 확인한다.
    앞뒤 공백만 다른 제목은 같은 업무로 보고 묻지 않는다. 제목은 저장할 때 공백을 지우지 않는다.
    """
    if not isinstance(base_title, str) or task.title.strip() == base_title.strip():
        return None
    # 다른 충돌 항목과 모양을 맞춘다. 제목은 제안하지 않으므로 proposed는 null이다
    return {"field": "title", "base": base_title, "current": task.title, "proposed": None}


def _apply_approval(
    db: Session,
    approval: ApprovalRequest,
    *,
    overrides: dict[str, object],
    confirm_task_version: int | None = None,
    save_alias: bool = False,
) -> None:
    """승인된 요청을 실제 Task 생성/수정으로 반영한다.

    overrides는 _normalize_overrides를 거친, PM이 승인하면서 고친 값이다. 제안과 다른 것만 제안 대신 쓰고,
    task 이력에 PM이 직접 바꾼 것으로 남기고, payload.task_overrides에 저장한다. 원래 제안은 payload에 그대로 둔다.
    task_update는 제안 뒤에 같은 필드가 바뀌었으면 반영하지 않고 APPROVAL_CONFLICT를 낸다.
    PM이 그 충돌을 본 task 버전(confirm_task_version)을 보내면, task가 그 버전 그대로일 때만 덮어쓴다.
    """
    payload = json.loads(approval.payload)
    changed: dict[str, object] = {}

    if approval.type == str(ApprovalType.TASK_CREATE):
        # Task를 만들기 전에 연결 대상부터 검증한다.
        extraction_item_id = payload.get("extraction_item_id")
        if extraction_item_id:
            _get_linkable_extraction_item(db, approval, extraction_item_id)

        proposal = {
            "task_title": payload.get("task_title") or payload.get("title") or "",
            "assignee_member_id": payload.get("assignee_member_id"),
            "due_date": payload.get("due_date"),
        }
        changed = _changed_overrides(overrides, proposal)
        final = {**proposal, **changed}

        # 제안으로 먼저 만들고 고치면, PM이 바로잡는 중인 잘못된 담당자·날짜에서 먼저 막힌다. 최종 값으로 한 번에 만든다.
        # 상태는 고르지 않는다. 제안에 status가 실려 있어도 항상 todo다. 제목·status 검증은 create_task가 공통으로 수행한다.
        task = create_task(
            db,
            workspace_id=approval.workspace_id,
            title=final["task_title"],
            meeting_id=payload.get("meeting_id"),
            assignee_member_id=final["assignee_member_id"],
            due_date=parse_date(final["due_date"], field="due_date"),
            status=str(TaskStatus.TODO),
            # PM 이 정한 출처가 먼저다. 없으면 채팅 회의 항목은 chat, 그 밖은 meeting·manual
            change_source=payload.get("change_source")
            or _change_source(
                db,
                payload.get("meeting_id"),
                ChangeSource.MEETING if payload.get("meeting_id") else ChangeSource.MANUAL,
            ),
            changed_by=approval.resolved_by,
            # 제안 제목은 검증하지 않은 payload 값이라 문자열이 아닐 수 있다. 이력 칸에 맞게 문자열로 남긴다
            history_title=str(proposal["task_title"]),
        )
        for field, new_value in changed.items():
            old_value = proposal[field]
            # 문자열이 아닌 제안 제목은 되돌릴 값이 못 된다. None 이면 되돌리기가 최초 생성 이력으로 보고 막는다
            if field == "task_title" and not isinstance(old_value, str):
                old_value = None
            log_manual_edit(
                db, task, "title" if field == "task_title" else field,
                old_value=None if old_value is None else str(old_value),
                new_value=None if new_value is None else str(new_value),
                changed_by=approval.resolved_by,
            )
        approval.related_task_id = task.task_id
        # PM 이 확인한 최종 제목을 AI 가 받아 명사를 용어 목록에 올린다(#532). 승인이 되돌려지면 함께 사라진다
        db.add(AsrTitleQueue(workspace_id=approval.workspace_id, title=task.title))

        # 합쳐진 항목(action="merge")도 같은 카드에서 나왔으므로 카드가 만든 task 를 함께 가리킨다
        linked_items = db.execute(
            select(ExtractionItem).where(ExtractionItem.approval_id == approval.approval_id)
        ).scalars().all()
        for linked in linked_items:
            linked.task_id = task.task_id
        # 별칭은 카드의 담당자를 정한 항목에서만 배운다. payload 의 assignee_item_id 가 이 카드의 연결 항목이
        # 아니면(위조·다른 카드) 무시한다. create_task 가 담당자(탈퇴·다른 공간)를 검증한 뒤에 저장하고,
        # 담당자를 못 고른 카드는 건너뛴다
        alias_item = next((i for i in linked_items if i.item_id == assignee_item_of(payload)), None)
        if alias_item is not None and save_alias and final["assignee_member_id"]:
            alias_text = learnable_alias_text(alias_item)
            if alias_text is not None:
                learn_alias(
                    db,
                    workspace_id=approval.workspace_id,
                    member_id=final["assignee_member_id"],
                    alias_text=alias_text,
                    lookup_forms=alias_lookup_forms(alias_item.assignee_raw, alias_text),
                )

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
        if task is None or task.is_deleted:
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
        changed = _changed_overrides(overrides, updates)
        # 충돌은 PM이 최종으로 정한 값 기준으로 본다. 지금 값이 그 값과 같으면 덮어써도 잃는 것이 없다
        conflicts = _find_conflicts(task, {**updates, **changed}, payload.get("base_values"))
        target_change = _find_target_change(task, payload.get("base_title"))
        if target_change is not None:
            conflicts.append(target_change)
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
        proposed = {k: v for k, v in updates.items() if k not in changed}
        if "due_date" in proposed:
            proposed["due_date"] = parse_date(proposed["due_date"], field="due_date")
        source = payload.get("change_source") or _change_source(
            db, payload.get("meeting_id"), ChangeSource.MEETING
        )
        entries = apply_task_updates(
            db,
            task,
            proposed,
            change_source=source,
            changed_by=approval.resolved_by,
        )
        edited = dict(changed)
        if edited.get("due_date") is not None:
            edited["due_date"] = parse_date(edited["due_date"], field="due_date")
        entries += apply_task_updates(
            db,
            task,
            edited,
            change_source=str(ChangeSource.MANUAL),
            changed_by=approval.resolved_by,
        )
        if payload.get("category") == "scope":
            doc_text = payload.get("doc_text")
            text = doc_text.strip() if isinstance(doc_text, str) else ""
            entries.append(
                log_scope_change(
                    db,
                    task,
                    new_value=text or None,
                    change_source=source,
                    changed_by=approval.resolved_by,
                )
            )
        if payload.get("change_source") == str(ChangeSource.REMINDER_REPLY):
            replies.link_history(db, approval.approval_id, entries)

    if changed:
        approval.payload = json.dumps({**payload, "task_overrides": changed}, ensure_ascii=False)


def _payload_version(row: ApprovalRequest) -> str | None:
    """task_create 카드의 payload 지문. 합치기가 payload 를 바꾸면 값이 달라져 승인 화면의 낡은 내용을 알아챈다."""
    if row.type != str(ApprovalType.TASK_CREATE):
        return None
    return hashlib.sha256(row.payload.encode("utf-8")).hexdigest()[:16]


def _to_response(row: ApprovalRequest, alias_text: str | None = None) -> ApprovalResponse:
    """DB 모델 → Pydantic 응답 변환. payload JSON 파싱 포함.

    alias_text 는 approval_alias_texts 가 구한 값이다. 있으면 별칭 등록을 물어볼 승인이다.
    """
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
        payload_version=_payload_version(row),
        alias_candidate=alias_text is not None,
        alias_text=alias_text,
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
    from app.services.meeting_deletion import require_live_meeting
    merged = payload.payload.get("merged_items")
    if merged is not None and (
        not isinstance(merged, list) or any(not isinstance(part, dict) for part in merged)
    ):
        raise AppError(ErrorCode.INVALID_REQUEST, details={"field": "merged_items"})
    parts = [payload.payload, *(merged or [])]
    meeting_ids = set()
    for part in parts:
        meeting_id = part.get("meeting_id")
        if meeting_id is None:
            continue
        if not isinstance(meeting_id, str) or not meeting_id:
            raise AppError(ErrorCode.INVALID_REQUEST, details={"field": "meeting_id"})
        meeting_ids.add(meeting_id)
    roots = set()
    for meeting_id in sorted(meeting_ids):
        meeting = require_live_meeting(db, meeting_id)
        if meeting.workspace_id != payload.workspace_id:
            raise AppError(ErrorCode.WORKSPACE_MISMATCH)
        roots.add(meeting.recording_root_id or meeting.meeting_id)
    # 삭제도 root부터 잠근다. payload 순서는 같은 녹음 계보의 잠금 순서를 바꿀 수 없다.
    for root_id in sorted(roots):
        require_live_meeting(db, root_id, lock=True)
    for meeting_id in sorted(meeting_ids):
        require_live_meeting(db, meeting_id, lock=True)
    # task_overrides는 승인하는 PM의 요청에서만 받는다. 요청 단계에서 미리 넣어 두면 PM이 고친 값처럼 읽힐 수 있다
    if "task_overrides" in payload.payload:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="payload에 task_overrides를 넣을 수 없습니다. 고친 값은 승인할 때 보냅니다.",
            details={"field": "task_overrides"},
        )
    # 반영할 때 이력의 출처로 그대로 쓰므로 들어올 때 걸러 둔다
    change_source = payload.payload.get("change_source")
    if change_source is not None and change_source not in [str(s) for s in ChangeSource]:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message=f"유효하지 않은 change_source 값입니다: {change_source}",
            details={"field": "change_source", "allowed": sorted(str(s) for s in ChangeSource)},
        )
    # 일반 팀원이 회의나 답장에서 나온 변경처럼 이력을 남기지 못하게 한다. 출처를 정하는 쪽은 PM 과 서버 경로뿐이다
    if change_source is not None and member.role != MemberRole.PM:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="change_source는 PM만 정할 수 있습니다.",
            details={"field": "change_source"},
        )
    if payload.related_task_id is not None:
        # 승인할 때도 확인하지만(_apply_approval), 다른 워크스페이스의 task를 가리키는 요청이 PM 목록에 쌓이지 않게 먼저 막는다
        # auto 되돌리기(revert_auto_item)가 이 task를 지우는 중이면 끝날 때까지 기다린다. 잠그지 않으면 지운 task를
        # 가리키는 승인 요청이 남아, 승인할 때마다 TASK_NOT_FOUND가 된다
        task = db.execute(
            select(Task)
            .where(Task.task_id == payload.related_task_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if task is None or task.is_deleted:
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

    texts = approval_alias_texts(db, [approval])
    return success(_to_response(approval, texts.get(approval.approval_id)).model_dump(mode="json"))


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

    texts = approval_alias_texts(db, rows)
    return success(
        ApprovalListResponse(
            items=[_to_response(r, texts.get(r.approval_id)) for r in rows],
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
    texts = approval_alias_texts(db, [approval])
    return success(_to_response(approval, texts.get(approval.approval_id)).model_dump(mode="json"))


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
    db.refresh(target)
    source_payload = target.payload
    source_parts = json.loads(source_payload)
    source_parts = [source_parts, *(source_parts.get('merged_items') or [])]
    source_ids = {part.get('meeting_id') for part in source_parts if isinstance(part, dict) and part.get('meeting_id')}
    roots = set()
    for source_id in source_ids:
        source_meeting = db.get(Meeting, source_id)
        if source_meeting is not None:
            roots.add(source_meeting.recording_root_id or source_meeting.meeting_id)
    if roots:
        db.scalars(select(Meeting).where(Meeting.meeting_id.in_(roots)).order_by(Meeting.meeting_id)
                   .with_for_update().execution_options(populate_existing=True)).all()
        db.refresh(target)
        if target.payload != source_payload:
            raise AppError(ErrorCode.APPROVAL_CHANGED)
    # 이미 처리한 카드에는 고친 값이 틀렸다는 안내보다 처리됐다는 안내가 맞다. 경합은 아래 조건부 UPDATE 가 막는다
    if target.status != str(ApprovalStatus.PENDING):
        raise AppError(
            ErrorCode.APPROVAL_ALREADY_RESOLVED,
            details={"approval_id": approval_id, "current_status": target.status},
        )
    overrides = _normalize_overrides(db, target, payload.status, payload.task_overrides)

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

    # 이 세션이 앞서 읽은 객체는 identity map 의 이전 payload 를 들고 있다. 조건부 UPDATE 사이에 합치기가 payload 를
    # 바꿨어도 승인은 DB 의 최신 값으로 task 를 만들어야 한다
    approval = db.get(ApprovalRequest, approval_id)
    db.refresh(approval)

    # 카드를 본 뒤 payload 가 바뀌었으면 승인·반려 모두 되돌리고 새 내용을 보게 한다. refresh 한 값으로 비교해야 한다
    current_version = _payload_version(approval)
    requested_version = payload.payload_version
    if requested_version is not None and current_version is not None and requested_version != current_version:
        db.rollback()
        raise AppError(
            ErrorCode.APPROVAL_CHANGED,
            details={"approval_id": approval_id, "payload_version": current_version},
        )

    if payload.status == ApprovalStatus.APPROVED:
        try:
            _apply_approval(
                db, approval, overrides=overrides,
                confirm_task_version=payload.confirm_task_version, save_alias=payload.save_alias,
            )
        except AppError:
            # 반영하지 못했으면 승인 처리도 되돌려 pending으로 남긴다. 충돌을 확인한 PM이 다시 처리할 수 있다
            db.rollback()
            raise

    db.commit()
    db.refresh(approval)
    texts = approval_alias_texts(db, [approval])
    return success(_to_response(approval, texts.get(approval.approval_id)).model_dump(mode="json"))
