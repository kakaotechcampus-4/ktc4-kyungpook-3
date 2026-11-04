"""스케줄러 상태 규칙 회귀 테스트. 묶음, 시계 하나, 막힘 풀기, 담당자 변경, 발송 직전 처리."""
from datetime import date, datetime, timedelta, timezone

from app.models import (
    Notification,
    Reminder,
    ReminderBundle,
    ReminderStatus,
    ReminderWatch,
    TaskHistory,
    ThreadMessage,
    WatchState,
)
from app.services import messages, scheduler
from tests.api.test_scheduler import (
    H,
    PROPOSE,
    SLOT,
    _approve_all,
    _assign,
    _change,
    _notes,
    _reminders,
    _send,
    _suggested_and_sent,
    _undo,
    _web_reply,
    tick,
)

H72 = timedelta(hours=72)
LATER_DUE = date(2026, 12, 10)


def _live(db, task):
    return [
        w for w in db.query(ReminderWatch).filter(ReminderWatch.task_id == task.task_id).all()
        if w.state in (WatchState.WATCHING, WatchState.BLOCKED)
    ]


def _resend(db, seed, task, created, send_at, who="alice"):
    messages.create_reminder(
        db, workspace_id=seed["ws"], task_id=task.task_id, member_id=seed[who].member_id,
        scheduled_at=send_at, note=None, created_by=seed["pm"].member_id, now=created,
    )
    db.commit()
    _approve_all(db, created)
    _send(db, send_at)


def _auto_blocked(db, seed):
    task = _suggested_and_sent(db, seed)
    tick(db, SLOT + H72)
    db.refresh(task)
    assert task.status == "blocked"
    return task


def test_p1_one_reply_cancels_whole_bundle_notes_do_not_ask_for_reapproval(mdb, mseed):
    _assign(mdb, mseed, 0)
    _assign(mdb, mseed, 1)
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    _web_reply(mdb, mseed, "alice", PROPOSE + H)
    tick(mdb, PROPOSE + 2 * H)

    [bundle] = mdb.query(ReminderBundle).all()
    notes = _notes(mdb, mseed, kind="reminder_auto_cancelled")
    assert bundle.status == ReminderStatus.CANCELLED
    assert [n for n in notes if n.link_type == "bundle"] == []
    assert [n for n in notes if "다시 승인" in n.text] == []


def test_p4_catch_up_mixed_bundle_sends_rest_or_tells_pm(mdb, mseed):
    _assign(mdb, mseed, 0)
    later = _assign(mdb, mseed, 1, due=date(2026, 11, 30))
    tick(mdb, PROPOSE)
    messages.create_reminder(
        mdb, workspace_id=mseed["ws"], task_id=later.task_id, member_id=mseed["alice"].member_id,
        scheduled_at=SLOT, note=None, created_by=mseed["pm"].member_id, now=PROPOSE,
    )
    mdb.commit()
    _approve_all(mdb, PROPOSE)
    before = len(_notes(mdb, mseed))

    tick(mdb, datetime(2026, 11, 20, 15, 0, tzinfo=timezone.utc))

    [rest] = _reminders(mdb, later)
    new_notes = _notes(mdb, mseed)[before:]
    assert rest.status == ReminderStatus.SENT or new_notes


def test_p8_one_bundle_gets_one_note_when_two_suggestions_join_approved_bundle(mdb, mseed):
    first = _assign(mdb, mseed, 0, due=date(2026, 11, 30))
    messages.create_reminder(
        mdb, workspace_id=mseed["ws"], task_id=first.task_id, member_id=mseed["alice"].member_id,
        scheduled_at=SLOT, note="직접 쓴 재촉", created_by=mseed["pm"].member_id, now=PROPOSE,
    )
    mdb.commit()
    _approve_all(mdb, PROPOSE)
    _assign(mdb, mseed, 1)
    _assign(mdb, mseed, 2)
    tick(mdb, PROPOSE + H)

    [bundle] = mdb.query(ReminderBundle).all()
    notes = [n for n in _notes(mdb, mseed) if n.link_id == bundle.bundle_id]
    assert len(notes) == 1


