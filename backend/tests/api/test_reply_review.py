"""PM 쪽 경로. 태스크 고르기와 재판단, 되돌리기, 승인 이력 연결, 태스크 타임라인."""
import json
from datetime import datetime, timedelta, timezone

import pytest

from app.models import (
    ApprovalRequest,
    Member,
    MemberAlias,
    Notification,
    ReminderWatch,
    ReplyChange,
    ReplyJudgmentState as S,
    TaskHistory,
    WatchState,
    Workspace,
)
from app.services import messages, replies, scheduler
from app.services import tasks as task_service
from tests.api.test_messages_api import P, client
from tests.api.test_replies import _remind, _reply
from tests.api.test_reply_clock import DEADLINE, _auto_blocked
from tests.api.test_reply_judgment import AT, _change, _claim, _judge, _lines, _outcomes, _post, _row
from tests.api.test_scheduler import SLOT, H, tick


def _attribute(item, task, token="pm", ws=None, seed=None):
    message_id = item["message_id"] if isinstance(item, dict) else item
    task_id = task.task_id if hasattr(task, "task_id") else task
    return client(token).post(
        f"{P}/workspaces/{ws or seed['ws']}/messages/replies/{message_id}/attribution", json={"task_id": task_id},
    )


def _unknown(mdb, mseed, at=AT, body="그거 다 했어요"):
    """태스크를 모르는 판단까지 끝낸 답장."""
    _reply(mdb, mseed, at, body=body)
    item = _claim()
    _judge(item, _change(None, "unknown", quote=body))
    return item


def _watch(db, task):
    db.expire_all()
    return db.query(ReminderWatch).filter(ReminderWatch.task_id == task.task_id).one()


def _kind(db, kind):
    db.expire_all()
    return db.query(Notification).filter(Notification.kind == kind).all()


@pytest.fixture
def two(mdb, mseed):
    a, b = mseed["tasks"][:2]
    a.title, b.title = "API 명세서", "로그인"
    a.status = "in_progress"
    _remind(mdb, mseed, [a, b], SLOT)
    return a, b


# 태스크 고르기

def test_picking_a_task_queues_a_rejudgment_for_that_task_only(mdb, mseed, two):
    a, _ = two
    item = _unknown(mdb, mseed)
    first_queued_at = _row(mdb, item).queued_at
    r = _attribute(item, a, seed=mseed)
    assert (r.status_code, r.json()["data"]) == (200, {"message_id": item["message_id"]})

    row = _row(mdb, item)
    assert (row.state, row.picked_task_id, row.claimed_at, row.finished_at) == (S.PENDING, a.task_id, None, None)
    assert json.loads(row.candidates) == [a.task_id]
    assert row.queued_at != first_queued_at
    assert _outcomes(mdb, item) == [("unknown", "picked")]

    again = _claim()
    assert (again["message_id"], again["attempt"]) == (item["message_id"], item["attempt"] + 1)
    assert [c["task_id"] for c in again["candidates"]] == [a.task_id]

    _judge(again, _change(a, "status", "done", evidence="certain", claimed=again))
    assert a.status == "done"
    assert _row(mdb, item).state == S.DONE
    assert [n.text for n in _kind(mdb, "reply_judged")] == [
        "앨리스 답장 '그거 다 했어요' → 어느 태스크인지 골라 주세요",
        "앨리스 답장 '그거 다 했어요' → API 명세서 완료로 바꿨어요(되돌리기)",
    ]


def test_rejudgment_without_a_change_tells_the_pm_it_found_nothing(mdb, mseed, two):
    a, _ = two
    item = _unknown(mdb, mseed)
    _attribute(item, a, seed=mseed)
    again = _claim()
    _judge(again, _change(None, "unknown"))

    assert _row(mdb, item).state == S.DONE
    assert _outcomes(mdb, item) == [("none", "noted"), ("unknown", "picked")]
    [_, found_nothing] = _kind(mdb, "reply_judged")
    assert found_nothing.text == "앨리스 답장 '그거 다 했어요' → 바꿀 내용을 찾지 못했어요. 직접 확인해 주세요"
    assert (found_nothing.link_type, found_nothing.link_id) == ("thread", _row(mdb, item).thread_id)


def test_rejudgment_with_only_the_current_value_tells_the_pm_too(mdb, mseed, two):
    a, _ = two
    item = _unknown(mdb, mseed)
    _attribute(item, a, seed=mseed)
    again = _claim()
    _judge(again, _change(a, "status", "in_progress", evidence="certain", claimed=again))
    assert _kind(mdb, "reply_judged")[-1].text.endswith("→ 바꿀 내용을 찾지 못했어요. 직접 확인해 주세요")


def test_rejudgment_failure_tells_pm(mdb, mseed, two):
    a, _ = two
    item = _unknown(mdb, mseed)
    _attribute(item, a, seed=mseed)
    _judge(_claim(), failure="Boom")
    assert _row(mdb, item).state == S.FAILED
    assert len(_kind(mdb, "reply_unjudged")) == 1


def test_result_from_before_the_pick_is_stale(mdb, mseed, two):
    a, _ = two
    item = _unknown(mdb, mseed)
    _attribute(item, a, seed=mseed)
    r = _post(item["message_id"], {"attempt": item["attempt"], "changes": [_change(None, "unknown")]})
    assert (r.status_code, r.json()["error"]["code"]) == (409, "REPLY_JUDGMENT_STALE")


def test_rejudgment_does_not_apply_a_field_twice(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT, body="API 끝났고 그것도 다 했어요")
    item = _claim()
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item), _change(None, "unknown"))
    _attribute(item, a, seed=mseed)
    again = _claim()
    _judge(again, _change(a, "status", "done", evidence="certain", claimed=again))

    assert _row(mdb, item).state == S.DONE
    assert mdb.query(TaskHistory).filter(TaskHistory.task_id == a.task_id, TaskHistory.changed_field == "status").count() == 1
    assert mdb.query(ReplyChange).filter(ReplyChange.task_id == a.task_id).count() == 1


def test_rejudgment_may_not_touch_another_task(mdb, mseed, two):
    a, b = two
    item = _unknown(mdb, mseed)
    _attribute(item, a, seed=mseed)
    again = _claim()
    r = _post(again["message_id"], {"attempt": again["attempt"], "changes": [_change(b, "status", "done")]})
    assert r.status_code == 400


def test_not_applicable_closes_the_reply(mdb, mseed, two):
    item = _unknown(mdb, mseed)
    assert _attribute(item, None, seed=mseed).status_code == 200
    row = _row(mdb, item)
    assert (row.state, row.picked_task_id, json.loads(row.candidates)) == (S.DONE, None, [])
    assert _outcomes(mdb, item) == [("unknown", "dismissed")]
    assert _claim() is None


