"""리마인드의 재촉 이유·근거와 묶음 요약(app/services/reminder_reason.py)."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.models import (
    ChangedField,
    ChangeSource,
    Member,
    MessageSender,
    ReminderOrigin,
    ReplyChannel,
    TaskHistory,
    ThreadMessage,
)
from app.services import messages as svc
from app.services.reminder_reason import Evidence, bundle_summary, reminder_reason

CREATED = datetime(2026, 11, 2, 3, 0, tzinfo=timezone.utc)  # 11/2(월) KST
DUE = date(2026, 11, 14)  # 토
NOW = datetime(2026, 11, 3, 0, 0, tzinfo=timezone.utc)
AT = datetime(2026, 11, 20, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def seed(mdb, mseed):
    task = mseed["tasks"][0]
    task.created_at = CREATED
    task.due_date = DUE
    mdb.commit()
    return mseed


def _make(db, seed, *, origin=ReminderOrigin.SCHEDULER, who="alice", task=0, created_by=None, at=AT):
    r = svc.create_reminder(
        db, workspace_id=seed["ws"], task_id=seed["tasks"][task].task_id, member_id=seed[who].member_id,
        scheduled_at=at, note=None, created_by=created_by, now=NOW, origin=origin,
    )
    db.commit()
    db.refresh(r)
    return r


def _thread_id(r):
    return r.bundle.thread_id


def _msg(db, thread_id, at, sender=MessageSender.MEMBER):
    m = ThreadMessage(thread_id=thread_id, sender=sender, body="네", created_at=at,
                      reply_channel=ReplyChannel.WEB if sender == MessageSender.MEMBER else None)
    db.add(m)
    db.commit()
    return m


def _hist(db, task, field, source, at):
    db.add(TaskHistory(task_id=task.task_id, changed_field=field, change_source=source, created_at=at))
    db.commit()


def test_scheduler_reminder_without_news_counts_from_task_creation(mdb, seed):
    r = _make(mdb, seed)
    reason, evidence = reminder_reason(mdb, r, _thread_id(r))
    assert reason == "'할일0' 마감이 11/14(토)인데, 11/2(월)에 만든 뒤로 진행 소식이 없어요."
    assert evidence is None


def test_member_reply_in_the_thread_is_the_latest_news(mdb, seed):
    r = _make(mdb, seed)
    at = datetime(2026, 11, 5, 1, 0, tzinfo=timezone.utc)
    m = _msg(mdb, _thread_id(r), at)
    reason, evidence = reminder_reason(mdb, r, _thread_id(r))
    assert reason.endswith("11/5(목) 이후로 진행 소식이 없어요.")
    assert evidence == Evidence("reply", at, m.message_id)
    assert svc.utc(evidence.at) == at


def test_web_reply_is_news(mdb, seed):
    r = _make(mdb, seed)
    thread = r.bundle.thread
    web = svc.add_web_reply(mdb, thread, body="진행 중", now=datetime(2026, 11, 5, 1, 0, tzinfo=timezone.utc))
    mdb.commit()
    reason, evidence = reminder_reason(mdb, r, thread.thread_id)
    assert reason.endswith("11/5(목) 이후로 진행 소식이 없어요.")
    assert evidence.kind == "reply" and evidence.message_id == web.message_id


def test_later_manual_task_change_wins_over_reply(mdb, seed):
    r = _make(mdb, seed)
    _msg(mdb, _thread_id(r), datetime(2026, 11, 5, 1, 0, tzinfo=timezone.utc))
    _hist(mdb, seed["tasks"][0], ChangedField.STATUS, ChangeSource.MANUAL,
          datetime(2026, 11, 6, 1, 0, tzinfo=timezone.utc))
    reason, evidence = reminder_reason(mdb, r, _thread_id(r))
    assert evidence.kind == "task_change" and evidence.message_id is None
    assert "11/6(금)" in reason


def test_ignored_news(mdb, seed):
    r = _make(mdb, seed)
    task = seed["tasks"][0]
    t = datetime(2026, 11, 5, 1, 0, tzinfo=timezone.utc)
    _hist(mdb, task, ChangedField.STATUS, ChangeSource.SCHEDULER, t)
    _hist(mdb, task, ChangedField.STATUS, ChangeSource.REMINDER_REPLY, t)
    for field in (ChangedField.TITLE, ChangedField.ASSIGNEE, ChangedField.BLOCKER):
        _hist(mdb, task, field, ChangeSource.MANUAL, t)
    other = _make(mdb, seed, who="carol")
    _msg(mdb, _thread_id(other), t)
    _msg(mdb, _thread_id(r), t, sender=MessageSender.BOT)
    _msg(mdb, _thread_id(r), CREATED - timedelta(hours=1))
    reason, evidence = reminder_reason(mdb, r, _thread_id(r))
    assert evidence is None
    assert reason.endswith("11/2(월)에 만든 뒤로 진행 소식이 없어요.")


def test_kst_date_boundary(mdb, seed):
    r = _make(mdb, seed)
    _msg(mdb, _thread_id(r), datetime(2026, 11, 5, 15, 30, tzinfo=timezone.utc))
    reason, _ = reminder_reason(mdb, r, _thread_id(r))
    assert "11/6(금)" in reason


def test_pm_reminder_names_the_creator_or_falls_back(mdb, seed):
    seed["pm"].display_name = "김PM"
    old = Member(workspace_id=seed["ws"], display_name="옛PM", role="pm", is_deleted=True)
    mdb.add(old)
    mdb.commit()
    r = _make(mdb, seed, origin=ReminderOrigin.PM, created_by=seed["pm"].member_id)
    reason, _ = reminder_reason(mdb, r, _thread_id(r))
    assert reason == "김PM님이 직접 만든 재촉이에요. 11/2(월)에 만든 뒤로 진행 소식이 없어요."
    r2 = _make(mdb, seed, origin=ReminderOrigin.PM, created_by=old.member_id, who="bob")
    reason2, _ = reminder_reason(mdb, r2, _thread_id(r2))
    assert reason2.startswith("김PM님이 직접 만든 재촉이에요.")


def test_pm_reminder_on_task_without_due_date(mdb, seed):
    seed["tasks"][0].due_date = None
    mdb.commit()
    r = _make(mdb, seed, origin=ReminderOrigin.PM, created_by=seed["pm"].member_id)
    reason, _ = reminder_reason(mdb, r, _thread_id(r))
    assert reason == "PM님이 직접 만든 재촉이에요. 11/2(월)에 만든 뒤로 진행 소식이 없어요."


def test_scheduler_reminder_whose_due_date_was_removed(mdb, seed):
    r = _make(mdb, seed)
    seed["tasks"][0].due_date = None
    mdb.commit()
    reason, _ = reminder_reason(mdb, r, _thread_id(r))
    assert reason == "11/2(월)에 만든 뒤로 진행 소식이 없어요."


def test_deleted_task_gives_no_reason(mdb, seed):
    r = _make(mdb, seed)
    thread_id = _thread_id(r)
    r.task_id = None
    mdb.commit()
    mdb.refresh(r)
    assert reminder_reason(mdb, r, thread_id) == (None, None)


def test_bundle_summary(mdb, seed):
    r0 = _make(mdb, seed, task=0)
    assert bundle_summary([r0]) == "할일0 진행 상황 확인"
    r1 = _make(mdb, seed, task=1)
    r2 = _make(mdb, seed, task=2)
    assert bundle_summary([r0, r1, r2]) == "할일0 외 2건 진행 상황 확인"
    r0.task_id = None
    mdb.commit()
    mdb.refresh(r0)
    assert bundle_summary([r0, r1]) == "지워진 태스크 외 1건 진행 상황 확인"
    assert bundle_summary([]) == ""


def test_reply_beats_manual_status_change_at_the_same_time(mdb, seed):
    r = _make(mdb, seed)
    at = datetime(2026, 11, 5, 1, 0, tzinfo=timezone.utc)
    m = _msg(mdb, _thread_id(r), at)
    _hist(mdb, seed["tasks"][0], ChangedField.STATUS, ChangeSource.MANUAL, at)
    _, evidence = reminder_reason(mdb, r, _thread_id(r))
    assert evidence.kind == "reply" and evidence.message_id == m.message_id


def test_manual_due_date_change_is_task_change_evidence(mdb, seed):
    r = _make(mdb, seed)
    at = datetime(2026, 11, 5, 1, 0, tzinfo=timezone.utc)
    _hist(mdb, seed["tasks"][0], ChangedField.DUE_DATE, ChangeSource.MANUAL, at)
    reason, evidence = reminder_reason(mdb, r, _thread_id(r))
    assert evidence == Evidence("task_change", at, None)
    assert reason.endswith("11/5(목) 이후로 진행 소식이 없어요.")


def test_same_time_replies_pick_the_largest_message_id(mdb, seed):
    r = _make(mdb, seed)
    at = datetime(2026, 11, 5, 1, 0, tzinfo=timezone.utc)
    ids = [_msg(mdb, _thread_id(r), at).message_id for _ in range(5)]
    _, evidence = reminder_reason(mdb, r, _thread_id(r))
    assert evidence.message_id == max(ids)
