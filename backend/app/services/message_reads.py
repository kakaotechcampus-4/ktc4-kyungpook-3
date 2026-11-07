"""대화별 읽은 위치를 기준으로 읽지 않은 메시지 수를 세고, 읽은 위치를 옮긴다.

모든 함수는 commit 하지 않는다. 호출하는 쪽(API)이 요청 끝에서 commit 한다.
"""
from datetime import datetime, timezone

from sqlalchemy import DateTime, and_, exists, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.models import Member, MemberRole, MessageSender, MessageThread, MessageThreadRead, ThreadMessage
from app.services.messages import utc


def _arrival(model):
    """메시지가 대화에 들어온 시각. 디스코드 답장은 created_at 이 보낸 시각이라 늦게 들어와도 앞서므로
    받은 시각(received_at)이 있으면 그것을 쓴다."""
    return func.coalesce(model.received_at, model.created_at)


def unread_by_thread(db: Session, viewer: Member) -> dict[str, int]:
    """viewer 에게 보이는 대화마다 읽지 않은 메시지 수. 0 인 대화도 키로 넣는다.

    대화 수와 무관하게 쿼리 하나로 센다. 메시지와 읽은 위치를 LEFT JOIN 으로 붙여 읽지 않은 것이 없는
    대화도 결과에 남긴다.
    """
    owner = aliased(Member)
    later_reply = aliased(ThreadMessage)
    own_thread = MessageThread.member_id == viewer.member_id
    arrival = _arrival(ThreadMessage)
    baseline = func.coalesce(MessageThreadRead.last_read_at, utc(viewer.created_at))

    # 자기 대화에서는 봇 메시지, 남의 대화에서는 대화 주인의 메시지가 상대편이다.
    counterpart = or_(
        and_(own_thread, ThreadMessage.sender == MessageSender.BOT),
        and_(~own_thread, ThreadMessage.sender == MessageSender.MEMBER),
    )
    # 자기 대화에서 봇 메시지 뒤에 내가 답장했다면 그 봇 메시지는 이미 본 것으로 친다.
    not_answered = or_(
        ~own_thread,
        ~exists().where(
            later_reply.thread_id == ThreadMessage.thread_id,
            later_reply.sender == MessageSender.MEMBER,
            _arrival(later_reply) > arrival,
        ),
    )

    visible = [owner.is_deleted.is_(False)]
    if viewer.role == MemberRole.PM:
        visible.append(MessageThread.workspace_id == viewer.workspace_id)
    else:
        visible.append(own_thread)

    stmt = (
        select(MessageThread.thread_id, func.count(ThreadMessage.message_id))
        .join(owner, owner.member_id == MessageThread.member_id)
        .outerjoin(
            MessageThreadRead,
            and_(
                MessageThreadRead.thread_id == MessageThread.thread_id,
                MessageThreadRead.member_id == viewer.member_id,
            ),
        )
        .outerjoin(
            ThreadMessage,
            and_(ThreadMessage.thread_id == MessageThread.thread_id, counterpart, arrival > baseline, not_answered),
        )
        .where(*visible)
        .group_by(MessageThread.thread_id)
    )
    return {thread_id: count for thread_id, count in db.execute(stmt).all()}


def unread_count(db: Session, viewer: Member) -> int:
    return sum(unread_by_thread(db, viewer).values())


def _stored_position(db: Session, thread_id: str, member_id: str) -> datetime | None:
    value = db.scalar(
        select(MessageThreadRead.last_read_at).where(
            MessageThreadRead.thread_id == thread_id, MessageThreadRead.member_id == member_id
        )
    )
    return utc(value) if value is not None else None


def _advance(db: Session, thread_id: str, member_id: str, at: datetime) -> datetime | None:
    """읽은 위치를 at 까지 옮기고 저장된 값을 돌려준다. 이미 더 늦으면 그대로 둔다.

    처음 넣을 때 다른 요청과 겹치면 기본 키 충돌이 나므로, 그때는 조건부 UPDATE 로 바꾼다.
    """
    at = utc(at)
    current = _stored_position(db, thread_id, member_id)
    if current is None:
        try:
            with db.begin_nested():
                db.add(MessageThreadRead(thread_id=thread_id, member_id=member_id, last_read_at=at))
            return at
        except IntegrityError:
            # 다른 요청이 먼저 넣었다. 아래에서 더 늦을 때만 갱신한다.
            pass
    db.execute(
        update(MessageThreadRead)
        .where(
            MessageThreadRead.thread_id == thread_id,
            MessageThreadRead.member_id == member_id,
            MessageThreadRead.last_read_at < at,
        )
        .values(last_read_at=at, updated_at=datetime.now(timezone.utc))
        .execution_options(synchronize_session=False)
    )
    return _stored_position(db, thread_id, member_id)


def mark_read(db: Session, viewer: Member, thread: MessageThread) -> datetime | None:
    """그 대화의 가장 늦게 들어온 메시지까지 읽은 것으로 옮기고 그 위치를 돌려준다.

    보낸 쪽과 무관하게 모든 메시지 중 가장 늦은 것을 쓴다. 읽지 않은 수는 상대편 메시지만 세므로
    결과가 같고, 구현이 단순하다. 메시지가 없으면 아무것도 하지 않고 기존 위치(없으면 None)를 돌려준다.
    """
    latest = db.scalar(
        select(func.max(_arrival(ThreadMessage), type_=DateTime(timezone=True))).where(
            ThreadMessage.thread_id == thread.thread_id
        )
    )
    if latest is None:
        return _stored_position(db, thread.thread_id, viewer.member_id)
    return _advance(db, thread.thread_id, viewer.member_id, latest)


def mark_workspace_read(db: Session, member: Member, at: datetime) -> None:
    """member 의 워크스페이스 모든 대화를 at 까지 읽은 것으로 한다. PM 으로 올라간 사람이 그 전 답장을
    한꺼번에 읽지 않은 것으로 보지 않게 한다."""
    thread_ids = db.scalars(
        select(MessageThread.thread_id).where(MessageThread.workspace_id == member.workspace_id)
    ).all()
    for thread_id in thread_ids:
        _advance(db, thread_id, member.member_id, at)
