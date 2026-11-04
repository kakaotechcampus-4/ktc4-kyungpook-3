import json
import logging
import uuid
from fastapi import APIRouter, Depends, UploadFile, File, Form
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload
from datetime import datetime, timezone
from typing import Optional

from app.api.deps import get_current_user, get_current_member, require_member, get_current_pm
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import (
    Workspace,
    WorkspaceOnboardingStepState,
    Member,
    MemberRole,
    User,
    Meeting,
    MeetingSource,
    MeetingStatus,
    MeetingUpload,
    OnboardingStep,
    OnboardingStepStatus,
    Source,
)
from app.schemas.meeting import MeetingListResponse
from app.services import upload_storage
from app.schemas.workspace import (
    WorkspaceCreateRequest,
    WorkspaceListResponse,
    WorkspaceResponse,
    WorkspaceOnboardingUpdateRequest,
    WorkspaceOnboarding,
    WorkspaceOnboardingStep
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def _onboarding_statuses(workspace: Workspace) -> dict[OnboardingStep, str]:
    """단계 → 상태. 저장된 행이 없는 단계는 기본값이다. 워크스페이스가 있으면 create_workspace는 끝난 것이다."""
    saved = {state.step: state.status for state in workspace.onboarding_steps}
    return {
        step: saved.get(
            step,
            OnboardingStepStatus.COMPLETED
            if step == OnboardingStep.CREATE_WORKSPACE
            else OnboardingStepStatus.PENDING,
        )
        for step in OnboardingStep
    }


def _build_onboarding(workspace: Workspace) -> WorkspaceOnboarding:
    statuses = _onboarding_statuses(workspace)
    pending = [step for step, status in statuses.items() if status == OnboardingStepStatus.PENDING]
    return WorkspaceOnboarding(
        completed=not pending,
        # 다 끝나면 null이 아니라 빈 문자열이다(계약 4.0)
        current_step=str(pending[0]) if pending else "",
        steps=[WorkspaceOnboardingStep(step=str(step), status=str(status)) for step, status in statuses.items()],
    )


def _build_workspace_response(workspace: Workspace, member: Member | None = None) -> dict:
    data = WorkspaceResponse.model_validate(workspace).model_dump()
    if member:
        data["role"] = member.role
    data["onboarding"] = _build_onboarding(workspace).model_dump()
    return data


@router.post("", status_code=201, response_model=Envelope[WorkspaceResponse])
def create_workspace(
    payload: WorkspaceCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    # 중복 이름 검사 (공백 제거 후 대소문자 무시 비교 등 로직 추가 가능)
    # existing = db.query(Workspace).filter(Workspace.name == payload.name).first()
    # if existing:
    #      raise AppError(ErrorCode.WORKSPACE_NAME_DUPLICATED, details={"msg": "Workspace name duplicated"})

    workspace = Workspace(name=payload.name)
    db.add(workspace)
    db.flush()
    
    # 워크스페이스 생성자를 PM으로 등록
    member = Member(workspace_id=workspace.workspace_id, user_id=user.user_id, display_name=user.name, role=MemberRole.PM)
    db.add(member)
    db.commit()
    db.refresh(workspace)
    
    return success(_build_workspace_response(workspace, member))


@router.get("", response_model=Envelope[WorkspaceListResponse])
def list_workspaces(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> dict:
    # 사용자가 속한 워크스페이스만 조회
    members = db.query(Member).filter(Member.user_id == user.user_id, Member.is_deleted.is_(False)).all()
    workspace_ids = [m.workspace_id for m in members]
    
    if not workspace_ids:
        return success(WorkspaceListResponse(items=[], total=0).model_dump(mode="json"))
        
    # 온보딩 단계를 워크스페이스마다 따로 읽지 않고 한 번에 가져온다
    workspaces = (
        db.query(Workspace)
        .options(selectinload(Workspace.onboarding_steps))
        .filter(Workspace.workspace_id.in_(workspace_ids))
        .order_by(Workspace.created_at.desc())
        .all()
    )
    
    member_by_ws = {m.workspace_id: m for m in members}
    items = [_build_workspace_response(ws, member_by_ws.get(ws.workspace_id)) for ws in workspaces]

    return success(
        WorkspaceListResponse(
            items=items,
            total=len(items),
        ).model_dump(mode="json")
    )


@router.get("/{workspace_id}", response_model=Envelope[WorkspaceResponse])
def get_workspace(
    workspace_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> dict:
    workspace = db.get(Workspace, workspace_id)
    if workspace is None:
        raise AppError(
            ErrorCode.WORKSPACE_NOT_FOUND, details={"workspace_id": workspace_id}
        )

    member = require_member(db, user, workspace_id)
    return success(_build_workspace_response(workspace, member))


@router.patch("/{workspace_id}/onboarding", response_model=Envelope[dict])
def update_onboarding(
    workspace_id: str,
    payload: WorkspaceOnboardingUpdateRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db)
) -> dict:
    # 워크스페이스 행을 커밋까지 잠근다. 같은 공간으로 동시에 온 요청이 같은 단계 행을 두 번 넣거나
    # onboarding_completed를 서로 덮어쓰지 않는다.
    workspace = db.execute(
        select(Workspace)
        .where(Workspace.workspace_id == workspace_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if not workspace:
        raise AppError(ErrorCode.WORKSPACE_NOT_FOUND, details={"workspace_id": workspace_id})

    if member.role != MemberRole.PM:
        raise AppError(ErrorCode.FORBIDDEN, "Only PM can update onboarding status")

    if payload.step == OnboardingStep.CREATE_WORKSPACE and payload.action == "skip":
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            "워크스페이스 생성 단계는 건너뛸 수 없습니다.",
            details={"step": payload.step, "action": payload.action},
        )

    current = _onboarding_statuses(workspace)[payload.step]
    if payload.action == "complete":
        new_status = OnboardingStepStatus.COMPLETED
    else:
        # 이미 끝낸 단계를 건너뜀으로 되돌리지 않는다. FE 재시도로 같은 요청이 다시 와도 200이다
        new_status = OnboardingStepStatus.SKIPPED if current == OnboardingStepStatus.PENDING else current

    state = next((s for s in workspace.onboarding_steps if s.step == payload.step), None)
    if state is None:
        workspace.onboarding_steps.append(
            WorkspaceOnboardingStepState(step=str(payload.step), status=str(new_status))
        )
    else:
        state.status = str(new_status)

    workspace.onboarding_completed = _build_onboarding(workspace).completed
    db.commit()
    # 갱신된 상태는 돌려주지 않는다. FE가 상세를 다시 읽는다(계약 4.2)
    return success({})


@router.get("/{workspace_id}/meetings", response_model=Envelope[MeetingListResponse])
def list_workspace_meetings(
    workspace_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> dict:
    member = db.query(Member).filter(
        Member.workspace_id == workspace_id, Member.user_id == user.user_id, Member.is_deleted.is_(False)
    ).first()
    if not member:
        raise AppError(ErrorCode.FORBIDDEN)
        
    meetings = db.query(Meeting).filter(
        Meeting.workspace_id == workspace_id,
        Meeting.status != MeetingStatus.FAILED
    ).order_by(Meeting.started_at.desc()).all()
    
    # 회의마다 발화를 읽지 않고, 회의별 참석자 수를 한 번에 센다
    attendee_counts = dict(
        db.execute(
            select(Source.meeting_id, func.count(Source.member_id.distinct()))
            .where(Source.meeting_id.in_([m.meeting_id for m in meetings]))
            .group_by(Source.meeting_id)
        ).all()
    ) if meetings else {}

    items = []
    for m in meetings:
        attendee_count = attendee_counts.get(m.meeting_id, 0)
        items.append({
            "meeting_id": m.meeting_id,
            "title": m.title,
            "started_at": m.started_at,
            "source": m.source,
            "status": m.status,
            "duration_ms": m.duration_ms or 0,
            "attendee_count": attendee_count,
            "processed_at": m.ended_at
        })
        
    return success(MeetingListResponse(items=items, total=len(items)).model_dump(mode="json"))


@router.post("/{workspace_id}/meetings/upload", status_code=202, response_model=Envelope[dict])
def upload_meeting(
    workspace_id: str,
    # meeting.title 칼럼 길이. 넘으면 파일을 저장하기 전에 400으로 거절한다
    title: str = Form(..., max_length=200),
    started_at: Optional[datetime] = Form(None),
    # 프론트는 참석자마다 같은 이름의 필드를 반복해 보낸다
    attendee_member_ids: list[str] = Form(...),
    file: UploadFile = File(...),
    member: Member = Depends(get_current_pm),
    db: Session = Depends(get_db)
) -> dict:
    """녹음을 디스크에 저장하고 `processing` 회의와 업로드 정보(`meeting_upload`)를 만든다.

    처음부터 `processing`이라 프론트가 Discord 회의처럼 정리 중으로 추적하고, 끝날 때까지 이 공간의 다음
    업로드는 409다(D-088·D-089). AI가 가져갔는지는 `meeting_upload.claimed_at`으로 가린다.
    녹음을 먼저 저장하고 두 행은 마지막에 함께 커밋한다. 순서는 `upload_storage` 설명 참고.
    """
    processing = db.query(Meeting).filter(
        Meeting.workspace_id == workspace_id, 
        Meeting.status == MeetingStatus.PROCESSING
    ).first()
    if processing:
        raise AppError(
            ErrorCode.MEETING_PROCESSING_IN_PROGRESS,
            details={"meeting_id": processing.meeting_id}
        )

    # 참석자를 고른 뒤 팀원이 삭제됐을 수 있다. 서버에서 다시 확인한다
    attendee_ids = list(dict.fromkeys(attendee_member_ids))
    attendees = {
        m.member_id: m
        for m in db.query(Member).filter(
            Member.workspace_id == workspace_id,
            Member.member_id.in_(attendee_ids),
            Member.is_deleted.is_(False),
        )
    }
    unknown_ids = [member_id for member_id in attendee_ids if member_id not in attendees]
    if unknown_ids:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            message="워크스페이스 팀원이 아닌 참석자가 있습니다.",
            details={"attendee_member_ids": unknown_ids},
        )

    if not upload_storage.is_supported_audio(file.filename, file.file):
        raise AppError(
            ErrorCode.AUDIO_FORMAT_UNSUPPORTED,
            details={"filename": file.filename, "supported": upload_storage.SUPPORTED_EXTENSIONS},
        )

    size_bytes = upload_storage.file_size(file.file)
    max_bytes = upload_storage.max_bytes()
    if size_bytes > max_bytes:
        raise AppError(
            ErrorCode.AUDIO_TOO_LARGE,
            details={"size_bytes": size_bytes, "max_bytes": max_bytes},
        )

    # 같은 순간을 뜻하는 시각(회의 시작 기본값, 정리 시작, 업로드)은 한 번 읽은 값을 같이 쓴다
    now = datetime.now(timezone.utc)
    meeting = Meeting(
        meeting_id=str(uuid.uuid4()),
        workspace_id=workspace_id,
        title=title,
        source=str(MeetingSource.MANUAL_UPLOAD),
        status=str(MeetingStatus.PROCESSING),
        started_at=started_at or now,
        # Discord 회의의 `/end`처럼 녹음이 끝나고 정리를 시작한 시각이다
        ended_at=now,
    )
    upload = MeetingUpload(
        meeting_id=meeting.meeting_id,
        # 칼럼 길이에 맞춘다. 사용자가 보낸 값이라 길어도 업로드를 거절하지 않는다
        original_filename=file.filename[:255] if file.filename else None,
        content_type=file.content_type[:100] if file.content_type else None,
        uploaded_by_member_id=member.member_id,
        uploaded_at=now,
        attendees=json.dumps(
            [
                {"member_id": member_id, "display_name": attendees[member_id].display_name}
                for member_id in attendee_ids
            ],
            ensure_ascii=False,
        ),
    )
    # 녹음을 복사하는 동안(100MiB면 몇 초) DB 연결을 붙잡지 않도록 읽기 트랜잭션을 끝내 풀에 돌려준다.
    # 그 사이 바뀐 것은 아래 커밋 직전 잠금과 재확인이 잡는다
    db.rollback()
    try:
        upload.stored_filename, upload.size_bytes = upload_storage.save_upload(
            meeting.meeting_id, file.file, file.filename
        )
    except OSError:
        logger.exception("업로드 녹음을 저장하지 못했습니다: meeting_id=%s", meeting.meeting_id)
        raise AppError(ErrorCode.AUDIO_UPLOAD_FAILED)

    try:
        # 위의 409 검사는 녹음을 받기 전에 한 번 본 것이라, 같은 공간에 동시에 온 업로드가 둘 다 통과할 수 있다.
        # 워크스페이스 행을 커밋까지 잠그고 다시 확인해 하나만 받는다(SQLite는 FOR UPDATE를 무시한다)
        db.execute(
            select(Workspace.workspace_id)
            .where(Workspace.workspace_id == workspace_id)
            .with_for_update()
        )
        busy_id = db.scalar(
            select(Meeting.meeting_id).where(
                Meeting.workspace_id == workspace_id,
                Meeting.status == str(MeetingStatus.PROCESSING),
            )
        )
        if busy_id is not None:
            raise AppError(ErrorCode.MEETING_PROCESSING_IN_PROGRESS, details={"meeting_id": busy_id})
        db.add_all([meeting, upload])
        db.commit()
    except Exception:
        db.rollback()
        upload_storage.remove_upload(meeting.meeting_id)
        raise

    return success({"meeting_id": meeting.meeting_id, "status": meeting.status})
