"""읽지 않은 메시지 수 API와 대화 요약의 unread_count. 규칙 자체는 test_message_reads_service.py 에서 고정한다."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event

from app.models import Member, MessageSender, MessageThread, MessageThreadRead, Session as SessionModel, ThreadMessage, User, Workspace
from app.services import message_reads
from app.services.sessions import hash_session_token
from tests.api.test_messages_api import P, client

BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)
_ORIGINAL_UNREAD_BY_THREAD = message_reads.unread_by_thread


@pytest.fixture
def seed(mdb, mseed):
    """가입 시각을 고정해 읽음 기준선을 정한다."""
    for key in ("pm", "alice", "bob", "carol"):
        mseed[key].created_at = BASE
    mdb.commit()
    return mseed


def _thread(db, member):
    thread = MessageThread(workspace_id=member.workspace_id, member_id=member.member_id)
    db.add(thread)
    db.commit()
    return thread


def _msg(db, thread, sender, minute):
    db.add(ThreadMessage(
        thread_id=thread.thread_id, sender=sender, body="내용", created_at=BASE + timedelta(minutes=minute)
    ))
    db.commit()


def _url(seed, tail=""):
    return f"{P}/workspaces/{seed['ws']}/messages{tail}"


def _count(c, seed):
    r = c.get(_url(seed, "/unread-count"))
    assert r.status_code == 200, r.text
    return r.json()["data"]["unread_count"]


def _second_pm(db, seed):
    user = User(email="pm2@example.com", name="pm2")
    db.add(user)
    db.flush()
    db.add(SessionModel(
        user_id=user.user_id, session_token=hash_session_token("pm2-token"),
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    db.add(Member(
        workspace_id=seed["ws"], user_id=user.user_id, display_name="PM2", role="pm", created_at=BASE
    ))
    db.commit()


def test_unread_count_for_member_and_read_clears(mdb, seed):
    thread = _thread(mdb, seed["alice"])
    _msg(mdb, thread, MessageSender.BOT, 1)
    _msg(mdb, thread, MessageSender.BOT, 2)
    alice = client("alice")

    assert _count(alice, seed) == 2
    r = alice.post(_url(seed, f"/threads/{thread.thread_id}/read"))

    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["thread_id"] == thread.thread_id
    assert data["unread_count"] == 0 and data["total_unread_count"] == 0
    assert data["last_read_at"] is not None
    assert _count(alice, seed) == 0


def test_read_twice_is_200_and_empty_thread_has_null_last_read_at(mdb, seed):
    full = _thread(mdb, seed["alice"])
    _msg(mdb, full, MessageSender.BOT, 1)
    empty = _thread(mdb, seed["bob"])
    alice, bob = client("alice"), client("bob")

    first = alice.post(_url(seed, f"/threads/{full.thread_id}/read")).json()["data"]
    second = alice.post(_url(seed, f"/threads/{full.thread_id}/read"))
    assert second.status_code == 200
    assert second.json()["data"]["last_read_at"] == first["last_read_at"]

    r = bob.post(_url(seed, f"/threads/{empty.thread_id}/read"))
    assert r.status_code == 200
    assert r.json()["data"]["last_read_at"] is None


def test_member_cannot_read_others_thread_403(mdb, seed):
    thread = _thread(mdb, seed["bob"])
    _msg(mdb, thread, MessageSender.MEMBER, 1)
    r = client("alice").post(_url(seed, f"/threads/{thread.thread_id}/read"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    assert _count(client("pm"), seed) == 1


def test_other_workspace_thread_404(mdb, seed):
    other = Workspace(name="B")
    mdb.add(other)
    mdb.flush()
    pm_b = Member(workspace_id=other.workspace_id, user_id=seed["pm"].user_id, display_name="PM", role="pm")
    alice_b = Member(workspace_id=other.workspace_id, display_name="앨리스B", role="member")
    mdb.add_all([pm_b, alice_b])
    mdb.commit()
    thread = _thread(mdb, alice_b)

    r = client("pm").post(_url(seed, f"/threads/{thread.thread_id}/read"))
    assert r.status_code == 404 and r.json()["error"]["code"] == "MESSAGE_THREAD_NOT_FOUND"


def test_two_pms_read_separately(mdb, seed):
    _second_pm(mdb, seed)
    thread = _thread(mdb, seed["alice"])
    _msg(mdb, thread, MessageSender.MEMBER, 1)
    pm, pm2 = client("pm"), client("pm2")
    assert _count(pm, seed) == 1 and _count(pm2, seed) == 1

    assert pm.post(_url(seed, f"/threads/{thread.thread_id}/read")).status_code == 200

    assert _count(pm, seed) == 0
    assert _count(pm2, seed) == 1


def test_inbox_rows_carry_unread_count_matching_total(mdb, seed):
    one, two = _thread(mdb, seed["alice"]), _thread(mdb, seed["bob"])
    _msg(mdb, one, MessageSender.MEMBER, 1)
    _msg(mdb, one, MessageSender.MEMBER, 2)
    _msg(mdb, two, MessageSender.MEMBER, 3)
    pm = client("pm")

    rows = pm.get(_url(seed)).json()["data"]["threads"]
    by_id = {t["thread_id"]: t["unread_count"] for t in rows}
    assert by_id == {one.thread_id: 2, two.thread_id: 1}
    assert sum(by_id.values()) == _count(pm, seed)
    detail = pm.get(_url(seed, f"/threads/{one.thread_id}")).json()["data"]["thread"]
    assert detail["unread_count"] == 2


def test_get_thread_does_not_mark_read(mdb, seed):
    thread = _thread(mdb, seed["alice"])
    _msg(mdb, thread, MessageSender.BOT, 1)
    alice = client("alice")

    assert alice.get(_url(seed, f"/threads/{thread.thread_id}")).status_code == 200
    assert alice.get(_url(seed)).status_code == 200

    assert _count(alice, seed) == 1


def test_scheduled_bundle_is_not_counted(mdb, seed):
    from tests.api.test_messages_api import _create

    _create(client("pm"), seed, "alice")
    assert _count(client("pm"), seed) == 0
    rows = client("pm").get(_url(seed)).json()["data"]["threads"]
    assert [t["unread_count"] for t in rows] == [0]


def test_deleted_member_thread_is_not_counted_and_read_404(mdb, seed):
    thread = _thread(mdb, seed["alice"])
    _msg(mdb, thread, MessageSender.MEMBER, 1)
    seed["alice"].is_deleted = True
    mdb.commit()
    pm = client("pm")

    assert _count(pm, seed) == 0
    r = pm.post(_url(seed, f"/threads/{thread.thread_id}/read"))
    assert r.status_code == 404 and r.json()["error"]["code"] == "MESSAGE_THREAD_NOT_FOUND"


def _inbox_unread_selects(mdb, seed, monkeypatch, thread_count):
    members = [seed["alice"], seed["bob"], seed["carol"]]
    for i in range(thread_count):
        thread = _thread(mdb, members[i % len(members)] if i < len(members) else _extra_member(mdb, seed, i))
        _msg(mdb, thread, MessageSender.MEMBER, i + 1)
    counts: list[int] = []
    original = _ORIGINAL_UNREAD_BY_THREAD

    def counted(db, viewer):
        selects = []

        def on_execute(conn, cursor, statement, *args):
            if statement.lstrip().upper().startswith("SELECT"):
                selects.append(statement)

        event.listen(mdb.get_bind(), "before_cursor_execute", on_execute)
        try:
            return original(db, viewer)
        finally:
            event.remove(mdb.get_bind(), "before_cursor_execute", on_execute)
            counts.append(len(selects))

    monkeypatch.setattr(message_reads, "unread_by_thread", counted)
    assert client("pm").get(_url(seed)).status_code == 200
    return counts


def _extra_member(db, seed, i):
    member = Member(workspace_id=seed["ws"], display_name=f"추가{i}", role="member", created_at=BASE)
    db.add(member)
    db.commit()
    return member


def test_inbox_unread_query_count_does_not_grow_with_threads(mdb, seed, monkeypatch):
    few = _inbox_unread_selects(mdb, seed, monkeypatch, 2)
    for t in mdb.query(MessageThread).all():
        mdb.query(ThreadMessage).filter_by(thread_id=t.thread_id).delete()
        mdb.delete(t)
    mdb.commit()
    many = _inbox_unread_selects(mdb, seed, monkeypatch, 4)

    # 목록 요청 하나에서 한 번만 불러 쿼리 수가 대화 수와 상관없이 같다.
    assert len(few) == len(many) == 1
    assert few == many


def _patch_role(c, seed, key, role):
    return c.patch(f"{P}/members/{seed[key].member_id}", json={"role": role})


def test_promoted_pm_does_not_count_replies_before_promotion(mdb, seed):
    thread = _thread(mdb, seed["carol"])
    _msg(mdb, thread, MessageSender.MEMBER, 1)
    _msg(mdb, thread, MessageSender.MEMBER, 2)

    assert _patch_role(client("pm"), seed, "bob", "pm").status_code == 200

    bob = client("bob")
    assert _count(bob, seed) == 0
    # 올린 뒤에 온 답장만 센다.
    mdb.add(ThreadMessage(
        thread_id=thread.thread_id, sender=MessageSender.MEMBER, body="새 답장",
        created_at=datetime.now(timezone.utc) + timedelta(hours=1),
    ))
    mdb.commit()
    assert _count(bob, seed) == 1


def test_demote_keeps_reads(mdb, seed):
    other = _thread(mdb, seed["carol"])
    _msg(mdb, other, MessageSender.MEMBER, 1)
    pm = client("pm")
    # bob 을 올렸다 내린다. 올릴 때 남의 대화에 읽은 위치가 생긴다.
    assert _patch_role(pm, seed, "bob", "pm").status_code == 200
    bob_id = seed["bob"].member_id
    before = mdb.query(MessageThreadRead).filter_by(member_id=bob_id).count()
    assert before >= 1

    assert _patch_role(pm, seed, "bob", "member").status_code == 200

    mdb.expire_all()
    assert mdb.query(MessageThreadRead).filter_by(member_id=bob_id).count() == before
    # 내려간 뒤에는 남의 대화를 세지 않는다.
    assert _count(client("bob"), seed) == 0
