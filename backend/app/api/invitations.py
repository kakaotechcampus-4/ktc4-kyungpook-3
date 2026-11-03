"""팀원 초대. PM 이 로그인 계정 없는 팀원에게 가입 이메일로 초대를 만들고, 그 이메일로 로그인한 사람이 수락하면
팀원(Member.user_id)과 계정이 이어진다. 메일은 보내지 않는다. 받는 사람은 로그인한 뒤 내 초대에서 본다.

여러 행을 고치는 요청은 팀원 행을 먼저, 초대 행을 나중에 고친다. 순서가 엇갈리면 PostgreSQL 에서 교착한다.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.api.deps import get_current_pm, get_current_user, require_pm
from app.api.members import _ensure_other_pm
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Invitation, InvitationStatus, Member, MemberRole, User, Workspace
from app.schemas.invitation import (
    InvitationAcceptResponse,
    InvitationCreateRequest,
    InvitationDeclineResponse,
    InvitationListResponse,
    InvitationResponse,
    InvitedUser,
    MyInvitationListResponse,
    MyInvitationResponse,
    normalize_email,
)

router = APIRouter(tags=["invitations"])

# 옮겨 갈 상태 → (옮길 수 있는 상태, 그 상태가 아닐 때의 오류)
_TRANSITIONS: dict[InvitationStatus, tuple[InvitationStatus, ErrorCode]] = {
    InvitationStatus.ACCEPTED: (InvitationStatus.PENDING, ErrorCode.INVITATION_NOT_PENDING),
    InvitationStatus.DECLINED: (InvitationStatus.PENDING, ErrorCode.INVITATION_NOT_PENDING),
    InvitationStatus.CANCELED: (InvitationStatus.PENDING, ErrorCode.INVITATION_NOT_PENDING),
    InvitationStatus.REVOKED: (InvitationStatus.ACCEPTED, ErrorCode.INVITATION_NOT_ACCEPTED),
}

_Inviter = aliased(User)
_Accepted = aliased(User)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _check_can_move(invitation: Invitation, to: InvitationStatus) -> None:
    source, error = _TRANSITIONS[to]
    if invitation.status != source:
        raise AppError(error, details={"invitation_id": invitation.invitation_id, "status": invitation.status})


def _move(db: Session, invitation_id: str, to: InvitationStatus, **values: object) -> None:
    """초대 상태를 조건부 UPDATE 로 옮긴다. 확인한 뒤 다른 요청이 먼저 옮겼으면 이 요청이 쓴 것을 모두 되돌리고 409."""
    source, error = _TRANSITIONS[to]
    result = db.execute(
        update(Invitation)
        .where(Invitation.invitation_id == invitation_id, Invitation.status == str(source))
        .values(status=str(to), responded_at=_now(), **values)
    )
    if result.rowcount != 1:
        db.rollback()
        raise AppError(error, details={"invitation_id": invitation_id})


def _invitations(db: Session, *where) -> list[InvitationResponse]:
    rows = db.execute(
        select(Invitation, Member.display_name, _Inviter.name, _Accepted)
        .join(Member, Member.member_id == Invitation.member_id)
        .outerjoin(_Inviter, _Inviter.user_id == Invitation.invited_by_user_id)
        .outerjoin(_Accepted, _Accepted.user_id == Invitation.accepted_user_id)
        .where(*where)
        .order_by(Invitation.created_at.desc())
    ).all()
    return [
        InvitationResponse(
            invitation_id=invitation.invitation_id,
            member_id=invitation.member_id,
            member_display_name=display_name,
            email=invitation.email,
            status=invitation.status,
            invited_by_name=inviter_name,
            accepted_user=InvitedUser(user_id=accepted.user_id, name=accepted.name, email=accepted.email)
            if accepted is not None
            else None,
            created_at=invitation.created_at,
            responded_at=invitation.responded_at,
        )
        for invitation, display_name, inviter_name, accepted in rows
    ]


def _invitation_response(db: Session, invitation_id: str) -> dict:
    [item] = _invitations(db, Invitation.invitation_id == invitation_id)
    return success(item.model_dump(mode="json"))


def _email_pending_for_other_member(db: Session, workspace_id: str, email: str, member_id: str) -> bool:
    return db.execute(
        select(Invitation.invitation_id).where(
            Invitation.workspace_id == workspace_id,
            Invitation.email == email,
            Invitation.status == str(InvitationStatus.PENDING),
            Invitation.member_id != member_id,
        ).limit(1)
    ).first() is not None


def _email_in_workspace(db: Session, workspace_id: str, email: str) -> bool:
    """이 이메일로 가입한 계정이 이미 이 워크스페이스의 (탈퇴하지 않은) 팀원인가. 가입 이메일은 입력 그대로 저장돼 있어,
    초대·수락과 같은 normalize_email 로 비교한다. SQL lower 는 DB 마다 비 ASCII 글자를 다르게 바꾼다."""
    linked_emails = db.execute(
        select(User.email)
        .join(Member, Member.user_id == User.user_id)
        .where(Member.workspace_id == workspace_id, Member.is_deleted.is_(False))
    ).scalars()
    return any(normalize_email(linked) == email for linked in linked_emails)


def _user_in_workspace(db: Session, workspace_id: str, user_id: str) -> bool:
    return db.execute(
        select(Member.member_id).where(
            Member.workspace_id == workspace_id,
            Member.user_id == user_id,
            Member.is_deleted.is_(False),
        ).limit(1)
    ).first() is not None


def _pm_invitation(db: Session, invitation_id: str, user: User) -> Invitation:
    invitation = db.get(Invitation, invitation_id)
    if invitation is None:
        raise AppError(ErrorCode.INVITATION_NOT_FOUND, details={"invitation_id": invitation_id})
    require_pm(db, user, invitation.workspace_id)
    return invitation


def _my_pending_invitation(db: Session, invitation_id: str, user: User, to: InvitationStatus) -> tuple[Invitation, Member]:
    """내 이메일로 온 초대가 아니면 있는지도 알려 주지 않는다(404). 팀원이 탈퇴한 초대는 닫힌 것으로 본다."""
    invitation = db.get(Invitation, invitation_id)
    if invitation is None or invitation.email != normalize_email(user.email):
        raise AppError(ErrorCode.INVITATION_NOT_FOUND, details={"invitation_id": invitation_id})
    _check_can_move(invitation, to)
    member = db.get(Member, invitation.member_id)
    if member.is_deleted:
        raise AppError(ErrorCode.INVITATION_NOT_PENDING, details={"invitation_id": invitation_id})
    return invitation, member


@router.post(
    "/workspaces/{workspace_id}/invitations", status_code=201, response_model=Envelope[InvitationResponse]
)
def create_invitation(
    workspace_id: str,
    payload: InvitationCreateRequest,
    pm: Member = Depends(get_current_pm),
    db: Session = Depends(get_db),
) -> dict:
    """같은 팀원에게 열린 초대가 있으면 취소하고 새로 만든다. 이메일 오타는 다시 초대해서 고친다."""
    # 팀원 행을 잠가 같은 팀원을 동시에 다시 초대하거나 수락하는 요청을 차례로 돌린다.
    member = db.execute(
        select(Member)
        .where(Member.member_id == payload.member_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if member is None or member.workspace_id != workspace_id or member.is_deleted:
        raise AppError(ErrorCode.MEMBER_NOT_FOUND, details={"member_id": payload.member_id})
    if member.user_id is not None:
        raise AppError(ErrorCode.MEMBER_ALREADY_LINKED, details={"member_id": member.member_id})
    # 수락한 계정이 바로 PM 이 되면 원래 PM 을 내려 연결 끊기를 막을 수 있다(결정 0035).
    if member.role == str(MemberRole.PM):
        raise AppError(ErrorCode.PM_MEMBER_NOT_INVITABLE, details={"member_id": member.member_id})
    if _email_in_workspace(db, workspace_id, payload.email):
        raise AppError(ErrorCode.ALREADY_WORKSPACE_MEMBER, details={"email": payload.email})
    if _email_pending_for_other_member(db, workspace_id, payload.email, member.member_id):
        raise AppError(ErrorCode.EMAIL_ALREADY_INVITED, details={"email": payload.email})

    db.execute(
        update(Invitation)
        .where(Invitation.member_id == member.member_id, Invitation.status == str(InvitationStatus.PENDING))
        .values(status=str(InvitationStatus.CANCELED), responded_at=_now())
    )
    invitation = Invitation(
        workspace_id=workspace_id, member_id=member.member_id, email=payload.email, invited_by_user_id=pm.user_id
    )
    db.add(invitation)
    try:
        db.commit()
    except IntegrityError:
        # 다른 팀원에게 같은 이메일로 동시에 초대해 둘 다 사전 검사를 통과했다. 같은 팀원 쪽 인덱스는 팀원 행
        # 잠금으로 차례가 정해져 여기 오지 않는다. 이긴 쪽 초대가 그새 닫혔을 수 있어 다시 보지 않고 409 로 돌린다.
        db.rollback()
        raise AppError(ErrorCode.EMAIL_ALREADY_INVITED, details={"email": payload.email}) from None
    return _invitation_response(db, invitation.invitation_id)


@router.get("/workspaces/{workspace_id}/invitations", response_model=Envelope[InvitationListResponse])
def list_invitations(
    workspace_id: str,
    _pm: Member = Depends(get_current_pm),
    db: Session = Depends(get_db),
) -> dict:
    items = _invitations(db, Invitation.workspace_id == workspace_id)
    return success(InvitationListResponse(items=items, total=len(items)).model_dump(mode="json"))


@router.post("/invitations/{invitation_id}/cancel", response_model=Envelope[InvitationResponse])
def cancel_invitation(
    invitation_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    invitation = _pm_invitation(db, invitation_id, user)
    _check_can_move(invitation, InvitationStatus.CANCELED)
    _move(db, invitation_id, InvitationStatus.CANCELED)
    db.commit()
    return _invitation_response(db, invitation_id)


@router.post("/invitations/{invitation_id}/revoke", response_model=Envelope[InvitationResponse])
def revoke_invitation(
    invitation_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """수락한 계정과 팀원의 연결을 끊는다. 팀원 행과 태스크·이력은 그대로 둔다."""
    invitation = _pm_invitation(db, invitation_id, user)
    _check_can_move(invitation, InvitationStatus.REVOKED)
    member = db.get(Member, invitation.member_id)
    # PM 행을 member_id 순으로 잠그므로 팀원 행을 고치기 전에 부른다. PM 이 아닌 팀원이면 요청한 PM 이 남아 늘 통과한다.
    _ensure_other_pm(db, member)
    # 계정이 지워져 accepted_user_id 가 비었으면 그사이 다시 이어진 다른 계정을 끊지 않는다.
    if invitation.accepted_user_id is not None:
        db.execute(
            update(Member)
            .where(Member.member_id == member.member_id, Member.user_id == invitation.accepted_user_id)
            .values(user_id=None)
        )
    _move(db, invitation_id, InvitationStatus.REVOKED)
    db.commit()
    return _invitation_response(db, invitation_id)


@router.get("/invitations/me", response_model=Envelope[MyInvitationListResponse])
def list_my_invitations(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """내 가입 이메일로 온 대기 중 초대. 초대보다 먼저 가입했든 나중에 가입했든 같은 기준으로 찾는다."""
    rows = db.execute(
        select(Invitation, Workspace.name, Member.display_name, _Inviter.name)
        .join(Workspace, Workspace.workspace_id == Invitation.workspace_id)
        .join(Member, Member.member_id == Invitation.member_id)
        .outerjoin(_Inviter, _Inviter.user_id == Invitation.invited_by_user_id)
        .where(
            Invitation.email == normalize_email(user.email),
            Invitation.status == str(InvitationStatus.PENDING),
            Member.is_deleted.is_(False),
        )
        .order_by(Invitation.created_at.desc())
    ).all()
    items = [
        MyInvitationResponse(
            invitation_id=invitation.invitation_id,
            workspace_id=invitation.workspace_id,
            workspace_name=workspace_name,
            member_display_name=display_name,
            invited_by_name=inviter_name,
            created_at=invitation.created_at,
        )
        for invitation, workspace_name, display_name, inviter_name in rows
    ]
    return success(MyInvitationListResponse(items=items, total=len(items)).model_dump(mode="json"))


@router.post("/invitations/{invitation_id}/accept", response_model=Envelope[InvitationAcceptResponse])
def accept_invitation(
    invitation_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    invitation, member = _my_pending_invitation(db, invitation_id, user, InvitationStatus.ACCEPTED)
    workspace_id, member_id = invitation.workspace_id, member.member_id
    if member.user_id is not None:
        raise AppError(ErrorCode.MEMBER_ALREADY_LINKED, details={"member_id": member_id})
    if _user_in_workspace(db, workspace_id, user.user_id):
        raise AppError(ErrorCode.ALREADY_WORKSPACE_MEMBER, details={"workspace_id": workspace_id})

    # 두 사람이 같은 초대를 동시에 수락해도(대소문자만 다른 두 계정) 한 계정만 이어지도록 조건부로 고친다.
    linked = db.execute(
        update(Member)
        .where(Member.member_id == member_id, Member.user_id.is_(None), Member.is_deleted.is_(False))
        .values(user_id=user.user_id)
    )
    if linked.rowcount != 1:
        db.rollback()
        raise AppError(ErrorCode.MEMBER_ALREADY_LINKED, details={"member_id": member_id})
    _move(db, invitation_id, InvitationStatus.ACCEPTED, accepted_user_id=user.user_id)
    db.commit()
    return success(InvitationAcceptResponse(workspace_id=workspace_id, member_id=member_id).model_dump())


@router.post("/invitations/{invitation_id}/decline", response_model=Envelope[InvitationDeclineResponse])
def decline_invitation(
    invitation_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    _my_pending_invitation(db, invitation_id, user, InvitationStatus.DECLINED)
    _move(db, invitation_id, InvitationStatus.DECLINED)
    db.commit()
    return success(
        InvitationDeclineResponse(invitation_id=invitation_id, status=str(InvitationStatus.DECLINED)).model_dump()
    )
