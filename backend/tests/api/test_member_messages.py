"""리마인드 없이 PM 과 팀원이 주고받는 글(#470). 봇 경로까지 API 로 돌린다.

재촉 전후의 묶음 문구, 나가는 DM 이 지나는 자리(claim·결과 보고·답장 경로·목록 표시), 시계와 판단을 건드리지 않는지를 본다.
"""
from datetime import datetime, timedelta, timezone

from app.models import (
    Member,
    MessageThread,
    ReminderBundle,
    ReminderWatch,
    ReplyJudgment,
    ThreadMessage,
    WatchState,
    Workspace,
)
from app.services import messages as svc
from tests.api.test_messages_api import P, _approve, _claim, _create, _due, _first, _future, _iso, _sent_message, client
from tests.api.test_replies import _remind, _reply
from tests.api.test_reply_clock import DEADLINE
from tests.api.test_scheduler import SLOT, H, tick

RULE = "'할일0' 진행 상황 한번 여쭤봐요.\n지금 어디까지 됐는지 편하게 알려 주세요!"


def _thread(db, seed, who="alice"):
    thread = svc.get_or_create_thread(db, seed["ws"], seed[who].member_id)
    db.commit()
    return thread.thread_id


def _send(c, seed, thread_id, body="회의 자료 부탁해요"):
    return c.post(f"{P}/workspaces/{seed['ws']}/messages/threads/{thread_id}/replies", json={"body": body})


def _report(item, *discord_ids):
    r = client(service=True).post(
        f"{P}/bot/messages/{item['message_id']}/result",
        json={"status": "delivered", "discord_message_ids": list(discord_ids)},
    )
    assert r.status_code == 200, r.text


def _discord(discord_message_id, *, reply_to=None, sent_at=None, user="d_alice"):
    r = client(service=True).post(f"{P}/bot/replies", json={
        "discord_user_id": user, "discord_message_id": discord_message_id, "body": "네",
        "sent_at": _iso(sent_at or datetime.now(timezone.utc)), "reply_to_discord_message_id": reply_to,
    })
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _inbox_row(c, seed, thread_id):
    threads = c.get(f"{P}/workspaces/{seed['ws']}/messages").json()["data"]["threads"]
    return next(t for t in threads if t["thread_id"] == thread_id)


# 보내기

def test_pm_message_reaches_the_bot_as_a_notice_and_the_web_keeps_what_was_written(mdb, mseed):
    pm, tid = client("pm"), _thread(mdb, mseed)
    r = _send(pm, mseed, tid, "내일 회의 자료 부탁해요")

    assert r.status_code == 201, r.text
    written = r.json()["data"]
    assert written["sender"] == "pm"
    assert written["body"] == "내일 회의 자료 부탁해요"
    assert written["dm_status"] == "pending" and written["dm_failure_reason"] is None
    assert written["reply_channel"] is None and written["scheduled_at"] is None
    assert written["author_member_id"] == mseed["pm"].member_id and written["author_name"] == "PM"

    (item,) = _claim()
    assert item["message_id"] == written["message_id"]
    assert item["body"] == "A PM PM 이 메시지를 보냈어요."
    assert item["discord_user_id"] == "d_alice" and item["scheduled_at"] is None
    assert _claim() == []

    _report(item, "dm_1")
    detail = pm.get(f"{P}/workspaces/{mseed['ws']}/messages/threads/{tid}").json()["data"]
    (shown,) = detail["messages"]
    assert shown["body"] == "내일 회의 자료 부탁해요" and shown["dm_status"] == "delivered"
    last = detail["thread"]["last_message"]
    assert (last["sender"], last["author_member_id"], last["author_name"]) == ("pm", mseed["pm"].member_id, "PM")


def test_each_pm_signs_their_own_message_in_one_thread(mdb, mseed):
    mseed["bob"].role = "pm"
    mdb.commit()
    tid = _thread(mdb, mseed)
    _send(client("pm"), mseed, tid, "하나")
    _send(client("bob"), mseed, tid, "둘")

    assert [i["body"] for i in _claim()] == ["A PM PM 이 메시지를 보냈어요.", "A 밥 PM 이 메시지를 보냈어요."]


