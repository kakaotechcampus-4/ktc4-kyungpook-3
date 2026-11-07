"""읽지 않은 메시지 수 계산과 읽음 처리 서비스. mdb·mseed 픽스처가 tests/api 에 있어 이 폴더에 둔다."""
import threading
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import sessionmaker

from app.models import (
    Member, MemberRole, MessageSender, MessageThread, MessageThreadRead, ThreadMessage,
)
from app.services import message_reads as reads
from app.services.messages import utc

BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)


@pytest.fixture
def seed(mdb, mseed):
    """팀원들의 가입 시각을 고정해 읽음 기준선을 정한다."""
    for key in ("pm", "alice", "bob", "carol"):
        mseed[key].created_at = BASE
    mdb.commit()
    return mseed


def _thread(db, member):
    thread = MessageThread(workspace_id=member.workspace_id, member_id=member.member_id)
    db.add(thread)
    db.commit()
    return thread


def _msg(db, thread, sender, at, received_at=None):
    message = ThreadMessage(
        thread_id=thread.thread_id, sender=sender, body="내용", created_at=at, received_at=received_at
    )
    db.add(message)
    db.commit()
    return message


def _set_read(db, thread, member, at):
    db.add(MessageThreadRead(thread_id=thread.thread_id, member_id=member.member_id, last_read_at=at))
    db.commit()


def _minutes(n):
    return BASE + timedelta(minutes=n)


def test_member_counts_unread_bot_messages_in_own_thread(mdb, seed):
    thread = _thread(mdb, seed["alice"])
    _msg(mdb, thread, MessageSender.BOT, _minutes(1))
    _msg(mdb, thread, MessageSender.BOT, _minutes(2))

    assert reads.unread_count(mdb, seed["alice"]) == 2
    assert reads.unread_by_thread(mdb, seed["alice"]) == {thread.thread_id: 2}


def test_mark_read_clears_and_new_message_counts_again(mdb, seed):
    thread = _thread(mdb, seed["alice"])
    _msg(mdb, thread, MessageSender.BOT, _minutes(1))
    _msg(mdb, thread, MessageSender.BOT, _minutes(2))

    returned = reads.mark_read(mdb, seed["alice"], thread)
    mdb.commit()

    assert returned == _minutes(2)
    assert reads.unread_count(mdb, seed["alice"]) == 0
    _msg(mdb, thread, MessageSender.BOT, _minutes(3))
    assert reads.unread_count(mdb, seed["alice"]) == 1


def test_pm_counts_member_replies_not_bot_messages(mdb, seed):
    thread = _thread(mdb, seed["alice"])
    _msg(mdb, thread, MessageSender.BOT, _minutes(1))
    _msg(mdb, thread, MessageSender.MEMBER, _minutes(2))
    _msg(mdb, thread, MessageSender.MEMBER, _minutes(3))

    assert reads.unread_by_thread(mdb, seed["pm"]) == {thread.thread_id: 2}
    assert reads.unread_count(mdb, seed["pm"]) == 2


def test_pm_own_thread_counts_bot_not_own_reply(mdb, seed):
    thread = _thread(mdb, seed["pm"])
    _msg(mdb, thread, MessageSender.BOT, _minutes(1))

    assert reads.unread_by_thread(mdb, seed["pm"]) == {thread.thread_id: 1}

    # Q6: PM 이 봇 메시지 뒤에 답장하면 그 봇 메시지는 읽은 것으로 본다.
    _msg(mdb, thread, MessageSender.MEMBER, _minutes(2))
    assert reads.unread_by_thread(mdb, seed["pm"]) == {thread.thread_id: 0}


def test_late_discord_reply_counts_by_received_at(mdb, seed):
    thread = _thread(mdb, seed["alice"])
    _set_read(mdb, thread, seed["pm"], _minutes(10))
    # 디스코드 답장은 보낸 시각(created_at)이 읽은 시각보다 앞서도 받은 시각이 뒤면 읽지 않은 것이다.
    _msg(mdb, thread, MessageSender.MEMBER, _minutes(9), received_at=_minutes(11))

    assert reads.unread_count(mdb, seed["pm"]) == 1


def test_member_reply_marks_earlier_bot_messages_read(mdb, seed):
    thread = _thread(mdb, seed["alice"])
    _msg(mdb, thread, MessageSender.BOT, _minutes(1))
    _msg(mdb, thread, MessageSender.MEMBER, _minutes(2))
    _msg(mdb, thread, MessageSender.BOT, _minutes(3))

    assert reads.unread_count(mdb, seed["alice"]) == 1


def test_pm_joined_later_does_not_count_older_replies(mdb, seed):
    thread = _thread(mdb, seed["alice"])
    _msg(mdb, thread, MessageSender.MEMBER, _minutes(5))
    seed["pm"].created_at = _minutes(6)
    mdb.commit()

    assert reads.unread_by_thread(mdb, seed["pm"]) == {thread.thread_id: 0}


