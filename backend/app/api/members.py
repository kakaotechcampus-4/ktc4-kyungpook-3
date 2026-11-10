from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import (
    AliasResolutionLog,
    AliasSource,
    Invitation,
    InvitationStatus,
    Meeting,
    Member,
    MemberAlias,
    MemberRole,
    Source,
    User,
    Workspace,
)
from app.schemas.member import (
    MemberAliasCreateRequest,
    MemberAliasListResponse,
    MemberAliasResponse,
    MemberCreateRequest,
    MemberListResponse,
    MemberResponse,
    MemberUpdateRequest,
    UnresolvedAliasListResponse,
    UnresolvedAliasResponse,
)
from app.api.deps import get_current_member, get_current_user, require_member, require_pm
from app.services import message_reads
from app.services.matching import resolved_texts
from app.services.member_aliases import (
    add_discord_nickname_alias,
    remove_discord_profile_aliases,
    sync_name_aliases,
)

router = APIRouter(prefix="/members", tags=["members"])

def _get_member(db: Session, member_id: str, user: User, *, pm: bool = False) -> Member:
    """팀원을 찾고 요청자가 그 워크스페이스 소속인지(pm이면 PM인지) 확인한다."""
    member = db.get(Member, member_id)
    if member is None or member.withdrawn_at is not None:
        raise AppError(ErrorCode.MEMBER_NOT_FOUND, details={"member_id": member_id})
    (require_pm if pm else require_member)(db, user, member.workspace_id)
    db.refresh(member)
    if member.withdrawn_at is not None:
        raise AppError(ErrorCode.MEMBER_NOT_FOUND, details={"member_id": member_id})
    return member


