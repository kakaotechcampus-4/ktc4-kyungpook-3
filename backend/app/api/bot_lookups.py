"""녹음 봇이 전사 힌트로 쓰는 조회. 팀원 이름만 돌려주고 회의 내용은 돌려주지 않는다.

디스코드 봇이 사용자 세션 없이 부르는 경로라 세션 대신 서비스 토큰(X-Service-Token)으로 막는다.
웹 화면용 조회(GET /members, GET /tasks)는 로그인 세션이 있어야 해서 봇이 부르지 못한다.
"""
from datetime import timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_service_token
from app.core.database import get_db
from app.core.errors import Envelope, success
from app.models import Meeting, MeetingSource, MeetingStatus, Member, MemberAlias, Workspace
from app.schemas.meeting import ChatCursorResponse
from app.schemas.member import MemberNameListResponse, MemberNameResponse
from app.services import lifecycle

router = APIRouter(prefix="/workspaces", dependencies=[Depends(require_service_token)])


def _require_workspace(db: Session, workspace_id: str) -> None:
    lifecycle.workspace(db, workspace_id, check_epoch=False)


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
    return success(MemberNameListResponse(items=items, identity_epoch=db.get(Workspace, workspace_id).identity_epoch).model_dump(mode="json"))


@router.get("/{workspace_id}/chat-cursor", tags=["meetings"], response_model=Envelope[ChatCursorResponse])
def get_chat_cursor(workspace_id: str, db: Session = Depends(get_db)) -> dict:
    """봇이 마지막으로 처리한 채팅 위치. 끝난(done) 채팅 회의 중 가장 늦게 시작한 것의 끝 시각이다."""
    _require_workspace(db, workspace_id)
    meeting = db.execute(
        select(Meeting)
        .where(
            Meeting.workspace_id == workspace_id,
            Meeting.source == MeetingSource.CHAT,
            Meeting.status == MeetingStatus.DONE,
        )
        # 같은 started_at 이면 더 멀리 읽은(끝이 늦은) 쪽을, 그래도 같으면 id 로 정해 실행마다 같은 답이 나오게 한다
        .order_by(Meeting.started_at.desc(), Meeting.duration_ms.desc().nulls_last(), Meeting.meeting_id.desc())
        .limit(1)
    ).scalar_one_or_none()
    if meeting is None:
        return success(None)
    started = meeting.started_at
    if started.tzinfo is None:  # SQLite는 시각대를 잃는다. 저장값은 UTC다.
        started = started.replace(tzinfo=timezone.utc)
    last = started + timedelta(milliseconds=meeting.duration_ms or 0)
    return success({"meeting_id": meeting.meeting_id, "last_message_at": last.astimezone(timezone.utc).isoformat()})
