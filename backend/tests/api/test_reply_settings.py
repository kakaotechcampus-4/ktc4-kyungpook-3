"""메시지·알림 설정과 답장 판단이 만나는 경로."""
from datetime import timedelta

from app.models import Notification, ReminderWatch, WatchState
from app.services import message_settings, messages, replies, scheduler
from tests.api.test_replies import _remind, _reply
from tests.api.test_reply_clock import DEADLINE, _auto_blocked
from tests.api.test_reply_judgment import _change, _claim, _judge, two  # noqa: F401
from tests.api.test_scheduler import H, SLOT, tick

AT = SLOT + H


def _set(db, seed, now, **changes):
    message_settings.update_settings(db, seed["ws"], changes, updated_by=seed["pm"].member_id, now=now)
    db.commit()


def _kinds(db):
    db.expire_all()
    return [n.kind for n in db.query(Notification).filter(Notification.member_id.isnot(None)).all()]


def test_silence_alert_off_keeps_the_block_and_the_reply_still_releases_it(mdb, mseed):
    _set(mdb, mseed, SLOT - 2 * H, silence_alert=False)
    task = _auto_blocked(mdb, mseed)
    assert "silence_blocked" not in _kinds(mdb)

    _reply(mdb, mseed, DEADLINE + H, body="네 확인했어요")
    item = _claim()
    _judge(item)
    tick(mdb, DEADLINE + 2 * H)

    mdb.expire_all()
    assert (task.status, task.blocker) == ("in_progress", None)


def test_silence_alert_off_does_not_silence_the_judgment_notice(mdb, mseed):
    _set(mdb, mseed, SLOT - 2 * H, silence_alert=False)
    task = _auto_blocked(mdb, mseed)
    _reply(mdb, mseed, DEADLINE + H, body="다 끝났어요")
    item = _claim()
    _judge(item, _change(task, "status", "done", evidence="certain", claimed=item))

    assert "reply_judged" in _kinds(mdb)


def test_silence_alert_off_does_not_silence_the_failed_judgment_notice(mdb, mseed):
    _set(mdb, mseed, SLOT - 2 * H, silence_alert=False)
    _auto_blocked(mdb, mseed)
    message = _reply(mdb, mseed, DEADLINE + H, body="다 끝났어요")
    tick(mdb, DEADLINE + H + timedelta(minutes=11))

    assert "reply_unjudged" in _kinds(mdb)
    assert replies.overdue(mdb, DEADLINE + 2 * H) == []
    assert message.message_id


def test_due_reminder_off_still_judges_a_reply_to_a_reminder_the_pm_wrote(mdb, mseed, two):  # noqa: F811
    _set(mdb, mseed, SLOT - 2 * H, due_reminder=False)
    a, _ = two
    _reply(mdb, mseed, AT, body="API 다 했어요")
    item = _claim()
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item))

    mdb.expire_all()
    assert a.status == "done"


def test_a_reply_to_an_auto_approved_reminder_is_judged_and_closes_its_clock(mdb, mseed):
    _set(mdb, mseed, SLOT - 3 * H, reminder_auto_approve=True)
    task = mseed["tasks"][0]
    task.assignee_member_id, task.status = mseed["alice"].member_id, "in_progress"
    messages.create_reminder(
        mdb, workspace_id=mseed["ws"], task_id=task.task_id, member_id=mseed["alice"].member_id,
        scheduled_at=SLOT, note=None, created_by=mseed["pm"].member_id, now=SLOT - H,
    )
    mdb.commit()
    tick(mdb, SLOT)
    scheduler_watch = mdb.query(ReminderWatch).filter_by(task_id=task.task_id).one()
    assert scheduler_watch.state == WatchState.WATCHING

    _reply(mdb, mseed, AT, body="다 끝났어요")
    item = _claim()
    assert [c["task_id"] for c in item["candidates"]] == [task.task_id]
    _judge(item, _change(task, "status", "done", evidence="certain", claimed=item))
    tick(mdb, AT + H)

    mdb.expire_all()
    assert task.status == "done"
    assert scheduler_watch.state == WatchState.ANSWERED


def test_reminders_left_unanswered_with_rule_change_still_use_the_saved_clock(mdb, mseed, two):  # noqa: F811
    a, b = two
    _reply(mdb, mseed, AT, body="API 다 했어요")
    item = _claim()
    _set(mdb, mseed, AT, nudge_days_before=3, nudge_hour=10)
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item))
    tick(mdb, AT + H)

    mdb.expire_all()
    watch = mdb.query(ReminderWatch).filter_by(task_id=b.task_id).one()
    assert watch.state == WatchState.WATCHING
