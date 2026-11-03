"""리마인드·대화 메시지 웹 API(PM, 팀원)와 봇 서비스 API. 시각이 된 상태는 DB의 발송 시각을 과거로 돌려 만든다."""
from datetime import date, datetime, timedelta, timezone

from app.models import DmStatus, Reminder, ReminderBundle, ReminderStatus, ThreadMessage
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


def _create(c, seed, who="alice", task=0, at=None, note=None):
    body = {"member_id": seed[who].member_id, "task_id": seed["tasks"][task].task_id,
            "scheduled_at": _iso(at or _future())}
    if note is not None:
        body["note"] = note
    r = c.post(f"{P}/workspaces/{seed['ws']}/messages/reminders", json=body)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _bundles_url(seed, bid=""):
    return f"{P}/workspaces/{seed['ws']}/messages/bundles" + (f"/{bid}" if bid else "")


def _approve(c, seed, bid, draft_version=None):
    """draft_version 을 주지 않으면 PM 화면처럼 받은편지함에 보이는 판으로 승인한다."""
    if draft_version is None:
        shown = c.get(f"{P}/workspaces/{seed['ws']}/messages").json()["data"]["bundles"] or []
        draft_version = next((b["draft_version"] for b in shown if b["bundle_id"] == bid), 0)
    return c.post(f"{_bundles_url(seed, bid)}/approve", json={"draft_version": draft_version})


def _due(db, *bundle_ids, at=None):
    """발송 시각이 된 것으로 만든다."""
    at = at or datetime.now(timezone.utc) - timedelta(minutes=1)
    for bid in bundle_ids:
        db.get(ReminderBundle, bid).scheduled_at = at
    db.commit()


def _claim():
    r = client(service=True).post(f"{P}/bot/messages/claim")
    assert r.status_code == 200, r.text
    return r.json()["data"]["items"]


def _sent_message(db, seed, who="alice", note="마감 확인 부탁해요"):
    pm = client("pm")
    bid = _create(pm, seed, who, note=note)["bundle"]["bundle_id"]
    assert _approve(pm, seed, bid).status_code == 200
    _due(db, bid)
    return bid


# 권한

def test_only_pm_can_touch_reminders_and_bundles(mdb, mseed):
    created = _create(client("pm"), mseed)
    rid, bid = created["reminder"]["reminder_id"], created["bundle"]["bundle_id"]
    base = f"{P}/workspaces/{mseed['ws']}/messages/reminders"
    for who in ("alice", "outsider"):
        c = client(who)
        assert c.post(base, json={
            "member_id": mseed["alice"].member_id, "task_id": mseed["tasks"][0].task_id,
            "scheduled_at": _iso(_future()),
        }).status_code == 403
        assert c.patch(f"{base}/{rid}", json={"note": "y"}).status_code == 403
        assert c.post(f"{base}/{rid}/cancel").status_code == 403
        assert c.patch(_bundles_url(mseed, bid), json={"body": "y"}).status_code == 403
        assert c.post(f"{_bundles_url(mseed, bid)}/approve", json={"draft_version": 1}).status_code == 403
        assert c.post(f"{_bundles_url(mseed, bid)}/cancel").status_code == 403
    assert client().get(f"{P}/workspaces/{mseed['ws']}/messages").status_code == 401


