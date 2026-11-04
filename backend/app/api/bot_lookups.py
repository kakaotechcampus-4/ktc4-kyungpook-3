"""녹음 봇이 전사 힌트로 쓰는 조회. 팀원 이름만 돌려주고 회의 내용은 돌려주지 않는다.

디스코드 봇이 사용자 세션 없이 부르는 경로라 세션 대신 서비스 토큰(X-Service-Token)으로 막는다.
웹 화면용 조회(GET /members, GET /tasks)는 로그인 세션이 있어야 해서 봇이 부르지 못한다.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_service_token
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Member, MemberAlias, Workspace
from app.schemas.member import MemberNameListResponse, MemberNameResponse

router = APIRouter(prefix="/workspaces", dependencies=[Depends(require_service_token)])


def _require_workspace(db: Session, workspace_id: str) -> None:
    if db.get(Workspace, workspace_id) is None:
        raise AppError(ErrorCode.WORKSPACE_NOT_FOUND, details={"workspace_id": workspace_id})


@router.get(
    "/{workspace_id}/members/names",
    response_model=Envelope[MemberNameListResponse],
    tags=["members"],
)
def list_member_names(workspace_id: str, db: Session = Depends(get_db)) -> dict:
    """탈퇴하지 않은 팀원의 이름과 별칭을 만든 순서로 돌려준다.

    이름은 PM이 온보딩에서 정한 display_name이다. 봇이 디스코드 표시 이름 대신 전사 이름 힌트로 쓴다.
    별칭은 종류와 확인 여부를 가리지 않고 넣고, 확인한(verified) 별칭을 앞에 둔다. 한 팀원 안에서 같은
    별칭은 uq_alias_per_member가 막으므로 따로 겹침을 지우지 않는다.
    """
    _require_workspace(db, workspace_id)
    members = db.execute(
        select(Member)
        .where(Member.workspace_id == workspace_id, Member.is_deleted.is_(False))
        .order_by(Member.created_at, Member.member_id)
    ).scalars().all()

    aliases: dict[str, list[str]] = {member.member_id: [] for member in members}
    rows = db.execute(
        select(MemberAlias.member_id, MemberAlias.alias_text)
        .where(MemberAlias.workspace_id == workspace_id, MemberAlias.member_id.in_(list(aliases)))
        .order_by(MemberAlias.verified.desc(), MemberAlias.created_at, MemberAlias.alias_id)
    ).all()
    for member_id, alias_text in rows:
        aliases[member_id].append(alias_text)

    items = [
        MemberNameResponse(
            member_id=member.member_id,
            name=member.display_name,
            discord_user_id=member.discord_user_id,
            aliases=aliases[member.member_id],
        )
        for member in members
    ]
    return success(MemberNameListResponse(items=items).model_dump(mode="json"))

