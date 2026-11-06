"""행 하나의 실패가 틱 전체로 번지지 않는지, 틱과 봇 가져가기가 교착하지 않는지."""
import threading
import time
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from app.core.database import get_db
from app.main import app
from app.models import Member, Notification, Reminder, ReminderOrigin, ReminderWatch, Task, WatchState
from app.services import messages, notifications, scheduler
from tests.api.conftest import SERVICE_TOKEN
from tests.api.test_notifications_api import P, client
from tests.api.test_scheduler import DUE, PROPOSE, SLOT, _approve_all, _assign, _notes, _send, tick


def _victim_past_deadline(mdb, mseed):
    """Workspace A: a delivered reminder whose 72 hours have run out."""
    task = _assign(mdb, mseed, 0)
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    _send(mdb, SLOT)
    return task, SLOT + timedelta(hours=73)


def _poison(mdb, due: str):
    """A different tenant: any signed-in account makes its own workspace, is its PM, adds a task for itself."""
    c = client("outsider")
    r = c.post(f"{P}/workspaces", json={"name": "other tenant"})
    assert r.status_code == 201, r.text
    ws = r.json()["data"]
    member = mdb.query(Member).filter(Member.workspace_id == ws["workspace_id"]).one()
    r = c.post(f"{P}/tasks", json={
        "workspace_id": ws["workspace_id"], "title": "x", "due_date": due,
        "assignee_member_id": member.member_id,
    })
    assert r.status_code == 201, r.text
    print(f"\nPOST /tasks due_date={due} -> {r.status_code}")
    return r.json()["data"]["task_id"]


def test_control_block_happens_without_bad_row(mdb, mseed):
    task, later = _victim_past_deadline(mdb, mseed)
    tick(mdb, later)
    mdb.expire_all()
    assert task.status == "blocked"
    assert len(_notes(mdb, mseed, kind="silence_blocked")) == 1


@pytest.mark.parametrize("due", ["0001-01-01", "0001-01-04"])
def test_other_tenants_bad_due_date_must_not_stop_my_tick(mdb, mseed, due):
    task, later = _victim_past_deadline(mdb, mseed)
    _poison(mdb, due)
    errors = []
    for offset in (0, 1, 2):
        try:
            tick(mdb, later + timedelta(minutes=offset))
        except Exception as e:  # noqa: BLE001
            mdb.rollback()
            errors.append(repr(e))
    mdb.expire_all()
    watch = mdb.query(ReminderWatch).filter(ReminderWatch.task_id == task.task_id).one()
    print("tick errors:", errors)
    print("victim task status:", task.status, "| watch state:", watch.state,
          "| silence_blocked:", len(_notes(mdb, mseed, kind="silence_blocked")))
    assert errors == []
    assert task.status == "blocked"
    assert watch.state == WatchState.BLOCKED


@pytest.mark.parametrize("poisoned", [False, True], ids=["control", "bad_row"])
def test_scope_of_overflow_outage(mdb, mseed, poisoned):
    """What stops and what keeps working while the bad row exists."""
    task, later = _victim_past_deadline(mdb, mseed)
    bob_task = _assign(mdb, mseed, 1, who="bob", due=DUE + timedelta(days=10))
    reminder = messages.create_reminder(
        mdb, workspace_id=mseed["ws"], task_id=bob_task.task_id, member_id=mseed["bob"].member_id,
        scheduled_at=later - timedelta(minutes=5), note=None, created_by=None, now=later - timedelta(hours=1),
    )
    messages.approve_bundle(mdb, reminder.bundle, draft_version=reminder.bundle.draft_version, approved_by=None,
                            now=later - timedelta(hours=1))
    mdb.commit()
    reminder_id = reminder.reminder_id
    bad_task = _poison(mdb, "0001-01-01") if poisoned else None
    n = notifications.notify(mdb, member_id=mseed["pm"].member_id, kind="k", text="t", link_type="thread",
                             link_id="x", now=later)
    mdb.commit()
    note_id = n.notification_id
    try:
        tick(mdb, later)
        tick_result = "ok"
    except Exception as e:  # noqa: BLE001
        mdb.rollback()
        tick_result = repr(e)
    mdb.expire_all()
    print("tick:", tick_result, "| new push:", mdb.get(Notification, note_id).push_status,
          "| due reminder after tick:", mdb.get(Reminder, reminder_id).status)
    for claimed in messages.claim_for_bot(mdb, later):
        messages.report_result(
            mdb, claimed.message.message_id, delivered=True, failure_reason=None,
            discord_message_ids=[f"dm-{claimed.message.message_id}"], now=later,
        )
    mdb.commit()
    mdb.expire_all()
    print("due reminder after bot claim:", mdb.get(Reminder, reminder_id).status)
    for minutes in (1, 2):
        try:
            tick(mdb, later + timedelta(minutes=minutes))
        except Exception:  # noqa: BLE001
            mdb.rollback()
    mdb.expire_all()
    watches = mdb.query(ReminderWatch).filter(ReminderWatch.reminder_id == reminder_id).count()
    sent = len(_notes(mdb, mseed, who="bob", kind="reminder_sent"))
    print(f"72h clocks for the delivered reminder: {watches} | bob reminder_sent notifications: {sent}")
    if poisoned:
        r = client("pm").patch(f"{P}/tasks/{bad_task}", json={"due_date": "2026-12-01"})
        print("victim PM PATCH on the other tenant's task:", r.status_code)
    assert watches == 1 and sent == 1


