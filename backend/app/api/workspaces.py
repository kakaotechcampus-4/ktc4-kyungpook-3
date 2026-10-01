from fastapi import APIRouter, Depends, UploadFile, File, Form
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from typing import Optional

from app.api.deps import get_current_user, get_current_member, require_member
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import (
    Workspace,
    WorkspaceOnboardingStepState,
    Member,
    MemberRole,
    User,
    Meeting,
    MeetingStatus,
    OnboardingStep,
    OnboardingStepStatus,
    Source,
)
from app.schemas.meeting import MeetingListResponse
from app.schemas.workspace import (
    WorkspaceCreateRequest,
    WorkspaceListResponse,
    WorkspaceResponse,
    WorkspaceOnboardingUpdateRequest,
    WorkspaceOnboarding,
    WorkspaceOnboardingStep
)

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
    existing = db.query(Workspace).filter(Workspace.name == payload.name).first()
    if existing:
         raise AppError(ErrorCode.WORKSPACE_NAME_DUPLICATED, details={"msg": "Workspace name duplicated"})

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
        
    workspaces = db.query(Workspace).filter(Workspace.workspace_id.in_(workspace_ids)).order_by(Workspace.created_at.desc()).all()
    
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
    title: str = Form(...),
    started_at: Optional[datetime] = Form(None),
    attendee_member_ids: str = Form(...),
    file: UploadFile = File(...),
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db)
) -> dict:
    
    processing = db.query(Meeting).filter(
        Meeting.workspace_id == workspace_id, 
        Meeting.status == MeetingStatus.PROCESSING
    ).first()
    if processing:
        raise AppError(
            ErrorCode.MEETING_PROCESSING_IN_PROGRESS,
            details={"meeting_id": processing.meeting_id}
        )
        
    meeting = Meeting(
        workspace_id=workspace_id,
        title=title,
        source="manual_upload",
        status=MeetingStatus.PROCESSING,
        started_at=started_at or datetime.now(timezone.utc)
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    
    # TODO: 파일 저장 및 큐 전송 등 비동기 처리 연결
    
    return success({"meeting_id": meeting.meeting_id, "status": meeting.status})
