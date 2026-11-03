"""웹 안 알림(목록·배지·읽음)과 푸시 구독·발송. 푸시는 가짜 발송기로 받는 쪽을 본다."""
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.models import Notification, PushSubscription
from app.services import notifications as svc
from app.services.push import PushGone

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
    _subscribe("alice", mseed["ws"], "https://push.example/alice-phone")
    _subscribe("alice", mseed["ws"], "https://push.example/alice-laptop")
    _subscribe("bob", mseed["ws"], "https://push.example/bob")
    n = _notify(mdb, mseed, "alice", link_id="thread-1")

    sender = FakeSender()
    svc.send_pending_pushes(mdb, now=NOW, send=sender)
    mdb.commit()

    assert sorted(e for e, _ in sender.sent) == [
        "https://push.example/alice-laptop", "https://push.example/alice-phone",
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
    _subscribe("alice", mseed["ws"], "https://push.example/old")
    _subscribe("alice", mseed["ws"], "https://push.example/new")
    n = _notify(mdb, mseed, "alice")

    sender = FakeSender(fail={"https://push.example/old": PushGone()})
    svc.send_pending_pushes(mdb, now=NOW, send=sender)
    mdb.commit()

    endpoints = [s.endpoint for s in mdb.query(PushSubscription).all()]
    assert endpoints == ["https://push.example/new"]
    assert mdb.get(Notification, n.notification_id).push_status == "sent"
    assert len(_list("alice", mseed)["items"]) == 1


def test_push_failure_keeps_notification_in_list(mdb, mseed):
    _subscribe("alice", mseed["ws"], "https://push.example/broken")
    n = _notify(mdb, mseed, "alice")

    sender = FakeSender(fail={"https://push.example/broken": RuntimeError("network down")})
    svc.send_pending_pushes(mdb, now=NOW, send=sender)
    mdb.commit()

    assert mdb.get(Notification, n.notification_id).push_status == "failed"
    assert len(_list("alice", mseed)["items"]) == 1


def test_subscribe_same_endpoint_again_moves_it_to_current_user(mdb, mseed):
    _subscribe("alice", mseed["ws"], "https://push.example/shared")
    _subscribe("bob", mseed["ws"], "https://push.example/shared")
    subs = mdb.query(PushSubscription).all()
    assert [(s.endpoint, s.user_id) for s in subs] == [
        ("https://push.example/shared", mseed["bob"].user_id),
    ]


def test_unsubscribe_removes_only_own_endpoint(mdb, mseed):
    _subscribe("alice", mseed["ws"], "https://push.example/a")
    r = client("bob").request("DELETE", f"{P}/push/subscriptions", json={"endpoint": "https://push.example/a"})
    assert r.status_code == 204
    assert mdb.query(PushSubscription).count() == 1
    r = client("alice").request("DELETE", f"{P}/push/subscriptions", json={"endpoint": "https://push.example/a"})
    assert r.status_code == 204
    assert mdb.query(PushSubscription).count() == 0


def test_vapid_public_key(mdb, mseed, monkeypatch):
    monkeypatch.setenv("VAPID_PUBLIC_KEY", "BPUBLIC")
    r = client("alice").get(f"{P}/push/vapid-public-key")
    assert r.status_code == 200
    assert r.json()["data"] == {"public_key": "BPUBLIC"}

    monkeypatch.delenv("VAPID_PUBLIC_KEY")
    assert client("alice").get(f"{P}/push/vapid-public-key").json()["data"] == {"public_key": None}
