"""리마인드 스케줄러. 시각(now)을 바꿔 가며 틱을 돌린다.

기준: 마감 11/20(금). 리마인드는 하루 전 11/19 09:00 KST(= 00:00 UTC)에 나가고, 제안은 그 3일 전 11/16 00:00 UTC 에 생긴다.
"""
from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.models import (
    ChangeSource,
    Notification,
    Reminder,
    ReminderBundle,
    ReminderOrigin,
    ReminderStatus,
    ReminderWatch,
    TaskHistory,
    ThreadMessage,
    WatchState,
)
from app.services import messages, scheduler
from app.services.tasks import apply_task_updates

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


def _reminders(db, task):
    return db.query(Reminder).filter(Reminder.task_id == task.task_id).all()


def _notes(db, seed, who="pm", kind=None):
    q = db.query(Notification).filter(Notification.member_id == seed[who].member_id)
    if kind:
        q = q.filter(Notification.kind == kind)
    return q.all()


def _change(db, task, now, **updates):
    """사람(PM)이 태스크를 바꾼 것. 이력 시각을 now 로 맞춘다."""
    for entry in apply_task_updates(db, task, updates, change_source=ChangeSource.MANUAL):
        entry.created_at = now
    db.commit()


def _web_reply(db, seed, who, now, body="하고 있어요"):
    thread = messages.get_or_create_thread(db, seed["ws"], seed[who].member_id)
    messages.add_web_reply(db, thread, body=body, now=now)
    db.commit()


def _approve_all(db, now):
    for bundle in db.query(ReminderBundle).filter(ReminderBundle.status == ReminderStatus.SCHEDULED).all():
        messages.approve_bundle(db, bundle, draft_version=bundle.draft_version, approved_by=None, now=now)
    db.commit()


def _send(db, now, delivered=True):
    """발송 시각의 틱과 봇의 가져가기·결과 보고."""
    tick(db, now)
    for claimed in messages.claim_for_bot(db, now):
        messages.report_result(
            db, claimed.message.message_id, delivered=delivered,
            failure_reason=None if delivered else "unknown",
            discord_message_ids=[f"dm-{claimed.message.message_id}"] if delivered else [], now=now,
        )
    db.commit()
    tick(db, now)


def _suggested_and_sent(db, seed, i=0):
    task = _assign(db, seed, i)
    tick(db, PROPOSE)
    _approve_all(db, PROPOSE)
    _send(db, SLOT)
    return task


# 제안

def test_no_suggestion_before_three_days(mdb, mseed):
    task = _assign(mdb, mseed)
    tick(mdb, PROPOSE - timedelta(seconds=1))
    assert _reminders(mdb, task) == []


def test_suggests_three_days_before_send_once(mdb, mseed):
    task = _assign(mdb, mseed)
    tick(mdb, PROPOSE)
    tick(mdb, PROPOSE + H)

    [reminder] = _reminders(mdb, task)
    assert reminder.origin == ReminderOrigin.SCHEDULER
    assert reminder.status == ReminderStatus.SCHEDULED
    assert messages.utc(reminder.bundle.scheduled_at) == SLOT
    assert reminder.bundle.approved_at is None
    assert reminder.bundle.thread.member_id == mseed["alice"].member_id
    [note] = _notes(mdb, mseed, kind="nudge_suggested")
    assert (note.link_type, note.link_id) == ("bundle", reminder.bundle_id)


def test_suggests_right_away_when_less_than_three_days_left(mdb, mseed):
    task = _assign(mdb, mseed)
    tick(mdb, SLOT - 5 * H)
    [reminder] = _reminders(mdb, task)
    assert messages.utc(reminder.bundle.scheduled_at) == SLOT


def test_no_suggestion_without_due_assignee_or_when_done(mdb, mseed):
    no_due = _assign(mdb, mseed, 0, due=None)
    no_assignee = mseed["tasks"][1]
    no_assignee.due_date = DUE
    done = _assign(mdb, mseed, 2)
    done.status = "done"
    mdb.commit()
    tick(mdb, PROPOSE)
    assert mdb.query(Reminder).count() == 0
    assert no_due.due_date is None and no_assignee.assignee_member_id is None


def test_pm_cancelled_suggestion_is_not_made_again(mdb, mseed):
    task = _assign(mdb, mseed)
    tick(mdb, PROPOSE)
    [reminder] = _reminders(mdb, task)
    messages.cancel_reminder(mdb, reminder, now=PROPOSE + H)
    mdb.commit()
    tick(mdb, PROPOSE + 2 * H)
    assert [r.status for r in _reminders(mdb, task)] == [ReminderStatus.CANCELLED]


def test_due_change_cancels_old_suggestion_and_suggests_for_new_due(mdb, mseed):
    task = _assign(mdb, mseed)
    tick(mdb, PROPOSE)
    _change(mdb, task, PROPOSE + H, due_date=date(2026, 11, 21))
    tick(mdb, PROPOSE + 2 * H)
    tick(mdb, PROPOSE + timedelta(days=1))

    by_slot = {messages.utc(r.bundle.scheduled_at): r.status for r in _reminders(mdb, task)}
    assert by_slot == {SLOT: ReminderStatus.CANCELLED, SLOT + timedelta(days=1): ReminderStatus.SCHEDULED}


