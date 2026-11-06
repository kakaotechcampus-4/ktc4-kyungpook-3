"""봇 경로로 답장을 맡기고 판단 결과를 넣는다. 게이트·반영·승인·알림·재시도."""
import json
from datetime import date, timedelta

import pytest

from app.models import (
    ApprovalRequest,
    MemberAlias,
    Notification,
    ReplyChange,
    ReplyJudgment,
    ReplyJudgmentState as S,
    TaskHistory,
)
from app.services import messages, replies
from tests.api.test_messages_api import P, client
from tests.api.test_replies import _remind, _reply
from tests.api.test_reply_clock import DEADLINE, _auto_blocked
from tests.api.test_scheduler import SLOT, H, tick
from tests.api.test_scheduler_concurrency import _postgres_only, _together

MIN = timedelta(minutes=1)
AT = SLOT + H


def _bot():
    return client(service=True)


def _claim():
    """봇 경로로 맡긴다. 경로는 실제 시각을 쓰므로 시각을 재는 테스트는 서비스를 직접 부른다."""
    r = _bot().post(f"{P}/bot/replies/claim")
    assert r.status_code == 200, r.text
    return r.json()["data"]["item"]


def _post(message_id, body):
    return _bot().post(f"{P}/bot/replies/{message_id}/judgment", json=body)


def _change(task, field, value=None, *, evidence=None, claimed=None, quote="근거", **extra):
    base = None
    if claimed is not None:
        [seen] = [c for c in claimed["candidates"] if c["task_id"] == task.task_id]
        base = {k: seen[k] for k in ("status", "due_date", "assignee_member_id", "updated_at")}
        base["title"] = seen["title"]
    return {
        "task_id": task and task.task_id, "field": field, "new_value": value, "evidence_status": evidence,
        "summary": "AI 해석", "evidence_quote": quote, "base": base, **extra,
    }


def _judge(item, *changes, failure=None):
    r = _post(item["message_id"], {
        "attempt": item["attempt"], "failure_reason": failure, "model_name": "terra+luna+jev", "changes": list(changes),
    })
    assert r.status_code == 200, r.text
    return r


def _row(db, item):
    db.expire_all()
    return db.get(ReplyJudgment, item["message_id"])


def _lines(db, item):
    db.expire_all()
    rows = db.query(ReplyChange).filter(ReplyChange.message_id == item["message_id"]).all()
    return {(r.task_id, r.field): r for r in rows}


def _outcomes(db, item):
    return sorted((r.field, r.outcome) for r in _lines(db, item).values())


def _notes(db, kind="reply_judged"):
    db.expire_all()
    return db.query(Notification).filter(Notification.kind == kind).all()


def _cards(db):
    db.expire_all()
    return db.query(ApprovalRequest).all()


@pytest.fixture
def two(mdb, mseed):
    a, b = mseed["tasks"][:2]
    a.title, b.title = "API 명세서", "로그인"
    a.status, a.due_date, b.due_date = "in_progress", date(2026, 11, 20), date(2026, 11, 21)
    _remind(mdb, mseed, [a, b], SLOT)
    return a, b


# 맡기기

def test_claim_gives_the_reply_with_context(mdb, mseed, two):
    a, b = two
    now = SLOT.replace(hour=16)
    message = _reply(mdb, mseed, now, body="API 다 했어요")
    item = _claim()

    assert item["message_id"] == message.message_id
    assert (item["attempt"], item["workspace_id"], item["member_name"]) == (1, mseed["ws"], "앨리스")
    assert item["reply_date"] == "2026-11-20"
    assert [line["sender"] for line in item["lines"]] == ["pm", "member"]
    assert item["lines"][-1]["text"] == "API 다 했어요"
    by_id = {c["task_id"]: c for c in item["candidates"]}
    assert set(by_id) == {a.task_id, b.task_id}
    assert by_id[a.task_id]["title"] == "API 명세서"
    assert by_id[a.task_id]["status"] == "in_progress"
    assert by_id[a.task_id]["due_date"] == "2026-11-20"
    assert by_id[a.task_id]["assignee_member_id"] == mseed["alice"].member_id
    assert by_id[a.task_id]["updated_at"]


