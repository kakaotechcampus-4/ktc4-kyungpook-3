"""봇이 가져가는 DM 안내 글. 저장된 묶음 문구는 그대로 두고 claim 응답에서만 안내로 바꾼다.

기준 시각과 시계 헬퍼는 test_scheduler, test_replies 와 같다. 안내의 답장 수는 그 대화에서 답을 기다리는 태스크 수다.
"""
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models import (
    Member,
    Notification,
    Reminder,
    ReminderBundle,
    ReminderWatch,
    Task,
    ThreadMessage,
    User,
    WatchState,
    Workspace,
)
from app.models import ReplyChangeField as F
from app.models import ReplyChangeOutcome as O
from app.models import ReplyJudgmentState as S
from app.services import messages, replies
from tests.api.test_messages_api import P, _sent_message, client
from tests.api.test_reply_clock import _judged
from tests.api.test_replies import _reply
from tests.api.test_scheduler import SLOT, H, _approve_all, tick

BASE = "https://app.example.com"
REPLY_ON_WEB = "웹에서 답장해 주세요."
REPLY_ON_SITE = "웹사이트에서 답장해 주세요."
ASK_INVITE = "웹 답장을 하려면 PM 에게 초대를 요청하고, 초대받은 이메일로 가입해 주세요."


@pytest.fixture(autouse=True)
def base_url(monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", f"{BASE}/")


def _thread_link(workspace_id, thread_id):
    return f"{BASE}/workspaces/{workspace_id}/messages/threads/{thread_id}"


def _head(name, n):
    return f"{name}에서 답장을 기다리는 리마인드가 {n}개 있어요."


def _due(db, seed, tasks, at, who="alice"):
    """시각이 된 승인된 묶음을 만든다. 봇은 아직 가져가지 않았고 시계도 열리지 않았다."""
    member = seed[who]
    for task in tasks:
        task.assignee_member_id = member.member_id
        messages.create_reminder(
            db, workspace_id=member.workspace_id, task_id=task.task_id, member_id=member.member_id,
            scheduled_at=at, note=None, created_by=seed["pm"].member_id, now=at - H,
        )
    db.commit()
    _approve_all(db, at - H)


def _claim_one(db, at):
    (claimed,) = messages.claim_for_bot(db, at)
    db.commit()
    return claimed


def _deliver(db, claimed, at):
    messages.report_result(
        db, claimed.message.message_id, delivered=True, failure_reason=None,
        discord_message_ids=[f"dm-{claimed.message.message_id}"], now=at,
    )
    db.commit()
    tick(db, at)


def _sent(db, seed, tasks, at, who="alice"):
    """시계까지 연다. 팀원이 받은 글을 돌려준다."""
    _due(db, seed, tasks, at, who)
    tick(db, at)
    claimed = _claim_one(db, at)
    _deliver(db, claimed, at)
    return claimed.body


def _thread_id(db, seed, who="alice"):
    return messages.get_or_create_thread(db, seed["ws"], seed[who].member_id).thread_id


# 문구

def test_a_linked_member_gets_the_workspace_count_and_thread_link(mdb, mseed):
    body = _sent(mdb, mseed, mseed["tasks"][:2], SLOT)
    assert body == "\n".join([_head("A", 2), REPLY_ON_WEB, _thread_link(mseed["ws"], _thread_id(mdb, mseed))])


def test_without_a_base_url_the_notice_has_no_link_and_logs_a_warning(mdb, mseed, monkeypatch, caplog):
    monkeypatch.delenv("APP_BASE_URL")
    _due(mdb, mseed, mseed["tasks"][:1], SLOT)
    assert _claim_one(mdb, SLOT).body == "\n".join([_head("A", 1), REPLY_ON_SITE])
    assert any(r.levelname == "WARNING" and "APP_BASE_URL" in r.getMessage() for r in caplog.records)


def test_a_member_without_an_account_gets_the_invitation_note_not_the_thread_link(mdb, mseed):
    _due(mdb, mseed, mseed["tasks"][:1], SLOT, who="carol")
    assert _claim_one(mdb, SLOT).body == "\n".join([_head("A", 1), ASK_INVITE, f"{BASE}/signup"])


def test_a_member_without_an_account_and_a_base_url_gets_no_link(mdb, mseed, monkeypatch):
    monkeypatch.delenv("APP_BASE_URL")
    _due(mdb, mseed, mseed["tasks"][:1], SLOT, who="carol")
    assert _claim_one(mdb, SLOT).body == "\n".join([_head("A", 1), ASK_INVITE])


def test_a_revoked_member_goes_back_to_the_invitation_note(mdb, mseed):
    outsider_id = mdb.scalar(select(User.user_id).where(User.email == "outsider@example.com"))
    invited = client("pm").post(f"{P}/workspaces/{mseed['ws']}/invitations",
                                json={"member_id": mseed["carol"].member_id, "user_id": outsider_id})
    invitation_id = invited.json()["data"]["invitation_id"]
    assert client("outsider").post(f"{P}/invitations/{invitation_id}/accept").status_code == 200
    linked = _sent(mdb, mseed, mseed["tasks"][:1], SLOT, who="carol")
    assert linked.endswith(_thread_link(mseed["ws"], _thread_id(mdb, mseed, "carol")))

    assert client("pm").post(f"{P}/invitations/{invitation_id}/revoke").status_code == 200
    mdb.expire_all()
    assert mdb.get(Member, mseed["carol"].member_id).user_id is None
    body = _sent(mdb, mseed, mseed["tasks"][1:2], SLOT + H, who="carol")
    assert body.splitlines()[1:] == [ASK_INVITE, f"{BASE}/signup"]


def test_the_link_encodes_ids_like_the_web_routes():
    member, thread = SimpleNamespace(user_id="u"), SimpleNamespace(workspace_id="w s", thread_id="t/1!'()*")
    assert messages._reply_guide(member, thread).splitlines()[1] == (
        f"{BASE}/workspaces/w%20s/messages/threads/t%2F1!'()*"
    )


def test_a_member_of_two_workspaces_gets_each_workspace_its_own_notice(mdb, mseed):
    other = Workspace(name="B팀")
    mdb.add(other)
    mdb.flush()
    tasks = [Task(workspace_id=other.workspace_id, title=f"B할일{i}", status="todo") for i in range(2)]
    mdb.add_all(tasks)
    pm_b = Member(workspace_id=other.workspace_id, user_id=mseed["pm"].user_id, display_name="PM", role="pm")
    alice_b = Member(workspace_id=other.workspace_id, user_id=mseed["alice"].user_id, display_name="앨리스",
                     role="member", discord_user_id="d_alice")
    mdb.add_all([pm_b, alice_b])
    mdb.commit()

    _due(mdb, mseed, mseed["tasks"][:1], SLOT)
    _due(mdb, {"pm": pm_b, "alice": alice_b}, tasks, SLOT)
    claimed = messages.claim_for_bot(mdb, SLOT)
    mdb.commit()

    by_workspace = {c.workspace_id: c for c in claimed}
    assert {c.discord_user_id for c in claimed} == {"d_alice"} and len(by_workspace) == 2
    thread_a = _thread_id(mdb, mseed)
    thread_b = messages.get_or_create_thread(mdb, other.workspace_id, alice_b.member_id).thread_id
    assert by_workspace[mseed["ws"]].body == "\n".join(
        [_head("A", 1), REPLY_ON_WEB, _thread_link(mseed["ws"], thread_a)])
    assert by_workspace[other.workspace_id].body == "\n".join(
        [_head("B팀", 2), REPLY_ON_WEB, _thread_link(other.workspace_id, thread_b)])


# 저장된 글

def test_the_stored_text_and_the_web_push_preview_stay_the_approved_words(mdb, mseed):
    _due(mdb, mseed, mseed["tasks"][:1], SLOT)
    stored = mdb.query(ReminderBundle).one().body
    claimed = _claim_one(mdb, SLOT)
    _deliver(mdb, claimed, SLOT)
    mdb.expire_all()
    assert claimed.body != stored
    assert mdb.query(ThreadMessage).one().body == stored
    assert mdb.query(ReminderBundle).one().body == stored
    (note,) = mdb.query(Notification).filter(Notification.kind == "reminder_sent").all()
    assert note.text.startswith(f"새 메시지가 왔어요: {stored.splitlines()[0][:50]}")


# 답장 수

def test_the_count_includes_this_bundle_before_its_watches_open(mdb, mseed):
    _due(mdb, mseed, mseed["tasks"][:2], SLOT)
    claimed = _claim_one(mdb, SLOT)
    assert mdb.query(ReminderWatch).count() == 0
    assert claimed.body.splitlines()[0] == _head("A", 2)


def test_open_watches_add_to_the_count_and_the_same_task_counts_once(mdb, mseed):
    first, second, _ = mseed["tasks"]
    _sent(mdb, mseed, [first], SLOT)
    assert _sent(mdb, mseed, [second], SLOT + H).splitlines()[0] == _head("A", 2)
    assert _sent(mdb, mseed, [first], SLOT + 2 * H).splitlines()[0] == _head("A", 2)


def test_each_reminder_without_a_task_counts_as_one(mdb, mseed):
    _due(mdb, mseed, mseed["tasks"], SLOT)
    messages.dispatch_due(mdb, SLOT)
    for reminder in mdb.query(Reminder).limit(2).all():
        reminder.task_id = None
    mdb.commit()
    assert _claim_one(mdb, SLOT).body.splitlines()[0] == _head("A", 3)


def test_the_count_drops_after_a_reply_closes_a_watch(mdb, mseed):
    first, second, third = mseed["tasks"]
    _sent(mdb, mseed, [first, second], SLOT)
    assert _sent(mdb, mseed, [third], SLOT + H).splitlines()[0] == _head("A", 3)

    _judged(mdb, _reply(mdb, mseed, SLOT + 2 * H), S.DONE, (first, F.NONE, O.NOTED))
    tick(mdb, SLOT + 2 * H)
    assert _sent(mdb, mseed, [second], SLOT + 3 * H).splitlines()[0] == _head("A", 2)


def test_a_reply_waiting_for_pm_review_leaves_the_count(mdb, mseed):
    first, second, _ = mseed["tasks"]
    _sent(mdb, mseed, [first], SLOT)
    _judged(
        mdb, _reply(mdb, mseed, SLOT + H), S.NEEDS_PM,
        (None, F.UNKNOWN, O.UNKNOWN), candidates=[first],
    )
    tick(mdb, SLOT + H)
    watch = mdb.query(ReminderWatch).one()
    assert watch.state == WatchState.WATCHING
    assert watch.paused_at is not None

    _due(mdb, mseed, [second], SLOT + 2 * H)
    assert _claim_one(mdb, SLOT + 2 * H).body.splitlines()[0] == _head("A", 1)


def _done(task, seed):
    task.status = "done"


def _reassigned(task, seed):
    task.assignee_member_id = seed["pm"].member_id


def _deleted(task, seed):
    task.is_deleted = True


@pytest.mark.parametrize("change", [_done, _reassigned, _deleted])
def test_a_task_no_longer_waiting_leaves_the_count_even_if_its_blocked_watch_stays_open(mdb, mseed, change):
    first, second, _ = mseed["tasks"]
    _sent(mdb, mseed, [first], SLOT)
    mdb.query(ReminderWatch).one().state = WatchState.BLOCKED
    change(first, mseed)
    mdb.commit()
    _due(mdb, mseed, [second], SLOT + H)
    assert _claim_one(mdb, SLOT + H).body.splitlines()[0] == _head("A", 1)


def test_a_task_a_person_unblocked_leaves_the_count(mdb, mseed):
    first, second, _ = mseed["tasks"]
    _sent(mdb, mseed, [first], SLOT)
    mdb.query(ReminderWatch).one().state = WatchState.BLOCKED
    first.status = "in_progress"
    mdb.commit()
    _due(mdb, mseed, [second], SLOT + H)
    assert _claim_one(mdb, SLOT + H).body.splitlines()[0] == _head("A", 1)


def test_a_task_still_blocked_by_its_watch_stays_in_the_count(mdb, mseed):
    first, second, _ = mseed["tasks"]
    _sent(mdb, mseed, [first], SLOT)
    mdb.query(ReminderWatch).one().state = WatchState.BLOCKED
    first.status = "blocked"
    mdb.commit()
    _due(mdb, mseed, [second], SLOT + H)
    assert _claim_one(mdb, SLOT + H).body.splitlines()[0] == _head("A", 2)


# 웹 답장

def test_a_web_reply_reaches_the_judgment_queue(mdb, mseed):
    _sent(mdb, mseed, mseed["tasks"][:1], SLOT)
    message = _reply(mdb, mseed, SLOT + H)
    assert replies.claim(mdb, SLOT + H).message_id == message.message_id


# 봇이 받는 응답

def _claim_data():
    response = client(service=True).post(f"{P}/bot/messages/claim")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_the_claim_response_sends_the_notice_and_the_web_url(mdb, mseed):
    bid = _sent_message(mdb, mseed)
    data = _claim_data()
    stored = mdb.get(ReminderBundle, bid).body
    assert data["web_url"] == BASE
    assert [i["body"].splitlines()[0] for i in data["items"]] == [_head("A", 1)]
    assert data["items"][0]["body"] != stored


def test_the_web_url_comes_with_an_empty_claim(mdb, mseed):
    assert _claim_data() == {"items": [], "total": 0, "web_url": BASE}


def test_the_web_url_is_null_when_unset(mdb, mseed, monkeypatch):
    monkeypatch.delenv("APP_BASE_URL")
    assert _claim_data()["web_url"] is None


# 대화 응답

def _summaries(mseed):
    inbox = client("pm").get(f"{P}/workspaces/{mseed['ws']}/messages").json()["data"]
    return {t["member_id"]: t for t in inbox["threads"]}


def test_a_thread_says_whether_its_member_can_reply_on_the_web(mdb, mseed):
    alice, carol = mseed["alice"], mseed["carol"]
    _due(mdb, mseed, mseed["tasks"][:1], SLOT)
    _due(mdb, mseed, mseed["tasks"][1:2], SLOT, who="carol")
    messages.claim_for_bot(mdb, SLOT)
    mdb.commit()
    summaries = _summaries(mseed)
    assert summaries[alice.member_id]["web_reply_available"] is True
    assert summaries[carol.member_id]["web_reply_available"] is False

    thread_id = _thread_id(mdb, mseed, "carol")
    detail = client("pm").get(f"{P}/workspaces/{mseed['ws']}/messages/threads/{thread_id}").json()["data"]
    assert detail["thread"]["web_reply_available"] is False