def test_suggestion_added_to_approved_bundle_asks_pm_again(mdb, mseed):
    _assign(mdb, mseed, 0)
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    _assign(mdb, mseed, 1)
    tick(mdb, PROPOSE + H)

    [bundle] = mdb.query(ReminderBundle).all()
    assert bundle.approved_at is None
    assert len(_notes(mdb, mseed, kind="nudge_reapprove")) == 1


# 발송 직전 재확인

def test_reply_after_suggestion_cancels_it_and_tells_pm(mdb, mseed):
    task = _assign(mdb, mseed)
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    _web_reply(mdb, mseed, "alice", PROPOSE + H)
    tick(mdb, PROPOSE + 2 * H)

    [reminder] = _reminders(mdb, task)
    assert reminder.status == ReminderStatus.CANCELLED
    assert len(_notes(mdb, mseed, kind="reminder_auto_cancelled")) == 1
    _send(mdb, SLOT)
    assert mdb.query(ThreadMessage).filter(ThreadMessage.sender == "bot").count() == 0


def test_status_change_cancels_only_that_task_and_unapproves_rest(mdb, mseed):
    first = _assign(mdb, mseed, 0)
    second = _assign(mdb, mseed, 1)
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    _change(mdb, first, PROPOSE + H, status="in_progress")
    tick(mdb, PROPOSE + 2 * H)

    assert [r.status for r in _reminders(mdb, first)] == [ReminderStatus.CANCELLED]
    [rest] = _reminders(mdb, second)
    assert rest.status == ReminderStatus.SCHEDULED
    assert rest.bundle.approved_at is None
    assert rest.bundle.draft_status == "needed"


def test_bot_claim_rechecks_before_dispatch(mdb, mseed):
    task = _assign(mdb, mseed)
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    _web_reply(mdb, mseed, "alice", SLOT - timedelta(seconds=1))

    assert messages.claim_for_bot(mdb, SLOT) == []
    assert _reminders(mdb, task)[0].status == ReminderStatus.CANCELLED


def test_scheduler_own_block_is_not_a_response(mdb, mseed):
    task = _assign(mdb, mseed)
    for entry in apply_task_updates(mdb, task, {"status": "blocked"}, change_source=ChangeSource.SCHEDULER):
        entry.created_at = PROPOSE + H
    mdb.commit()
    tick(mdb, PROPOSE)
    tick(mdb, PROPOSE + 2 * H)
    assert [r.status for r in _reminders(mdb, task)] == [ReminderStatus.SCHEDULED]


# 놓친 일정

def test_missed_send_goes_out_after_restart_before_due(mdb, mseed):
    _assign(mdb, mseed)
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    tick(mdb, SLOT + 20 * H)
    assert mdb.query(ThreadMessage).filter(ThreadMessage.sender == "bot").count() == 1


def test_missed_send_after_due_passed_expires(mdb, mseed):
    task = _assign(mdb, mseed)
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    tick(mdb, datetime(2026, 11, 21, 1, 0, tzinfo=timezone.utc))
    assert _reminders(mdb, task)[0].status == ReminderStatus.EXPIRED
    assert mdb.query(ThreadMessage).filter(ThreadMessage.sender == "bot").count() == 0


# 72시간

def test_member_gets_notified_when_reminder_goes_out(mdb, mseed):
    _suggested_and_sent(mdb, mseed)
    [note] = _notes(mdb, mseed, "alice", kind="reminder_sent")
    assert note.link_type == "thread"
    assert _notes(mdb, mseed, "bob") == []


def test_blocks_exactly_after_72_hours_without_response(mdb, mseed):
    task = _suggested_and_sent(mdb, mseed)
    tick(mdb, SLOT + timedelta(hours=72) - timedelta(seconds=1))
    assert task.status == "todo"

    tick(mdb, SLOT + timedelta(hours=72))
    tick(mdb, SLOT + timedelta(hours=73))
    mdb.refresh(task)
    assert task.status == "blocked"
    assert task.blocker == scheduler.BLOCKER_TEXT
    sources = {h.change_source for h in mdb.query(TaskHistory).filter(TaskHistory.task_id == task.task_id)}
    assert sources == {"scheduler"}
    [note] = _notes(mdb, mseed, kind="silence_blocked")
    assert (note.link_type, note.link_id) == ("task", task.task_id)


def test_failed_dm_does_not_block(mdb, mseed):
    task = _assign(mdb, mseed)
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    _send(mdb, SLOT, delivered=False)
    tick(mdb, SLOT + timedelta(hours=80))
    assert task.status == "todo"


def test_web_reply_before_deadline_prevents_block(mdb, mseed):
    task = _suggested_and_sent(mdb, mseed)
    _web_reply(mdb, mseed, "alice", SLOT + 10 * H)
    tick(mdb, SLOT + timedelta(hours=80))
    assert task.status == "todo"


