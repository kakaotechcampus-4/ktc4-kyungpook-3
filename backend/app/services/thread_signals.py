"""대화에 새 줄이 생겼다는 신호를 열린 소켓으로 보낸다.

서비스는 트랜잭션 안에서 queue 로 등록만 하고, 바깥 커밋이 끝나면 훅이 publish 한다. 그래서 글을 만드는 경로마다 커밋
뒤를 챙기지 않아도 되고 롤백된 글은 신호가 없다. 연결표는 이 프로세스 메모리에 있어 --workers 1 일 때만 전부 닿는다.
"""
import asyncio
import logging
import threading
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.models import Member, MemberRole, MessageThread

logger = logging.getLogger(__name__)

# 연결 하나가 밀릴 수 있는 신호 수. 넘으면 끊어서 다시 붙게 한다.
OUTBOX_SIZE = 64
CLOSE_TRY_AGAIN_LATER = 1013
_PENDING = "thread_signals_pending"


@dataclass(eq=False)
class Connection:
    workspace_id: str
    member_id: str
    session_token: str
    expires_at: datetime
    # 라우트의 루프와 신호를 보내는 스레드가 달라, 큐에 넣는 일은 이 루프로 넘겨서 한다.
    loop: asyncio.AbstractEventLoop
    outbox: asyncio.Queue[str] = field(default_factory=lambda: asyncio.Queue(OUTBOX_SIZE))
    overflowed: asyncio.Event = field(default_factory=asyncio.Event)

    def enqueue(self, thread_id: str) -> None:
        try:
            self.outbox.put_nowait(thread_id)
        except asyncio.QueueFull:
            self.overflowed.set()


_connections: dict[str, set[Connection]] = {}
_lock = threading.Lock()


def register(conn: Connection) -> None:
    with _lock:
        _connections.setdefault(conn.member_id, set()).add(conn)


def unregister(conn: Connection) -> None:
    with _lock:
        held = _connections.get(conn.member_id, set())
        held.discard(conn)
        if not held:
            _connections.pop(conn.member_id, None)


def publish(thread_id: str, member_ids: Iterable[str]) -> None:
    """어느 스레드에서 불러도 된다."""
    with _lock:
        targets = [conn for member_id in member_ids for conn in _connections.get(member_id, ())]
    now = datetime.now(timezone.utc)
    for conn in targets:
        if conn.expires_at < now:
            continue
        try:
            conn.loop.call_soon_threadsafe(conn.enqueue, thread_id)
        except RuntimeError:
            # 루프가 이미 닫혔다.
            unregister(conn)


def queue(db: Session, thread: MessageThread) -> None:
    """이 트랜잭션이 커밋되면 대화 주인과 지금의 PM 전원에게 알린다. 쓴 사람도 다른 탭이 있어 받는다.

    SAVEPOINT(begin_nested) 안에서 부르지 않는다. 그 SAVEPOINT 만 롤백돼도 등록은 남아 바깥 커밋 때 나간다.
    """
    pms = db.scalars(
        select(Member.member_id).where(
            Member.workspace_id == thread.workspace_id,
            Member.role == MemberRole.PM,
            Member.is_deleted.is_(False),
        )
    )
    db.info.setdefault(_PENDING, {})[thread.thread_id] = {thread.member_id, *pms}


@event.listens_for(Session, "after_commit")
def _publish_committed(session: Session) -> None:
    # 이 훅은 SAVEPOINT 해제에서도 불린다. 알림이 queue 뒤에 begin_nested 를 쓰므로 바깥 커밋까지 기다린다.
    if session.in_nested_transaction():
        return
    try:
        for thread_id, member_ids in session.info.pop(_PENDING, {}).items():
            publish(thread_id, member_ids)
    except Exception:
        # 이미 커밋된 요청이다. 소켓 문제로 실패 응답을 주면 안 된다. 놓친 신호는 polling 이 메운다.
        logger.exception("대화 신호 전달 실패")


@event.listens_for(Session, "after_rollback")
def _drop_rolled_back(session: Session) -> None:
    # 이 훅도 SAVEPOINT 롤백에서 불린다. 알림 중복 경합으로 되돌린 SAVEPOINT 가 글의 신호까지 지우면 안 된다.
    if not session.in_nested_transaction():
        session.info.pop(_PENDING, None)
