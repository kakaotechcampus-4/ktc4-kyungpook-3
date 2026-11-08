"""답장 판단 결과가 72시간 시계에 주는 효과. 판단 행을 직접 써서 판단 없이도 시계 쪽만 검증한다.

기준: 11/19 00:00 UTC 에 리마인드가 나가고 바로 전달되어 72시간 뒤가 시한이다.
"""
import json
from datetime import timedelta

import pytest

from app.models import (
    ChangeSource,
    Notification,
    ReminderWatch,
    ReplyChange,
    ReplyChangeField as F,
    ReplyChangeOutcome as O,
    ReplyJudgment,
    ReplyJudgmentState as S,
    WatchState,
)
from app.services import messages, replies, scheduler
from app.services.replies import ClockEffect as E
from app.services.tasks import apply_task_updates
from tests.api.test_replies import _remind, _reply
from tests.api.test_scheduler import SLOT, H, tick

MIN = timedelta(minutes=1)
DEADLINE = SLOT + timedelta(hours=72)


def _judged(db, message, state, *lines, candidates=None, picked=None):
    """판단 결과를 그대로 적는다. lines 는 (task, field, outcome, new_value)."""
    row = db.get(ReplyJudgment, message.message_id)
    row.state = state
    row.picked_task_id = picked and picked.task_id
    if candidates is not None:
        row.candidates = json.dumps([t.task_id for t in candidates])
    for task, field, outcome, *value in lines:
        db.add(ReplyChange(
            message_id=message.message_id, task_id=task and task.task_id, field=field, outcome=outcome,
            new_value=value[0] if value else None,
        ))
    db.commit()


def _watch(db, task):
    return db.query(ReminderWatch).filter(ReminderWatch.task_id == task.task_id).one()


def _effect(db, task, before=None):
    db.flush()
    return replies.clock_effect(db, _watch(db, task), before=before)


def _pm_notes(db, kind):
    return db.query(Notification).filter(Notification.kind == kind).all()


def _auto_blocked(db, seed, status="in_progress"):
    """72시간 무응답으로 스케줄러가 막은 태스크."""
    task = seed["tasks"][0]
    task.status = status
    _remind(db, seed, [task], SLOT)
    tick(db, DEADLINE)
    assert task.status == "blocked"
    return task


@pytest.fixture
def two(mdb, mseed):
    a, b = mseed["tasks"][:2]
    _remind(mdb, mseed, [a, b], SLOT)
    return a, b


# 판단 표

def test_without_a_judgment_row_a_reply_answers_like_before(mdb, mseed, two):
    message = _reply(mdb, mseed, SLOT + H)
    mdb.delete(mdb.get(ReplyJudgment, message.message_id))
    mdb.commit()
    assert _effect(mdb, two[0]) == E.ANSWERED


def test_no_reply_has_no_effect(mdb, mseed, two):
    assert _effect(mdb, two[0]) == E.NONE


@pytest.mark.parametrize("state", [S.FAILED, S.TIMED_OUT])
def test_failed_or_timed_out_reply_counts_as_answered(mdb, mseed, two, state):
    _judged(mdb, _reply(mdb, mseed, SLOT + H), state)
    assert _effect(mdb, two[0]) == E.ANSWERED


def test_pending_reply_waits(mdb, mseed, two):
    _reply(mdb, mseed, SLOT + H)
    assert _effect(mdb, two[0]) == E.WAIT


@pytest.mark.parametrize("outcome", [O.APPLIED, O.PROPOSED, O.NOTED])
def test_blocked_line_keeps_the_task_blocked(mdb, mseed, two, outcome):
    a, b = two
    _judged(mdb, _reply(mdb, mseed, SLOT + H), S.DONE, (a, F.STATUS, outcome, "blocked"))
    assert _effect(mdb, a) == E.KEEP_BLOCKED
    assert _effect(mdb, b) == E.NONE


@pytest.mark.parametrize("line", [
    (F.STATUS, O.APPLIED, "done"), (F.DUE_DATE, O.PROPOSED, "2026-11-30"), (F.NONE, O.NOTED), (F.SCOPE, O.PROPOSED),
    (F.STATUS, O.SKIPPED, "in_progress"),
])
def test_a_line_about_this_task_answers_only_this_task(mdb, mseed, two, line):
    a, b = two
    _judged(mdb, _reply(mdb, mseed, SLOT + H), S.DONE, (a, *line))
    assert _effect(mdb, a) == E.ANSWERED
    assert _effect(mdb, b) == E.NONE


def test_needs_pm_pauses_candidates_it_does_not_mention(mdb, mseed, two):
    a, b = two
    _judged(mdb, _reply(mdb, mseed, SLOT + H), S.NEEDS_PM, (None, F.UNKNOWN, O.UNKNOWN), (a, F.STATUS, O.APPLIED, "done"))
    assert _effect(mdb, a) == E.ANSWERED
    assert _effect(mdb, b) == E.PAUSE