def test_unpicked_task_resumes_its_clock_and_picked_task_is_answered(mdb, mseed, two):
    a, b = two
    paused_at, resume_at = AT + timedelta(minutes=1), AT + 2 * H
    item = _unknown(mdb, mseed)
    tick(mdb, paused_at)
    assert messages.utc(_watch(mdb, b).paused_at) == paused_at

    _attribute(item, a, seed=mseed)
    again = _claim()
    _judge(again, _change(a, "status", "done", evidence="certain", claimed=again))
    tick(mdb, resume_at)

    assert _watch(mdb, a).state == WatchState.ANSWERED
    watch = _watch(mdb, b)
    assert (watch.state, watch.paused_at) == (WatchState.WATCHING, None)
    assert messages.utc(watch.deadline_at) == DEADLINE + (resume_at - paused_at)


def test_unpicked_clock_keeps_counting_when_rejudgment_fails(mdb, mseed, two):
    a, b = two
    item = _unknown(mdb, mseed)
    tick(mdb, AT + timedelta(minutes=1))
    assert _watch(mdb, b).paused_at is not None
    _attribute(item, a, seed=mseed)
    _judge(_claim(), failure="TimeoutError")
    tick(mdb, AT + 2 * H)
    assert _watch(mdb, a).state == WatchState.ANSWERED
    assert _watch(mdb, b).state == WatchState.WATCHING


def test_unpicked_clock_keeps_counting_when_rejudgment_times_out(mdb, mseed, two):
    a, b = two
    item = _unknown(mdb, mseed)
    tick(mdb, AT + timedelta(minutes=1))
    replies.attribute(mdb, mseed["ws"], item["message_id"], a.task_id, AT + timedelta(minutes=2))
    mdb.commit()
    tick(mdb, AT + timedelta(minutes=13))
    assert _row(mdb, item).state == S.TIMED_OUT
    assert _watch(mdb, a).state == WatchState.ANSWERED
    assert _watch(mdb, b).state == WatchState.WATCHING


def test_unpicked_auto_blocked_task_stays_blocked_when_rejudgment_fails(mdb, mseed):
    a, b = mseed["tasks"][:2]
    a.status, b.status = "in_progress", "in_progress"
    _remind(mdb, mseed, [a, b], SLOT)
    tick(mdb, DEADLINE)
    item = _unknown(mdb, mseed, at=DEADLINE + H)
    tick(mdb, DEADLINE + H + timedelta(minutes=1))
    _attribute(item, a, seed=mseed)
    _judge(_claim(), failure="TimeoutError")
    tick(mdb, DEADLINE + 2 * H)
    mdb.expire_all()
    assert (a.status, b.status) == ("in_progress", "blocked")


def test_line_on_the_unpicked_task_still_counts_after_a_failed_rejudgment(mdb, mseed, two):
    a, b = two
    _reply(mdb, mseed, AT)
    item = _claim()
    _judge(
        item, _change(b, "status", "blocked", evidence="inferred", claimed=item), _change(None, "unknown", quote="그거"),
    )
    _attribute(item, a, seed=mseed)
    _judge(_claim(), failure="TimeoutError")
    tick(mdb, AT + H)
    assert _watch(mdb, b).state == WatchState.ANSWERED


def test_dismissing_resumes_every_clock(mdb, mseed, two):
    a, b = two
    item = _unknown(mdb, mseed)
    tick(mdb, AT + timedelta(minutes=1))
    assert _watch(mdb, a).paused_at is not None
    _attribute(item, None, seed=mseed)
    tick(mdb, AT + H)
    assert _watch(mdb, a).paused_at is None
    assert _watch(mdb, b).state == WatchState.WATCHING


def test_only_pm_picks(mdb, mseed, two):
    item = _unknown(mdb, mseed)
    assert _attribute(item, two[0], token="alice", seed=mseed).status_code == 403


def test_reply_without_a_judgment_is_404(mdb, mseed, two):
    r = _attribute("없는 id", two[0], seed=mseed)
    assert (r.status_code, r.json()["error"]["code"]) == (404, "REPLY_JUDGMENT_NOT_FOUND")


def test_reply_of_another_workspace_is_404(mdb, mseed, two):
    item = _unknown(mdb, mseed)
    with pytest.raises(replies.AppError) as e:
        replies.attribute(mdb, "다른 워크스페이스", item["message_id"], two[0].task_id, AT)
    assert e.value.code == "REPLY_JUDGMENT_NOT_FOUND"


def test_reply_that_does_not_need_a_pick_is_409(mdb, mseed, two):
    _reply(mdb, mseed, AT)
    item = _claim()
    assert _attribute(item, two[0], seed=mseed).json()["error"]["code"] == "REPLY_ATTRIBUTION_NOT_NEEDED"
    _judge(item)
    assert _attribute(item, two[0], seed=mseed).status_code == 409


def test_picking_twice_is_409(mdb, mseed, two):
    item = _unknown(mdb, mseed)
    _attribute(item, two[0], seed=mseed)
    assert _attribute(item, two[1], seed=mseed).status_code == 409


def test_task_outside_the_candidates_cannot_be_picked(mdb, mseed, two):
    item = _unknown(mdb, mseed)
    r = _attribute(item, mseed["tasks"][2], seed=mseed)
    assert (r.status_code, r.json()["error"]["code"]) == (400, "INVALID_REQUEST")
    assert _row(mdb, item).state == S.NEEDS_PM


# 고르기 화면 목록

def _attributions(seed, thread_id, token="pm"):
    return client(token).get(f"{P}/workspaces/{seed['ws']}/messages/threads/{thread_id}/attributions")


def test_attributions_list_replies_that_needed_a_pick(mdb, mseed, two):
    a, b = two
    waiting = _unknown(mdb, mseed, body="첫째")
    dismissed = _unknown(mdb, mseed, at=AT + H, body="둘째")
    picked = _unknown(mdb, mseed, at=AT + 2 * H, body="셋째")
    _reply(mdb, mseed, AT + 3 * H)
    plain = _claim()
    _judge(plain)
    _attribute(dismissed, None, seed=mseed)
    _attribute(picked, a, seed=mseed)

    thread_id = _row(mdb, waiting).thread_id
    r = _attributions(mseed, thread_id)
    assert r.status_code == 200
    data = r.json()["data"]
    by_id = {item["message_id"]: item for item in data["items"]}
    assert data["total"] == 3 and plain["message_id"] not in by_id
    assert by_id[waiting["message_id"]]["status"] == "needs_pm"
    assert {c["title"] for c in by_id[waiting["message_id"]]["candidates"]} == {"API 명세서", "로그인"}
    assert by_id[dismissed["message_id"]] == {
        "message_id": dismissed["message_id"], "status": "resolved", "candidates": None, "task": None,
    }
    assert by_id[picked["message_id"]]["task"] == {"task_id": a.task_id, "title": "API 명세서"}


