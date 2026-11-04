"""스케줄러가 워크스페이스 메시지·알림 설정을 따르는지 본다.

기준: 마감 11/20(금). 기본 규칙이면 11/19 09:00 KST(= 00:00 UTC)에 나가고, 제안은 그 3일 전에 생긴다.
"""
from datetime import date, datetime, timedelta, timezone

from app.models import (
    Member,
    Notification,
    Reminder,
    ReminderBundle,
    ReminderStatus,
    SchedulerSuggestion,
    Task,
    ThreadMessage,
    Workspace,
)
from app.services import message_settings, messages, scheduler

DUE = date(2026, 11, 20)
SLOT = datetime(2026, 11, 19, 0, 0, tzinfo=timezone.utc)
PROPOSE = SLOT - timedelta(days=3)
H = timedelta(hours=1)


def tick(db, now):
    scheduler.run_tick(db, now=now, send=lambda sub, payload: None)


def _assign(db, seed, i=0, who="alice", due=DUE):
    task = seed["tasks"][i]
    task.assignee_member_id = seed[who].member_id
    task.due_date = due
    db.commit()
    return task


def _notes(db, seed, who="pm", kind=None):
    q = db.query(Notification).filter(Notification.member_id == seed[who].member_id)
    if kind:
        q = q.filter(Notification.kind == kind)
    return q.all()


def _set(db, workspace_id, **changes):
    message_settings.update_settings(db, workspace_id, changes, updated_by="tester", now=PROPOSE - timedelta(days=30))
    db.commit()


def _approve_all(db, now):
    for bundle in db.query(ReminderBundle).filter(ReminderBundle.status == ReminderStatus.SCHEDULED).all():
        messages.approve_bundle(db, bundle, draft_version=bundle.draft_version, approved_by=None, now=now)
    db.commit()


def _send(db, now):
    tick(db, now)
    for claimed in messages.claim_for_bot(db, now):
        messages.report_result(
            db, claimed.message.message_id, delivered=True, failure_reason=None,
            discord_message_ids=[f"dm-{claimed.message.message_id}"], now=now,
        )
    db.commit()
    tick(db, now)


def _suggestions(db):
    return db.query(SchedulerSuggestion).count()


def _bundles(db):
    return db.query(ReminderBundle).all()


def test_default_rule_matches_previous_slot():
    assert scheduler.send_slot(DUE) == SLOT


def test_no_suggestion_when_due_reminder_off(mdb, mseed):
    _assign(mdb, mseed)
    _set(mdb, mseed["ws"], due_reminder=False)
    tick(mdb, SLOT - 3 * 24 * H + H)
    assert mdb.query(Reminder).count() == 0
    assert _suggestions(mdb) == 0

    _set(mdb, mseed["ws"], due_reminder=True)
    tick(mdb, SLOT - 3 * 24 * H + 2 * H)
    assert mdb.query(Reminder).count() == 1


def test_due_reminder_off_is_per_workspace(mdb, mseed):
    _assign(mdb, mseed)
    ws_b = Workspace(name="B")
    mdb.add(ws_b)
    mdb.flush()
    member_b = Member(workspace_id=ws_b.workspace_id, display_name="비", role="member", discord_user_id="d_b")
    mdb.add(member_b)
    mdb.flush()
    task_b = Task(
        workspace_id=ws_b.workspace_id, title="B할일", status="todo",
        assignee_member_id=member_b.member_id, due_date=DUE,
    )
    mdb.add(task_b)
    mdb.commit()
    _set(mdb, mseed["ws"], due_reminder=False)

    tick(mdb, PROPOSE + H)

    assert [r.task_id for r in mdb.query(Reminder).all()] == [task_b.task_id]


def test_pm_made_reminder_still_sent_when_due_reminder_off(mdb, mseed):
    task = _assign(mdb, mseed)
    _set(mdb, mseed["ws"], due_reminder=False)
    messages.create_reminder(
        mdb, workspace_id=mseed["ws"], task_id=task.task_id, member_id=mseed["alice"].member_id,
        scheduled_at=SLOT, note=None, created_by=mseed["pm"].member_id, now=PROPOSE,
    )
    mdb.commit()
    _approve_all(mdb, PROPOSE)

    _send(mdb, SLOT)

    assert mdb.query(ThreadMessage).count() == 1
    assert len(_notes(mdb, mseed, "alice", kind="reminder_sent")) == 1


def test_nudge_rule_moves_slot(mdb, mseed):
    _assign(mdb, mseed)
    _set(mdb, mseed["ws"], nudge_days_before=2, nudge_hour=18)
    slot = datetime(2026, 11, 18, 9, 0, tzinfo=timezone.utc)

    tick(mdb, slot - timedelta(days=3) - timedelta(seconds=1))
    assert _suggestions(mdb) == 0

    tick(mdb, slot - timedelta(days=3))
    [bundle] = _bundles(mdb)
    assert messages.utc(bundle.scheduled_at) == slot


def test_days_before_zero_is_due_day(mdb, mseed):
    _assign(mdb, mseed)
    _set(mdb, mseed["ws"], nudge_days_before=0, nudge_hour=9)

    tick(mdb, datetime(2026, 11, 20, 0, 0, tzinfo=timezone.utc) - timedelta(days=3))

    [bundle] = _bundles(mdb)
    assert messages.utc(bundle.scheduled_at) == datetime(2026, 11, 20, 0, 0, tzinfo=timezone.utc)


def test_rule_change_keeps_existing_suggestion(mdb, mseed):
    _assign(mdb, mseed)
    tick(mdb, PROPOSE)
    _set(mdb, mseed["ws"], nudge_days_before=2, nudge_hour=18)

    tick(mdb, PROPOSE + H)

    [bundle] = _bundles(mdb)
    assert messages.utc(bundle.scheduled_at) == SLOT
    assert mdb.query(Reminder).count() == 1


def test_silence_alert_off_blocks_without_pm_notice(mdb, mseed):
    task = _assign(mdb, mseed)
    _set(mdb, mseed["ws"], silence_alert=False)
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    _send(mdb, SLOT)

    tick(mdb, SLOT + timedelta(hours=72))
    tick(mdb, SLOT + timedelta(hours=73))

    mdb.refresh(task)
    assert task.status == "blocked"
    assert _notes(mdb, mseed, kind="silence_blocked") == []
