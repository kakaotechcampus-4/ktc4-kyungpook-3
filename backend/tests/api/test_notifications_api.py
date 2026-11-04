"""웹 안 알림(목록·배지·읽음)과 푸시 구독·발송. 푸시는 가짜 발송기로 받는 쪽을 본다."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pywebpush import WebPushException
from sqlalchemy import text

from app.main import app
from app.models import Notification, PushSubscription
from app.services import notifications as svc
from app.services import push
from app.services.push import PushGone, PushRejected

P = "/api/v1"
NOW = datetime(2026, 11, 4, 0, 0, tzinfo=timezone.utc)


def client(token: str) -> TestClient:
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", f"{token}-token")
    return c


def _notify(db, seed, who="alice", text="리마인드가 왔어요", **kw):
    n = svc.notify(
        db, member_id=seed[who].member_id, kind=kw.pop("kind", "reminder_sent"), text=text,
        link_type=kw.pop("link_type", "thread"), link_id=kw.pop("link_id", "t1"), now=NOW, **kw,
    )
    db.commit()
    return n


def _subscribe(who: str, ws: str, endpoint: str):
    r = client(who).post(f"{P}/push/subscriptions", json={
        "endpoint": endpoint, "keys": {"p256dh": "p" * 20, "auth": "a" * 10},
    })
    assert r.status_code == 201, r.text


class FakeSender:
    def __init__(self, fail: dict[str, Exception] | None = None):
        self.sent: list[tuple[str, dict]] = []
        self.fail = fail or {}

    def __call__(self, subscription: PushSubscription, payload: dict) -> None:
        if subscription.endpoint in self.fail:
            raise self.fail[subscription.endpoint]
        self.sent.append((subscription.endpoint, payload))


def _list(who, seed, **params):
    r = client(who).get(f"{P}/workspaces/{seed['ws']}/notifications", params=params)
    assert r.status_code == 200, r.text
    return r.json()["data"]


def test_notification_shows_in_list_and_badge_only_for_recipient(mdb, mseed):
    _notify(mdb, mseed, "alice", link_id="thread-1")

    data = _list("alice", mseed)
    assert [n["text"] for n in data["items"]] == ["리마인드가 왔어요"]
    assert data["items"][0]["link"] == {"type": "thread", "id": "thread-1"}
    assert data["items"][0]["read_at"] is None
    assert data["unread_count"] == 1
    assert _list("bob", mseed) == {"items": [], "unread_count": 0}


def test_outsider_cannot_read_workspace_notifications(mdb, mseed):
    _notify(mdb, mseed)
    r = client("outsider").get(f"{P}/workspaces/{mseed['ws']}/notifications")
    assert r.status_code == 403


def test_mark_read_lowers_badge_and_others_cannot_mark(mdb, mseed):
    n = _notify(mdb, mseed, "alice")
    url = f"{P}/workspaces/{mseed['ws']}/notifications/{n.notification_id}/read"

    assert client("bob").post(url).status_code == 404
    r = client("alice").post(url)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["read_at"] is not None
    assert _list("alice", mseed)["unread_count"] == 0
    assert client("alice").post(url).status_code == 200


def test_dedupe_key_makes_notify_once(mdb, mseed):
    first = _notify(mdb, mseed, dedupe_key="silence:r1")
    again = _notify(mdb, mseed, dedupe_key="silence:r1")
    assert first.notification_id == again.notification_id
    assert len(_list("alice", mseed)["items"]) == 1


def test_push_goes_only_to_recipient_devices(mdb, mseed):
    _subscribe("alice", mseed["ws"], "https://fcm.googleapis.com/fcm/send/alice-phone")
    _subscribe("alice", mseed["ws"], "https://fcm.googleapis.com/fcm/send/alice-laptop")
    _subscribe("bob", mseed["ws"], "https://fcm.googleapis.com/fcm/send/bob")
    n = _notify(mdb, mseed, "alice", link_id="thread-1")

    sender = FakeSender()
    svc.send_pending_pushes(mdb, now=NOW, send=sender)
    mdb.commit()

    assert sorted(e for e, _ in sender.sent) == [
        "https://fcm.googleapis.com/fcm/send/alice-laptop", "https://fcm.googleapis.com/fcm/send/alice-phone",
    ]
    payload = sender.sent[0][1]
    assert payload == {
        "notification_id": n.notification_id, "workspace_id": mseed["ws"], "kind": "reminder_sent",
        "text": "리마인드가 왔어요", "link": {"type": "thread", "id": "thread-1"},
    }
    assert mdb.get(Notification, n.notification_id).push_status == "sent"

    svc.send_pending_pushes(mdb, now=NOW, send=sender)
    assert len(sender.sent) == 2


def test_member_without_account_keeps_notification_without_push(mdb, mseed):
    n = _notify(mdb, mseed, "carol")
    sender = FakeSender()
    svc.send_pending_pushes(mdb, now=NOW, send=sender)
    mdb.commit()
    assert sender.sent == []
    assert mdb.get(Notification, n.notification_id).push_status == "skipped"


def test_gone_subscription_is_removed_and_notification_stays(mdb, mseed):
    _subscribe("alice", mseed["ws"], "https://fcm.googleapis.com/fcm/send/old")
    _subscribe("alice", mseed["ws"], "https://fcm.googleapis.com/fcm/send/new")
    n = _notify(mdb, mseed, "alice")

    sender = FakeSender(fail={"https://fcm.googleapis.com/fcm/send/old": PushGone()})
    svc.send_pending_pushes(mdb, now=NOW, send=sender)
    mdb.commit()

    endpoints = [s.endpoint for s in mdb.query(PushSubscription).all()]
    assert endpoints == ["https://fcm.googleapis.com/fcm/send/new"]
    assert mdb.get(Notification, n.notification_id).push_status == "sent"
    assert len(_list("alice", mseed)["items"]) == 1


def test_push_failure_retries_three_times_and_keeps_notification(mdb, mseed):
    _subscribe("alice", mseed["ws"], "https://fcm.googleapis.com/fcm/send/broken")
    n = _notify(mdb, mseed, "alice")

    sender = FakeSender(fail={"https://fcm.googleapis.com/fcm/send/broken": RuntimeError("network down")})
    for expected in ("pending", "pending", "failed"):
        svc.send_pending_pushes(mdb, now=NOW, send=sender)
        mdb.commit()
        assert mdb.get(Notification, n.notification_id).push_status == expected
    svc.send_pending_pushes(mdb, now=NOW, send=sender)
    assert mdb.get(Notification, n.notification_id).push_attempts == 3
    assert len(_list("alice", mseed)["items"]) == 1


def test_no_push_key_skips_push_and_keeps_notification(mdb, mseed):
    _subscribe("alice", mseed["ws"], "https://fcm.googleapis.com/fcm/send/a")
    n = _notify(mdb, mseed, "alice")
    svc.send_pending_pushes(mdb, now=NOW, send=None)
    mdb.commit()
    assert mdb.get(Notification, n.notification_id).push_status == "skipped"
    assert len(_list("alice", mseed)["items"]) == 1


def test_subscribe_same_endpoint_again_moves_it_to_current_user(mdb, mseed):
    _subscribe("alice", mseed["ws"], "https://fcm.googleapis.com/fcm/send/shared")
    _subscribe("bob", mseed["ws"], "https://fcm.googleapis.com/fcm/send/shared")
    subs = mdb.query(PushSubscription).all()
    assert [(s.endpoint, s.user_id) for s in subs] == [
        ("https://fcm.googleapis.com/fcm/send/shared", mseed["bob"].user_id),
    ]


def test_unsubscribe_removes_only_own_endpoint(mdb, mseed):
    _subscribe("alice", mseed["ws"], "https://fcm.googleapis.com/fcm/send/a")
    r = client("bob").request("DELETE", f"{P}/push/subscriptions", json={"endpoint": "https://fcm.googleapis.com/fcm/send/a"})
    assert r.status_code == 204
    assert mdb.query(PushSubscription).count() == 1
    r = client("alice").request("DELETE", f"{P}/push/subscriptions", json={"endpoint": "https://fcm.googleapis.com/fcm/send/a"})
    assert r.status_code == 204
    assert mdb.query(PushSubscription).count() == 0


def test_vapid_public_key(mdb, mseed, monkeypatch):
    monkeypatch.setenv("VAPID_PUBLIC_KEY", "BPUBLIC")
    r = client("alice").get(f"{P}/push/vapid-public-key")
    assert r.status_code == 200
    assert r.json()["data"] == {"public_key": "BPUBLIC"}

    monkeypatch.delenv("VAPID_PUBLIC_KEY")
    assert client("alice").get(f"{P}/push/vapid-public-key").json()["data"] == {"public_key": None}


@pytest.mark.parametrize("endpoint", [
    "https://169.254.169.254/latest/meta-data/",
    "https://127.0.0.1:5432/",
    "http://fcm.googleapis.com/fcm/send/a",
    "https://fcm.googleapis.com:8443/fcm/send/a",
    "https://fcm.googleapis.com@evil.example/a",
    "https://fcm.googleapis.com.evil.example/a",
    "https://127.0.0.1\\.notify.windows.com/hook",
    "https://evil.example\\.push.services.mozilla.com/a",
    "https://fcm.googleapis.com/\x00",
    "https://" + "가" * 2040,
])
def test_subscribe_refuses_addresses_that_are_not_push_services(mdb, mseed, endpoint):
    r = client("alice").post(f"{P}/push/subscriptions", json={
        "endpoint": endpoint, "keys": {"p256dh": "p" * 20, "auth": "a" * 10},
    })
    assert r.status_code == 400, r.text
    assert mdb.query(PushSubscription).count() == 0


@pytest.mark.parametrize("endpoint", [
    "https://fcm.googleapis.com/fcm/send/a",
    "https://web.push.apple.com/a",
    "https://updates.push.services.mozilla.com/wpush/v2/a",
    "https://wns2-sg2p.notify.windows.com/w/?token=a",
])
def test_subscribe_accepts_browser_push_services(mdb, mseed, endpoint):
    _subscribe("alice", mseed["ws"], endpoint)


def test_keys_and_unsubscribe_refuse_nul(mdb, mseed):
    r = client("alice").post(f"{P}/push/subscriptions", json={
        "endpoint": "https://fcm.googleapis.com/fcm/send/a", "keys": {"p256dh": "p" * 20, "auth": "a\x00"},
    })
    assert r.status_code == 400
    r = client("alice").request("DELETE", f"{P}/push/subscriptions", json={"endpoint": "https://a.example/\x00"})
    assert r.status_code == 400


def test_one_account_keeps_newest_ten_devices(mdb, mseed):
    for i in range(12):
        _subscribe("alice", mseed["ws"], f"https://fcm.googleapis.com/fcm/send/{i}")
    assert mdb.query(PushSubscription).count() == 10


def test_push_is_sent_outside_the_row_lock(mdb, mseed):
    if mdb.get_bind().dialect.name != "postgresql":
        pytest.skip("행 잠금은 PostgreSQL 에서만 본다")
    _subscribe("alice", mseed["ws"], "https://fcm.googleapis.com/fcm/send/a")
    n = _notify(mdb, mseed, "alice")
    other = mdb.get_bind().connect()

    def send(subscription, payload):
        other.execute(text("SET lock_timeout = '1s'"))
        other.execute(
            text("UPDATE notification SET read_at = now() WHERE notification_id = :id"),
            {"id": n.notification_id},
        )
        other.commit()

    svc.send_pending_pushes(mdb, now=NOW, send=send)
    other.close()
    mdb.expire_all()
    assert mdb.get(Notification, n.notification_id).read_at is not None
    assert mdb.get(Notification, n.notification_id).push_status == "sent"


def test_pushes_past_the_time_budget_wait_for_the_next_tick(mdb, mseed, monkeypatch):
    _subscribe("alice", mseed["ws"], "https://fcm.googleapis.com/fcm/send/a")
    n = _notify(mdb, mseed, "alice")
    monkeypatch.setattr(svc, "PUSH_TICK_SECONDS", -1)
    sender = FakeSender()
    svc.send_pending_pushes(mdb, now=NOW, send=sender)
    mdb.expire_all()
    row = mdb.get(Notification, n.notification_id)
    assert (sender.sent, row.push_status, row.push_attempts, row.pushed_at) == ([], "pending", 0, None)

    monkeypatch.setattr(svc, "PUSH_TICK_SECONDS", 30)
    svc.send_pending_pushes(mdb, now=NOW, send=sender)
    assert len(sender.sent) == 1


def test_claimed_push_is_left_alone_until_the_lease_ends(mdb, mseed):
    _subscribe("alice", mseed["ws"], "https://fcm.googleapis.com/fcm/send/a")
    n = _notify(mdb, mseed, "alice")
    n.pushed_at = NOW
    mdb.commit()
    sender = FakeSender()
    svc.send_pending_pushes(mdb, now=NOW + timedelta(minutes=1), send=sender)
    assert sender.sent == []
    svc.send_pending_pushes(mdb, now=NOW + svc.PUSH_LEASE + timedelta(minutes=1), send=sender)
    assert len(sender.sent) == 1


def test_left_member_gets_no_notification(mdb, mseed):
    mseed["alice"].is_deleted = True
    mdb.commit()

    assert _notify(mdb, mseed, "alice") is None
    assert mdb.query(Notification).count() == 0


def test_pending_push_is_not_sent_after_member_left(mdb, mseed):
    _subscribe("alice", mseed["ws"], "https://fcm.googleapis.com/fcm/send/alice-phone")
    n = _notify(mdb, mseed, "alice")
    mseed["alice"].is_deleted = True
    mdb.commit()

    sender = FakeSender()
    svc.send_pending_pushes(mdb, now=NOW, send=sender)
    mdb.commit()

    assert sender.sent == []
    assert mdb.get(Notification, n.notification_id).push_status == "skipped"


def test_rejected_push_keeps_subscription_and_does_not_retry(mdb, mseed):
    url = "https://fcm.googleapis.com/fcm/send/old-key"
    _subscribe("alice", mseed["ws"], url)
    n = _notify(mdb, mseed, "alice")
    sender = FakeSender(fail={url: PushRejected()})

    svc.send_pending_pushes(mdb, now=NOW, send=sender)
    mdb.commit()

    stored = mdb.get(Notification, n.notification_id)
    assert stored.push_status == "failed"
    assert stored.push_attempts == 1
    assert mdb.query(PushSubscription).filter_by(endpoint=url).count() == 1


@pytest.mark.parametrize("code", [400, 401, 403])
def test_send_turns_rejection_into_push_rejected(monkeypatch, code):
    def refuse(**_kwargs):
        raise WebPushException("rejected", response=SimpleNamespace(status_code=code))

    monkeypatch.setattr(push, "webpush", refuse)
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "unused")
    monkeypatch.setenv("VAPID_SUBJECT", "mailto:unused@example.com")
    sub = PushSubscription(endpoint="https://fcm.googleapis.com/fcm/send/x", p256dh="p", auth="a")

    with pytest.raises(PushRejected):
        push.send(sub, {})