def test_claim_with_nothing_to_do_returns_null(mdb, mseed):
    assert _claim() is None


def test_claim_needs_the_service_token(mdb, mseed):
    assert client().post(f"{P}/bot/replies/claim").status_code == 401


def test_blocked_task_is_shown_with_the_status_before_the_block(mdb, mseed):
    _auto_blocked(mdb, mseed)
    _reply(mdb, mseed, DEADLINE + H, body="막혔어요")
    [candidate] = _claim()["candidates"]
    assert candidate["status"] == "in_progress"


def test_lines_end_at_this_reply_even_if_later_replies_are_queued(mdb, mseed, two):
    first = _reply(mdb, mseed, AT, body="첫 답장")
    _reply(mdb, mseed, AT + MIN, body="다음 답장")
    item = _claim()
    assert item["message_id"] == first.message_id
    assert item["lines"][-1]["text"] == "첫 답장"
    assert all(line["text"] != "다음 답장" for line in item["lines"])


def test_lines_are_capped_and_keep_this_reply_last(mdb, mseed, two):
    for i in range(replies.LINE_LIMIT + 3):
        message = _reply(mdb, mseed, AT + i * MIN, body=f"답장 {i}")
        row = mdb.get(ReplyJudgment, message.message_id)
        if i < replies.LINE_LIMIT + 2:
            mdb.delete(row)
    mdb.commit()
    item = _claim()
    assert len(item["lines"]) == replies.LINE_LIMIT
    assert item["lines"][-1]["text"] == f"답장 {replies.LINE_LIMIT + 2}"


def test_lines_start_at_the_oldest_candidate_reminder(mdb, mseed):
    a, b = mseed["tasks"][:2]
    _reply(mdb, mseed, SLOT - 2 * H, body="리마인드 전 글")
    _remind(mdb, mseed, [a], SLOT)
    _remind(mdb, mseed, [b], SLOT + H)
    _reply(mdb, mseed, SLOT + 2 * H, body="이번 답장")
    assert [line["sender"] for line in _claim()["lines"]] == ["pm", "pm", "member"]


def test_lease_blocks_a_second_claim_then_reissues_with_a_new_attempt(mdb, mseed, two):
    message = _reply(mdb, mseed, AT)
    first = replies.claim(mdb, AT + MIN)
    assert first.attempt == 1
    assert replies.claim(mdb, AT + MIN + replies.JUDGE_LEASE - timedelta(seconds=1)) is None
    again = replies.claim(mdb, AT + MIN + replies.JUDGE_LEASE)
    assert (again.message_id, again.attempt) == (message.message_id, 2)


def test_one_thread_at_a_time_oldest_first(mdb, mseed, two):
    first = _reply(mdb, mseed, AT, body="앞")
    second = _reply(mdb, mseed, AT + MIN, body="뒤")
    item = _claim()
    assert item["message_id"] == first.message_id
    assert _claim() is None

    _judge(item)
    assert _claim()["message_id"] == second.message_id


def test_other_threads_are_not_held_back(mdb, mseed):
    a, b = mseed["tasks"][:2]
    _remind(mdb, mseed, [a], SLOT)
    _remind(mdb, mseed, [b], SLOT + H, who="carol")
    alice = _reply(mdb, mseed, SLOT + 2 * H)
    carol, _ = messages.ingest_discord_reply(
        mdb, discord_user_id="d_carol", discord_message_id="c1", body="네", sent_at=SLOT + 2 * H, now=SLOT + 2 * H,
    )
    mdb.commit()
    assert {_claim()["message_id"], _claim()["message_id"]} == {alice.message_id, carol.message_id}


# 게이트