def _lock_member(db: Session, member: Member) -> None:
    """팀원 행을 커밋까지 잠그고 최신 값으로 다시 읽는다. 이름·디스코드 계정을 바꾸는 PATCH 가 쓴다.

    같은 팀원을 동시에 고치면 두 요청이 모두 같은 별칭이 없다고 보고 넣어, 뒤쪽이 uq_alias_per_member 에 걸려
    500 이 된다(#463 리뷰). 잠근 뒤 별칭을 읽으면 앞 요청이 넣은 것을 보고 건너뛴다.
    """
    db.execute(
        select(Member)
        .where(Member.member_id == member.member_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one()


def _discord_user_taken(
    db: Session, workspace_id: str, discord_user_id: str, *, exclude_member_id: str | None = None
) -> bool:
    """탈퇴하지 않은 다른 팀원이 이 디스코드 계정에 연결돼 있는가. DB 유일 인덱스와 같은 범위를 본다."""
    stmt = select(Member.member_id).where(
        Member.workspace_id == workspace_id,
        Member.discord_user_id == discord_user_id,
        Member.is_deleted.is_(False),
    )
    if exclude_member_id is not None:
        stmt = stmt.where(Member.member_id != exclude_member_id)
    return db.execute(stmt.limit(1)).first() is not None


def _ensure_discord_user_free(
    db: Session, workspace_id: str, discord_user_id: str | None, *, exclude_member_id: str | None = None
) -> None:
    """연결하려는 디스코드 계정을 탈퇴하지 않은 다른 팀원이 쓰고 있으면 409. 값이 없으면(연결 해제) 확인하지 않는다."""
    if discord_user_id and _discord_user_taken(
        db, workspace_id, discord_user_id, exclude_member_id=exclude_member_id
    ):
        raise AppError(
            ErrorCode.DISCORD_USER_ALREADY_MAPPED, details={"discord_user_id": discord_user_id}
        )


def _lock_discord_holder(db: Session, member: Member, discord_user_id: str) -> Member | None:
    """이 계정을 가진 다른 활성 팀원을 찾아 이 팀원과 함께 member_id 순서로 커밋까지 잠근다. 없으면 이 팀원만 잠근다.

    두 팀원이 서로의 계정을 동시에 옮겨 받아도 같은 순서로 잠가 교착하지 않는다(#652). 잠그는 사이에 그 팀원이
    계정을 풀었거나 바꿨으면 옮길 것이 없으므로 None 이다.
    """
    holder_id = db.scalar(
        select(Member.member_id).where(
            Member.workspace_id == member.workspace_id,
            Member.discord_user_id == discord_user_id,
            Member.is_deleted.is_(False),
            Member.member_id != member.member_id,
        ).limit(1)
    )
    db.execute(
        select(Member)
        .where(Member.member_id.in_([member.member_id] + ([holder_id] if holder_id else [])))
        .order_by(Member.member_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalars().all()
    holder = db.get(Member, holder_id) if holder_id else None
    if holder is None or holder.is_deleted or holder.discord_user_id != discord_user_id:
        return None
    return holder


def _unlink_discord(db: Session, member: Member) -> None:
    """디스코드 연결을 풀고 그 계정의 닉네임 별칭을 지운다. PATCH {discord_user_id: null} 과 같은 정리다.

    바로 flush 한다. 다른 팀원에 같은 계정을 잇는 값이 먼저 DB 에 나가면 한 계정이 두 활성 팀원에 붙어
    유일 인덱스에 걸린다. 같은 표의 UPDATE 는 대입 순서가 아니라 기본 키 순서로 나가므로 순서를 직접 정한다.
    """
    removed = remove_discord_profile_aliases(db, member)
    member.discord_user_id = None
    if removed:
        sync_name_aliases(db, member, only_texts=removed)
    db.flush()


def _reattribute_utterances(db: Session, member: Member) -> None:
    """이 워크스페이스 회의에서 member 의 디스코드 계정이 말한 발화를 모두 member 에 붙인다(#652).

    발화의 member_id 는 저장할 때의 연결로 정해져, 나중에 계정을 옮기면 회의록이 앞 팀원 이름으로 남는다.
    연결이 없던 발화(member_id NULL)도 붙인다. 업로드 회의 발화는 화자 uid 가 없어 해당하지 않는다.
    """
    db.execute(
        update(Source)
        .where(
            Source.speaker_discord_user_id == member.discord_user_id,
            Source.meeting_id.in_(select(Meeting.meeting_id).where(Meeting.workspace_id == member.workspace_id)),
        )
        .values(member_id=member.member_id)
        .execution_options(synchronize_session=False)
    )


def _ensure_no_pending_invitation(db: Session, member: Member) -> None:
    """대기 초대가 있는 팀원은 PM 으로 올리지 않는다. 수락한 계정이 바로 PM 이 되면 원래 PM 을 내려 연결 끊기를 막을 수
    있다(결정 0036). 초대 만들기와 같은 팀원 행을 잠가, 확인과 역할 변경 사이에 초대가 생기지 않게 한다."""
    db.execute(select(Member.member_id).where(Member.member_id == member.member_id).with_for_update()).first()
    pending = db.execute(
        select(Invitation.invitation_id).where(
            Invitation.member_id == member.member_id,
            Invitation.status == str(InvitationStatus.PENDING),
        ).limit(1)
    ).first()
    if pending is not None:
        raise AppError(ErrorCode.MEMBER_HAS_PENDING_INVITATION, details={"member_id": member.member_id})


def _commit_member(db: Session, member: Member, *, reattribute: bool = False) -> None:
    """팀원 변경을 커밋한다. 같은 계정을 동시에 연결해 사전 검사를 함께 통과했으면 DB 유일 인덱스에 걸린다.
    이때 500 대신 사전 검사와 같은 409로 돌려준다. 다른 이유의 무결성 오류는 그대로 올린다.

    reattribute 면 팀원을 먼저 내보낸 뒤 그 계정의 지난 발화를 같은 트랜잭션에서 이 팀원에 붙인다. 새 팀원은
    행이 있어야 발화가 가리킬 수 있다.
    """
    workspace_id, discord_user_id, member_id = member.workspace_id, member.discord_user_id, member.member_id
    try:
        if reattribute:
            db.flush()
            _reattribute_utterances(db, member)
        db.commit()
    except IntegrityError:
        db.rollback()
        if discord_user_id and _discord_user_taken(
            db, workspace_id, discord_user_id, exclude_member_id=member_id
        ):
            raise AppError(
                ErrorCode.DISCORD_USER_ALREADY_MAPPED, details={"discord_user_id": discord_user_id}
            ) from None
        raise


def _ensure_other_pm(db: Session, member: Member) -> None:
    """member가 PM에서 내려가도 로그인할 수 있는 PM이 남는지 확인한다. 없으면 LAST_PM_REQUIRED.

    로그인 계정이 없는 팀원(디스코드 연결로 만든 명단)은 PM이어도 웹에 들어올 수 없어 세지 않는다.
    내리려는 팀원까지 포함해 PM 행을 모두 커밋까지 잠근다. 서로 다른 행만 잠그면, 두 PM이 동시에 서로를
    내릴 때 둘 다 "다른 PM이 있다"고 보고 PM이 없어진다. 순서를 정해 잠가 교착을 피한다.
    member는 지금 PM이 아니어도 함께 잠근다. 따로 잠그면 이 순서를 벗어나 역할을 바꾸는 요청과 교착한다.
    """
    pm_ids = db.execute(
        select(Member.member_id)
        .where(
            or_(
                Member.member_id == member.member_id,
                and_(
                    Member.workspace_id == member.workspace_id,
                    Member.role == str(MemberRole.PM),
                    Member.user_id.is_not(None),
                    Member.is_deleted.is_(False),
                ),
            )
        )
        .order_by(Member.member_id)
        .with_for_update()
    ).scalars().all()
    if not [pm_id for pm_id in pm_ids if pm_id != member.member_id]:
        raise AppError(
            ErrorCode.LAST_PM_REQUIRED,
            details={"workspace_id": member.workspace_id, "member_id": member.member_id},
        )


@router.post("", status_code=201, response_model=Envelope[MemberResponse])
def create_member(
    payload: MemberCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if db.get(Workspace, payload.workspace_id) is None:
        raise AppError(
            ErrorCode.WORKSPACE_NOT_FOUND, details={"workspace_id": payload.workspace_id}
        )
    require_pm(db, user, payload.workspace_id)

    _ensure_discord_user_free(db, payload.workspace_id, payload.discord_user_id)

    member = Member(
        workspace_id=payload.workspace_id,
        display_name=payload.display_name,
        discord_user_id=payload.discord_user_id,
        notion_name=payload.notion_name,
        role=str(payload.role),
    )
    db.add(member)
    # 이름 별칭은 팀원과 한 커밋으로 들어간다(flush 하지 않는다). 디스코드 유일 위반이 _commit_member 안에서 나야 409 가 된다.
    sync_name_aliases(db, member)
    _commit_member(db, member, reattribute=bool(payload.discord_user_id))
    db.refresh(member)
    if payload.discord_user_id:
        # 서버 닉네임은 팀원 커밋 뒤에 Discord 에서 읽는다. 실패해도 팀원 등록은 그대로다.
        workspace_id, member_id = payload.workspace_id, member.member_id
        add_discord_nickname_alias(db, workspace_id, member_id, payload.discord_user_id)
        db.refresh(member)
    return success(MemberResponse.model_validate(member).model_dump(mode="json"))


@router.get("", response_model=Envelope[MemberListResponse])
def list_members(
    workspace_id: str = Query(..., description="워크스페이스 ID"),
    include_withdrawn: bool = Query(False, description="공동 기록의 익명 작성자를 읽기용으로 포함"),
    _member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> dict:
    visible = or_(Member.is_deleted.is_(False), Member.withdrawn_at.is_not(None)) if include_withdrawn else Member.is_deleted.is_(False)
    stmt = (
        select(Member)
        .where(Member.workspace_id == workspace_id, visible)
        .order_by(Member.created_at)
    )
    rows = db.execute(stmt).scalars().all()

    count_stmt = select(func.count()).select_from(Member).where(
        Member.workspace_id == workspace_id, visible
    )
    total = db.execute(count_stmt).scalar() or 0

    return success(
        MemberListResponse(
            items=[MemberResponse.model_validate(r) for r in rows], total=total
        ).model_dump(mode="json")
    )


@router.get("/aliases", response_model=Envelope[MemberAliasListResponse])
def list_aliases(
    workspace_id: str = Query(..., description="워크스페이스 ID"),
    _member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> dict:
    """담당자 매핑 화면의 현재 별칭 테이블."""
    stmt = (
        select(MemberAlias)
        .where(MemberAlias.workspace_id == workspace_id)
        .order_by(MemberAlias.created_at.desc())
    )
    rows = db.execute(stmt).scalars().all()
    return success(
        MemberAliasListResponse(
            items=[MemberAliasResponse.model_validate(r) for r in rows],
            total=len(rows),
        ).model_dump(mode="json")
    )


@router.get("/unresolved-aliases", response_model=Envelope[UnresolvedAliasListResponse])
def list_unresolved_aliases(
    workspace_id: str = Query(..., description="워크스페이스 ID"),
    _member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> dict:
    """담당자 매핑 화면의 '미매칭' 행 — 회의에서 감지됐지만 아직 팀원과 연결 안 된 이름."""
    stmt = (
        select(
            AliasResolutionLog.alias_text,
            func.count().label("occurrences"),
            func.max(AliasResolutionLog.created_at).label("last_seen_at"),
        )
        .where(AliasResolutionLog.workspace_id == workspace_id)
        .group_by(AliasResolutionLog.alias_text)
        .order_by(func.max(AliasResolutionLog.created_at).desc())
    )
    rows = db.execute(stmt).all()

    # 매칭 판정(resolve_assignee)과 같은 기준(님·조사를 뗀 후보)으로 해결 여부를 가른다.
    resolved_aliases = resolved_texts(db, workspace_id, [r.alias_text for r in rows])

    items = [
        UnresolvedAliasResponse(
            alias_text=alias_text, occurrences=occurrences, last_seen_at=last_seen_at
        )
        for alias_text, occurrences, last_seen_at in rows
        if alias_text not in resolved_aliases
    ]

    return success(
        UnresolvedAliasListResponse(items=items, total=len(items)).model_dump(
            mode="json"
        )
    )


@router.delete("/aliases/{alias_id}", status_code=204)
def delete_alias(
    alias_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    alias = db.get(MemberAlias, alias_id)
    if alias is None:
        raise AppError(ErrorCode.MEMBER_ALIAS_NOT_FOUND, details={"alias_id": alias_id})
    require_pm(db, user, alias.workspace_id)
    db.delete(alias)
    db.commit()


@router.get("/{member_id}", response_model=Envelope[MemberResponse])
def get_member(
    member_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    member = _get_member(db, member_id, user)
    return success(MemberResponse.model_validate(member).model_dump(mode="json"))


@router.patch("/{member_id}", response_model=Envelope[MemberResponse])
def update_member(
    member_id: str,
    payload: MemberUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    member = _get_member(db, member_id, user, pm=True)

    updates = {field: getattr(payload, field) for field in payload.model_fields_set}
    move_to = updates.get("discord_user_id") if updates.pop("move_discord_link", False) else None

    # PM을 넘길 때는 다른 팀원을 먼저 PM으로 올리고 나서 자기를 내린다. 마지막 PM은 내릴 수 없다.
    if updates.get("role") == MemberRole.MEMBER and member.role == MemberRole.PM:
        _ensure_other_pm(db, member)
    if updates.get("role") == MemberRole.PM and member.role != MemberRole.PM:
        _ensure_no_pending_invitation(db, member)

    if not move_to:
        _ensure_discord_user_free(
            db, member.workspace_id, updates.get("discord_user_id"), exclude_member_id=member_id
        )

    # 별칭이 바뀔 수 있는 PATCH 는 팀원 행을 잠근다. 위 PM·초대 검사가 잠그는 행보다 뒤에 잠가 순서가 꼬이지 않게 한다.
    # 계정을 옮겨 오면 그 계정을 가진 팀원도 같이 잠근다.
    holder = None
    if move_to:
        holder = _lock_discord_holder(db, member, move_to)
    elif "display_name" in updates or "discord_user_id" in updates:
        _lock_member(db, member)

    # 승격은 이 PATCH 의 commit 에 함께 넣는다. 올라가기 전 대화는 PM 이 되기 전 일이라 읽지 않은 것으로 세지 않는다.
    if updates.get("role") == MemberRole.PM and member.role != MemberRole.PM:
        message_reads.mark_workspace_read(db, member, datetime.now(timezone.utc))

    old_name = member.display_name
    # 디스코드 계정이 바뀌면(풀리는 것 포함) 옛 계정의 닉네임 별칭을 지운다. 조회가 팀원 변경을 먼저 flush 해
    # 유일 위반이 409 처리 밖에서 나지 않도록 값을 바꾸기 전에 한다.
    discord_changed = "discord_user_id" in updates and updates["discord_user_id"] != member.discord_user_id
    removed_nicknames: set[str] = set()
    if discord_changed:
        removed_nicknames = remove_discord_profile_aliases(db, member)
    if holder is not None:
        _unlink_discord(db, holder)
    for field, value in updates.items():
        if field == "role":
            if value is not None:
                member.role = str(value)
            continue
        setattr(member, field, value)

    # 이름이 바뀌면 이름 별칭을 전부 다시 맞춘다. 이름이 그대로인데 닉네임 별칭을 지웠다면, 닉네임과 겹쳐 건너뛴
    # 이름 꼴만 채운다. PM 이 지운 다른 이름 별칭을 되살리지 않기 위해서다.
    name_changed = "display_name" in updates and updates["display_name"] != old_name
    if name_changed:
        sync_name_aliases(db, member, old_name)
    elif removed_nicknames:
        sync_name_aliases(db, member, only_texts=removed_nicknames)

    workspace_id, new_discord = member.workspace_id, updates.get("discord_user_id")
    _commit_member(db, member, reattribute=bool(discord_changed and new_discord))
    db.refresh(member)
    if discord_changed and new_discord:
        add_discord_nickname_alias(db, workspace_id, member_id, new_discord)
        db.refresh(member)
    return success(MemberResponse.model_validate(member).model_dump(mode="json"))


@router.post(
    "/{member_id}/aliases", status_code=201, response_model=Envelope[MemberAliasResponse]
)
def create_alias(
    member_id: str,
    payload: MemberAliasCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    member = _get_member(db, member_id, user, pm=True)

    exists = db.execute(
        select(MemberAlias).where(
            MemberAlias.workspace_id == member.workspace_id,
            MemberAlias.member_id == member_id,
            MemberAlias.alias_text == payload.alias_text,
        )
    ).scalar_one_or_none()
    if exists is not None:
        # 자동 별칭(이름·디스코드 닉네임)과 같은 글자를 PM 이 사람이 정한 출처(manual·learned)로 등록하면 그 출처로
        # 올린다. 그래야 다른 팀원의 자동 별칭을 막고 이름을 바꿔도 지워진다. 요청의 출처가 자동 별칭 표시
        # (discord_profile)면 올리지 않는다. 올리면 이름을 바꿔도 안 지워지는데 확정 매칭이 되는 별칭이 생긴다.
        # 이미 사람이 정한 별칭은 그대로 둔다.
        if exists.source in (str(AliasSource.DISPLAY_NAME), str(AliasSource.DISCORD_PROFILE)) and payload.source in (
            AliasSource.MANUAL,
            AliasSource.LEARNED,
        ):
            exists.alias_type = str(payload.alias_type)
            exists.source = str(payload.source)
            exists.confidence = payload.confidence
            exists.verified = payload.verified
            db.commit()
            db.refresh(exists)
        return success(MemberAliasResponse.model_validate(exists).model_dump(mode="json"))

    alias = MemberAlias(
        member_id=member_id,
        workspace_id=member.workspace_id,
        alias_text=payload.alias_text,
        alias_type=str(payload.alias_type),
        source=str(payload.source),
        confidence=payload.confidence,
        verified=payload.verified,
    )
    db.add(alias)
    db.commit()
    db.refresh(alias)
    return success(MemberAliasResponse.model_validate(alias).model_dump(mode="json"))