def test_attributions_are_for_pm_and_this_workspace(mdb, mseed, two):
    item = _unknown(mdb, mseed)
    assert _attributions(mseed, _row(mdb, item).thread_id, token="alice").status_code == 403
    assert _attributions(mseed, "없는 대화").status_code == 404


# 되돌리기

def _undo(task, change_id, token="pm"):
    return client(token).post(f"{P}/tasks/{task.task_id}/reply-changes/{change_id}/undo")


def _applied(mdb, mseed, task, value="done", quote="근거"):
    _reply(mdb, mseed, AT)
    item = _claim()
    _judge(item, _change(task, "status", value, evidence="certain", claimed=item, quote=quote))
    return item, _lines(mdb, item)[(task.task_id, "status")].change_id


def test_undo_puts_the_status_back(mdb, mseed, two):
    a, _ = two
    _, change_id = _applied(mdb, mseed, a)
    r = _undo(a, change_id)
    assert r.status_code == 200
    assert r.json()["data"]["status"] == "in_progress"
    mdb.expire_all()
    assert a.status == "in_progress"
    entries = mdb.query(TaskHistory).filter(TaskHistory.task_id == a.task_id, TaskHistory.changed_field == "status").all()
    assert sorted((e.new_value, e.is_rolled_back) for e in entries) == [("done", True), ("in_progress", False)]


def test_undo_restores_status_and_reason_together(mdb, mseed, two):
    a, _ = two
    _, change_id = _applied(mdb, mseed, a, value="blocked", quote="키 대기")
    assert _undo(a, change_id).status_code == 200
    mdb.expire_all()
    assert (a.status, a.blocker) == ("in_progress", None)


def test_undo_twice_is_409(mdb, mseed, two):
    a, _ = two
    _, change_id = _applied(mdb, mseed, a)
    _undo(a, change_id)
    r = _undo(a, change_id)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "REPLY_CHANGE_NOT_UNDOABLE")


def test_undo_refuses_whole_if_any_field_moved_on(mdb, mseed, two):
    a, _ = two
    _, change_id = _applied(mdb, mseed, a, value="blocked", quote="키 대기")
    assert client("pm").patch(f"{P}/tasks/{a.task_id}", json={"blocker": "다른 사유"}).status_code == 200
    r = _undo(a, change_id)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "REPLY_CHANGE_NOT_UNDOABLE")
    mdb.expire_all()
    assert (a.status, a.blocker) == ("blocked", "다른 사유")
    assert not mdb.query(TaskHistory).filter(TaskHistory.is_rolled_back.is_(True)).count()


def test_only_applied_changes_are_undoable(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    item = _claim()
    _judge(item, _change(a, "status", "done", evidence="inferred", claimed=item))
    assert _undo(a, _lines(mdb, item)[(a.task_id, "status")].change_id).status_code == 409


def test_change_of_another_task_or_unknown_change_is_not_undoable(mdb, mseed, two):
    a, b = two
    _, change_id = _applied(mdb, mseed, a)
    assert _undo(b, change_id).status_code == 409
    assert _undo(a, "없는 id").status_code == 409


def test_only_pm_undoes(mdb, mseed, two):
    a, _ = two
    _, change_id = _applied(mdb, mseed, a)
    assert _undo(a, change_id, token="alice").status_code == 403


# 승인과 이력

def _resolve(approval_id, status="approved", **extra):
    return client("pm").patch(f"{P}/approvals/{approval_id}", json={"status": status, **extra})


def _proposed(mdb, mseed, *changes):
    _reply(mdb, mseed, AT)
    item = _claim()
    _judge(item, *[c(item) for c in changes])
    return item


def test_approved_change_is_linked_to_its_line(mdb, mseed, two):
    a, _ = two
    item = _proposed(mdb, mseed, lambda i: _change(a, "due_date", "2026-12-01", claimed=i))
    line = _lines(mdb, item)[(a.task_id, "due_date")]
    assert _resolve(line.approval_id).status_code == 200
    [entry] = mdb.query(TaskHistory).filter(TaskHistory.task_id == a.task_id, TaskHistory.changed_field == "due_date").all()
    assert entry.reply_change_id == line.change_id
    assert entry.change_source == "reminder_reply"


def test_value_the_pm_edited_while_approving_is_linked_too(mdb, mseed, two):
    a, _ = two
    item = _proposed(mdb, mseed, lambda i: _change(a, "due_date", "2026-12-01", claimed=i))
    line = _lines(mdb, item)[(a.task_id, "due_date")]
    r = _resolve(line.approval_id, task_overrides={"due_date": "2026-12-05"})
    assert r.status_code == 200, r.text
    [entry] = mdb.query(TaskHistory).filter(TaskHistory.task_id == a.task_id, TaskHistory.changed_field == "due_date").all()
    assert (entry.new_value, entry.change_source, entry.reply_change_id) == ("2026-12-05", "manual", line.change_id)


def test_card_with_two_fields_links_each_to_its_own_line(mdb, mseed, two):
    a, _ = two
    item = _proposed(
        mdb, mseed,
        lambda i: _change(a, "status", "done", evidence="inferred", claimed=i),
        lambda i: _change(a, "due_date", "2026-12-01", claimed=i),
    )
    lines = _lines(mdb, item)
    _resolve(lines[(a.task_id, "status")].approval_id)
    linked = {
        e.changed_field: e.reply_change_id
        for e in mdb.query(TaskHistory).filter(TaskHistory.reply_change_id.is_not(None)).all()
    }
    assert linked == {
        "status": lines[(a.task_id, "status")].change_id, "due_date": lines[(a.task_id, "due_date")].change_id,
    }


def test_card_conflicts_after_the_pm_changes_the_field(mdb, mseed, two):
    a, _ = two
    item = _proposed(mdb, mseed, lambda i: _change(a, "status", "done", evidence="inferred", claimed=i))
    client("pm").patch(f"{P}/tasks/{a.task_id}", json={"status": "todo"})
    r = _resolve(_lines(mdb, item)[(a.task_id, "status")].approval_id)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "APPROVAL_CONFLICT")


