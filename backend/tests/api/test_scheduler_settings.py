"""스케줄러가 워크스페이스 메시지·알림 설정을 따르는지 본다.

기준: 마감 11/20(금). 기본 규칙이면 11/19 09:00 KST(= 00:00 UTC)에 나가고, 제안은 그 3일 전에 생긴다.
"""
from datetime import date, datetime, timedelta, timezone

from app.models import (
    DraftStatus,
    Member,
    MessageSender,
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


def _set(db, seed, **changes):
    message_settings.update_settings(
        db, seed["ws"], changes, updated_by=seed["pm"].member_id, now=PROPOSE - timedelta(days=30)
    )
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
    _set(mdb, mseed, due_reminder=False)
    tick(mdb, SLOT - 3 * 24 * H + H)
    assert mdb.query(Reminder).count() == 0
    assert _suggestions(mdb) == 0

    _set(mdb, mseed, due_reminder=True)
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
    _set(mdb, mseed, due_reminder=False)

    tick(mdb, PROPOSE + H)

    assert [r.task_id for r in mdb.query(Reminder).all()] == [task_b.task_id]


def test_pm_made_reminder_still_sent_when_due_reminder_off(mdb, mseed):
    task = _assign(mdb, mseed)
    _set(mdb, mseed, due_reminder=False)
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
    _set(mdb, mseed, nudge_days_before=2, nudge_hour=18)
    slot = datetime(2026, 11, 18, 9, 0, tzinfo=timezone.utc)

    tick(mdb, slot - timedelta(days=3) - timedelta(seconds=1))
    assert _suggestions(mdb) == 0

    tick(mdb, slot - timedelta(days=3))
    [bundle] = _bundles(mdb)
    assert messages.utc(bundle.scheduled_at) == slot


def test_days_before_zero_is_due_day(mdb, mseed):
    _assign(mdb, mseed)
    _set(mdb, mseed, nudge_days_before=0, nudge_hour=9)

    tick(mdb, datetime(2026, 11, 20, 0, 0, tzinfo=timezone.utc) - timedelta(days=3))

    [bundle] = _bundles(mdb)
    assert messages.utc(bundle.scheduled_at) == datetime(2026, 11, 20, 0, 0, tzinfo=timezone.utc)


def test_rule_change_keeps_existing_suggestion(mdb, mseed):
    _assign(mdb, mseed)
    tick(mdb, PROPOSE)
    _set(mdb, mseed, nudge_days_before=2, nudge_hour=18)

    tick(mdb, PROPOSE + H)

    [bundle] = _bundles(mdb)
    assert messages.utc(bundle.scheduled_at) == SLOT
    assert mdb.query(Reminder).count() == 1


def test_silence_alert_off_blocks_without_pm_notice(mdb, mseed):
    task = _assign(mdb, mseed)
    _set(mdb, mseed, silence_alert=False)
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    _send(mdb, SLOT)

    tick(mdb, SLOT + timedelta(hours=72))
    tick(mdb, SLOT + timedelta(hours=73))

    mdb.refresh(task)
    assert task.status == "blocked"
    assert _notes(mdb, mseed, kind="silence_blocked") == []


# 자동 승인


def _turn_on(db, seed, now=PROPOSE - timedelta(days=30)):
    message_settings.update_settings(
        db, seed["ws"], {"reminder_auto_approve": True}, updated_by=seed["pm"].member_id, now=now
    )
    db.commit()


def _messages(db):
    return db.query(ThreadMessage).filter(ThreadMessage.sender == MessageSender.BOT).all()


def test_auto_approve_sends_without_pm(mdb, mseed):
    _assign(mdb, mseed)
    _turn_on(mdb, mseed)
    tick(mdb, PROPOSE)

    tick(mdb, SLOT)

    assert len(_messages(mdb)) == 1
    [bundle] = _bundles(mdb)
    assert messages.utc(bundle.approved_at) == SLOT
    assert bundle.approved_by is None
    assert bundle.status == ReminderStatus.SENT


def test_auto_approve_closes_pending_draft_like_manual_approve(mdb, mseed):
    _assign(mdb, mseed)
    _turn_on(mdb, mseed)
    tick(mdb, PROPOSE)
    [bundle] = _bundles(mdb)
    assert bundle.draft_status == DraftStatus.NEEDED

    tick(mdb, SLOT)

    mdb.refresh(bundle)
    assert bundle.status == ReminderStatus.SENT
    assert bundle.draft_status == DraftStatus.DONE


def test_auto_approve_via_bot_claim(mdb, mseed):
    _assign(mdb, mseed)
    _turn_on(mdb, mseed)
    tick(mdb, PROPOSE)

    claimed = messages.claim_for_bot(mdb, SLOT)

    assert len(claimed) == 1
    assert len(_messages(mdb)) == 1


def test_auto_approve_applies_to_pm_made_reminder(mdb, mseed):
    task = _assign(mdb, mseed)
    _turn_on(mdb, mseed)
    messages.create_reminder(
        mdb, workspace_id=mseed["ws"], task_id=task.task_id, member_id=mseed["alice"].member_id,
        scheduled_at=SLOT, note=None, created_by=mseed["pm"].member_id, now=PROPOSE,
    )
    mdb.commit()

    tick(mdb, SLOT)

    assert len(_messages(mdb)) == 1


def test_auto_approve_skips_cancelled_bundle(mdb, mseed):
    _assign(mdb, mseed)
    _turn_on(mdb, mseed)
    tick(mdb, PROPOSE)
    [bundle] = _bundles(mdb)
    messages.cancel_bundle(mdb, bundle, now=PROPOSE + H)
    mdb.commit()

    tick(mdb, SLOT)

    assert _messages(mdb) == []
    mdb.refresh(bundle)
    assert bundle.approved_at is None


def test_auto_approve_skips_replied_reminder(mdb, mseed):
    _assign(mdb, mseed)
    _turn_on(mdb, mseed)
    tick(mdb, PROPOSE)
    thread = messages.get_or_create_thread(mdb, mseed["ws"], mseed["alice"].member_id)
    messages.add_web_reply(mdb, thread, body="했어요", now=SLOT - H)
    mdb.commit()

    tick(mdb, SLOT)

    assert _messages(mdb) == []
    assert [r.status for r in mdb.query(Reminder).all()] == [ReminderStatus.CANCELLED]
    [bundle] = _bundles(mdb)
    assert bundle.approved_at is None


def test_auto_approve_ignores_bundles_due_before_turning_on(mdb, mseed):
    _assign(mdb, mseed)
    tick(mdb, PROPOSE)
    tick(mdb, SLOT - H)
    _turn_on(mdb, mseed, now=SLOT + H)

    tick(mdb, SLOT + 2 * H)

    assert _messages(mdb) == []
    [bundle] = _bundles(mdb)
    assert bundle.approved_at is None


def test_auto_approve_is_per_workspace(mdb, mseed):
    _assign(mdb, mseed)
    ws_b = Workspace(name="B")
    mdb.add(ws_b)
    mdb.flush()
    member_b = Member(workspace_id=ws_b.workspace_id, display_name="비", role="member", discord_user_id="d_b")
    mdb.add(member_b)
    mdb.flush()
    mdb.add(Task(
        workspace_id=ws_b.workspace_id, title="B할일", status="todo",
        assignee_member_id=member_b.member_id, due_date=DUE,
    ))
    mdb.commit()
    _turn_on(mdb, mseed)
    tick(mdb, PROPOSE)

    tick(mdb, SLOT)

    [message] = _messages(mdb)
    sent = {b.thread.workspace_id for b in _bundles(mdb) if b.status == ReminderStatus.SENT}
    assert sent == {mseed["ws"]}
    assert message.thread.workspace_id == mseed["ws"]
    [pending] = [b for b in _bundles(mdb) if b.status == ReminderStatus.SCHEDULED]
    assert pending.approved_at is None


def test_auto_approve_off_keeps_manual_flow(mdb, mseed):
    _assign(mdb, mseed)
    tick(mdb, PROPOSE)

    tick(mdb, SLOT)

    assert _messages(mdb) == []


def test_suggestion_notice_says_auto_send_when_on(mdb, mseed):
    _assign(mdb, mseed)
    _turn_on(mdb, mseed)
    tick(mdb, PROPOSE)

    [note] = _notes(mdb, mseed, kind="nudge_suggested")
    assert "발송 시각에 자동으로 나가요" in note.text


def test_suggestion_notice_asks_approval_when_off(mdb, mseed):
    _assign(mdb, mseed)
    tick(mdb, PROPOSE)

    [note] = _notes(mdb, mseed, kind="nudge_suggested")
    assert "승인해 주세요" in note.text


def _two_approved_then_delete_first(db, seed, delete_at):
    _assign(db, seed, 0)
    _assign(db, seed, 1)
    tick(db, PROPOSE)
    assert len(_bundles(db)) == 1 and db.query(Reminder).count() == 2
    _approve_all(db, PROPOSE)
    seed["tasks"][0].is_deleted = True
    db.commit()
    tick(db, delete_at)
    [note] = _notes(db, seed, kind="reminder_auto_cancelled")
    return note


def test_drop_notice_says_auto_send_for_bundle_due_after_turning_on(mdb, mseed):
    _turn_on(mdb, mseed)

    note = _two_approved_then_delete_first(mdb, mseed, SLOT - H)

    assert "발송 시각에 자동으로 나가요" in note.text


def test_drop_notice_asks_approval_for_bundle_due_before_turning_on(mdb, mseed):
    # 켜기 전에 발송 시각이 지난 묶음은 자동 승인 대상이 아니므로 다시 승인하라고 알린다.
    _turn_on(mdb, mseed, now=SLOT + H)

    note = _two_approved_then_delete_first(mdb, mseed, SLOT + 2 * H)

    assert "다시 승인해 주세요" in note.text


def test_auto_approve_sends_bundle_proposed_before_turning_on(mdb, mseed):
    _assign(mdb, mseed)
    tick(mdb, PROPOSE)
    _turn_on(mdb, mseed, now=SLOT - H)

    tick(mdb, SLOT)

    assert len(_messages(mdb)) == 1


def test_auto_approve_boundary_scheduled_at_equals_since(mdb, mseed):
    _assign(mdb, mseed)
    tick(mdb, PROPOSE)
    _turn_on(mdb, mseed, now=SLOT)

    tick(mdb, SLOT)

    assert len(_messages(mdb)) == 1


def test_auto_approve_off_then_on_after_slot_does_not_send_missed_bundle(mdb, mseed):
    _assign(mdb, mseed)
    _turn_on(mdb, mseed)
    tick(mdb, PROPOSE)
    _set(mdb, mseed, reminder_auto_approve=False)
    message_settings.update_settings(
        mdb, mseed["ws"], {"reminder_auto_approve": True}, updated_by=mseed["pm"].member_id, now=SLOT + H
    )
    mdb.commit()

    tick(mdb, SLOT + 2 * H)

    assert _messages(mdb) == []
    [bundle] = _bundles(mdb)
    assert bundle.approved_at is None


def test_auto_approve_skips_scheduler_bundle_after_due_reminder_off(mdb, mseed):
    # 재촉 제안을 끄면 끄기 전에 만든 스케줄러 제안도 승인 없이는 나가지 않는다.
    _assign(mdb, mseed)
    _turn_on(mdb, mseed)
    tick(mdb, PROPOSE)
    _set(mdb, mseed, due_reminder=False)

    tick(mdb, SLOT)

    assert _messages(mdb) == []
    [bundle] = _bundles(mdb)
    assert bundle.approved_at is None


def test_auto_approve_sends_pm_made_reminder_when_due_reminder_off(mdb, mseed):
    task = _assign(mdb, mseed)
    _turn_on(mdb, mseed)
    _set(mdb, mseed, due_reminder=False)
    messages.create_reminder(
        mdb, workspace_id=mseed["ws"], task_id=task.task_id, member_id=mseed["alice"].member_id,
        scheduled_at=SLOT, note=None, created_by=mseed["pm"].member_id, now=PROPOSE,
    )
    mdb.commit()

    tick(mdb, SLOT)

    assert len(_messages(mdb)) == 1


def test_auto_approve_sends_bundle_with_pm_reminder_when_due_reminder_off(mdb, mseed):
    # PM 이 직접 넣은 재촉이 있는 묶음은 PM 이 보내려던 것이므로 함께 나간다.
    _assign(mdb, mseed, 0)
    task = _assign(mdb, mseed, 1, due=DUE + timedelta(days=7))
    _turn_on(mdb, mseed)
    tick(mdb, PROPOSE)
    messages.create_reminder(
        mdb, workspace_id=mseed["ws"], task_id=task.task_id, member_id=mseed["alice"].member_id,
        scheduled_at=SLOT, note=None, created_by=mseed["pm"].member_id, now=PROPOSE + H,
    )
    mdb.commit()
    assert len(_bundles(mdb)) == 1
    _set(mdb, mseed, due_reminder=False)

    tick(mdb, SLOT)

    assert len(_messages(mdb)) == 1


def test_drop_notice_asks_approval_when_due_reminder_off(mdb, mseed):
    _turn_on(mdb, mseed)
    _assign(mdb, mseed, 0)
    _assign(mdb, mseed, 1)
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    _set(mdb, mseed, due_reminder=False)
    mseed["tasks"][0].is_deleted = True
    mdb.commit()

    tick(mdb, SLOT - H)

    [note] = _notes(mdb, mseed, kind="reminder_auto_cancelled")
    assert "다시 승인해 주세요" in note.text