def test_needs_pm_does_not_pause_a_task_outside_the_candidates(mdb, mseed, two):
    a, b = two
    _judged(mdb, _reply(mdb, mseed, SLOT + H), S.NEEDS_PM, (None, F.UNKNOWN, O.UNKNOWN), candidates=[a])
    assert _effect(mdb, b) == E.NONE


def test_picked_task_is_answered_even_without_lines(mdb, mseed, two):
    a, b = two
    _judged(mdb, _reply(mdb, mseed, SLOT + H), S.DONE, (None, F.UNKNOWN, O.PICKED), candidates=[a], picked=a)
    assert _effect(mdb, a) == E.ANSWERED
    assert _effect(mdb, b) == E.NONE


def test_dismissed_reply_leaves_the_clock_running(mdb, mseed, two):
    _judged(mdb, _reply(mdb, mseed, SLOT + H), S.DONE, (None, F.UNKNOWN, O.DISMISSED), candidates=[])
    assert _effect(mdb, two[0]) == E.NONE


def test_replies_at_or_after_the_cutoff_do_not_count(mdb, mseed, two):
    _judged(mdb, _reply(mdb, mseed, SLOT + H), S.DONE, (two[0], F.NONE, O.NOTED))
    assert _effect(mdb, two[0], before=SLOT + H) == E.NONE


# 여러 답장

@pytest.mark.parametrize("first, second, expected", [
    ("pending", "answered", E.WAIT),
    ("keep", "pending", E.WAIT),
    ("keep", "answered", E.KEEP_BLOCKED),
    ("answered", "keep", E.KEEP_BLOCKED),
    ("pause", "answered", E.ANSWERED),
    ("answered", "pause", E.ANSWERED),
    ("pause", "none", E.PAUSE),
    ("none", "pause", E.PAUSE),
])
def test_stronger_reply_wins_whatever_the_order(mdb, mseed, two, first, second, expected):
    a, b = two
    kinds = {
        "keep": lambda m: _judged(mdb, m, S.DONE, (a, F.STATUS, O.APPLIED, "blocked")),
        "answered": lambda m: _judged(mdb, m, S.DONE, (a, F.NONE, O.NOTED)),
        "pause": lambda m: _judged(mdb, m, S.NEEDS_PM, (None, F.UNKNOWN, O.UNKNOWN)),
        "none": lambda m: _judged(mdb, m, S.DONE, (b, F.NONE, O.NOTED)),
        "pending": lambda m: None,
    }
    kinds[first](_reply(mdb, mseed, SLOT + H))
    kinds[second](_reply(mdb, mseed, SLOT + 2 * H))
    assert _effect(mdb, a) == expected


# 틱

def test_pending_reply_holds_the_clock_past_the_deadline(mdb, mseed, two):
    a = two[0]
    _reply(mdb, mseed, DEADLINE - MIN)
    tick(mdb, DEADLINE + timedelta(minutes=8))
    assert a.status == "todo"
    assert _watch(mdb, a).state == WatchState.WATCHING


def test_answered_task_closes_after_judgment_not_on_arrival(mdb, mseed, two):
    a = two[0]
    message = _reply(mdb, mseed, SLOT + H)
    tick(mdb, SLOT + H)
    assert _watch(mdb, a).state == WatchState.WATCHING

    _judged(mdb, message, S.DONE, (a, F.NONE, O.NOTED))
    tick(mdb, SLOT + H + MIN)
    assert _watch(mdb, a).state == WatchState.ANSWERED


def test_other_task_keeps_counting_and_blocks_at_its_deadline(mdb, mseed, two):
    a, b = two
    _judged(mdb, _reply(mdb, mseed, SLOT + H), S.DONE, (a, F.NONE, O.NOTED))
    tick(mdb, SLOT + 2 * H)
    assert _watch(mdb, b).state == WatchState.WATCHING
    tick(mdb, DEADLINE)
    assert (b.status, _watch(mdb, b).state) == ("blocked", WatchState.BLOCKED)
    assert a.status == "todo"