def test_auto_block_release_does_not_conflict_with_a_card_based_on_the_status_before(mdb, mseed):
    task = mseed["tasks"][0]
    task.status = "in_progress"
    _remind(mdb, mseed, [task], SLOT)
    tick(mdb, DEADLINE)
    _reply(mdb, mseed, DEADLINE + H, body="QA 넘겼어요")
    item = _claim()
    _judge(item, _change(task, "status", "done", evidence="inferred", claimed=item))
    tick(mdb, DEADLINE + 2 * H)
    assert task.status == "in_progress"

    r = _resolve(_lines(mdb, item)[(task.task_id, "status")].approval_id)
    assert r.status_code == 200, r.text
    mdb.expire_all()
    assert task.status == "done"


# 타임라인

def _timeline(task, token="pm"):
    r = client(token).get(f"{P}/tasks/{task.task_id}/timeline")
    assert r.status_code == 200, r.text
    return r.json()["data"]


def test_applied_change_is_one_line_under_the_reply(mdb, mseed, two):
    a, _ = two
    item, change_id = _applied(mdb, mseed, a)
    data = _timeline(a)
    assert data["total"] == 1
    [reply] = data["items"]
    assert reply["kind"] == "reply"
    assert (reply["message_id"], reply["member_name"], reply["channel"], reply["body"]) == (
        item["message_id"], "앨리스", "web", "네",
    )
    assert reply["at"]
    [change] = reply["changes"]
    assert change == {
        "change_id": change_id, "field": "status", "new_value": "done", "evidence_status": "certain",
        "summary": "AI 해석", "evidence_quote": "근거", "result": "applied", "undoable": True,
    }


def test_history_route_keeps_its_shape(mdb, mseed, two):
    a, _ = two
    _applied(mdb, mseed, a)
    [entry] = [e for e in client("pm").get(f"{P}/tasks/{a.task_id}/history").json()["data"]["items"]
               if e["changed_field"] == "status"]
    assert "reply_change_id" not in entry


def test_nothing_to_change_shows_on_each_candidate(mdb, mseed, two):
    a, b = two
    _reply(mdb, mseed, AT)
    _judge(_claim())
    for task in (a, b):
        [reply] = _timeline(task)["items"]
        [change] = reply["changes"]
        assert (change["field"], change["result"], change["undoable"]) == ("none", "noted", False)


def test_reason_replaced_by_an_inferred_block_shows_only_under_the_reply(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _reply(mdb, mseed, DEADLINE + H, body="키가 늦네요")
    item = _claim()
    _judge(item, _change(task, "status", "blocked", evidence="inferred", claimed=item, quote="키가 늦네요"))
    items = _timeline(task)["items"]
    [reply] = [i for i in items if i["kind"] == "reply"]
    [change] = reply["changes"]
    assert (change["field"], change["result"], change["undoable"]) == ("status", "noted", False)
    assert [i for i in items if i["kind"] == "history" and i["change_source"] == "reminder_reply"] == []


def test_reply_shows_only_on_the_task_it_touched(mdb, mseed, two):
    a, b = two
    _applied(mdb, mseed, a)
    assert _timeline(b)["items"] == []


@pytest.mark.parametrize("status, result", [(None, "pending"), ("approved", "approved"), ("rejected", "rejected")])
def test_card_result_is_read_from_the_approval(mdb, mseed, two, status, result):
    a, _ = two
    item = _proposed(mdb, mseed, lambda i: _change(a, "due_date", "2026-12-01", claimed=i))
    if status:
        _resolve(_lines(mdb, item)[(a.task_id, "due_date")].approval_id, status=status)
    [reply] = _timeline(a)["items"]
    assert reply["changes"][0]["result"] == result


def test_approved_change_stays_one_line_and_approval_is_not_a_line(mdb, mseed, two):
    a, _ = two
    item = _proposed(mdb, mseed, lambda i: _change(a, "due_date", "2026-12-01", claimed=i))
    _resolve(_lines(mdb, item)[(a.task_id, "due_date")].approval_id, task_overrides={"due_date": "2026-12-05"})
    assert [i["kind"] for i in _timeline(a)["items"]] == ["reply"]
    assert mdb.query(ApprovalRequest).count() == 1


def test_manual_change_is_its_own_line_newest_first(mdb, mseed, two):
    a, _ = two
    _applied(mdb, mseed, a)
    client("pm").patch(f"{P}/tasks/{a.task_id}", json={"due_date": "2026-12-01"})
    items = _timeline(a)["items"]
    [history] = [i for i in items if i["kind"] == "history"]
    assert (history["changed_field"], history["new_value"], history["change_source"]) == (
        "due_date", "2026-12-01", "manual",
    )
    assert history["history_id"] and history["at"]
    assert [i["at"] for i in items] == sorted((i["at"] for i in items), reverse=True)


def test_undone_change_says_so_and_the_undo_is_a_history_line(mdb, mseed, two):
    a, _ = two
    _, change_id = _applied(mdb, mseed, a)
    _undo(a, change_id)
    items = _timeline(a)["items"]
    [reply] = [i for i in items if i["kind"] == "reply"]
    assert (reply["changes"][0]["result"], reply["changes"][0]["undoable"]) == ("undone", False)
    [history] = [i for i in items if i["kind"] == "history"]
    assert history["new_value"] == "in_progress"


def test_late_result_shows_as_recorded(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    item = replies.claim(mdb, AT).model_dump(mode="json")
    tick(mdb, AT + replies.JUDGE_WINDOW)
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item))
    [reply] = _timeline(a)["items"]
    assert reply["changes"][0]["result"] == "recorded"


def test_other_members_do_not_read_a_private_reply(mdb, mseed, two):
    a, _ = two
    _applied(mdb, mseed, a)
    [reply] = _timeline(a, token="bob")["items"]
    assert reply["body"] is None
    assert (reply["changes"][0]["summary"], reply["changes"][0]["evidence_quote"]) == (None, None)
    assert reply["changes"][0]["new_value"] == "done"

    [own] = _timeline(a, token="alice")["items"]
    assert own["body"] == "네"
    assert own["changes"][0]["summary"] == "AI 해석"


def test_timeline_needs_membership_and_a_live_task(mdb, mseed, two):
    a, _ = two
    assert client("outsider").get(f"{P}/tasks/{a.task_id}/timeline").status_code == 403
    assert client("pm").get(f"{P}/tasks/없는/timeline").status_code == 404


# 판단이 본 값과 실제 값

def _status_moved_at(db, task, new_value, at):
    """경로는 실제 시각으로 이력을 찍는다. 운영 순서대로 답장 뒤로 옮긴다."""
    for entry in db.query(TaskHistory).filter(
        TaskHistory.task_id == task.task_id, TaskHistory.changed_field == "status", TaskHistory.new_value == new_value,
    ):
        entry.created_at = at
    db.commit()