def test_mark_read_never_moves_back(mdb, seed):
    thread = _thread(mdb, seed["alice"])
    _msg(mdb, thread, MessageSender.BOT, _minutes(1))
    future = _minutes(500)
    _set_read(mdb, thread, seed["alice"], future)

    returned = reads.mark_read(mdb, seed["alice"], thread)
    mdb.commit()

    assert returned == future
    stored = mdb.scalar(select(MessageThreadRead.last_read_at).where(
        MessageThreadRead.thread_id == thread.thread_id, MessageThreadRead.member_id == seed["alice"].member_id
    ))
    assert utc(stored) == future


def test_mark_read_on_empty_thread_returns_none(mdb, seed):
    thread = _thread(mdb, seed["alice"])

    assert reads.mark_read(mdb, seed["alice"], thread) is None
    assert mdb.scalar(select(func.count()).select_from(MessageThreadRead)) == 0


def test_mark_read_on_empty_thread_returns_existing_position(mdb, seed):
    thread = _thread(mdb, seed["alice"])
    _set_read(mdb, thread, seed["alice"], _minutes(7))

    assert reads.mark_read(mdb, seed["alice"], thread) == _minutes(7)


def test_mark_workspace_read_sets_all_threads(mdb, seed):
    alice_thread = _thread(mdb, seed["alice"])
    carol_thread = _thread(mdb, seed["carol"])
    _msg(mdb, alice_thread, MessageSender.MEMBER, _minutes(1))
    _msg(mdb, carol_thread, MessageSender.MEMBER, _minutes(2))
    _set_read(mdb, alice_thread, seed["bob"], _minutes(100))  # 이미 더 늦은 위치는 그대로 둔다.
    bob = seed["bob"]
    bob.role = MemberRole.PM
    mdb.commit()

    reads.mark_workspace_read(mdb, bob, _minutes(10))
    mdb.commit()
    _msg(mdb, carol_thread, MessageSender.MEMBER, _minutes(15))

    assert reads.unread_by_thread(mdb, bob) == {alice_thread.thread_id: 0, carol_thread.thread_id: 1}
    stored = mdb.scalar(select(MessageThreadRead.last_read_at).where(
        MessageThreadRead.thread_id == alice_thread.thread_id, MessageThreadRead.member_id == bob.member_id
    ))
    assert utc(stored) == _minutes(100)


def test_unread_by_thread_excludes_deleted_members_threads(mdb, seed):
    thread = _thread(mdb, seed["alice"])
    _msg(mdb, thread, MessageSender.MEMBER, _minutes(1))
    seed["alice"].is_deleted = True
    mdb.commit()

    assert reads.unread_by_thread(mdb, seed["pm"]) == {}


def test_unread_by_thread_query_count_is_constant(mdb, seed):
    for key in ("alice", "bob", "carol"):
        _msg(mdb, _thread(mdb, seed[key]), MessageSender.MEMBER, _minutes(1))
    mdb.refresh(seed["pm"])  # 만료된 속성을 다시 읽는 쿼리가 세어지지 않게 한다.
    statements = []

    def count(conn, cursor, statement, *args):
        statements.append(statement)

    engine = mdb.get_bind()
    event.listen(engine, "before_cursor_execute", count)
    try:
        assert sum(reads.unread_by_thread(mdb, seed["pm"]).values()) == 3
    finally:
        event.remove(engine, "before_cursor_execute", count)

    assert len(statements) == 1


def test_concurrent_first_mark_read_keeps_one_row_and_latest(mdb, seed):
    if mdb.get_bind().dialect.name != "postgresql":
        pytest.skip("동시 INSERT 경쟁은 PostgreSQL 에서만 확인한다")
    thread = _thread(mdb, seed["alice"])
    _msg(mdb, thread, MessageSender.BOT, _minutes(1))
    pm, thread_id = seed["pm"].member_id, thread.thread_id
    Session = sessionmaker(bind=mdb.get_bind(), autoflush=False)
    barrier = threading.Barrier(2)

    # 두 세션이 모두 "행 없음"을 본 뒤 동시에 넣게 맞춘다. 시각이 다른 두 요청의 더 늦은 값이 남아야 한다.
    def run(minutes):
        db = Session()
        try:
            member = db.get(Member, pm)
            db.scalar(select(MessageThreadRead.last_read_at).where(MessageThreadRead.thread_id == thread_id))
            barrier.wait(5)
            reads.mark_workspace_read(db, member, _minutes(minutes))
            db.commit()
        finally:
            db.close()

    workers = [threading.Thread(target=run, args=(m,)) for m in (5, 9)]
    for w in workers:
        w.start()
    for w in workers:
        w.join(20)
    assert not any(w.is_alive() for w in workers)

    mdb.expire_all()
    rows = mdb.scalars(select(MessageThreadRead).where(
        MessageThreadRead.thread_id == thread_id, MessageThreadRead.member_id == pm
    )).all()
    assert len(rows) == 1
    assert utc(rows[0].last_read_at) == _minutes(9)