def test_certain_status_change_is_applied_and_tells_pm(mdb, mseed, two):
    a, b = two
    _reply(mdb, mseed, AT, body="API 명세서 다 끝났어요")
    item = _claim()
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item))

    assert a.status == "done"
    assert _outcomes(mdb, item) == [("status", "applied")]
    row = _row(mdb, item)
    assert row.state == S.DONE
    assert row.model_name == "terra+luna+jev"
    assert row.finished_at is not None
    [entry] = mdb.query(TaskHistory).filter(TaskHistory.task_id == a.task_id, TaskHistory.changed_field == "status").all()
    assert entry.change_source == "reminder_reply"
    assert entry.reply_change_id == _lines(mdb, item)[(a.task_id, "status")].change_id
    assert _cards(mdb) == []
    [note] = _notes(mdb)
    assert note.member_id == mseed["pm"].member_id
    assert note.text == "앨리스 답장 'API 명세서 다 끝났어요' → API 명세서 완료로 바꿨어요(되돌리기)"
    assert (note.link_type, note.link_id) == ("task", a.task_id)


def test_inferred_status_change_waits_for_pm(mdb, mseed, two):
    a, b = two
    _reply(mdb, mseed, AT, body="QA 넘겼어요")
    item = _claim()
    _judge(item, _change(a, "status", "done", evidence="inferred", claimed=item, quote="QA 넘겼어요"))

    assert a.status == "in_progress"
    assert _outcomes(mdb, item) == [("status", "proposed")]
    [card] = _cards(mdb)
    assert _lines(mdb, item)[(a.task_id, "status")].approval_id == card.approval_id
    assert (card.type, card.status, card.related_task_id, card.requested_by) == (
        "task_update", "pending", a.task_id, None,
    )
    payload = json.loads(card.payload)
    assert payload["status"] == "done"
    assert payload["base_values"] == {"status": "in_progress"}
    assert payload["base_title"] == payload["task_title"] == "API 명세서"
    assert payload["base_task_version"] == a.version
    assert payload["doc_text"] == "AI 해석"
    assert payload["evidence_quote"] == "QA 넘겼어요"
    assert payload["evidence_speaker_member_id"] == mseed["alice"].member_id
    assert payload["change_source"] == "reminder_reply"
    assert payload["reply_message_id"] == item["message_id"]
    assert payload["gate"] == "review"
    assert "meeting_id" not in payload and "extraction_item_id" not in payload
    [note] = _notes(mdb)
    assert note.text.endswith("→ API 명세서 완료로 바꿀까요?")
    assert (note.link_type, note.link_id) == ("task", a.task_id)


def test_due_date_always_waits_for_pm_even_if_certain(mdb, mseed, two):
    _, b = two
    _reply(mdb, mseed, AT, body="로그인은 11/28까지요")
    item = _claim()
    _judge(item, _change(b, "due_date", "2026-11-28", evidence="certain", claimed=item))

    assert b.due_date == date(2026, 11, 21)
    [card] = _cards(mdb)
    payload = json.loads(card.payload)
    assert (payload["due_date"], payload["base_values"]) == ("2026-11-28", {"due_date": "2026-11-21"})
    [note] = _notes(mdb)
    assert note.text == "앨리스 답장 '로그인은 11/28까지요' → 로그인 마감을 11/28로 미룰까요?"


def test_one_reply_splits_into_changes_per_task_with_one_notice(mdb, mseed, two):
    a, b = two
    message = _reply(mdb, mseed, AT, body="API 다 끝났고 로그인은 금요일까지요")
    item = _claim()
    _judge(
        item,
        _change(a, "status", "done", evidence="certain", claimed=item),
        _change(b, "due_date", "2026-11-28", claimed=item),
    )
    assert a.status == "done"
    assert len(_cards(mdb)) == 1
    [note] = _notes(mdb)
    assert note.text.endswith("→ 1건 바꿨어요, 1건 확인이 필요해요")
    assert (note.link_type, note.link_id) == ("thread", message.thread_id)