def _pm_block(mdb, task, at):
    r = client("pm").patch(f"{P}/tasks/{task.task_id}", json={"status": "blocked", "blocker": "PM: 외부 승인 대기"})
    assert r.status_code == 200, r.text
    _status_moved_at(mdb, task, "blocked", at)


def test_pm_block_during_judgment_is_proposed_not_applied(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    item = _claim()
    _pm_block(mdb, a, AT + timedelta(minutes=1))
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item))
    mdb.expire_all()
    assert (a.status, a.blocker) == ("blocked", "PM: 외부 승인 대기")
    assert _outcomes(mdb, item) == [("status", "proposed")]
    line = _lines(mdb, item)[(a.task_id, "status")]
    assert _resolve(line.approval_id).json()["error"]["code"] == "APPROVAL_CONFLICT"


def test_pm_block_between_the_reply_and_the_claim_is_proposed_not_applied(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    _pm_block(mdb, a, AT + timedelta(minutes=1))
    item = _claim()
    assert {c["task_id"]: c["status"] for c in item["candidates"]}[a.task_id] == "in_progress"
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item))
    mdb.expire_all()
    assert (a.status, a.blocker) == ("blocked", "PM: 외부 승인 대기")
    assert _outcomes(mdb, item) == [("status", "proposed")]


def _two_replies_first_applied_late(mdb, mseed, task):
    """앞 답장이 뒤 답장을 받은 뒤에야 자동 반영된다."""
    _reply(mdb, mseed, AT, body="다 했어요")
    _reply(mdb, mseed, AT + timedelta(minutes=1), body="아니 다시 볼게요")
    first = _claim()
    _judge(first, _change(task, "status", "done", evidence="certain", claimed=first))
    _status_moved_at(mdb, task, "done", AT + timedelta(minutes=2))
    return _lines(mdb, first)[(task.task_id, "status")].change_id


def test_earlier_reply_applied_after_the_next_reply_does_not_hold_it_back(mdb, mseed, two):
    a, _ = two
    _two_replies_first_applied_late(mdb, mseed, a)
    item = _claim()
    _judge(item, _change(a, "status", "in_progress", evidence="certain", claimed=item))
    mdb.expire_all()
    assert a.status == "in_progress"


def test_auto_block_after_the_reply_does_not_hold_it_back(mdb, mseed):
    a = _auto_blocked(mdb, mseed)
    _reply(mdb, mseed, DEADLINE - H, body="다 했어요")
    _status_moved_at(mdb, a, "blocked", DEADLINE)
    item = _claim()
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item))
    mdb.expire_all()
    assert a.status == "done"


def test_pm_undo_after_the_reply_is_a_person_changing_the_status(mdb, mseed, two):
    a, _ = two
    change_id = _two_replies_first_applied_late(mdb, mseed, a)
    assert _undo(a, change_id).status_code == 200
    _status_moved_at(mdb, a, "in_progress", AT + timedelta(minutes=3))
    item = _claim()
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item))
    mdb.expire_all()
    assert a.status == "in_progress"
    assert _outcomes(mdb, item) == [("status", "proposed")]


def _card_on_auto_blocked_task(mdb, mseed):
    a = _auto_blocked(mdb, mseed)
    _reply(mdb, mseed, DEADLINE + H, body="QA 넘겼어요")
    item = _claim()
    assert item["candidates"][0]["status"] == "in_progress"
    _judge(item, _change(a, "status", "done", evidence="inferred", claimed=item))
    return a, _lines(mdb, item)[(a.task_id, "status")].approval_id


def test_card_on_auto_blocked_task_is_approvable_before_the_tick(mdb, mseed):
    a, approval_id = _card_on_auto_blocked_task(mdb, mseed)
    assert _resolve(approval_id).status_code == 200
    mdb.expire_all()
    assert a.status == "done"


def test_card_stays_approvable_after_the_pm_undoes_the_auto_block(mdb, mseed):
    a, approval_id = _card_on_auto_blocked_task(mdb, mseed)
    assert client("pm").post(f"{P}/tasks/{a.task_id}/auto-block/undo").status_code == 200
    r = _resolve(approval_id)
    assert r.status_code == 200, r.text
    mdb.expire_all()
    assert a.status == "done"


def test_card_stays_approvable_while_a_followup_reply_holds_the_clock(mdb, mseed):
    a, approval_id = _card_on_auto_blocked_task(mdb, mseed)
    follow_up_at = DEADLINE + H + timedelta(minutes=1)
    _reply(mdb, mseed, follow_up_at, body="그리고 금요일에 다시 볼게요")
    tick(mdb, follow_up_at + timedelta(minutes=1))
    assert _resolve(approval_id).status_code == 200


def test_requeued_older_reply_does_not_override_a_newer_reply(mdb, mseed, two):
    a, _ = two
    item = _unknown(mdb, mseed, body="그거 아직 진행 중이에요")
    _reply(mdb, mseed, AT + H, body="API 명세서 다 했어요")
    newer = _claim()
    _judge(newer, _change(a, "status", "done", evidence="certain", claimed=newer))
    mdb.expire_all()
    assert a.status == "done"

    _attribute(item, a, seed=mseed)
    again = _claim()
    _judge(again, _change(a, "status", "in_progress", evidence="certain", claimed=again))
    mdb.expire_all()
    assert a.status == "done"
    assert ("status", "proposed") in _outcomes(mdb, again)


def test_newer_reply_that_changed_nothing_still_guards_the_requeued_reply(mdb, mseed, two):
    a, _ = two
    item = _unknown(mdb, mseed)
    _reply(mdb, mseed, AT + H, body="아 API 명세서는 아직 진행 중이에요")
    newer = _claim()
    _judge(newer, _change(a, "status", "in_progress", evidence="certain", claimed=newer))
    assert _outcomes(mdb, newer) == [("status", "skipped")]

    _attribute(item, a, seed=mseed)
    again = _claim()
    _judge(again, _change(a, "status", "done", evidence="certain", claimed=again))
    mdb.expire_all()
    assert a.status == "in_progress"
    assert ("status", "proposed") in _outcomes(mdb, again)


def test_newer_reply_noted_on_a_blocked_task_still_guards_the_requeued_reply(mdb, mseed, two):
    a, _ = two
    client("pm").patch(f"{P}/tasks/{a.task_id}", json={"status": "blocked", "blocker": "PM 사유"})
    _status_moved_at(mdb, a, "blocked", AT - H)
    item = _unknown(mdb, mseed)
    _reply(mdb, mseed, AT + H, body="API 명세서 막혔어요")
    newer = _claim()
    _judge(newer, _change(a, "status", "blocked", evidence="inferred", claimed=newer))
    assert _outcomes(mdb, newer) == [("status", "noted")]

    _attribute(item, a, seed=mseed)
    again = _claim()
    _judge(again, _change(a, "status", "done", evidence="certain", claimed=again))
    mdb.expire_all()
    assert (a.status, a.blocker) == ("blocked", "PM 사유")
    assert ("status", "proposed") in _outcomes(mdb, again)