def test_member_sees_only_own_thread(mdb, mseed):
    pm = client("pm")
    _create(pm, mseed, "alice")
    _create(pm, mseed, "bob")
    ws = mseed["ws"]

    inbox = pm.get(f"{P}/workspaces/{ws}/messages").json()["data"]
    assert len(inbox["threads"]) == 2 and len(inbox["bundles"]) == 2

    mine = client("alice").get(f"{P}/workspaces/{ws}/messages").json()["data"]
    assert [t["member_id"] for t in mine["threads"]] == [mseed["alice"].member_id]
    assert mine["bundles"] is None

    bob_thread = next(t for t in inbox["threads"] if t["member_id"] == mseed["bob"].member_id)
    assert client("alice").get(f"{P}/workspaces/{ws}/messages/threads/{bob_thread['thread_id']}").status_code == 403
    assert client("outsider").get(f"{P}/workspaces/{ws}/messages").status_code == 403
    assert pm.get(f"{P}/workspaces/{ws}/messages/threads/{bob_thread['thread_id']}").status_code == 200
    r = pm.get(f"{P}/workspaces/{ws}/messages/threads/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "MESSAGE_THREAD_NOT_FOUND"


def test_member_thread_hides_bundles(mdb, mseed):
    pm = client("pm")
    _create(pm, mseed, "alice")
    ws = mseed["ws"]
    tid = client("alice").get(f"{P}/workspaces/{ws}/messages").json()["data"]["threads"][0]["thread_id"]
    mine = client("alice").get(f"{P}/workspaces/{ws}/messages/threads/{tid}").json()["data"]
    assert mine["bundles"] is None
    assert len(pm.get(f"{P}/workspaces/{ws}/messages/threads/{tid}").json()["data"]["bundles"]) == 1


def test_bot_routes_require_service_token(mdb, mseed):
    c = client()
    assert c.post(f"{P}/bot/messages/claim").status_code == 401
    assert c.post(f"{P}/bot/messages/x/result", json={"status": "delivered"}).status_code == 401
    assert c.post(f"{P}/bot/replies", json={
        "discord_user_id": "d_alice", "discord_message_id": "1", "body": "x", "sent_at": _iso(_future(0)),
    }).status_code == 401
    assert c.post(f"{P}/bot/drafts/claim").status_code == 401
    assert c.post(f"{P}/bot/drafts/x", json={"draft_version": 1, "body": None}).status_code == 401
    assert client("pm").post(f"{P}/bot/messages/claim").status_code == 401


# 만들기와 묶음

def test_create_returns_reminder_in_its_bundle(mdb, mseed):
    mseed["tasks"][0].due_date = date(2026, 11, 13)
    mdb.commit()
    at = _future()
    data = _create(client("pm"), mseed, at=at)
    reminder, bundle = data["reminder"], data["bundle"]
    assert reminder["bundle_id"] == bundle["bundle_id"] and reminder["note"] is None
    assert reminder["task_title"] == "할일0" and reminder["due_date"] == "2026-11-13"
    assert bundle["recipient_name"] == "앨리스" and bundle["member_id"] == mseed["alice"].member_id
    assert datetime.fromisoformat(bundle["scheduled_at"]) == at
    assert bundle["body"] == "앨리스님, 할일0 마감이 11/13(금)이라 한번 여쭤봐요. 지금 어디까지 됐는지 편하게 알려 주세요!"
    assert (bundle["status"], bundle["approved"], bundle["body_source"], bundle["draft_status"]) == (
        "scheduled", False, "rule", "needed")
    assert [r["reminder_id"] for r in bundle["reminders"]] == [reminder["reminder_id"]]


def test_create_validation(mdb, mseed):
    pm = client("pm")
    url = f"{P}/workspaces/{mseed['ws']}/messages/reminders"
    body = {"member_id": mseed["alice"].member_id, "task_id": mseed["tasks"][0].task_id}
    past = pm.post(url, json={**body, "scheduled_at": _iso(datetime.now(timezone.utc) - timedelta(hours=1))})
    assert past.status_code == 409 and past.json()["error"]["code"] == "REMINDER_SCHEDULED_AT_PASSED"
    assert pm.post(url, json={**body, "scheduled_at": "2030-01-01T09:00:00"}).status_code == 400
    assert pm.post(url, json={**body, "task_id": "nope", "scheduled_at": _iso(_future())}).status_code == 404
    assert pm.post(url, json={**body, "member_id": "nope", "scheduled_at": _iso(_future())}).status_code == 404
    blank = pm.post(url, json={**body, "note": "  ", "scheduled_at": _iso(_future())})
    assert blank.status_code == 201 and blank.json()["data"]["reminder"]["note"] is None


def test_same_recipient_and_time_merge_and_unapprove(mdb, mseed):
    pm = client("pm")
    at = _future()
    first = _create(pm, mseed, task=0, at=at, note="첫째")
    bid = first["bundle"]["bundle_id"]
    assert first["bundle"]["body_source"] == "pm" and first["bundle"]["draft_status"] == "done"
    assert _approve(pm, mseed, bid).json()["data"]["approved"] is True

    second = _create(pm, mseed, task=1, at=at, note="둘째")
    bundle = second["bundle"]
    assert bundle["bundle_id"] == bid and bundle["approved"] is False
    assert bundle["body"] == "첫째\n\n둘째" and bundle["draft_status"] == "needed"
    assert len(pm.get(f"{P}/workspaces/{mseed['ws']}/messages").json()["data"]["bundles"]) == 1


def test_reminder_edit_moves_to_other_bundle_and_rejects_past_time(mdb, mseed):
    pm = client("pm")
    at = _future()
    stay = _create(pm, mseed, task=0, at=at, note="남음")
    move = _create(pm, mseed, task=1, at=at, note="옮김")["reminder"]["reminder_id"]
    url = f"{P}/workspaces/{mseed['ws']}/messages/reminders/{move}"

    r = pm.patch(url, json={"scheduled_at": _iso(_future(3))})
    assert r.status_code == 200
    moved = r.json()["data"]["bundle"]
    assert moved["bundle_id"] != stay["bundle"]["bundle_id"] and moved["body"] == "옮김"
    inbox = {b["bundle_id"]: b for b in pm.get(f"{P}/workspaces/{mseed['ws']}/messages").json()["data"]["bundles"]}
    assert inbox[stay["bundle"]["bundle_id"]]["body"] == "남음"

    cleared = pm.patch(url, json={"note": None}).json()["data"]
    assert cleared["reminder"]["note"] is None and cleared["bundle"]["body_source"] == "rule"
    past = pm.patch(url, json={"scheduled_at": _iso(datetime.now(timezone.utc) - timedelta(minutes=1))})
    assert past.status_code == 409 and past.json()["error"]["code"] == "REMINDER_SCHEDULED_AT_PASSED"
    assert pm.patch(url, json={}).status_code == 400
    assert pm.patch(f"{P}/workspaces/{mseed['ws']}/messages/reminders/nope", json={"note": "x"}).status_code == 404


def test_cancelling_last_reminder_cancels_bundle(mdb, mseed):
    pm = client("pm")
    data = _create(pm, mseed)
    r = pm.post(f"{P}/workspaces/{mseed['ws']}/messages/reminders/{data['reminder']['reminder_id']}/cancel")
    assert r.status_code == 200
    assert r.json()["data"]["reminder"]["status"] == "cancelled"
    assert r.json()["data"]["bundle"]["status"] == "cancelled"
    assert pm.get(f"{P}/workspaces/{mseed['ws']}/messages").json()["data"]["bundles"] == []


# 묶음 고치기, 승인, 취소

def test_bundle_body_edit_keeps_approval_and_time_move_merges(mdb, mseed):
    pm = client("pm")
    a = _create(pm, mseed, task=0, at=_future(2), note="가")["bundle"]["bundle_id"]
    b = _create(pm, mseed, task=1, at=_future(3), note="나")["bundle"]["bundle_id"]
    assert _approve(pm, mseed, a).status_code == 200

    edited = pm.patch(_bundles_url(mseed, a), json={"body": "  고친 문구  "}).json()["data"]
    assert edited["body"] == "고친 문구" and edited["approved"] is True and edited["body_source"] == "pm"

    merged = pm.patch(_bundles_url(mseed, a), json={"scheduled_at": _iso(_future(3))}).json()["data"]
    assert merged["bundle_id"] == b and merged["approved"] is False
    assert merged["body"] == "가\n\n나" and len(merged["reminders"]) == 2
    assert [x["bundle_id"] for x in pm.get(f"{P}/workspaces/{mseed['ws']}/messages").json()["data"]["bundles"]] == [b]


def test_bundle_edit_validation(mdb, mseed):
    pm = client("pm")
    bid = _create(pm, mseed)["bundle"]["bundle_id"]
    url = _bundles_url(mseed, bid)
    assert pm.patch(url, json={}).status_code == 400
    assert pm.patch(url, json={"body": "  "}).status_code == 400
    past = pm.patch(url, json={"scheduled_at": _iso(datetime.now(timezone.utc) - timedelta(minutes=1))})
    assert past.status_code == 409 and past.json()["error"]["code"] == "REMINDER_SCHEDULED_AT_PASSED"
    missing = pm.patch(_bundles_url(mseed, "nope"), json={"body": "x"})
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "REMINDER_BUNDLE_NOT_FOUND"


def test_approve_after_time_passed_asks_for_new_time_and_is_idempotent(mdb, mseed):
    pm = client("pm")
    late = _create(pm, mseed, task=0)["bundle"]["bundle_id"]
    _due(mdb, late)
    r = _approve(pm, mseed, late)
    assert r.status_code == 409 and r.json()["error"]["code"] == "REMINDER_SCHEDULED_AT_PASSED"

    ok = _create(pm, mseed, who="carol", task=1)["bundle"]["bundle_id"]
    assert _approve(pm, mseed, ok).status_code == 200
    _due(mdb, ok)
    assert _approve(pm, mseed, ok).status_code == 200


def test_bundle_of_other_workspace_is_not_found(mdb, mseed):
    from app.models import Member, Workspace
    other = Workspace(name="B")
    mdb.add(other)
    mdb.flush()
    mdb.add(Member(workspace_id=other.workspace_id, user_id=mseed["pm"].user_id, display_name="PM", role="pm"))
    mdb.commit()
    data = _create(client("pm"), mseed)
    base = f"{P}/workspaces/{other.workspace_id}/messages"
    r = client("pm").post(f"{base}/bundles/{data['bundle']['bundle_id']}/cancel")
    assert r.status_code == 404 and r.json()["error"]["code"] == "REMINDER_BUNDLE_NOT_FOUND"
    r = client("pm").post(f"{base}/reminders/{data['reminder']['reminder_id']}/cancel")
    assert r.status_code == 404 and r.json()["error"]["code"] == "REMINDER_NOT_FOUND"


def test_bundle_cancel_cancels_reminders_and_closed_bundles_are_locked(mdb, mseed):
    pm = client("pm")
    data = _create(pm, mseed, task=0)
    bid, rid = data["bundle"]["bundle_id"], data["reminder"]["reminder_id"]
    cancelled = pm.post(f"{_bundles_url(mseed, bid)}/cancel").json()["data"]
    assert cancelled["status"] == "cancelled" and [r["status"] for r in cancelled["reminders"]] == ["cancelled"]
    sent = _sent_message(mdb, mseed, who="carol")
    _claim()

    for target in (bid, sent):
        for r in (
            pm.patch(_bundles_url(mseed, target), json={"body": "x"}),
            pm.post(f"{_bundles_url(mseed, target)}/approve", json={"draft_version": 1}),
            pm.post(f"{_bundles_url(mseed, target)}/cancel"),
        ):
            assert r.status_code == 409 and r.json()["error"]["code"] == "REMINDER_NOT_EDITABLE"
    for r in (
        pm.patch(f"{P}/workspaces/{mseed['ws']}/messages/reminders/{rid}", json={"note": "x"}),
        pm.post(f"{P}/workspaces/{mseed['ws']}/messages/reminders/{rid}/cancel"),
    ):
        assert r.status_code == 409 and r.json()["error"]["code"] == "REMINDER_NOT_EDITABLE"


# 발송

def test_scheduled_to_sent_through_claim(mdb, mseed):
    pm = client("pm")
    bid = _sent_message(mdb, mseed)
    (item,) = _claim()
    assert item["body"] == "마감 확인 부탁해요" and item["discord_user_id"] == "d_alice"
    assert item["member_id"] == mseed["alice"].member_id and item["workspace_id"] == mseed["ws"]
    mdb.expire_all()
    assert mdb.get(ReminderBundle, bid).status == ReminderStatus.SENT
    assert {r.status for r in mdb.query(Reminder).filter_by(bundle_id=bid)} == {ReminderStatus.SENT}
    inbox = pm.get(f"{P}/workspaces/{mseed['ws']}/messages").json()["data"]
    assert inbox["bundles"] == []
    assert inbox["threads"][0]["last_message"]["body"] == "마감 확인 부탁해요"


def test_dispatch_sends_the_bundle_text_the_pm_approved(mdb, mseed):
    pm = client("pm")
    at = _future()
    bid = _create(pm, mseed, task=0, at=at)["bundle"]["bundle_id"]
    _create(pm, mseed, task=1, at=at)
    pm.patch(_bundles_url(mseed, bid), json={"body": "두 가지 다 어때요?"})
    _approve(pm, mseed, bid)
    _due(mdb, bid)
    items = _claim()
    assert [i["body"] for i in items] == ["두 가지 다 어때요?"]


def test_cancelled_bundle_is_never_sent(mdb, mseed):
    pm = client("pm")
    bid = _create(pm, mseed)["bundle"]["bundle_id"]
    assert _approve(pm, mseed, bid).status_code == 200
    pm.post(f"{_bundles_url(mseed, bid)}/cancel")
    _due(mdb, bid)
    assert _claim() == []


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


# AI 초안

def _draft_claim():
    r = client(service=True).post(f"{P}/bot/drafts/claim")
    assert r.status_code == 200, r.text
    return r.json()["data"]


def test_draft_claim_item_shape(mdb, mseed):
    mseed["tasks"][0].due_date = date(2026, 11, 14)
    mdb.commit()
    pm = client("pm")
    at = _future()
    _create(pm, mseed, "carol", task=2, at=at, note="PM 이 쓴 말투예요")
    _approve(pm, mseed, _create(pm, mseed, "carol", task=2, at=_future(4), note="PM 이 쓴 말투예요")["bundle"]["bundle_id"])
    bundle = _create(pm, mseed, task=0, at=at)["bundle"]
    _create(pm, mseed, task=1, at=at, note="메모")

    data = _draft_claim()
    (item,) = [i for i in data["items"] if i["bundle_id"] == bundle["bundle_id"]]
    assert data["total"] == len(data["items"])
    assert set(item) == {"bundle_id", "draft_version", "workspace_id", "recipient_name", "scheduled_at",
                         "tasks", "style_examples", "fallback_body"}
    assert item["workspace_id"] == mseed["ws"] and item["recipient_name"] == "앨리스"
    assert datetime.fromisoformat(item["scheduled_at"]) == at
    assert item["tasks"] == [
        {"task_id": mseed["tasks"][0].task_id, "title": "할일0", "due_date": "2026-11-14", "status": "todo", "note": None},
        {"task_id": mseed["tasks"][1].task_id, "title": "할일1", "due_date": None, "status": "todo", "note": "메모"},
    ]
    assert item["style_examples"] == ["PM 이 쓴 말투예요"]
    assert item["fallback_body"].startswith("앨리스님, 할일0 마감이 11/14(토)이라") and item["fallback_body"].endswith("\n\n메모")
    assert _draft_claim()["items"] == []


def test_draft_claim_is_offered_again_after_ten_minutes(mdb, mseed):
    _create(client("pm"), mseed)
    (item,) = _draft_claim()["items"]
    assert _draft_claim()["items"] == []
    mdb.get(ReminderBundle, item["bundle_id"]).draft_claimed_at = datetime.now(timezone.utc) - timedelta(minutes=11)
    mdb.commit()
    assert [i["bundle_id"] for i in _draft_claim()["items"]] == [item["bundle_id"]]


def test_draft_write_back_routes(mdb, mseed):
    pm = client("pm")
    _create(pm, mseed)
    (item,) = _draft_claim()["items"]
    bot = client(service=True)
    url = f"{P}/bot/drafts/{item['bundle_id']}"
    assert bot.post(url, json={"draft_version": item["draft_version"], "body": "  "}).status_code == 400
    assert bot.post(url, json={"draft_version": item["draft_version"], "body": "가" * 2001}).status_code == 400
    assert bot.post(url, json={"draft_version": item["draft_version"]}).status_code == 400
    stale = bot.post(url, json={"draft_version": item["draft_version"] + 1, "body": "x"})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "DRAFT_STALE"
    missing = bot.post(f"{P}/bot/drafts/nope", json={"draft_version": 1, "body": "x"})
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "REMINDER_BUNDLE_NOT_FOUND"

    assert bot.post(url, json={"draft_version": item["draft_version"], "body": " 앨리스님, 할일0 어때요? "}).status_code == 200
    (bundle,) = pm.get(f"{P}/workspaces/{mseed['ws']}/messages").json()["data"]["bundles"]
    assert (bundle["body"], bundle["body_source"], bundle["draft_status"]) == ("앨리스님, 할일0 어때요?", "ai", "done")


def test_pm_edit_or_approval_blocks_ai_write_back(mdb, mseed):
    pm = client("pm")
    a = _create(pm, mseed, "alice")["bundle"]["bundle_id"]
    c = _create(pm, mseed, "carol")["bundle"]["bundle_id"]
    versions = {i["bundle_id"]: i["draft_version"] for i in _draft_claim()["items"]}
    pm.patch(_bundles_url(mseed, a), json={"body": "PM 이 직접"})
    _approve(pm, mseed, c)
    bot = client(service=True)
    for bid in (a, c):
        r = bot.post(f"{P}/bot/drafts/{bid}", json={"draft_version": versions[bid], "body": "AI 초안"})
        assert r.status_code == 409 and r.json()["error"]["code"] == "DRAFT_STALE"
    bodies = {b["bundle_id"]: b["body"] for b in pm.get(f"{P}/workspaces/{mseed['ws']}/messages").json()["data"]["bundles"]}
    assert bodies[a] == "PM 이 직접" and "AI 초안" not in bodies[c]


def test_ai_could_not_draft_keeps_rule_text(mdb, mseed):
    pm = client("pm")
    rule = _create(pm, mseed)["bundle"]["body"]
    (item,) = _draft_claim()["items"]
    r = client(service=True).post(f"{P}/bot/drafts/{item['bundle_id']}",
                                  json={"draft_version": item["draft_version"], "body": None})
    assert r.status_code == 200
    (bundle,) = pm.get(f"{P}/workspaces/{mseed['ws']}/messages").json()["data"]["bundles"]
    assert (bundle["body"], bundle["body_source"], bundle["draft_status"]) == (rule, "rule", "done")


# 결과 보고

def test_report_result_routes(mdb, mseed):
    _sent_message(mdb, mseed)
    (item,) = _claim()
    bot = client(service=True)
    url = f"{P}/bot/messages/{item['message_id']}/result"
    assert bot.post(url, json={"status": "failed"}).status_code == 400
    assert bot.post(url, json={"status": "failed", "failure_reason": "discord_not_linked"}).status_code == 400
    assert bot.post(url, json={"status": "delivered"}).status_code == 400
    assert bot.post(url, json={"status": "delivered", "discord_message_ids": []}).status_code == 400
    assert bot.post(url, json={"status": "delivered", "discord_message_ids": ["dm1", "dm2"]}).status_code == 200
    assert bot.post(url, json={"status": "delivered", "discord_message_ids": ["dm1", "dm2"]}).status_code == 200
    again = bot.post(url, json={"status": "failed", "failure_reason": "dm_blocked"})
    assert again.status_code == 409 and again.json()["error"]["code"] == "MESSAGE_RESULT_CONFLICT"
    missing = bot.post(f"{P}/bot/messages/nope/result", json={"status": "delivered", "discord_message_ids": ["x"]})
    assert missing.status_code == 404


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


def test_reply_to_a_bot_dm_lands_in_that_workspace(mdb, mseed):
    from app.models import Member, Workspace
    other = Workspace(name="B")
    mdb.add(other)
    mdb.flush()
    alice_b = Member(workspace_id=other.workspace_id, display_name="앨리스B", role="member", discord_user_id="d_alice",
                     created_at=datetime.now(timezone.utc) + timedelta(days=1))
    mdb.add(alice_b)
    mdb.commit()
    _sent_message(mdb, mseed)
    (item,) = _claim()
    client(service=True).post(f"{P}/bot/messages/{item['message_id']}/result",
                              json={"status": "delivered", "discord_message_ids": ["dm_a"]})

    from app.services import messages as svc
    later = datetime.now(timezone.utc) + timedelta(minutes=5)
    from app.models import BotDmPart
    b_dm = ThreadMessage(
        thread_id=svc.get_or_create_thread(mdb, other.workspace_id, alice_b.member_id).thread_id,
        sender="bot", body="B 의 DM", created_at=later, dm_status="delivered", claimed_at=later, dm_reported_at=later,
    )
    mdb.add(b_dm)
    mdb.flush()
    mdb.add(BotDmPart(discord_message_id="dm_b", message_id=b_dm.message_id, created_at=later))
    mdb.commit()

    replied = _reply(discord_message_id="r1", reply_to_discord_message_id="dm_a", sent_at=_iso(later))
    assert replied.status_code == 201 and replied.json()["data"]["workspace_id"] == mseed["ws"]
    plain = _reply(discord_message_id="r2", sent_at=_iso(later))
    assert plain.json()["data"]["workspace_id"] == other.workspace_id


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


def test_deleted_member_bundles_leave_inbox_with_their_thread(mdb, mseed):
    pm = client("pm")
    _create(pm, mseed, "alice")
    mseed["alice"].is_deleted = True
    mdb.commit()
    data = pm.get(f"{P}/workspaces/{mseed['ws']}/messages").json()["data"]
    assert data["threads"] == []
    assert data["bundles"] == []


def test_body_edit_with_merging_time_move_is_rejected_and_keeps_both_bundles(mdb, mseed):
    pm = client("pm")
    a = _create(pm, mseed, task=0, at=_future(2), note="가")["bundle"]["bundle_id"]
    b = _create(pm, mseed, task=1, at=_future(3), note="나")["bundle"]["bundle_id"]
    r = pm.patch(_bundles_url(mseed, a), json={"body": "고친 문구", "scheduled_at": _iso(_future(3))})
    assert r.status_code == 400 and r.json()["error"]["code"] == "INVALID_REQUEST"
    bundles = pm.get(f"{P}/workspaces/{mseed['ws']}/messages").json()["data"]["bundles"]
    assert sorted(x["bundle_id"] for x in bundles) == sorted([a, b])
    assert {x["bundle_id"]: x["body"] for x in bundles}[a] == "가"


def test_approving_while_draft_is_pending_freezes_the_text(mdb, mseed):
    pm = client("pm")
    bundle = _create(pm, mseed)["bundle"]
    assert bundle["draft_status"] == "needed"
    approved = _approve(pm, mseed, bundle["bundle_id"]).json()["data"]
    assert approved["approved"] is True and approved["draft_status"] == "done"


def test_approve_needs_the_draft_version_on_screen_and_refuses_a_changed_text(mdb, mseed):
    pm, bot = client("pm"), client(service=True)
    shown = _create(pm, mseed)["bundle"]
    url = f"{_bundles_url(mseed, shown['bundle_id'])}/approve"
    assert pm.post(url).status_code == 400

    (item,) = bot.post(f"{P}/bot/drafts/claim").json()["data"]["items"]
    written = bot.post(f"{P}/bot/drafts/{item['bundle_id']}",
                       json={"draft_version": item["draft_version"], "body": "AI 가 새로 쓴 문구"})
    assert written.status_code == 200

    stale = pm.post(url, json={"draft_version": shown["draft_version"]})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "BUNDLE_CHANGED"
    current = stale.json()["error"]["details"]["draft_version"]
    assert current != shown["draft_version"]
    (on_screen,) = pm.get(f"{P}/workspaces/{mseed['ws']}/messages").json()["data"]["bundles"]
    assert on_screen["draft_version"] == current and on_screen["approved"] is False

    approved = pm.post(url, json={"draft_version": current}).json()["data"]
    assert approved["approved"] is True and approved["body"] == "AI 가 새로 쓴 문구"
    assert pm.post(url, json={"draft_version": shown["draft_version"]}).status_code == 200