def test_one_card_per_task_even_for_two_fields(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    item = _claim()
    _judge(
        item,
        _change(a, "status", "done", evidence="inferred", claimed=item),
        _change(a, "due_date", "2026-11-25", claimed=item),
    )
    [card] = _cards(mdb)
    payload = json.loads(card.payload)
    assert (payload["status"], payload["due_date"]) == ("done", "2026-11-25")
    assert set(payload["base_values"]) == {"status", "due_date"}
    assert {line.approval_id for line in _lines(mdb, item).values()} == {card.approval_id}


def test_value_that_is_already_set_is_skipped_quietly(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT, body="하고 있어요")
    item = _claim()
    _judge(item, _change(a, "status", "in_progress", evidence="certain", claimed=item))
    assert _outcomes(mdb, item) == [("status", "skipped")]
    assert _notes(mdb) == [] and _cards(mdb) == []


def test_reply_with_nothing_to_change_notes_every_candidate_without_a_push(mdb, mseed, two):
    a, b = two
    _reply(mdb, mseed, AT, body="네 확인했어요")
    item = _claim()
    _judge(item)
    assert set(_lines(mdb, item)) == {(a.task_id, "none"), (b.task_id, "none")}
    assert _row(mdb, item).state == S.DONE
    assert _notes(mdb) == [] and _cards(mdb) == []


def test_unknown_target_asks_pm_to_pick(mdb, mseed, two):
    message = _reply(mdb, mseed, AT, body="그거 다 했어요")
    item = _claim()
    _judge(item, _change(None, "unknown", quote="그거 다 했어요"))
    assert _row(mdb, item).state == S.NEEDS_PM
    assert _outcomes(mdb, item) == [("unknown", "unknown")]
    [note] = _notes(mdb)
    assert note.text == "앨리스 답장 '그거 다 했어요' → 어느 태스크인지 골라 주세요"
    assert (note.link_type, note.link_id) == ("thread", message.thread_id)


def test_due_clear_only_tells_pm_and_answers_the_reminder(mdb, mseed, two):
    a, b = two
    message = _reply(mdb, mseed, AT, body="마감이 없어졌어요")
    item = _claim()
    _judge(item, _change(None, "due_clear"))
    assert _row(mdb, item).state == S.DONE
    assert a.due_date == date(2026, 11, 20)
    [note] = _notes(mdb)
    assert note.text == "앨리스 답장 '마감이 없어졌어요' → 마감을 없애자는 내용이에요. 직접 확인해 주세요"
    assert (note.link_type, note.link_id) == ("thread", message.thread_id)
    assert set(_lines(mdb, item)) >= {(a.task_id, "none"), (b.task_id, "none")}


def test_partial_failure_keeps_what_worked_and_counts_as_needing_a_look(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    item = _claim()
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item), _change(None, "failed"))
    assert a.status == "done"
    assert _row(mdb, item).state == S.DONE
    assert ("failed", "noted") in _outcomes(mdb, item)
    [note] = _notes(mdb)
    assert note.text.endswith("→ 1건 바꿨어요, 1건 확인이 필요해요")


def test_failed_judgment_tells_pm_right_away_once(mdb, mseed, two):
    message = _reply(mdb, mseed, AT)
    item = _claim()
    _judge(item, failure="JudgeUnavailableError")
    row = _row(mdb, item)
    assert (row.state, row.failure_reason) == (S.FAILED, "JudgeUnavailableError")
    [note] = _notes(mdb, "reply_unjudged")
    assert note.text == "앨리스 답장이 왔어요. 자동 판단을 못 해서 확인이 필요해요"
    assert (note.link_type, note.link_id) == ("thread", message.thread_id)
    _judge(item, failure="JudgeUnavailableError")
    assert len(_notes(mdb, "reply_unjudged")) == 1


