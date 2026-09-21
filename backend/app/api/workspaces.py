from fastapi import APIRouter, Depends, UploadFile, File, Form
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from typing import Optional

from app.api.deps import get_current_user, get_current_member
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Workspace, Member, MemberRole, User, Meeting, MeetingStatus
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


def _build_workspace_response(workspace: Workspace, member: Member | None = None) -> dict:
    data = WorkspaceResponse.model_validate(workspace).model_dump()
    if member:
        data["role"] = member.role
    
    # 임시 온보딩 로직 (구현 상세는 추후 고도화)
    data["onboarding"] = WorkspaceOnboarding(
        completed=workspace.onboarding_completed,
        current_step="connect_notion" if not workspace.onboarding_completed else "",
        steps=[
            WorkspaceOnboardingStep(step="create_workspace", status="completed"),
            WorkspaceOnboardingStep(step="connect_discord", status="completed" if workspace.onboarding_completed else "pending"),
            WorkspaceOnboardingStep(step="connect_notion", status="pending"),
            WorkspaceOnboardingStep(step="connect_members", status="pending"),
        ]
    ).model_dump()
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
        
    member = db.query(Member).filter(Member.workspace_id == workspace_id, Member.user_id == user.user_id, Member.is_deleted.is_(False)).first()
    return success(_build_workspace_response(workspace, member))


@router.patch("/{workspace_id}/onboarding", response_model=Envelope[dict])
def update_onboarding(
    workspace_id: str,
    payload: WorkspaceOnboardingUpdateRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db)
) -> dict:
    workspace = db.get(Workspace, workspace_id)
    if not workspace:
        raise AppError(ErrorCode.WORKSPACE_NOT_FOUND, details={"workspace_id": workspace_id})
        
    if member.role != MemberRole.PM:
        raise AppError(ErrorCode.FORBIDDEN, "Only PM can update onboarding status")

    # 온보딩 단계 업데이트 로직 (간단화)
    if payload.action == "complete" and payload.step == "connect_members":
        workspace.onboarding_completed = True
        
    db.commit()
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
    
    items = []
    for m in meetings:
        # attendee_count 로직 개선 필요(현재는 segment 기반 추정)
        attendee_count = len({s.member_id for s in m.segments if s.member_id}) if m.segments else 0
        items.append({
            "meeting_id": m.meeting_id,
            "title": m.title,
            "started_at": m.started_at,
            "source": m.source,
            "status": m.status,
            "duration_ms": m.audio.duration_ms if m.audio else 0,
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