def test_newer_reply_that_said_nothing_about_the_task_does_not_guard_it(mdb, mseed, two):
    a, _ = two
    item = _unknown(mdb, mseed)
    _reply(mdb, mseed, AT + H, body="네")
    newer = _claim()
    _judge(newer)
    assert ("none", "noted") in _outcomes(mdb, newer)

    _attribute(item, a, seed=mseed)
    again = _claim()
    _judge(again, _change(a, "status", "done", evidence="certain", claimed=again))
    mdb.expire_all()
    assert a.status == "done"


def test_rejudgment_still_applies_when_no_newer_reply_touched_the_task(mdb, mseed, two):
    a, b = two
    item = _unknown(mdb, mseed)
    _reply(mdb, mseed, AT + H, body="로그인 다 했어요")
    newer = _claim()
    _judge(newer, _change(b, "status", "done", evidence="certain", claimed=newer))
    _attribute(item, a, seed=mseed)
    again = _claim()
    _judge(again, _change(a, "status", "done", evidence="certain", claimed=again))
    mdb.expire_all()
    assert a.status == "done"


# 자동 막힘을 넘어온 자동 반영 되돌리기

def _auto_blocked_then_done(mdb, mseed):
    a = _auto_blocked(mdb, mseed)
    _reply(mdb, mseed, DEADLINE + H, body="다 했어요")
    item = _claim()
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item))
    mdb.expire_all()
    assert a.status == "done"
    return a, _lines(mdb, item)[(a.task_id, "status")].change_id


def test_undo_after_release_goes_back_to_the_status_before_the_auto_block(mdb, mseed):
    a, change_id = _auto_blocked_then_done(mdb, mseed)
    tick(mdb, DEADLINE + 2 * H)
    assert _undo(a, change_id).status_code == 200
    mdb.expire_all()
    assert (a.status, a.blocker) == ("in_progress", None)


def test_undo_before_the_tick_leaves_no_silence_reason(mdb, mseed):
    a, change_id = _auto_blocked_then_done(mdb, mseed)
    assert _undo(a, change_id).status_code == 200
    # 되돌리기 이력은 실제 시각을 찍는다. 운영 순서대로 답장 뒤로 옮긴다.
    mdb.query(TaskHistory).filter(
        TaskHistory.task_id == a.task_id, TaskHistory.old_value == "done", TaskHistory.new_value == "blocked",
    ).one().created_at = DEADLINE + H + timedelta(minutes=1)
    mdb.commit()
    tick(mdb, DEADLINE + 2 * H)
    mdb.expire_all()
    assert (a.status, a.blocker) == ("in_progress", None)
    assert _watch(mdb, a).state not in scheduler._OPEN_STATES


def test_undone_done_is_not_read_as_the_status_before_a_block(mdb, mseed, two):
    a, _ = two
    client("pm").patch(f"{P}/tasks/{a.task_id}", json={"status": "blocked", "blocker": "PM 사유"})
    _status_moved_at(mdb, a, "blocked", AT)
    _reply(mdb, mseed, AT + H, body="다 했어요")
    item = _claim()
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item))
    mdb.expire_all()
    assert a.status == "done"
    assert _undo(a, _lines(mdb, item)[(a.task_id, "status")].change_id).status_code == 200
    mdb.expire_all()
    assert (a.status, a.blocker) == ("blocked", "PM 사유")
    assert scheduler._status_before_block(mdb, a) == "in_progress"


def test_timeline_shows_the_value_the_pm_actually_approved(mdb, mseed, two):
    a, _ = two
    item = _proposed(mdb, mseed, lambda claimed: _change(a, "due_date", "2026-12-01", claimed=claimed))
    line = _lines(mdb, item)[(a.task_id, "due_date")]
    assert _resolve(line.approval_id, task_overrides={"due_date": "2026-12-05"}).status_code == 200
    [change] = _timeline(a)["items"][0]["changes"]
    assert (change["new_value"], change["result"]) == ("2026-12-05", "approved")


def test_timeline_keeps_the_status_value_when_a_reason_is_linked_too(mdb, mseed, two):
    a, _ = two
    _applied(mdb, mseed, a, value="blocked")
    [change] = _timeline(a)["items"][0]["changes"]
    assert change["new_value"] == "blocked"


# 막힘 사유

def _blocked_reply(mdb, mseed, task, **extra):
    _reply(mdb, mseed, AT, body="개인 사정으로 병원 다녀오느라 막혔어요")
    item = _claim()
    _judge(item, {
        **_change(task, "status", "blocked", evidence="certain", claimed=item, quote="개인 사정으로 병원 다녀오느라 막혔어요"),
        **extra,
    })
    mdb.expire_all()


def test_reason_is_the_ai_reading_not_the_reply_text(mdb, mseed, two):
    a, _ = two
    _blocked_reply(mdb, mseed, a, summary="일정 문제로 막힘")
    task = client("bob").get(f"{P}/tasks/{a.task_id}").json()["data"]
    assert task["blocker"] == "일정 문제로 막힘"


def test_reason_falls_back_to_a_plain_phrase_without_a_summary(mdb, mseed, two):
    a, _ = two
    _blocked_reply(mdb, mseed, a, summary=None)
    assert a.blocker == "팀원이 막혔다고 답했어요"


# 지운 태스크

def test_deleted_task_is_not_offered_and_cannot_be_picked(mdb, mseed, two):
    a, b = two
    item = _unknown(mdb, mseed)
    task_service.delete_task(mdb, a)
    mdb.commit()

    [entry] = _attributions(mseed, _row(mdb, item).thread_id).json()["data"]["items"]
    assert [c["task_id"] for c in entry["candidates"]] == [b.task_id]
    assert _attribute(item, a, seed=mseed).status_code == 400
    assert _claim() is None


# 담당자를 못 찾은 카드

def test_approving_an_unresolved_assignee_card_says_nothing_changed(mdb, mseed, two):
    a, _ = two
    before = a.assignee_member_id
    item = _proposed(
        mdb, mseed, lambda i: _change(a, "assignee", None, claimed=i, assignee_raw="김철수", assignee_type="named"),
    )
    assert _resolve(_lines(mdb, item)[(a.task_id, "assignee")].approval_id).status_code == 200
    mdb.expire_all()
    assert a.assignee_member_id == before
    [change] = _timeline(a)["items"][0]["changes"]
    assert change["result"] == "noted"


