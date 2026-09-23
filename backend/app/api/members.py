from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import (
    AliasResolutionLog,
    Member,
    MemberAlias,
    ResolutionResult,
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
from app.api.deps import get_current_member
from app.services.matching import resolved_alias_texts

router = APIRouter(prefix="/members", tags=["members"])

def _get_member(db: Session, member_id: str) -> Member:
    member = db.get(Member, member_id)
    if member is None:
        raise AppError(ErrorCode.MEMBER_NOT_FOUND, details={"member_id": member_id})
    return member


@router.post("", status_code=201, response_model=Envelope[MemberResponse])
def create_member(
    payload: MemberCreateRequest,
    db: Session = Depends(get_db),
) -> dict:
    if db.get(Workspace, payload.workspace_id) is None:
        raise AppError(
            ErrorCode.WORKSPACE_NOT_FOUND, details={"workspace_id": payload.workspace_id}
        )

    if payload.discord_user_id:
        exists = db.execute(
            select(Member).where(
                Member.workspace_id == payload.workspace_id,
                Member.discord_user_id == payload.discord_user_id,
                Member.is_deleted.is_(False),
            )
        ).scalar_one_or_none()
        if exists is not None:
            raise AppError(
                ErrorCode.DISCORD_USER_ALREADY_MAPPED,
                details={"discord_user_id": payload.discord_user_id},
            )

    member = Member(
        workspace_id=payload.workspace_id,
        display_name=payload.display_name,
        discord_user_id=payload.discord_user_id,
        notion_name=payload.notion_name,
        role=str(payload.role),
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return success(MemberResponse.model_validate(member).model_dump(mode="json"))


@router.get("", response_model=Envelope[MemberListResponse])
def list_members(
    workspace_id: str = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
) -> dict:
    stmt = (
        select(Member)
        .where(Member.workspace_id == workspace_id, Member.is_deleted.is_(False))
        .order_by(Member.created_at)
    )
    rows = db.execute(stmt).scalars().all()

    count_stmt = select(func.count()).select_from(Member).where(
        Member.workspace_id == workspace_id, Member.is_deleted.is_(False)
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
    db: Session = Depends(get_db),
) -> dict:
    """담당자 매핑 화면의 '미매칭' 행 — 회의에서 감지됐지만 아직 팀원과 연결 안 된 이름."""
    # 매칭 판정(resolve_assignee)과 같은 기준으로 해결 여부를 가른다.
    resolved_aliases = resolved_alias_texts(db, workspace_id)

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
def delete_alias(alias_id: str, db: Session = Depends(get_db)) -> None:
    alias = db.get(MemberAlias, alias_id)
    if alias is None:
        raise AppError(ErrorCode.MEMBER_ALIAS_NOT_FOUND, details={"alias_id": alias_id})
    db.delete(alias)
    db.commit()


@router.get("/{member_id}", response_model=Envelope[MemberResponse])
def get_member(member_id: str, db: Session = Depends(get_db)) -> dict:
    member = _get_member(db, member_id)
    return success(MemberResponse.model_validate(member).model_dump(mode="json"))


@router.patch("/{member_id}", response_model=Envelope[MemberResponse])
def update_member(
    member_id: str,
    payload: MemberUpdateRequest,
    db: Session = Depends(get_db),
) -> dict:
    member = _get_member(db, member_id)

    updates = {field: getattr(payload, field) for field in payload.model_fields_set}

    if updates.get("discord_user_id"):
        exists = db.execute(
            select(Member).where(
                Member.workspace_id == member.workspace_id,
                Member.discord_user_id == updates["discord_user_id"],
                Member.member_id != member_id,
                Member.is_deleted.is_(False),
            )
        ).scalar_one_or_none()
        if exists is not None:
            raise AppError(
                ErrorCode.DISCORD_USER_ALREADY_MAPPED,
                details={"discord_user_id": updates["discord_user_id"]},
            )

    for field, value in updates.items():
        if field == "role":
            if value is not None:
                member.role = str(value)
            continue
        setattr(member, field, value)

    db.commit()
    db.refresh(member)
    return success(MemberResponse.model_validate(member).model_dump(mode="json"))


@router.post(
    "/{member_id}/aliases", status_code=201, response_model=Envelope[MemberAliasResponse]
)
def create_alias(
    member_id: str,
    payload: MemberAliasCreateRequest,
    db: Session = Depends(get_db),
) -> dict:
    member = _get_member(db, member_id)

    exists = db.execute(
        select(MemberAlias).where(
            MemberAlias.workspace_id == member.workspace_id,
            MemberAlias.member_id == member_id,
            MemberAlias.alias_text == payload.alias_text,
        )
    ).scalar_one_or_none()
    if exists is not None:
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