def test_member_lines_stay_authorless(mdb, mseed):
    tid = _thread(mdb, mseed)
    data = _send(client("alice"), mseed, tid, "웹으로 먼저 써요").json()["data"]

    assert (data["sender"], data["author_member_id"], data["author_name"]) == ("member", None, None)
    assert data["reply_channel"] == "web" and data["dm_status"] is None


def test_a_pm_writing_in_their_own_thread_is_the_owner_and_sends_no_dm(mdb, mseed):
    tid = _thread(mdb, mseed, "pm")
    data = _send(client("pm"), mseed, tid, "내 대화").json()["data"]

    assert (data["sender"], data["reply_channel"], data["dm_status"]) == ("member", "web", None)
    assert _claim() == []


def test_pm_message_notice_links_to_the_conversation(mdb, mseed, monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", "https://mm.example/")
    tid = _thread(mdb, mseed)
    _send(client("pm"), mseed, tid, "본문은 DM 에 나가지 않는다")

    body = _claim()[0]["body"]

    assert body == f"A PM PM 이 메시지를 보냈어요.\nhttps://mm.example/workspaces/{mseed['ws']}/messages/threads/{tid}"


# 묶음 문구

def test_plain_message_before_any_reminder_keeps_the_bundle_and_the_first_reminder_intro(mdb, mseed):
    pm = client("pm")
    created = _create(pm, mseed)
    bundle = created["bundle"]
    assert bundle["body"] == _first(RULE)
    assert _send(pm, mseed, bundle["thread_id"], "잡담이요").status_code == 201

    (item,) = _claim()
    _report(item, "dm_plain")

    mdb.expire_all()
    row = mdb.get(ReminderBundle, bundle["bundle_id"])
    assert (row.draft_version, row.body) == (bundle["draft_version"], _first(RULE))

    assert _approve(pm, mseed, bundle["bundle_id"], bundle["draft_version"]).status_code == 200
    _due(mdb, bundle["bundle_id"])
    (reminder,) = _claim()
    assert reminder["body"] == _first(RULE)


def test_the_first_reminder_after_a_plain_message_still_reframes_waiting_bundles(mdb, mseed):
    pm = client("pm")
    first = _create(pm, mseed, task=0, at=_future(2))["bundle"]
    waiting = _create(pm, mseed, task=1, at=_future(3))["bundle"]
    _send(pm, mseed, first["thread_id"], "잡담이요")
    _report(_claim()[0], "dm_plain")

    assert _approve(pm, mseed, first["bundle_id"], first["draft_version"]).status_code == 200
    _due(mdb, first["bundle_id"])
    (reminder,) = _claim()
    _report(reminder, "dm_reminder")

    mdb.expire_all()
    row = mdb.get(ReminderBundle, waiting["bundle_id"])
    assert row.draft_version == waiting["draft_version"] + 1
    assert row.body.startswith("앨리스님, PM(이)에요.\n")


# 발송 경로

def test_stale_claim_of_a_pm_message_closes_as_failed_and_a_late_report_corrects_it(mdb, mseed):
    pm, tid = client("pm"), _thread(mdb, mseed)
    _send(pm, mseed, tid)
    (item,) = _claim()
    row = mdb.get(ThreadMessage, item["message_id"])
    row.claimed_at = datetime.now(timezone.utc) - svc.CLAIM_TIMEOUT - timedelta(seconds=1)
    mdb.commit()

    assert _claim() == []
    mdb.expire_all()
    assert (row.dm_status, row.dm_failure_reason) == ("failed", "unknown")
    assert _inbox_row(pm, mseed, tid)["dm_failed"] is True

    _report(item, "dm_late")
    assert _inbox_row(pm, mseed, tid)["dm_failed"] is False


def test_report_on_a_member_message_is_not_found(mdb, mseed):
    tid = _thread(mdb, mseed)
    message_id = _send(client("alice"), mseed, tid).json()["data"]["message_id"]
    r = client(service=True).post(
        f"{P}/bot/messages/{message_id}/result", json={"status": "delivered", "discord_message_ids": ["x"]},
    )
    assert r.status_code == 404 and r.json()["error"]["code"] == "MESSAGE_NOT_FOUND"


def test_unlinked_owner_gets_the_message_on_the_web_and_a_failed_dm_with_no_resend(mdb, mseed):
    pm, tid = client("pm"), _thread(mdb, mseed, "bob")
    data = _send(pm, mseed, tid).json()["data"]

    assert (data["dm_status"], data["dm_failure_reason"]) == ("failed", "discord_not_linked")
    assert _inbox_row(pm, mseed, tid)["dm_failed"] is True
    assert _claim() == []

    mseed["bob"].discord_user_id = "d_bob"
    mdb.commit()
    assert _claim() == []


def test_dm_failed_follows_the_last_outgoing_message_whoever_wrote_it(mdb, mseed):
    pm, tid = client("pm"), _thread(mdb, mseed)
    _sent_message(mdb, mseed)
    (reminder,) = _claim()
    _report(reminder, "dm_1")
    _send(pm, mseed, tid)
    (plain,) = _claim()
    client(service=True).post(
        f"{P}/bot/messages/{plain['message_id']}/result", json={"status": "failed", "failure_reason": "dm_blocked"},
    )

    assert _inbox_row(pm, mseed, tid)["dm_failed"] is True


# 두 공간에 연결된 팀원의 답장

def _second_workspace(db, seed):
    """pm 계정이 B 의 PM 이고, 앨리스의 같은 디스코드 계정이 B 에도 있다. A 의 팀원 행이 더 늦게 만들어져 B 가 기본값으로 뽑히지 않는다."""
    other = Workspace(name="B")
    db.add(other)
    db.flush()
    before = datetime.now(timezone.utc) - timedelta(days=30)
    pm = Member(workspace_id=other.workspace_id, user_id=seed["pm"].user_id, display_name="비", role="pm")
    alice = Member(
        workspace_id=other.workspace_id, display_name="앨리스B", role="member", discord_user_id="d_alice",
        created_at=before,
    )
    db.add_all([pm, alice])
    db.flush()
    thread = svc.get_or_create_thread(db, other.workspace_id, alice.member_id)
    db.commit()
    return other.workspace_id, thread.thread_id


def _send_in(workspace_id, thread_id, body="B 공간 글"):
    r = client("pm").post(f"{P}/workspaces/{workspace_id}/messages/threads/{thread_id}/replies", json={"body": body})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def test_reply_to_a_pm_dm_lands_in_that_workspace(mdb, mseed):
    other_ws, other_thread = _second_workspace(mdb, mseed)
    _sent_message(mdb, mseed)
    (reminder,) = _claim()
    _report(reminder, "dm_a")
    _send_in(other_ws, other_thread)
    (plain,) = _claim()
    assert plain["body"] == "B 비 PM 이 메시지를 보냈어요."
    _report(plain, "dm_b")

    later = datetime.now(timezone.utc) + timedelta(minutes=5)
    assert _discord("r1", reply_to="dm_b", sent_at=later)["workspace_id"] == other_ws
    assert _discord("r2", reply_to="dm_a", sent_at=later)["workspace_id"] == mseed["ws"]
    assert _discord("r3", sent_at=later)["workspace_id"] == other_ws


def test_reply_without_the_reply_feature_goes_to_the_open_reminder_not_the_pm_notice(mdb, mseed):
    other_ws, other_thread = _second_workspace(mdb, mseed)
    _remind(mdb, mseed, [mseed["tasks"][0]], SLOT)
    _send_in(other_ws, other_thread)
    (plain,) = _claim()
    _report(plain, "dm_b")

    later = datetime.now(timezone.utc) + timedelta(minutes=5)

    assert _discord("r1", sent_at=later)["workspace_id"] == mseed["ws"]
    assert _discord("r2", reply_to="dm_b", sent_at=later)["workspace_id"] == other_ws


def test_reply_to_the_only_pm_notice_reaches_that_workspace(mdb, mseed):
    other_ws, other_thread = _second_workspace(mdb, mseed)
    _send_in(other_ws, other_thread)
    (plain,) = _claim()
    _report(plain, "dm_b")

    later = datetime.now(timezone.utc) + timedelta(minutes=5)

    assert _discord("r1", sent_at=later)["workspace_id"] == other_ws


def test_reminder_that_never_went_out_does_not_beat_a_delivered_pm_notice(mdb, mseed):
    other_ws, other_thread = _second_workspace(mdb, mseed)
    mdb.add(ThreadMessage(
        thread_id=_thread(mdb, mseed), sender="bot", body="A 의 재촉", dm_status="failed",
        dm_failure_reason="discord_not_linked", created_at=datetime.now(timezone.utc) + timedelta(minutes=1),
    ))
    mdb.commit()
    _send_in(other_ws, other_thread)
    (plain,) = _claim()
    _report(plain, "dm_b")

    assert _discord("r1", sent_at=datetime.now(timezone.utc) + timedelta(minutes=5))["workspace_id"] == other_ws


def test_reply_before_any_report_goes_to_the_workspace_the_bot_last_spoke_in(mdb, mseed):
    other_ws, other_thread = _second_workspace(mdb, mseed)
    mdb.add(ThreadMessage(
        thread_id=_thread(mdb, mseed), sender="bot", body="A 의 재촉", dm_status="claimed",
        claimed_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        created_at=datetime.now(timezone.utc) - timedelta(minutes=5),
    ))
    mdb.commit()
    _send_in(other_ws, other_thread)
    _claim()

    assert _discord("r1")["workspace_id"] == other_ws


# 시계와 판단

def test_plain_messages_leave_the_clock_and_judgment_alone(mdb, mseed):
    a = mseed["tasks"][0]
    a.status = "in_progress"
    _remind(mdb, mseed, [a], SLOT)
    thread = svc.get_or_create_thread(mdb, mseed["ws"], mseed["alice"].member_id)
    message = svc.add_pm_message(mdb, thread, author=mseed["pm"], body="잡담이요", now=SLOT + H)
    mdb.commit()

    assert mdb.get(ReplyJudgment, message.message_id) is None

    tick(mdb, DEADLINE)
    mdb.expire_all()
    assert a.status == "blocked"
    assert mdb.query(ReminderWatch).one().state == WatchState.BLOCKED


def test_plain_message_is_not_counted_as_waiting_for_a_reply(mdb, mseed):
    pm, tid = client("pm"), _thread(mdb, mseed)
    _send(pm, mseed, tid)

    assert _inbox_row(pm, mseed, tid)["awaiting_reply_since"] is None


def test_reply_to_a_plain_message_with_no_reminder_is_stored_without_judgment(mdb, mseed):
    pm, tid = client("pm"), _thread(mdb, mseed)
    _send(pm, mseed, tid)
    _report(_claim()[0], "dm_1")
    data = _discord("r1", reply_to="dm_1")

    assert data["workspace_id"] == mseed["ws"]
    assert mdb.query(ReplyJudgment).count() == 0
    rows = pm.get(f"{P}/workspaces/{mseed['ws']}/messages/threads/{tid}").json()["data"]["messages"]
    assert [m["sender"] for m in rows] == ["pm", "member"]


def test_judge_lines_label_pm_messages_as_pm(mdb, mseed):
    a = mseed["tasks"][0]
    _remind(mdb, mseed, [a], SLOT)
    thread = svc.get_or_create_thread(mdb, mseed["ws"], mseed["alice"].member_id)
    svc.add_pm_message(mdb, thread, author=mseed["pm"], body="회의 자료요", now=SLOT + H)
    mdb.commit()
    _reply(mdb, mseed, SLOT + 2 * H, body="네 올렸어요")

    item = client(service=True).post(f"{P}/bot/replies/claim").json()["data"]["item"]
    assert [(line["sender"], line["text"]) for line in item["lines"]][1:] == [("pm", "회의 자료요"), ("member", "네 올렸어요")]
    assert item["lines"][0]["sender"] == "pm"
    assert [c["task_id"] for c in item["candidates"]] == [a.task_id]


# 권한

def test_who_may_write_where(mdb, mseed):
    alice_thread, bob_thread = _thread(mdb, mseed), _thread(mdb, mseed, "bob")

    assert _send(client("pm"), mseed, alice_thread).status_code == 201
    assert _send(client("alice"), mseed, alice_thread).status_code == 201
    assert _send(client("alice"), mseed, bob_thread).status_code == 403
    assert _send(client("outsider"), mseed, alice_thread).status_code == 403


def test_thread_of_another_workspace_is_not_found(mdb, mseed):
    other = Workspace(name="B")
    mdb.add(other)
    mdb.flush()
    stranger = Member(workspace_id=other.workspace_id, display_name="남", role="member")
    mdb.add(stranger)
    mdb.flush()
    foreign = svc.get_or_create_thread(mdb, other.workspace_id, stranger.member_id)
    mdb.commit()

    r = _send(client("pm"), mseed, foreign.thread_id)
    assert r.status_code == 404 and r.json()["error"]["code"] == "MESSAGE_THREAD_NOT_FOUND"


def test_pm_cannot_write_to_a_deleted_thread_owner(mdb, mseed):
    tid = _thread(mdb, mseed)
    mseed["alice"].is_deleted = True
    mdb.commit()

    r = _send(client("pm"), mseed, tid)
    assert r.status_code == 404 and r.json()["error"]["code"] == "MEMBER_NOT_FOUND"
    assert mdb.query(ThreadMessage).count() == 0


# 대화 열기

def _open(c, seed, member_id):
    return c.post(f"{P}/workspaces/{seed['ws']}/messages/threads", json={"member_id": member_id})


def test_pm_opens_a_thread_in_a_workspace_with_no_reminders_and_it_reaches_the_bot(mdb, mseed):
    pm = client("pm")
    r = _open(pm, mseed, mseed["alice"].member_id)

    assert r.status_code == 200, r.text
    thread = r.json()["data"]
    assert thread["member_id"] == mseed["alice"].member_id and thread["name"] == "앨리스"
    assert thread["last_message"] is None and thread["dm_failed"] is False
    detail = pm.get(f"{P}/workspaces/{mseed['ws']}/messages/threads/{thread['thread_id']}").json()["data"]
    assert detail["messages"] == []

    assert _send(pm, mseed, thread["thread_id"], "안녕하세요").status_code == 201
    assert [i["body"] for i in _claim()] == ["A PM PM 이 메시지를 보냈어요."]


def test_opening_a_thread_twice_gives_the_same_thread(mdb, mseed):
    pm = client("pm")
    first = _open(pm, mseed, mseed["alice"].member_id).json()["data"]
    _send(pm, mseed, first["thread_id"], "글")
    again = _open(pm, mseed, mseed["alice"].member_id).json()["data"]

    assert again["thread_id"] == first["thread_id"]
    assert again["last_message"]["body"] == "글"


def test_member_may_open_only_their_own_thread_and_write_first(mdb, mseed):
    alice = client("alice")
    thread = _open(alice, mseed, mseed["alice"].member_id)
    assert thread.status_code == 200
    assert _send(alice, mseed, thread.json()["data"]["thread_id"], "먼저 써요").status_code == 201

    other = _open(alice, mseed, mseed["bob"].member_id)
    assert other.status_code == 403 and other.json()["error"]["code"] == "FORBIDDEN"


def test_member_learns_nothing_about_ids_that_are_not_theirs(mdb, mseed):
    assert _open(client("alice"), mseed, "no-such-member").status_code == 403


def test_outsider_cannot_open_a_thread(mdb, mseed):
    assert _open(client("outsider"), mseed, mseed["alice"].member_id).status_code == 403


def test_pm_cannot_open_a_thread_with_a_missing_foreign_or_deleted_member(mdb, mseed):
    other = Workspace(name="B")
    mdb.add(other)
    mdb.flush()
    stranger = Member(workspace_id=other.workspace_id, display_name="남", role="member")
    mdb.add(stranger)
    mseed["bob"].is_deleted = True
    mdb.commit()

    for member_id in ("no-such-member", stranger.member_id, mseed["bob"].member_id):
        r = _open(client("pm"), mseed, member_id)
        assert r.status_code == 404 and r.json()["error"]["code"] == "MEMBER_NOT_FOUND"
    assert mdb.query(MessageThread).count() == 0