def test_scope_change_is_a_card_without_values(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    item = _claim()
    _judge(item, _change(a, "scope", claimed=item))
    [card] = _cards(mdb)
    payload = json.loads(card.payload)
    assert (payload["category"], payload["base_values"]) == ("scope", {})
    assert "status" not in payload and "due_date" not in payload


def test_assignee_change_is_proposed_and_unresolved_name_needs_a_check(mdb, mseed, two):
    a, b = two
    mdb.add(MemberAlias(
        workspace_id=mseed["ws"], member_id=mseed["bob"].member_id, alias_text="밥", alias_type="name", source="manual",
    ))
    mdb.commit()
    _reply(mdb, mseed, AT)
    item = _claim()
    _judge(
        item,
        _change(a, "assignee", "밥", assignee_type="name", assignee_raw="밥", claimed=item),
        _change(b, "assignee", "없는사람", assignee_type="name", assignee_raw="없는사람", claimed=item),
    )
    assert a.assignee_member_id == mseed["alice"].member_id
    cards = {c.related_task_id: json.loads(c.payload) for c in _cards(mdb)}
    assert cards[a.task_id]["assignee_member_id"] == mseed["bob"].member_id
    assert "assignee_member_id" not in cards[b.task_id]
    assert (cards[b.task_id]["assignee_raw"], cards[b.task_id]["assignee_needs_check"]) == ("없는사람", True)


def test_first_person_on_ones_own_task_changes_nothing(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    item = _claim()
    _judge(item, _change(a, "assignee", None, assignee_type="first", claimed=item))
    assert _outcomes(mdb, item) == [("assignee", "skipped")]
    assert _cards(mdb) == []


def test_deleted_task_is_skipped(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    item = _claim()
    a.is_deleted = True
    mdb.commit()
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item))
    assert a.status == "in_progress"
    assert _outcomes(mdb, item) == [("status", "skipped")]


# 판단 사이에 바뀐 값

def test_pm_edit_during_judgment_downgrades_auto_to_a_card(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    item = _claim()
    a.status = "todo"
    mdb.commit()
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item))
    assert a.status == "todo"
    assert _outcomes(mdb, item) == [("status", "proposed")]
    assert json.loads(_cards(mdb)[0].payload)["base_values"] == {"status": "in_progress"}