def test_approving_a_resolved_assignee_card_stays_approved(mdb, mseed, two):
    a, _ = two
    mdb.add(MemberAlias(
        workspace_id=mseed["ws"], member_id=mseed["bob"].member_id, alias_text="밥", alias_type="name", source="manual",
    ))
    mdb.commit()
    item = _proposed(mdb, mseed, lambda i: _change(a, "assignee", "밥", claimed=i, assignee_raw="밥", assignee_type="name"))
    line = _lines(mdb, item)[(a.task_id, "assignee")]
    assert line.new_value == mseed["bob"].member_id
    assert _resolve(line.approval_id).status_code == 200
    assert _timeline(a)["items"][0]["changes"][0]["result"] == "approved"


# 담당자 카드에서 PM 이 담당자를 고른다

def _unresolved_card(mdb, mseed, task, *extra):
    item = _proposed(
        mdb, mseed,
        lambda i: _change(task, "assignee", None, claimed=i, assignee_raw="김철수", assignee_type="named"),
        *extra,
    )
    return _lines(mdb, item)[(task.task_id, "assignee")]


def _resolved_card(mdb, mseed, task):
    mdb.add(MemberAlias(
        workspace_id=mseed["ws"], member_id=mseed["bob"].member_id, alias_text="밥", alias_type="name", source="manual",
    ))
    mdb.commit()
    item = _proposed(mdb, mseed, lambda i: _change(task, "assignee", "밥", claimed=i, assignee_raw="밥", assignee_type="name"))
    return _lines(mdb, item)[(task.task_id, "assignee")]


def _assignee_history(db, task):
    db.expire_all()
    return db.query(TaskHistory).filter(
        TaskHistory.task_id == task.task_id, TaskHistory.changed_field == "assignee",
    ).all()


def _assignee_change(task):
    [reply] = [i for i in _timeline(task)["items"] if i["kind"] == "reply"]
    [change] = [c for c in reply["changes"] if c["field"] == "assignee"]
    return change


def _is_pending(db, approval_id):
    db.expire_all()
    return db.get(ApprovalRequest, approval_id).status == "pending"


def _depart(db, member):
    member.is_deleted = True
    member.deleted_at = datetime.now(timezone.utc)
    db.commit()


def _status_too(task):
    return lambda i: _change(task, "status", "done", evidence="inferred", claimed=i)


def test_unresolved_card_takes_the_member_the_pm_picked(mdb, mseed, two):
    a, _ = two
    bob = mseed["bob"].member_id
    line = _unresolved_card(mdb, mseed, a)
    r = _resolve(line.approval_id, task_overrides={"assignee_member_id": bob})
    assert r.status_code == 200, r.text
    mdb.expire_all()
    assert a.assignee_member_id == bob
    [entry] = _assignee_history(mdb, a)
    assert (entry.new_value, entry.change_source, entry.changed_by, entry.reply_change_id) == (
        bob, "manual", mseed["pm"].member_id, line.change_id,
    )
    payload = json.loads(mdb.get(ApprovalRequest, line.approval_id).payload)
    assert payload["task_overrides"] == {"assignee_member_id": bob}
    assert payload["assignee_raw"] == "김철수"
    change = _assignee_change(a)
    assert (change["result"], change["new_value"]) == ("approved", bob)


def test_unresolved_card_can_clear_the_assignee(mdb, mseed, two):
    a, _ = two
    a.assignee_member_id = mseed["alice"].member_id
    mdb.commit()
    line = _unresolved_card(mdb, mseed, a)
    assert _resolve(line.approval_id, task_overrides={"assignee_member_id": None}).status_code == 200
    mdb.expire_all()
    assert a.assignee_member_id is None
    change = _assignee_change(a)
    assert (change["result"], change["new_value"]) == ("approved", None)


def test_unresolved_card_with_the_current_assignee_stays_noted(mdb, mseed, two):
    a, _ = two
    alice = mseed["alice"].member_id
    a.assignee_member_id = alice
    mdb.commit()
    line = _unresolved_card(mdb, mseed, a)
    assert _resolve(line.approval_id, task_overrides={"assignee_member_id": alice}).status_code == 200
    assert _assignee_history(mdb, a) == []
    assert _assignee_change(a)["result"] == "noted"


def test_resolved_card_can_be_changed_to_another_member(mdb, mseed, two):
    a, _ = two
    line = _resolved_card(mdb, mseed, a)
    assert line.new_value == mseed["bob"].member_id
    picked = mseed["pm"].member_id
    assert _resolve(line.approval_id, task_overrides={"assignee_member_id": picked}).status_code == 200
    mdb.expire_all()
    assert a.assignee_member_id == picked
    change = _assignee_change(a)
    assert (change["result"], change["new_value"]) == ("approved", picked)


def test_resolved_card_with_the_proposed_value_is_not_an_edit(mdb, mseed, two):
    a, _ = two
    line = _resolved_card(mdb, mseed, a)
    bob = mseed["bob"].member_id
    assert _resolve(line.approval_id, task_overrides={"assignee_member_id": bob}).status_code == 200
    [entry] = _assignee_history(mdb, a)
    assert (entry.new_value, entry.change_source) == (bob, "reminder_reply")
    assert "task_overrides" not in json.loads(mdb.get(ApprovalRequest, line.approval_id).payload)


def test_card_with_status_and_assignee_links_each_line(mdb, mseed, two):
    a, _ = two
    bob = mseed["bob"].member_id
    line = _unresolved_card(mdb, mseed, a, _status_too(a))
    assert _resolve(line.approval_id, task_overrides={"assignee_member_id": bob}).status_code == 200
    mdb.expire_all()
    lines = {c.field: c for c in mdb.query(ReplyChange).filter(ReplyChange.approval_id == line.approval_id)}
    [status] = mdb.query(TaskHistory).filter(TaskHistory.changed_field == "status").all()
    [assignee] = _assignee_history(mdb, a)
    assert (status.change_source, status.reply_change_id) == ("reminder_reply", lines["status"].change_id)
    assert (assignee.change_source, assignee.reply_change_id) == ("manual", lines["assignee"].change_id)


def test_bad_assignee_cancels_the_status_on_the_same_card(mdb, mseed, two):
    a, _ = two
    bob = mseed["bob"].member_id
    before = a.assignee_member_id
    line = _unresolved_card(mdb, mseed, a, _status_too(a))
    r = _resolve(line.approval_id, task_overrides={"assignee_member_id": "no-such-member"})
    assert r.status_code == 404, r.text
    mdb.expire_all()
    assert _is_pending(mdb, line.approval_id)
    assert (a.status, a.assignee_member_id) == ("in_progress", before)
    assert mdb.query(TaskHistory).filter(TaskHistory.reply_change_id.is_not(None)).count() == 0
    assert _resolve(line.approval_id, task_overrides={"assignee_member_id": bob}).status_code == 200
    mdb.expire_all()
    assert (a.status, a.assignee_member_id) == ("done", bob)