def test_status_or_due_change_before_deadline_prevents_block(mdb, mseed):
    status_task = _suggested_and_sent(mdb, mseed, 0)
    _change(mdb, status_task, SLOT + 10 * H, status="in_progress")
    tick(mdb, SLOT + timedelta(hours=80))
    assert status_task.status == "in_progress"


def test_due_change_before_deadline_prevents_block(mdb, mseed):
    task = _suggested_and_sent(mdb, mseed, 0)
    _change(mdb, task, SLOT + 10 * H, due_date=date(2026, 11, 27))
    tick(mdb, SLOT + timedelta(hours=80))
    assert task.status == "todo"


def test_reply_after_block_unblocks_to_previous_status(mdb, mseed):
    task = _assign(mdb, mseed)
    task.status = "in_progress"
    mdb.commit()
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    _send(mdb, SLOT)
    tick(mdb, SLOT + timedelta(hours=72))
    assert task.status == "blocked"

    _web_reply(mdb, mseed, "alice", SLOT + timedelta(hours=75))
    tick(mdb, SLOT + timedelta(hours=76))
    mdb.refresh(task)
    assert (task.status, task.blocker) == ("in_progress", None)
    last = mdb.query(TaskHistory).filter(TaskHistory.task_id == task.task_id, TaskHistory.changed_field == "status")
    assert {h.change_source for h in last} == {"scheduler", "reminder_reply"}


def test_reply_also_lifts_manual_block_on_reminded_task(mdb, mseed):
    task = _suggested_and_sent(mdb, mseed)
    for entry in apply_task_updates(mdb, task, {"status": "blocked", "blocker": "디자인 대기"},
                                    change_source=ChangeSource.MANUAL):
        entry.created_at = SLOT + 2 * H
    mdb.commit()
    _web_reply(mdb, mseed, "alice", SLOT + 5 * H)
    tick(mdb, SLOT + 6 * H)
    mdb.refresh(task)
    assert (task.status, task.blocker) == ("todo", None)


def test_already_blocked_task_only_notifies_pm(mdb, mseed):
    task = _suggested_and_sent(mdb, mseed)
    task.status, task.blocker = "blocked", "디자인 대기"
    mdb.commit()
    tick(mdb, SLOT + timedelta(hours=72))
    mdb.refresh(task)
    assert (task.status, task.blocker) == ("blocked", "디자인 대기")
    assert len(_notes(mdb, mseed, kind="silence_blocked")) == 1


def test_new_reminder_restarts_the_clock(mdb, mseed):
    task = _suggested_and_sent(mdb, mseed)
    again = SLOT + 10 * H
    messages.create_reminder(
        mdb, workspace_id=mseed["ws"], task_id=task.task_id, member_id=mseed["alice"].member_id,
        scheduled_at=again + H, note=None, created_by=mseed["pm"].member_id, now=again,
    )
    mdb.commit()
    _approve_all(mdb, again)
    _send(mdb, again + H)

    tick(mdb, SLOT + timedelta(hours=72))
    assert task.status == "todo"
    tick(mdb, again + H + timedelta(hours=72))
    assert task.status == "blocked"


def test_paused_clock_does_not_block(mdb, mseed):
    task = _suggested_and_sent(mdb, mseed)
    watch = mdb.query(ReminderWatch).one()
    watch.paused_at = SLOT + H
    mdb.commit()
    tick(mdb, SLOT + timedelta(hours=80))
    assert task.status == "todo"


def test_tick_twice_at_same_time_changes_nothing_more(mdb, mseed):
    _suggested_and_sent(mdb, mseed)
    tick(mdb, SLOT + timedelta(hours=72))
    before = (mdb.query(TaskHistory).count(), mdb.query(Notification).count(), mdb.query(ReminderWatch).count())
    tick(mdb, SLOT + timedelta(hours=72))
    assert (mdb.query(TaskHistory).count(), mdb.query(Notification).count(),
            mdb.query(ReminderWatch).count()) == before
    assert mdb.query(ReminderWatch).one().state == WatchState.BLOCKED


# 자동 막힘 되돌리기 API

def _undo(token, task_id):
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", f"{token}-token")
    return c.post(f"/api/v1/tasks/{task_id}/auto-block/undo")


def test_pm_undoes_auto_block_to_previous_values(mdb, mseed):
    task = _assign(mdb, mseed)
    task.status, task.blocker = "in_progress", None
    mdb.commit()
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    _send(mdb, SLOT)
    tick(mdb, SLOT + timedelta(hours=72))

    assert _undo("alice", task.task_id).status_code == 403
    r = _undo("pm", task.task_id)
    assert r.status_code == 200, r.text
    assert (r.json()["data"]["status"], r.json()["data"]["blocker"]) == ("in_progress", None)
    assert mdb.query(ReminderWatch).one().state == WatchState.RELEASED

    tick(mdb, SLOT + timedelta(hours=100))
    mdb.refresh(task)
    assert task.status == "in_progress"
    assert _undo("pm", task.task_id).status_code == 409


def test_undo_refuses_when_not_auto_blocked(mdb, mseed):
    task = _assign(mdb, mseed)
    task.status = "blocked"
    mdb.commit()
    assert _undo("pm", task.task_id).status_code == 409