def test_reassigned_during_judgment_downgrades_auto_to_a_card(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    item = _claim()
    a.assignee_member_id = mseed["bob"].member_id
    mdb.commit()
    _judge(item, _change(a, "status", "done", evidence="certain", claimed=item))
    assert a.status == "in_progress"
    assert _outcomes(mdb, item) == [("status", "proposed")]


# 막힘

def _status_of(item, task):
    return next(c for c in item["candidates"] if c["task_id"] == task.task_id)["status"]


def test_blocked_reply_replaces_the_no_reply_reason(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _reply(mdb, mseed, DEADLINE + H, body="서버 키가 안 와서 막혔어요")
    item = _claim()
    _judge(item, _change(task, "status", "blocked", evidence="certain", claimed=item, quote="서버 키가 안 와서 막혔어요"))
    assert (task.status, task.blocker) == ("blocked", "AI 해석")
    [entry] = mdb.query(TaskHistory).filter(TaskHistory.task_id == task.task_id, TaskHistory.changed_field == "blocker",
                                            TaskHistory.change_source == "reminder_reply").all()
    assert entry.reply_change_id == _lines(mdb, item)[(task.task_id, "status")].change_id

    tick(mdb, DEADLINE + 2 * H)
    assert task.status == "blocked"


@pytest.mark.parametrize("evidence", ["certain", "inferred"])
def test_blocked_reply_keeps_a_reason_the_pm_wrote(mdb, mseed, two, evidence):
    a, _ = two
    a.status, a.blocker = "blocked", "디자인 대기"
    mdb.commit()
    _reply(mdb, mseed, AT)
    item = _claim()
    _judge(item, _change(a, "status", "blocked", evidence=evidence, claimed=item))
    assert a.blocker == "디자인 대기"
    assert _outcomes(mdb, item) == [("status", "noted")]
    assert _notes(mdb) == []


def test_inferred_block_replaces_the_no_reply_reason_without_a_card(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _reply(mdb, mseed, DEADLINE + H, body="키가 늦네요")
    item = _claim()
    _judge(item, _change(task, "status", "blocked", evidence="inferred", claimed=item, quote="키가 늦네요"))
    assert _outcomes(mdb, item) == [("status", "noted")]
    assert _cards(mdb) == [] and _notes(mdb) == []
    assert task.blocker == "AI 해석"
    [entry] = mdb.query(TaskHistory).filter(TaskHistory.task_id == task.task_id, TaskHistory.changed_field == "blocker",
                                            TaskHistory.change_source == "reminder_reply").all()
    assert entry.reply_change_id == _lines(mdb, item)[(task.task_id, "status")].change_id

    tick(mdb, DEADLINE + 2 * H)
    assert (task.status, task.blocker) == ("blocked", "AI 해석")


def test_inferred_block_fills_an_empty_reason(mdb, mseed, two):
    a, _ = two
    a.status = "blocked"
    mdb.commit()
    _reply(mdb, mseed, AT, body="키가 늦네요")
    item = _claim()
    _judge(item, _change(a, "status", "blocked", evidence="inferred", claimed=item, quote="키가 늦네요"))
    assert (a.status, a.blocker) == ("blocked", "AI 해석")
    assert _outcomes(mdb, item) == [("status", "noted")]


def test_new_block_writes_status_and_reason_under_one_change(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT, body="막혔어요")
    item = _claim()
    _judge(item, _change(a, "status", "blocked", evidence="certain", claimed=item, quote="막혔어요"))
    change_id = _lines(mdb, item)[(a.task_id, "status")].change_id
    entries = mdb.query(TaskHistory).filter(TaskHistory.reply_change_id == change_id).all()
    assert {e.changed_field for e in entries} == {"status", "blocker"}
    assert a.blocker == "AI 해석"


def test_status_shown_before_block_resolves_as_nothing_to_change_and_unblocks(mdb, mseed):
    task = _auto_blocked(mdb, mseed)
    _reply(mdb, mseed, DEADLINE + H, body="진행 중이에요")
    item = _claim()
    assert _status_of(item, task) == "in_progress"
    _judge(item, _change(task, "status", "in_progress", evidence="certain", claimed=item))
    assert _outcomes(mdb, item) == [("status", "skipped")]
    tick(mdb, DEADLINE + 2 * H)
    assert (task.status, task.blocker) == ("in_progress", None)


# 재시도와 늦은 결과

def test_same_attempt_retry_applies_once_and_notifies_once(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    item = _claim()
    change = _change(a, "status", "done", evidence="certain", claimed=item)
    _judge(item, change)
    version = a.version
    _judge(item, change)

    mdb.expire_all()
    assert a.version == version
    assert len(_lines(mdb, item)) == 1
    assert len(_notes(mdb)) == 1
    assert mdb.query(TaskHistory).filter(TaskHistory.task_id == a.task_id, TaskHistory.changed_field == "status").count() == 1


def test_duplicate_lines_in_one_body_are_recorded_once(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    item = _claim()
    _judge(
        item,
        _change(a, "due_date", "2026-11-25", claimed=item),
        _change(a, "due_date", "2026-11-26", claimed=item),
    )
    assert len(_lines(mdb, item)) == 1


def test_other_attempt_is_stale(mdb, mseed, two):
    message = _reply(mdb, mseed, AT)
    replies.claim(mdb, AT)
    mdb.commit()
    r = _post(message.message_id, {"attempt": 2, "changes": []})
    assert (r.status_code, r.json()["error"]["code"]) == (409, "REPLY_JUDGMENT_STALE")


def test_superseded_attempt_is_stale_and_changes_nothing(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    first = replies.claim(mdb, AT).model_dump(mode="json")
    second = replies.claim(mdb, AT + replies.JUDGE_LEASE).model_dump(mode="json")
    mdb.commit()
    r = _post(first["message_id"], {"attempt": first["attempt"], "changes": [
        _change(a, "status", "done", evidence="certain", claimed=first),
    ]})
    assert r.status_code == 409
    assert a.status == "in_progress"
    _judge(second, _change(a, "status", "done", evidence="certain", claimed=second))
    assert a.status == "done"


def test_unclaimed_row_is_stale(mdb, mseed, two):
    message = _reply(mdb, mseed, AT)
    assert _post(message.message_id, {"attempt": 0, "changes": []}).status_code == 409


def test_unknown_message_is_404(mdb, mseed):
    r = _post("없는 id", {"attempt": 1, "changes": []})
    assert (r.status_code, r.json()["error"]["code"]) == (404, "REPLY_JUDGMENT_NOT_FOUND")


def test_late_result_is_only_recorded(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    item = replies.claim(mdb, AT).model_dump(mode="json")
    tick(mdb, AT + replies.JUDGE_WINDOW)
    assert len(_notes(mdb, "reply_unjudged")) == 1

    change = _change(a, "status", "done", evidence="certain", claimed=item)
    _judge(item, change)
    assert a.status == "in_progress"
    assert _cards(mdb) == []
    assert _outcomes(mdb, item) == [("status", "recorded")]
    row = _row(mdb, item)
    assert row.state == S.TIMED_OUT
    assert row.finished_at is not None
    assert len(_notes(mdb, "reply_unjudged")) == 1
    assert _notes(mdb) == []

    _judge(item, change)
    assert len(_lines(mdb, item)) == 1


def test_late_failure_stays_timed_out_without_a_second_notice(mdb, mseed, two):
    _reply(mdb, mseed, AT)
    item = replies.claim(mdb, AT).model_dump(mode="json")
    tick(mdb, AT + replies.JUDGE_WINDOW)
    _judge(item, failure="Boom")
    assert _row(mdb, item).state == S.TIMED_OUT
    assert len(_notes(mdb, "reply_unjudged")) == 1


# 신뢰 경계

@pytest.mark.parametrize("field, value", [("status", "done"), ("due_date", "2026-11-25")])
def test_task_outside_the_candidates_is_rejected_whole(mdb, mseed, two, field, value):
    a, _ = two
    outsider = mseed["tasks"][2]
    _reply(mdb, mseed, AT)
    item = _claim()
    r = _post(item["message_id"], {"attempt": item["attempt"], "changes": [
        _change(a, "status", "done", evidence="certain", claimed=item),
        _change(outsider, field, value),
    ]})
    assert (r.status_code, r.json()["error"]["code"]) == (400, "INVALID_REQUEST")
    assert a.status == "in_progress"
    row = _row(mdb, item)
    assert (row.state, row.finished_at) == (S.PENDING, None)
    assert _lines(mdb, item) == {}


@pytest.mark.parametrize("field, value", [
    ("status", "finished"), ("status", None), ("due_date", "금요일"), ("due_date", None),
])
def test_bad_value_is_rejected(mdb, mseed, two, field, value):
    a, _ = two
    _reply(mdb, mseed, AT)
    item = _claim()
    r = _post(item["message_id"], {"attempt": item["attempt"], "changes": [_change(a, field, value)]})
    assert r.status_code == 400
    assert _row(mdb, item).finished_at is None


def test_value_change_without_a_task_is_rejected(mdb, mseed, two):
    _reply(mdb, mseed, AT)
    item = _claim()
    r = _post(item["message_id"], {"attempt": item["attempt"], "changes": [_change(None, "status", "done")]})
    assert r.status_code == 400


def test_failure_reason_is_cut_to_the_column(mdb, mseed, two):
    _reply(mdb, mseed, AT)
    item = _claim()
    _judge(item, failure="X" * 500)
    assert len(_row(mdb, item).failure_reason) == replies.FAILURE_REASON_LIMIT


# 동시성

def test_two_claims_at_once_take_one_reply_each(mdb, mseed, two):
    _postgres_only(mdb)
    _reply(mdb, mseed, AT)
    results = []
    _together(mdb, *[lambda db: results.append(replies.claim(db, AT + MIN)) for _ in range(3)])
    assert len([r for r in results if r is not None]) == 1
    assert mdb.query(ReplyJudgment).one().attempt == 1


def test_two_submits_at_once_apply_once(mdb, mseed, two):
    _postgres_only(mdb)
    a, _ = two
    message = _reply(mdb, mseed, AT)
    item = replies.claim(mdb, AT).model_dump(mode="json")
    mdb.commit()
    body = replies.ReplyJudgmentRequest(
        attempt=item["attempt"], changes=[_change(a, "status", "done", evidence="certain", claimed=item)],
    )
    _together(mdb, *[lambda db: replies.submit(db, message.message_id, body, AT + MIN) for _ in range(3)])
    assert mdb.query(TaskHistory).filter(TaskHistory.changed_field == "status").count() == 1
    assert mdb.query(ReplyChange).count() == 1


def test_submit_racing_expire_ends_one_way(mdb, mseed, two):
    _postgres_only(mdb)
    a, _ = two
    message = _reply(mdb, mseed, AT)
    item = replies.claim(mdb, AT).model_dump(mode="json")
    mdb.commit()
    body = replies.ReplyJudgmentRequest(
        attempt=item["attempt"], changes=[_change(a, "status", "done", evidence="certain", claimed=item)],
    )
    now = AT + replies.JUDGE_WINDOW
    _together(
        mdb,
        lambda db: replies.submit(db, message.message_id, body, now),
        lambda db: replies.expire(db, message.message_id, now),
    )
    state = mdb.query(ReplyJudgment).one().state
    [line] = mdb.query(ReplyChange).all()
    assert (state, line.outcome) in {(S.DONE, "applied"), (S.TIMED_OUT, "recorded")}
    assert mdb.query(Notification).filter(Notification.kind == "reply_unjudged").count() == (state == S.TIMED_OUT)


def test_a_card_with_status_and_scope_is_a_scope_card(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT, body="소셜 로그인은 빼기로 했고 나머지는 다 했어요")
    item = _claim()
    _judge(item, _change(a, "status", "done", evidence="inferred", claimed=item), _change(a, "scope", claimed=item))

    mdb.expire_all()
    card = mdb.query(ApprovalRequest).one()
    assert json.loads(card.payload)["category"] == "scope"


def test_a_rejected_body_leaves_the_attempt_open_for_a_failure_report(mdb, mseed, two):
    _reply(mdb, mseed, AT, body="다 했어요")
    item = _claim()
    bad = _post(item["message_id"], {"attempt": item["attempt"], "changes": [{"task_id": "남의 태스크", "field": "status"}]})
    assert bad.status_code == 400

    _judge(item, failure="INVALID_REQUEST")
    assert _row(mdb, item).state == S.FAILED


def test_a_reply_about_another_task_does_not_release_a_block_the_pm_set_after_the_answer(mdb, mseed, two):
    a, b = two
    _reply(mdb, mseed, AT, body="API 명세서는 금요일까지요")
    first = _claim()
    client("pm").patch(f"{P}/tasks/{a.task_id}", json={"status": "blocked", "blocker": "PM 사유"})
    blocked = mdb.query(TaskHistory).filter(TaskHistory.task_id == a.task_id, TaskHistory.new_value == "blocked").one()
    blocked.created_at = AT + MIN
    mdb.commit()
    _judge(first, _change(a, "due_date", "2026-12-01", claimed=first))
    _reply(mdb, mseed, AT + 2 * MIN, body="로그인은 다 했어요")
    second = _claim()
    _judge(second, _change(b, "status", "done", evidence="certain", claimed=second))
    tick(mdb, AT + 3 * MIN)

    mdb.expire_all()
    assert (a.status, a.blocker) == ("blocked", "PM 사유")
