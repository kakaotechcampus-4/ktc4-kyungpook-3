"""리마인드·대화 메시지 웹 API(PM, 팀원)와 봇 서비스 API. 시각이 된 상태는 DB의 발송 시각을 과거로 돌려 만든다."""
from datetime import datetime, timedelta, timezone

from app.models import DmStatus, Reminder, ReminderStatus, ThreadMessage
from app.services import messages as svc
from fastapi.testclient import TestClient

from app.main import app

P = "/api/v1"


def client(token: str | None = None, *, service: bool = False) -> TestClient:
    c = TestClient(app, base_url="https://testserver")
    if token:
        c.cookies.set("session_token", f"{token}-token")
    if service:
        c.headers["X-Service-Token"] = "test-service-token"
    return c


def _future(days=2):
    return (datetime.now(timezone.utc) + timedelta(days=days)).replace(microsecond=0)


def _iso(dt):
    return dt.isoformat()


def _create(c, seed, who="alice", task=0, at=None, body="마감 확인 부탁해요"):
    r = c.post(f"{P}/workspaces/{seed['ws']}/messages/reminders", json={
        "member_id": seed[who].member_id, "task_id": seed["tasks"][task].task_id,
        "body": body, "scheduled_at": _iso(at or _future()),
    })
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _approve(c, seed, rid):
    return c.post(f"{P}/workspaces/{seed['ws']}/messages/reminders/{rid}/approve")


def _due(db, *reminder_ids, at=None):
    """발송 시각이 된 것으로 만든다."""
    at = at or datetime.now(timezone.utc) - timedelta(minutes=1)
    for rid in reminder_ids:
        db.get(Reminder, rid).scheduled_at = at
    db.commit()


def _claim():
    r = client(service=True).post(f"{P}/bot/messages/claim")
    assert r.status_code == 200, r.text
    return r.json()["data"]["items"]


def _sent_message(db, seed, who="alice"):
    pm = client("pm")
    rid = _create(pm, seed, who)["reminder_id"]
    assert _approve(pm, seed, rid).status_code == 200
    _due(db, rid)
    return rid


# 권한

def test_only_pm_can_create_edit_approve_cancel(mdb, mseed):
    rid = _create(client("pm"), mseed)["reminder_id"]
    base = f"{P}/workspaces/{mseed['ws']}/messages/reminders"
    for who in ("alice", "outsider"):
        c = client(who)
        assert c.post(base, json={
            "member_id": mseed["alice"].member_id, "task_id": mseed["tasks"][0].task_id,
            "body": "x", "scheduled_at": _iso(_future()),
        }).status_code == 403
        assert c.patch(f"{base}/{rid}", json={"body": "y"}).status_code == 403
        assert c.post(f"{base}/{rid}/approve").status_code == 403
        assert c.post(f"{base}/{rid}/cancel").status_code == 403
    assert client().get(f"{P}/workspaces/{mseed['ws']}/messages").status_code == 401


