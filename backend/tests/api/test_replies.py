"""리마인드 답장 판단. 답장 저장부터 태스크 반영·알림·타임라인까지. 판단(LLM)은 봇 쪽이라 여기서는 결과 본문을 직접 준다."""
import json

from app.models import ReminderWatch, ReplyJudgment, ReplyJudgmentState, WatchState
from app.services import messages
from tests.api.test_scheduler import SLOT, H, _approve_all, _send


def _remind(db, seed, tasks, at, who="alice"):
    """태스크들의 리마인드를 한 묶음으로 at 에 보낸다. 시계까지 열린다."""
    for task in tasks:
        task.assignee_member_id = seed[who].member_id
        messages.create_reminder(
            db, workspace_id=seed["ws"], task_id=task.task_id, member_id=seed[who].member_id,
            scheduled_at=at, note=None, created_by=seed["pm"].member_id, now=at - H,
        )
    db.commit()
    _approve_all(db, at - H)
    _send(db, at)


def _reply(db, seed, at, who="alice", body="네"):
    thread = messages.get_or_create_thread(db, seed["ws"], seed[who].member_id)
    message = messages.add_web_reply(db, thread, body=body, now=at)
    db.commit()
    return message


def _row(db, message):
    return db.get(ReplyJudgment, message.message_id)


def _candidates(db, message):
    return set(json.loads(_row(db, message).candidates))


def _ids(*tasks):
    return {t.task_id for t in tasks}


# 후보

def test_reply_to_a_reminder_queues_one_judgment(mdb, mseed):
    a, b = mseed["tasks"][:2]
    _remind(mdb, mseed, [a, b], SLOT)
    message = _reply(mdb, mseed, SLOT + H)

    row = _row(mdb, message)
    assert row.state == ReplyJudgmentState.PENDING
    assert messages.utc(row.queued_at) == SLOT + H
    assert (row.workspace_id, row.thread_id) == (mseed["ws"], message.thread_id)
    assert (row.attempt, row.claimed_at, row.finished_at) == (0, None, None)
    assert _candidates(mdb, message) == _ids(a, b)


def test_message_without_any_reminder_has_no_judgment(mdb, mseed):
    assert _row(mdb, _reply(mdb, mseed, SLOT)) is None


def test_another_members_reminder_is_not_a_candidate(mdb, mseed):
    _remind(mdb, mseed, [mseed["tasks"][0]], SLOT, who="bob")
    assert _row(mdb, _reply(mdb, mseed, SLOT + H)) is None


def test_discord_reply_queues_once_even_if_sent_twice(mdb, mseed):
    task = mseed["tasks"][0]
    _remind(mdb, mseed, [task], SLOT)
    kwargs = dict(discord_user_id="d_alice", discord_message_id="reply-1", body="네", sent_at=SLOT + H, now=SLOT + H)
    first, created = messages.ingest_discord_reply(mdb, **kwargs)
    mdb.commit()
    again, created_again = messages.ingest_discord_reply(mdb, **kwargs)
    mdb.commit()

    assert (created, created_again) == (True, False)
    assert first.message_id == again.message_id
    assert _candidates(mdb, first) == _ids(task)
    assert mdb.query(ReplyJudgment).count() == 1


def test_later_replies_keep_the_last_bundle_after_its_clock_closed(mdb, mseed):
    task = mseed["tasks"][0]
    _remind(mdb, mseed, [task], SLOT)
    for watch in mdb.query(ReminderWatch).all():
        watch.state = WatchState.ANSWERED
    mdb.commit()

    assert _candidates(mdb, _reply(mdb, mseed, SLOT + H)) == _ids(task)


def test_candidates_are_last_bundle_and_open_clocks(mdb, mseed):
    older, answered, last = mseed["tasks"]
    _remind(mdb, mseed, [older, answered], SLOT)
    [w for w in mdb.query(ReminderWatch).all() if w.task_id == answered.task_id][0].state = WatchState.ANSWERED
    mdb.commit()
    _remind(mdb, mseed, [last], SLOT + H)

    assert _candidates(mdb, _reply(mdb, mseed, SLOT + 2 * H)) == _ids(older, last)


def test_deleted_or_reassigned_task_is_not_a_candidate(mdb, mseed):
    deleted, moved, kept = mseed["tasks"]
    _remind(mdb, mseed, [deleted, moved, kept], SLOT)
    deleted.is_deleted = True
    moved.assignee_member_id = mseed["bob"].member_id
    mdb.commit()

    assert _candidates(mdb, _reply(mdb, mseed, SLOT + H)) == _ids(kept)


def test_only_reminders_sent_before_the_reply_count(mdb, mseed):
    a, b = mseed["tasks"][:2]
    _remind(mdb, mseed, [a], SLOT)
    _remind(mdb, mseed, [b], SLOT + 2 * H)
    message, _ = messages.ingest_discord_reply(
        mdb, discord_user_id="d_alice", discord_message_id="old", body="네", sent_at=SLOT + H, now=SLOT + 3 * H,
    )
    mdb.commit()

    assert _candidates(mdb, message) == _ids(a)