def test_p2a_resend_while_auto_blocked_keeps_one_live_clock(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _change(mdb, task, SLOT + 73 * H, due_date=LATER_DUE)
    _resend(mdb, mseed, task, SLOT + 74 * H, SLOT + 75 * H)
    assert len(_live(mdb, task)) == 1


def test_p2b_reply_with_two_live_clocks_writes_one_release(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _change(mdb, task, SLOT + 73 * H, due_date=LATER_DUE)
    _resend(mdb, mseed, task, SLOT + 74 * H, SLOT + 75 * H)
    _web_reply(mdb, mseed, "alice", SLOT + 76 * H)
    tick(mdb, SLOT + 77 * H)
    released = mdb.query(TaskHistory).filter(
        TaskHistory.task_id == task.task_id, TaskHistory.change_source == "reminder_reply",
        TaskHistory.changed_field == "status",
    ).all()
    assert (task.status, task.blocker) == ("todo", None)
    assert len(released) == 1


def test_p2c_second_block_released_to_status_before_that_block(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _change(mdb, task, SLOT + 73 * H, status="in_progress", due_date=LATER_DUE)
    tick(mdb, SLOT + 73 * H + timedelta(minutes=1))
    _resend(mdb, mseed, task, SLOT + 74 * H, SLOT + 75 * H)
    tick(mdb, SLOT + 75 * H + H72)
    mdb.refresh(task)
    assert task.status == "blocked"
    _web_reply(mdb, mseed, "alice", SLOT + 75 * H + H72 + H)
    tick(mdb, SLOT + 75 * H + H72 + 2 * H)
    assert (task.status, task.blocker) == ("in_progress", None)


def test_p11_reply_after_pm_reblock_restores_status_before_pm_block(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _change(mdb, task, SLOT + 73 * H, status="in_progress")
    tick(mdb, SLOT + 74 * H)
    _change(mdb, task, SLOT + 75 * H, status="blocked", blocker="디자인 대기")
    tick(mdb, SLOT + 76 * H)
    _web_reply(mdb, mseed, "alice", SLOT + 77 * H)
    tick(mdb, SLOT + 78 * H)
    assert task.status == "in_progress"


def test_p9_reply_clears_auto_block_reason_after_pm_moved_status(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _change(mdb, task, SLOT + 73 * H, status="in_progress")
    _web_reply(mdb, mseed, "alice", SLOT + 74 * H)
    tick(mdb, SLOT + 75 * H)
    assert task.blocker is None


def test_p10_block_made_after_the_reply_survives(mdb, mseed):
    task = _suggested_and_sent(mdb, mseed)
    _web_reply(mdb, mseed, "alice", SLOT + 5 * H, body="디자인 시안을 기다리고 있어요")
    _change(mdb, task, SLOT + 5 * H + timedelta(seconds=30), status="blocked", blocker="디자인 대기")
    tick(mdb, SLOT + 6 * H)
    assert (task.status, task.blocker) == ("blocked", "디자인 대기")


def test_p3a_nudge_follows_reassignment(mdb, mseed):
    task = _assign(mdb, mseed)
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    _change(mdb, task, PROPOSE + H, assignee_member_id=mseed["carol"].member_id)
    tick(mdb, PROPOSE + 2 * H)
    _send(mdb, SLOT)

    assert _notes(mdb, mseed, "alice", kind="reminder_sent") == []


def test_p3b_former_assignee_silence_does_not_block_reassigned_task(mdb, mseed):
    task = _suggested_and_sent(mdb, mseed)
    _change(mdb, task, SLOT + H, assignee_member_id=mseed["bob"].member_id)
    _web_reply(mdb, mseed, "bob", SLOT + 2 * H, body="제가 이어받았어요")
    tick(mdb, SLOT + H72)
    _web_reply(mdb, mseed, "bob", SLOT + 73 * H, body="진행 중이에요")
    tick(mdb, SLOT + 74 * H)
    assert task.status == "todo"


def test_p12_scheduler_release_is_not_a_response_from_new_assignee(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _change(mdb, task, SLOT + 73 * H, assignee_member_id=mseed["carol"].member_id, due_date=LATER_DUE)
    messages.create_reminder(
        mdb, workspace_id=mseed["ws"], task_id=task.task_id, member_id=mseed["carol"].member_id,
        scheduled_at=SLOT + 200 * H, note=None, created_by=mseed["pm"].member_id, now=SLOT + 74 * H,
    )
    mdb.commit()
    _web_reply(mdb, mseed, "alice", SLOT + 75 * H, body="이제 제 일이 아니에요")
    tick(mdb, SLOT + 76 * H)
    tick(mdb, SLOT + 77 * H)
    rows = [(r.status, r.bundle.thread.member.display_name) for r in _reminders(mdb, task)]
    assert [s for s, who in rows if who == "캐럴"] == [ReminderStatus.SCHEDULED]


def test_p5_pm_own_due_change_is_not_credited_to_member(mdb, mseed):
    task = _assign(mdb, mseed)
    tick(mdb, PROPOSE)
    _change(mdb, task, PROPOSE + H, due_date=date(2026, 11, 27))
    tick(mdb, PROPOSE + 2 * H)
    [note] = _notes(mdb, mseed, kind="reminder_auto_cancelled")
    assert "응답해서" not in note.text


def test_ok_block_release_block_undo_cycle(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _web_reply(mdb, mseed, "alice", SLOT + 73 * H)
    tick(mdb, SLOT + 74 * H)
    mdb.refresh(task)
    assert (task.status, task.blocker) == ("todo", None)
    _change(mdb, task, SLOT + 75 * H, due_date=LATER_DUE)
    _resend(mdb, mseed, task, SLOT + 76 * H, SLOT + 77 * H)
    tick(mdb, SLOT + 77 * H + H72)
    mdb.refresh(task)
    assert task.status == "blocked"
    assert _undo("pm", task.task_id).status_code == 200
    mdb.refresh(task)
    assert (task.status, task.blocker) == ("todo", None)
    assert mdb.query(Notification).filter(Notification.kind == "silence_blocked").count() == 2
    assert mdb.query(Reminder).filter(Reminder.status == ReminderStatus.SENT).count() == 2
    assert scheduler.BLOCKER_TEXT not in (task.blocker or "")


def _deliver(db, now):
    for claim in messages.claim_for_bot(db, now):
        messages.report_result(
            db, claim.message.message_id, delivered=True, failure_reason=None,
            discord_message_ids=[f"dm-{claim.message.message_id}"], now=now,
        )
    db.commit()


def _deleted(db, task):
    task.is_deleted = True
    db.commit()


def test_clock_starts_when_dm_is_delivered_not_when_message_is_made(mdb, mseed):
    task = _assign(mdb, mseed, 0)
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    tick(mdb, SLOT)
    late = SLOT + 73 * H
    tick(mdb, late)
    mdb.refresh(task)
    assert task.status != "blocked"

    _deliver(mdb, late)
    tick(mdb, late + timedelta(minutes=1))
    mdb.refresh(task)
    assert task.status != "blocked"

    tick(mdb, late + H72)
    mdb.refresh(task)
    assert task.status == "blocked"


def test_reassigned_before_send_cancels_even_approved_nudge_and_suggests_to_new_assignee(mdb, mseed):
    task = _assign(mdb, mseed, 0)
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    old = _reminders(mdb, task)[0]
    _change(mdb, task, PROPOSE + H, assignee_member_id=mseed["carol"].member_id)

    tick(mdb, PROPOSE + 2 * H)
    tick(mdb, PROPOSE + 3 * H)
    mdb.expire_all()

    assert old.status == ReminderStatus.CANCELLED
    assert any("담당자가 바뀌어" in n.text for n in _notes(mdb, mseed, kind="reminder_auto_cancelled"))
    live = [r for r in _reminders(mdb, task) if r.status == ReminderStatus.SCHEDULED]
    assert [r.bundle.thread.member_id for r in live] == [mseed["carol"].member_id]
    assert live[0].bundle.approved_at is None


def test_pm_nudge_to_someone_else_is_not_treated_as_reassignment(mdb, mseed):
    task = _assign(mdb, mseed, 0)
    reminder = messages.create_reminder(
        mdb, workspace_id=mseed["ws"], task_id=task.task_id, member_id=mseed["carol"].member_id,
        scheduled_at=SLOT, note=None, created_by=mseed["pm"].member_id, now=PROPOSE - H,
    )
    mdb.commit()
    tick(mdb, PROPOSE)
    mdb.expire_all()
    assert reminder.status == ReminderStatus.SCHEDULED


def test_reassigned_after_send_closes_clock_without_blocking(mdb, mseed):
    task = _suggested_and_sent(mdb, mseed)
    _change(mdb, task, SLOT + H, assignee_member_id=mseed["carol"].member_id)
    tick(mdb, SLOT + H72 + H)
    mdb.refresh(task)
    assert task.status != "blocked"
    assert _notes(mdb, mseed, kind="silence_blocked") == []


def test_auto_block_moves_to_new_assignee_clock_and_stays_undoable(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _change(mdb, task, SLOT + 73 * H, assignee_member_id=mseed["carol"].member_id, due_date=LATER_DUE)
    _resend(mdb, mseed, task, SLOT + 74 * H, SLOT + 75 * H, who="carol")

    _web_reply(mdb, mseed, "alice", SLOT + 76 * H, body="확인했어요")
    tick(mdb, SLOT + 77 * H)
    mdb.refresh(task)
    assert task.status == "blocked"

    assert _undo("pm", task.task_id).status_code == 200
    mdb.refresh(task)
    assert (task.status, task.blocker) == ("todo", None)


def test_new_assignee_reply_releases_inherited_auto_block(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _change(mdb, task, SLOT + 73 * H, assignee_member_id=mseed["carol"].member_id, due_date=LATER_DUE)
    _resend(mdb, mseed, task, SLOT + 74 * H, SLOT + 75 * H, who="carol")
    _web_reply(mdb, mseed, "carol", SLOT + 76 * H)
    tick(mdb, SLOT + 77 * H)
    mdb.refresh(task)
    assert (task.status, task.blocker) == ("todo", None)


def test_deleted_task_nudge_does_not_go_out_and_pm_is_told(mdb, mseed):
    task = _assign(mdb, mseed, 0)
    tick(mdb, PROPOSE)
    _approve_all(mdb, PROPOSE)
    _deleted(mdb, task)
    tick(mdb, SLOT)
    mdb.expire_all()
    assert _reminders(mdb, task)[0].status == ReminderStatus.CANCELLED
    assert mdb.query(ThreadMessage).count() == 0
    assert any("지워져" in n.text for n in _notes(mdb, mseed, kind="reminder_auto_cancelled"))


def test_pm_due_change_note_does_not_credit_the_member(mdb, mseed):
    task = _assign(mdb, mseed, 0)
    tick(mdb, PROPOSE)
    _change(mdb, task, PROPOSE + H, due_date=LATER_DUE)
    tick(mdb, PROPOSE + 2 * H)
    texts = [n.text for n in _notes(mdb, mseed, kind="reminder_auto_cancelled")]
    assert len(texts) == 1
    assert "상태나 마감이 바뀌어" in texts[0] and "응답해서" not in texts[0]


def _block_inherited_by_resend(db, seed):
    task = _auto_blocked(db, seed)
    _change(db, task, SLOT + 73 * H, due_date=LATER_DUE)
    _resend(db, seed, task, SLOT + 74 * H, SLOT + 75 * H)
    return task


def test_inherited_clock_clears_auto_reason_after_pm_moved_status(mdb, mseed):
    task = _block_inherited_by_resend(mdb, mseed)
    _change(mdb, task, SLOT + 76 * H, status="in_progress")
    tick(mdb, SLOT + 77 * H)
    _web_reply(mdb, mseed, "alice", SLOT + 78 * H)
    tick(mdb, SLOT + 79 * H)
    mdb.refresh(task)
    assert (task.status, task.blocker) == ("in_progress", None)


def test_inherited_clock_keeps_undo_after_reassignment(mdb, mseed):
    task = _block_inherited_by_resend(mdb, mseed)
    _change(mdb, task, SLOT + 76 * H, assignee_member_id=mseed["carol"].member_id)
    tick(mdb, SLOT + 77 * H)
    assert _undo("pm", task.task_id).status_code == 200


def test_inherited_clock_keeps_undo_when_new_dm_failed(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _change(mdb, task, SLOT + 73 * H, due_date=LATER_DUE)
    messages.create_reminder(
        mdb, workspace_id=mseed["ws"], task_id=task.task_id, member_id=mseed["alice"].member_id,
        scheduled_at=SLOT + 75 * H, note=None, created_by=mseed["pm"].member_id, now=SLOT + 74 * H,
    )
    mdb.commit()
    _approve_all(mdb, SLOT + 74 * H)
    tick(mdb, SLOT + 75 * H)
    for claim in messages.claim_for_bot(mdb, SLOT + 75 * H):
        messages.report_result(
            mdb, claim.message.message_id, delivered=False, failure_reason="dm_blocked",
            discord_message_ids=[], now=SLOT + 75 * H,
        )
    mdb.commit()
    tick(mdb, SLOT + 75 * H + H72)
    assert _undo("pm", task.task_id).status_code == 200


def test_former_assignee_reply_after_reassignment_leaves_auto_block(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _change(mdb, task, SLOT + 73 * H, assignee_member_id=mseed["carol"].member_id)
    _web_reply(mdb, mseed, "alice", SLOT + 74 * H, body="저는 이제 담당이 아니에요")
    tick(mdb, SLOT + 75 * H)
    mdb.refresh(task)
    assert task.status == "blocked"
    assert _undo("pm", task.task_id).status_code == 200


def test_reply_before_reassignment_still_releases_on_a_late_tick(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _web_reply(mdb, mseed, "alice", SLOT + 73 * H)
    _change(mdb, task, SLOT + 74 * H, assignee_member_id=mseed["carol"].member_id)
    tick(mdb, SLOT + 75 * H)
    mdb.refresh(task)
    assert (task.status, task.blocker) == ("todo", None)


def test_reassigned_back_counts_the_original_assignee_again(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _change(mdb, task, SLOT + 73 * H, assignee_member_id=mseed["carol"].member_id)
    _change(mdb, task, SLOT + 74 * H, assignee_member_id=mseed["alice"].member_id)
    _web_reply(mdb, mseed, "alice", SLOT + 75 * H)
    tick(mdb, SLOT + 76 * H)
    mdb.refresh(task)
    assert (task.status, task.blocker) == ("todo", None)


def test_due_dates_near_the_minimum_are_skipped_without_errors(mdb, mseed, caplog):
    _assign(mdb, mseed, 0, due=date(1, 1, 3))
    good = _assign(mdb, mseed, 1)
    tick(mdb, PROPOSE)
    assert _reminders(mdb, good)
    assert [r for r in caplog.records if r.levelname == "ERROR"] == []