def test_status_only_reply_card_refuses_an_assignee_override(mdb, mseed, two):
    a, _ = two
    item = _proposed(mdb, mseed, _status_too(a))
    line = _lines(mdb, item)[(a.task_id, "status")]
    r = _resolve(line.approval_id, task_overrides={"assignee_member_id": mseed["bob"].member_id})
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    assert r.json()["error"]["details"]["fields"] == ["assignee_member_id"]
    assert _is_pending(mdb, line.approval_id)


@pytest.mark.parametrize(("value", "status", "code"), [
    ("nope", 404, "MEMBER_NOT_FOUND"),
    ("", 404, "MEMBER_NOT_FOUND"),
    (1, 400, "INVALID_REQUEST"),
])
def test_assignee_override_value_is_checked(mdb, mseed, two, value, status, code):
    a, _ = two
    line = _unresolved_card(mdb, mseed, a)
    r = _resolve(line.approval_id, task_overrides={"assignee_member_id": value})
    assert (r.status_code, r.json()["error"]["code"]) == (status, code)
    assert _is_pending(mdb, line.approval_id)


def test_assignee_override_of_another_workspace_is_refused(mdb, mseed, two):
    a, _ = two
    other = Workspace(name="B")
    mdb.add(other)
    mdb.flush()
    stranger = Member(workspace_id=other.workspace_id, display_name="외부", role="member")
    mdb.add(stranger)
    mdb.commit()
    line = _unresolved_card(mdb, mseed, a)
    r = _resolve(line.approval_id, task_overrides={"assignee_member_id": stranger.member_id})
    assert (r.status_code, r.json()["error"]["code"]) == (400, "WORKSPACE_MISMATCH")
    assert _is_pending(mdb, line.approval_id)


def test_assignee_override_of_a_departed_member_is_refused(mdb, mseed, two):
    a, _ = two
    _depart(mdb, mseed["carol"])
    line = _unresolved_card(mdb, mseed, a)
    r = _resolve(line.approval_id, task_overrides={"assignee_member_id": mseed["carol"].member_id})
    assert (r.status_code, r.json()["error"]["code"]) == (404, "MEMBER_NOT_FOUND")
    assert _is_pending(mdb, line.approval_id)


def test_card_proposing_a_departed_member_can_pick_another(mdb, mseed, two):
    a, _ = two
    line = _resolved_card(mdb, mseed, a)
    _depart(mdb, mseed["bob"])
    assert _resolve(line.approval_id).status_code == 404
    alice = mseed["alice"].member_id
    assert _resolve(line.approval_id, task_overrides={"assignee_member_id": alice}).status_code == 200
    mdb.expire_all()
    assert a.assignee_member_id == alice


@pytest.mark.parametrize("picked", ["bob", None])
def test_rolling_back_a_picked_assignee_shows_undone(mdb, mseed, two, picked):
    a, _ = two
    alice = mseed["alice"].member_id
    a.assignee_member_id = alice
    mdb.commit()
    line = _unresolved_card(mdb, mseed, a)
    value = mseed["bob"].member_id if picked else None
    assert _resolve(line.approval_id, task_overrides={"assignee_member_id": value}).status_code == 200
    [entry] = _assignee_history(mdb, a)
    r = client("pm").post(f"{P}/tasks/{a.task_id}/history/{entry.history_id}/rollback")
    assert r.status_code == 200, r.text
    mdb.expire_all()
    assert a.assignee_member_id == alice
    assert _assignee_change(a)["result"] == "undone"


def test_rejecting_with_an_assignee_override_is_refused(mdb, mseed, two):
    a, _ = two
    line = _unresolved_card(mdb, mseed, a)
    r = _resolve(line.approval_id, "rejected", task_overrides={"assignee_member_id": mseed["bob"].member_id})
    assert r.status_code == 400, r.text
    assert _is_pending(mdb, line.approval_id)


# 태스크가 실린 failed·due_clear 줄

@pytest.mark.parametrize("field", ["failed", "due_clear"])
def test_line_with_a_task_answers_only_that_tasks_clock(mdb, mseed, two, field):
    a, b = two
    _reply(mdb, mseed, AT)
    item = _claim()
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item), _change(b, field))
    assert _lines(mdb, item)[(b.task_id, field)].outcome == "noted"
    tick(mdb, AT + H)
    assert _watch(mdb, b).state == WatchState.ANSWERED


@pytest.mark.parametrize("field", ["failed", "due_clear"])
def test_line_with_a_task_keeps_a_clock_the_reply_did_not_mention_running(mdb, mseed, two, field):
    a, b = two
    _reply(mdb, mseed, AT)
    _judge(_claim(), _change(b, field))
    tick(mdb, AT + H)
    assert _watch(mdb, b).state == WatchState.ANSWERED
    assert _watch(mdb, a).state == WatchState.WATCHING


@pytest.mark.parametrize("field", ["failed", "due_clear"])
def test_line_with_a_task_outside_the_candidates_is_refused(mdb, mseed, two, field):
    _reply(mdb, mseed, AT)
    item = _claim()
    r = _post(item["message_id"], {"attempt": item["attempt"], "changes": [_change(mseed["tasks"][2], field)]})
    assert r.status_code == 400
    assert _outcomes(mdb, item) == []


def test_failed_line_with_a_task_counts_as_a_check_on_the_thread(mdb, mseed, two):
    a, b = two
    _reply(mdb, mseed, AT)
    item = _claim()
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item), _change(b, "failed"))
    [note] = _kind(mdb, "reply_judged")
    assert note.text.endswith("→ 1건 바꿨어요, 1건 확인이 필요해요")
    assert note.link_type == "thread"


def test_only_a_failed_line_with_a_task_still_notifies_on_the_thread(mdb, mseed, two):
    _, b = two
    _reply(mdb, mseed, AT)
    _judge(_claim(), _change(b, "failed"))
    [note] = _kind(mdb, "reply_judged")
    assert note.text.endswith("→ 1건 확인이 필요해요")
    assert note.link_type == "thread"


def test_rejudgment_repeating_a_failed_line_is_not_written_twice(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    item = _claim()
    _judge(item, _change(a, "failed"), _change(None, "unknown"))
    _attribute(item, a, seed=mseed)
    _judge(_claim(), _change(a, "failed"))
    assert ("failed", "noted") in _outcomes(mdb, item)
    assert _row(mdb, item).state == S.DONE