def _postgres_only(mdb):
    if mdb.get_bind().dialect.name != "postgresql":
        pytest.skip("row locks")


def _deadlock_setup(mdb, mseed, bob_older=True):
    """bob's reminder is older than alice's, so claim locks bob then alice. Suggest goes by due date: alice then bob.

    bob_older=False is the control: both sides then lock alice first.
    """
    tasks = mseed["tasks"]
    extra = Task(workspace_id=mseed["ws"], title="w", status="todo")
    mdb.add(extra)
    mdb.commit()
    far = SLOT + timedelta(days=30)
    earlier, later = PROPOSE - timedelta(days=2), PROPOSE - timedelta(days=1)
    messages.create_reminder(
        mdb, workspace_id=mseed["ws"], task_id=tasks[2].task_id, member_id=mseed["bob"].member_id, scheduled_at=far,
        note=None, created_by=None, now=earlier if bob_older else later, origin=ReminderOrigin.PM,
    )
    messages.create_reminder(
        mdb, workspace_id=mseed["ws"], task_id=extra.task_id, member_id=mseed["alice"].member_id, scheduled_at=far,
        note=None, created_by=None, now=later if bob_older else earlier, origin=ReminderOrigin.PM,
    )
    mdb.commit()
    _assign(mdb, mseed, 0, who="alice", due=DUE)
    _assign(mdb, mseed, 1, who="bob", due=DUE + timedelta(days=1))
    return PROPOSE + timedelta(days=1, hours=1)


@pytest.mark.parametrize("round_", range(3))
def test_tick_and_bot_claim_must_not_deadlock(mdb, mseed, monkeypatch, round_):
    """The wrapper only holds each side after its first thread lock, so both are inside their locking loops at once."""
    _race(mdb, mseed, monkeypatch, round_, bob_older=True, widen=True)


@pytest.mark.parametrize("round_", range(3))
def test_control_same_lock_order_with_same_barrier(mdb, mseed, monkeypatch, round_):
    _race(mdb, mseed, monkeypatch, round_, bob_older=False, widen=True)


@pytest.mark.parametrize("round_", range(10))
def test_no_instrumentation_race(mdb, mseed, monkeypatch, round_):
    """Same data, unpatched code, both started together."""
    _race(mdb, mseed, monkeypatch, round_, bob_older=True, widen=False)


def _race(mdb, mseed, monkeypatch, round_, *, bob_older, widen):
    _postgres_only(mdb)
    now = _deadlock_setup(mdb, mseed, bob_older=bob_older)
    engine = mdb.get_bind()
    Session = sessionmaker(bind=engine, autoflush=False)

    def per_request_db():
        db = Session()
        db.execute(text("SET lock_timeout = '15s'"))
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = per_request_db
    barrier = threading.Barrier(2)
    seen = threading.local()
    real_lock = messages._lock_thread

    def lock_then_meet(db, thread_id):
        real_lock(db, thread_id)
        if not getattr(seen, "met", False):
            seen.met = True
            try:
                barrier.wait(timeout=2)
            except threading.BrokenBarrierError:
                pass  # the other side is queued behind this lock: the order is consistent

    if widen:
        monkeypatch.setattr(messages, "_lock_thread", lock_then_meet)
    results: dict[str, object] = {}

    def run_tick():
        db = Session()
        db.execute(text("SET lock_timeout = '15s'"))
        try:
            scheduler.run_tick(db, now=now, send=None)
            results["tick"] = "ok"
        except Exception as e:  # noqa: BLE001
            results["tick"] = f"{type(e).__name__}: {str(e).splitlines()[0]}"
            db.rollback()
        finally:
            db.close()

    def bot_claim():
        c = TestClient(app, base_url="https://testserver", raise_server_exceptions=True)
        try:
            results["claim"] = c.post(f"{P}/bot/messages/claim", headers={"X-Service-Token": SERVICE_TOKEN}).status_code
        except Exception as e:  # noqa: BLE001
            results["claim"] = f"500 {type(getattr(e, 'orig', None) or e).__name__}"

    threads = [threading.Thread(target=run_tick), threading.Thread(target=bot_claim)]
    started = time.monotonic()
    for t in threads:
        t.start()
    for t in threads:
        t.join(40)
    print(f"\nround {round_}: {results} in {time.monotonic() - started:.1f}s")
    assert results == {"tick": "ok", "claim": 200}