def test_answered_reply_unblocks_to_the_status_before_the_block(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _judged(mdb, _reply(mdb, mseed, DEADLINE + H), S.DONE, (task, F.NONE, O.NOTED))
    tick(mdb, DEADLINE + 2 * H)
    assert (task.status, task.blocker) == ("in_progress", None)
    assert _watch(mdb, task).state == WatchState.RELEASED


def test_blocked_answer_keeps_the_block_and_closes_the_clock(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _judged(mdb, _reply(mdb, mseed, DEADLINE + H), S.DONE, (task, F.STATUS, O.APPLIED, "blocked"))
    tick(mdb, DEADLINE + 2 * H)
    assert task.status == "blocked"
    assert _watch(mdb, task).state == WatchState.ANSWERED


def test_manual_change_during_a_pause_still_closes_the_clock(mdb, mseed, two):
    a = two[0]
    _judged(mdb, _reply(mdb, mseed, SLOT + H), S.NEEDS_PM, (None, F.UNKNOWN, O.UNKNOWN))
    for entry in apply_task_updates(mdb, a, {"status": "in_progress"}, change_source=ChangeSource.MANUAL):
        entry.created_at = SLOT + 2 * H
    mdb.commit()
    tick(mdb, SLOT + 3 * H)
    assert _watch(mdb, a).state == WatchState.ANSWERED


# 멈춘 시계

def test_paused_clock_does_not_block_and_resumes_with_the_time_left(mdb, mseed, two):
    a = two[0]
    pause_at, resume_at = SLOT + H, SLOT + 100 * H
    tick(mdb, pause_at - MIN)
    message = _reply(mdb, mseed, pause_at)
    _judged(mdb, message, S.NEEDS_PM, (None, F.UNKNOWN, O.UNKNOWN))
    tick(mdb, pause_at)
    watch = _watch(mdb, a)
    assert messages.utc(watch.paused_at) == pause_at

    tick(mdb, DEADLINE + H)
    assert a.status == "todo"
    assert messages.utc(watch.paused_at) == pause_at

    row = mdb.get(ReplyJudgment, message.message_id)
    row.state = S.DONE
    row.candidates = "[]"
    mdb.commit()
    tick(mdb, resume_at)
    assert watch.paused_at is None
    new_deadline = DEADLINE + (resume_at - pause_at)
    assert messages.utc(watch.deadline_at) == new_deadline

    tick(mdb, new_deadline - MIN)
    assert a.status == "todo"
    tick(mdb, new_deadline)
    assert a.status == "blocked"


def test_pause_is_only_stamped_once(mdb, mseed, two):
    a = two[0]
    _judged(mdb, _reply(mdb, mseed, SLOT + H), S.NEEDS_PM, (None, F.UNKNOWN, O.UNKNOWN))
    tick(mdb, SLOT + H)
    tick(mdb, SLOT + 2 * H)
    assert messages.utc(_watch(mdb, a).paused_at) == SLOT + H


# 10분

def test_ten_minutes_without_a_result_times_out_tells_pm_once_and_answers(mdb, mseed, two):
    a = two[0]
    message = _reply(mdb, mseed, SLOT + H, who="alice")
    tick(mdb, SLOT + H + timedelta(minutes=10) - timedelta(seconds=1))
    assert mdb.get(ReplyJudgment, message.message_id).state == S.PENDING
    assert _pm_notes(mdb, "reply_unjudged") == []

    tick(mdb, SLOT + H + timedelta(minutes=10))
    assert mdb.get(ReplyJudgment, message.message_id).state == S.TIMED_OUT
    assert _watch(mdb, a).state == WatchState.ANSWERED
    tick(mdb, SLOT + 2 * H)

    [note] = _pm_notes(mdb, "reply_unjudged")
    assert note.member_id == mseed["pm"].member_id
    assert note.text == "앨리스 답장이 왔어요. 자동 판단을 못 해서 확인이 필요해요"
    assert (note.link_type, note.link_id) == ("thread", message.thread_id)


def test_finished_row_is_not_expired(mdb, mseed, two):
    _judged(mdb, _reply(mdb, mseed, SLOT + H), S.DONE, (two[0], F.NONE, O.NOTED))
    tick(mdb, SLOT + 2 * H)
    assert _pm_notes(mdb, "reply_unjudged") == []


def test_expire_rechecks_the_row(mdb, mseed, two):
    message = _reply(mdb, mseed, SLOT + H)
    now = SLOT + H + timedelta(minutes=10)
    assert replies.overdue(mdb, now) == [message.message_id]
    mdb.get(ReplyJudgment, message.message_id).queued_at = now
    mdb.commit()
    replies.expire(mdb, message.message_id, now)
    assert mdb.get(ReplyJudgment, message.message_id).state == S.PENDING


def test_tick_order_expires_before_settling_so_one_tick_is_enough(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _reply(mdb, mseed, DEADLINE + H)
    tick(mdb, DEADLINE + 2 * H)
    assert task.status == "in_progress"


# 판단에 보일 상태

def test_judge_status_of_an_open_task_is_its_status(mdb, mseed, two):
    assert replies._judge_status(mdb, two[0]) == "todo"


def test_judge_status_of_an_auto_blocked_task_is_the_status_before(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    assert replies._judge_status(mdb, task) == "in_progress"


def test_judge_status_of_a_manual_block_under_a_clock_is_the_status_before(mdb, mseed, two):
    a = two[0]
    a.status = "in_progress"
    mdb.commit()
    apply_task_updates(mdb, a, {"status": "blocked", "blocker": "키 대기"}, change_source=ChangeSource.MANUAL)
    mdb.commit()
    assert replies._judge_status(mdb, a) == "in_progress"


def test_judge_status_of_a_block_without_an_open_clock_is_blocked(mdb, mseed, two):
    a = two[0]
    a.status = "blocked"
    _watch(mdb, a).state = WatchState.STOPPED
    mdb.commit()
    assert replies._judge_status(mdb, a) == "blocked"


def test_stopped_watch_ignores_the_reply_table(mdb, mseed, two):
    a = two[0]
    _watch(mdb, a).state = WatchState.STOPPED
    mdb.commit()
    scheduler.settle_watches(mdb, SLOT + H)
    assert _watch(mdb, a).state == WatchState.STOPPED