def test_member_sees_only_own_thread(mdb, mseed):
    pm = client("pm")
    _create(pm, mseed, "alice")
    _create(pm, mseed, "bob")
    ws = mseed["ws"]

    inbox = pm.get(f"{P}/workspaces/{ws}/messages").json()["data"]
    assert len(inbox["threads"]) == 2 and len(inbox["reminders"]) == 2

    mine = client("alice").get(f"{P}/workspaces/{ws}/messages").json()["data"]
    assert [t["member_id"] for t in mine["threads"]] == [mseed["alice"].member_id]
    assert mine["reminders"] is None

    bob_thread = next(t for t in inbox["threads"] if t["member_id"] == mseed["bob"].member_id)
    assert client("alice").get(f"{P}/workspaces/{ws}/messages/threads/{bob_thread['thread_id']}").status_code == 403
    assert client("outsider").get(f"{P}/workspaces/{ws}/messages").status_code == 403
    assert pm.get(f"{P}/workspaces/{ws}/messages/threads/{bob_thread['thread_id']}").status_code == 200
    r = pm.get(f"{P}/workspaces/{ws}/messages/threads/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "MESSAGE_THREAD_NOT_FOUND"


def test_member_thread_hides_reminders(mdb, mseed):
    pm = client("pm")
    _create(pm, mseed, "alice")
    ws = mseed["ws"]
    tid = client("alice").get(f"{P}/workspaces/{ws}/messages").json()["data"]["threads"][0]["thread_id"]
    mine = client("alice").get(f"{P}/workspaces/{ws}/messages/threads/{tid}").json()["data"]
    assert mine["reminders"] is None
    assert len(pm.get(f"{P}/workspaces/{ws}/messages/threads/{tid}").json()["data"]["reminders"]) == 1


def test_bot_routes_require_service_token(mdb, mseed):
    c = client()
    assert c.post(f"{P}/bot/messages/claim").status_code == 401
    assert c.post(f"{P}/bot/messages/x/result", json={"status": "delivered"}).status_code == 401
    assert c.post(f"{P}/bot/replies", json={
        "discord_user_id": "d_alice", "discord_message_id": "1", "body": "x", "sent_at": _iso(_future(0)),
    }).status_code == 401
    assert client("pm").post(f"{P}/bot/messages/claim").status_code == 401


# 만들기, 고치기, 시각

def test_create_validation(mdb, mseed):
    pm = client("pm")
    url = f"{P}/workspaces/{mseed['ws']}/messages/reminders"
    body = {"member_id": mseed["alice"].member_id, "task_id": mseed["tasks"][0].task_id, "body": "x"}
    past = pm.post(url, json={**body, "scheduled_at": _iso(datetime.now(timezone.utc) - timedelta(hours=1))})
    assert past.status_code == 409 and past.json()["error"]["code"] == "REMINDER_SCHEDULED_AT_PASSED"
    assert pm.post(url, json={**body, "scheduled_at": "2030-01-01T09:00:00"}).status_code == 400
    assert pm.post(url, json={**body, "body": "  ", "scheduled_at": _iso(_future())}).status_code == 400
    assert pm.post(url, json={**body, "task_id": "nope", "scheduled_at": _iso(_future())}).status_code == 404
    assert pm.post(url, json={**body, "member_id": "nope", "scheduled_at": _iso(_future())}).status_code == 404


def test_edit_keeps_approval_and_rejects_past_time(mdb, mseed):
    pm = client("pm")
    rid = _create(pm, mseed)["reminder_id"]
    assert _approve(pm, mseed, rid).json()["data"]["approved"] is True
    url = f"{P}/workspaces/{mseed['ws']}/messages/reminders/{rid}"
    new_at = _future(3)
    r = pm.patch(url, json={"body": "바뀐 문구", "scheduled_at": _iso(new_at)})
    data = r.json()["data"]
    assert r.status_code == 200 and data["body"] == "바뀐 문구" and data["approved"] is True
    assert datetime.fromisoformat(data["scheduled_at"]) == new_at
    past = pm.patch(url, json={"scheduled_at": _iso(datetime.now(timezone.utc) - timedelta(minutes=1))})
    assert past.status_code == 409 and past.json()["error"]["code"] == "REMINDER_SCHEDULED_AT_PASSED"
    assert pm.patch(url, json={}).status_code == 400
    assert pm.patch(f"{P}/workspaces/{mseed['ws']}/messages/reminders/nope", json={"body": "x"}).status_code == 404


def test_approve_after_time_passed_asks_for_new_time_and_is_idempotent(mdb, mseed):
    pm = client("pm")
    rid = _create(pm, mseed)["reminder_id"]
    _due(mdb, rid)
    r = _approve(pm, mseed, rid)
    assert r.status_code == 409 and r.json()["error"]["code"] == "REMINDER_SCHEDULED_AT_PASSED"

    ok = _create(pm, mseed, task=1)["reminder_id"]
    assert _approve(pm, mseed, ok).status_code == 200
    _due(mdb, ok)
    assert _approve(pm, mseed, ok).status_code == 200


def test_reminder_of_other_workspace_is_not_found(mdb, mseed):
    from app.models import Member, Workspace
    other = Workspace(name="B")
    mdb.add(other)
    mdb.flush()
    mdb.add(Member(workspace_id=other.workspace_id, user_id=mseed["pm"].user_id, display_name="PM", role="pm"))
    mdb.commit()
    rid = _create(client("pm"), mseed)["reminder_id"]
    r = client("pm").post(f"{P}/workspaces/{other.workspace_id}/messages/reminders/{rid}/cancel")
    assert r.status_code == 404 and r.json()["error"]["code"] == "REMINDER_NOT_FOUND"


# 상태 흐름

def test_scheduled_to_sent_through_claim(mdb, mseed):
    pm = client("pm")
    rid = _sent_message(mdb, mseed)
    (item,) = _claim()
    assert item["body"] == "마감 확인 부탁해요" and item["discord_user_id"] == "d_alice"
    assert item["member_id"] == mseed["alice"].member_id and item["workspace_id"] == mseed["ws"]
    mdb.expire_all()
    assert mdb.get(Reminder, rid).status == ReminderStatus.SENT
    inbox = pm.get(f"{P}/workspaces/{mseed['ws']}/messages").json()["data"]
    assert inbox["reminders"] == []
    assert inbox["threads"][0]["last_message"]["body"] == "마감 확인 부탁해요"


def test_cancel_and_non_scheduled_reminders_are_locked(mdb, mseed):
    pm = client("pm")
    base = f"{P}/workspaces/{mseed['ws']}/messages/reminders"
    cancelled = _create(pm, mseed, task=0)["reminder_id"]
    assert pm.post(f"{base}/{cancelled}/cancel").json()["data"]["status"] == "cancelled"
    sent = _sent_message(mdb, mseed)
    _claim()
    expired = _create(pm, mseed, task=2)["reminder_id"]
    svc.expire_reminder(mdb, expired, datetime.now(timezone.utc))
    mdb.commit()

    for rid in (cancelled, sent, expired):
        for r in (
            pm.patch(f"{base}/{rid}", json={"body": "x"}),
            pm.post(f"{base}/{rid}/approve"),
            pm.post(f"{base}/{rid}/cancel"),
        ):
            assert r.status_code == 409 and r.json()["error"]["code"] == "REMINDER_NOT_EDITABLE"


def test_cancelled_reminder_is_never_sent(mdb, mseed):
    pm = client("pm")
    rid = _create(pm, mseed)["reminder_id"]
    assert _approve(pm, mseed, rid).status_code == 200
    pm.post(f"{P}/workspaces/{mseed['ws']}/messages/reminders/{rid}/cancel")
    _due(mdb, rid)
    assert _claim() == []


def test_same_recipient_and_time_merge_into_one_message(mdb, mseed):
    pm = client("pm")
    at = _future()
    a = _create(pm, mseed, task=0, at=at, body="첫째")["reminder_id"]
    b = _create(pm, mseed, task=1, at=at, body="둘째")["reminder_id"]
    for rid in (a, b):
        _approve(pm, mseed, rid)
    _due(mdb, a, b)
    items = _claim()
    assert len(items) == 1 and items[0]["body"] == "첫째\n\n둘째"


def test_claim_twice_never_returns_same_message(mdb, mseed):
    _sent_message(mdb, mseed)
    assert len(_claim()) == 1
    assert _claim() == []


def test_stale_claim_fails_as_unknown_and_is_not_reoffered(mdb, mseed):
    _sent_message(mdb, mseed)
    (item,) = _claim()
    msg = mdb.get(ThreadMessage, item["message_id"])
    msg.claimed_at = datetime.now(timezone.utc) - timedelta(minutes=11)
    mdb.commit()
    assert _claim() == []
    mdb.expire_all()
    assert msg.dm_status == DmStatus.FAILED and msg.dm_failure_reason == "unknown"


def test_unlinked_member_is_marked_without_reaching_bot(mdb, mseed):
    _sent_message(mdb, mseed, who="bob")
    assert _claim() == []
    pm = client("pm")
    tid = pm.get(f"{P}/workspaces/{mseed['ws']}/messages").json()["data"]["threads"][0]["thread_id"]
    (msg,) = pm.get(f"{P}/workspaces/{mseed['ws']}/messages/threads/{tid}").json()["data"]["messages"]
    assert msg["dm_status"] == "failed" and msg["dm_failure_reason"] == "discord_not_linked"


# 결과 보고

def test_report_result_routes(mdb, mseed):
    _sent_message(mdb, mseed)
    (item,) = _claim()
    bot = client(service=True)
    url = f"{P}/bot/messages/{item['message_id']}/result"
    assert bot.post(url, json={"status": "failed"}).status_code == 400
    assert bot.post(url, json={"status": "failed", "failure_reason": "discord_not_linked"}).status_code == 400
    assert bot.post(url, json={"status": "failed", "failure_reason": "dm_blocked"}).status_code == 200
    assert bot.post(url, json={"status": "failed", "failure_reason": "dm_blocked"}).status_code == 200
    again = bot.post(url, json={"status": "delivered"})
    assert again.status_code == 409 and again.json()["error"]["code"] == "MESSAGE_RESULT_CONFLICT"
    assert bot.post(f"{P}/bot/messages/nope/result", json={"status": "delivered"}).status_code == 404


def test_dm_failure_shows_in_inbox_and_awaiting_reply(mdb, mseed):
    _sent_message(mdb, mseed)
    (item,) = _claim()
    client(service=True).post(
        f"{P}/bot/messages/{item['message_id']}/result", json={"status": "failed", "failure_reason": "dm_blocked"})
    thread = client("pm").get(f"{P}/workspaces/{mseed['ws']}/messages").json()["data"]["threads"][0]
    assert thread["dm_failed"] is True and thread["awaiting_reply_since"] is not None
    assert thread["name"] == "앨리스"


# 답장

def _reply(**kw):
    body = {"discord_user_id": "d_alice", "discord_message_id": "m1", "body": "네 오늘 끝내요",
            "sent_at": _iso(datetime.now(timezone.utc)), **kw}
    return client(service=True).post(f"{P}/bot/replies", json=body)


def test_discord_reply_is_stored_once_and_clears_awaiting(mdb, mseed):
    _sent_message(mdb, mseed)
    _claim()
    first, second = _reply(), _reply()
    assert first.status_code == 201 and second.status_code == 200
    assert first.json()["data"]["message_id"] == second.json()["data"]["message_id"]
    assert mdb.query(ThreadMessage).filter_by(discord_message_id="m1").count() == 1
    thread = client("pm").get(f"{P}/workspaces/{mseed['ws']}/messages").json()["data"]["threads"][0]
    assert thread["awaiting_reply_since"] is None and thread["last_message"]["sender"] == "member"
    assert _reply(discord_user_id="stranger", discord_message_id="m2").status_code == 404


def test_discord_dm_with_empty_or_padded_text_is_stored_as_is(mdb, mseed):
    assert _reply(discord_message_id="e1", body="").status_code == 201
    assert _reply(discord_message_id="e2", body="  네  ").status_code == 201
    bodies = {m.discord_message_id: m.body for m in mdb.query(ThreadMessage).all()}
    assert bodies == {"e1": "", "e2": "  네  "}


def test_web_reply_only_by_thread_owner_and_never_goes_to_bot(mdb, mseed):
    pm = client("pm")
    _create(pm, mseed, "alice")
    ws = mseed["ws"]
    tid = pm.get(f"{P}/workspaces/{ws}/messages").json()["data"]["threads"][0]["thread_id"]
    url = f"{P}/workspaces/{ws}/messages/threads/{tid}/replies"

    assert pm.post(url, json={"body": "PM 이 대신"}).status_code == 403
    assert client("bob").post(url, json={"body": "남이"}).status_code == 403
    assert client("alice").post(url, json={"body": "  "}).status_code == 400
    r = client("alice").post(url, json={"body": "웹으로 답해요"})
    assert r.status_code == 201 and r.json()["data"]["reply_channel"] == "web"
    assert _claim() == []
    msgs = pm.get(f"{P}/workspaces/{ws}/messages/threads/{tid}").json()["data"]["messages"]
    assert [m["body"] for m in msgs] == ["웹으로 답해요"]
