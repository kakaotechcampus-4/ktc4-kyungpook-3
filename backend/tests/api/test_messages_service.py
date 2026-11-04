"""리마인드·보낼 메시지(묶음) 상태 전이 서비스(app/services/messages.py). 스케줄러가 시각을 넘겨 부르므로 now 를 직접 준다."""
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.errors import AppError, ErrorCode
from app.models import (
    DmFailureReason,
    DmStatus,
    Member,
    MessageSender,
    ReminderStatus,
    ThreadMessage,
    Workspace,
)
from app.services import messages as svc

NOW = datetime(2026, 11, 10, 9, 0, tzinfo=timezone.utc)
LATER = NOW + timedelta(days=1)
KST = timezone(timedelta(hours=9))
TAIL = "지금 어디까지 됐는지 편하게 알려 주세요!"


def _make(db, seed, who="alice", task=0, at=LATER, note=None, made=NOW):
    r = svc.create_reminder(
        db, workspace_id=seed["ws"], task_id=seed["tasks"][task].task_id, member_id=seed[who].member_id,
        scheduled_at=at, note=note, created_by=seed["pm"].member_id, now=made,
    )
    db.commit()
    return r


def _bundle(db, seed, reminder):
    db.refresh(reminder)
    return svc.get_bundle(db, seed["ws"], reminder.bundle_id)


def _approve(db, seed, reminder, now=NOW):
    bundle = _bundle(db, seed, reminder)
    bundle = svc.approve_bundle(
        db, bundle, draft_version=bundle.draft_version, approved_by=seed["pm"].member_id, now=now
    )
    db.commit()
    return bundle


def _sendable(db, seed, who="alice", note="마감 확인 부탁해요"):
    r = _make(db, seed, who=who, note=note)
    _approve(db, seed, r)
    return r


# 묶음 구성

def test_same_member_and_instant_share_one_bundle_whatever_the_offset(mdb, mseed):
    a = _make(mdb, mseed, task=0, at=LATER)
    b = _make(mdb, mseed, task=1, at=LATER.astimezone(KST))
    c = _make(mdb, mseed, task=2, at=LATER + timedelta(hours=1))
    other_member = _make(mdb, mseed, who="carol", task=0, at=LATER)
    assert a.bundle_id == b.bundle_id
    assert len({a.bundle_id, c.bundle_id, other_member.bundle_id}) == 3
    assert a.bundle.thread_id != other_member.bundle.thread_id


def test_rule_body_uses_default_persona_with_weekday_and_joins_in_created_order(mdb, mseed):
    mseed["tasks"][0].due_date = date(2026, 11, 14)
    mdb.commit()
    a = _make(mdb, mseed, task=0, made=NOW)
    b = _make(mdb, mseed, task=1, made=NOW + timedelta(minutes=1))
    bundle = _bundle(mdb, mseed, a)
    assert bundle.body == (
        f"앨리스님, 할일0 마감이 11/14(토)이라 한번 여쭤봐요. {TAIL}\n\n"
        f"앨리스님, 할일1 진행 상황 한번 여쭤봐요. {TAIL}"
    )
    assert (bundle.body_source, bundle.draft_status) == ("rule", "needed")
    assert b.bundle_id == bundle.bundle_id


def test_single_reminder_with_note_is_pm_text_and_needs_no_draft(mdb, mseed):
    r = _make(mdb, mseed, note="API 명세서 어디까지 됐어요?")
    bundle = _bundle(mdb, mseed, r)
    assert (bundle.body, bundle.body_source, bundle.draft_status) == ("API 명세서 어디까지 됐어요?", "pm", "done")

    _make(mdb, mseed, task=1, made=NOW + timedelta(minutes=1))
    mdb.refresh(bundle)
    assert bundle.body == f"API 명세서 어디까지 됐어요?\n\n앨리스님, 할일1 진행 상황 한번 여쭤봐요. {TAIL}"
    assert (bundle.body_source, bundle.draft_status) == ("rule", "needed")


def test_adding_a_reminder_clears_approval_and_bumps_draft_version(mdb, mseed):
    r = _make(mdb, mseed)
    approved = _approve(mdb, mseed, r)
    version = approved.draft_version
    assert approved.approved_at is not None

    _make(mdb, mseed, task=1)
    mdb.refresh(approved)
    assert approved.approved_at is None and approved.approved_by is None
    assert approved.draft_version == version + 1


def test_cancel_one_rebuilds_and_cancel_last_closes_bundle(mdb, mseed):
    a = _make(mdb, mseed, task=0, note="첫째")
    b = _make(mdb, mseed, task=1, made=NOW + timedelta(minutes=1))
    svc.cancel_reminder(mdb, svc.get_reminder(mdb, mseed["ws"], b.reminder_id), now=NOW)
    mdb.commit()
    bundle = _bundle(mdb, mseed, a)
    assert bundle.status == ReminderStatus.SCHEDULED and bundle.body == "첫째"

    svc.cancel_reminder(mdb, svc.get_reminder(mdb, mseed["ws"], a.reminder_id), now=NOW)
    mdb.commit()
    mdb.refresh(bundle)
    assert bundle.status == ReminderStatus.CANCELLED


def test_expire_only_scheduled_and_last_expired_closes_bundle_as_expired(mdb, mseed):
    r = _make(mdb, mseed)
    svc.expire_reminder(mdb, r.reminder_id, now=NOW)
    mdb.commit()
    assert r.status == ReminderStatus.EXPIRED and r.expired_at is not None
    assert r.bundle.status == ReminderStatus.EXPIRED
    with pytest.raises(AppError) as e:
        svc.expire_reminder(mdb, r.reminder_id, now=NOW)
    assert e.value.code == ErrorCode.REMINDER_NOT_EDITABLE


def test_moving_a_reminder_leaves_old_bundle_and_joins_the_one_at_new_time(mdb, mseed):
    there = _make(mdb, mseed, task=2, at=LATER + timedelta(hours=2), note="저쪽", made=NOW)
    stay = _make(mdb, mseed, task=0, at=LATER, note="남음", made=NOW + timedelta(minutes=1))
    move = _make(mdb, mseed, task=1, at=LATER, made=NOW + timedelta(minutes=2))
    target = _approve(mdb, mseed, there)

    svc.edit_reminder(mdb, svc.get_reminder(mdb, mseed["ws"], move.reminder_id),
                      scheduled_at=LATER + timedelta(hours=2), now=NOW)
    mdb.commit()
    source = _bundle(mdb, mseed, stay)
    mdb.refresh(target)
    assert move.bundle_id == target.bundle_id
    assert source.body == "남음" and source.body_source == "pm"
    assert target.approved_at is None
    assert target.body == f"저쪽\n\n앨리스님, 할일1 진행 상황 한번 여쭤봐요. {TAIL}"


def test_note_edit_rebuilds_text_and_clears_approval(mdb, mseed):
    r = _make(mdb, mseed, note="처음")
    _approve(mdb, mseed, r)
    svc.edit_reminder(mdb, svc.get_reminder(mdb, mseed["ws"], r.reminder_id), note="바꿈", now=NOW)
    mdb.commit()
    bundle = _bundle(mdb, mseed, r)
    assert bundle.body == "바꿈" and bundle.approved_at is None

    svc.edit_reminder(mdb, svc.get_reminder(mdb, mseed["ws"], r.reminder_id), note=None, now=NOW)
    mdb.commit()
    mdb.refresh(bundle)
    assert bundle.body == f"앨리스님, 할일0 진행 상황 한번 여쭤봐요. {TAIL}" and bundle.draft_status == "needed"


def test_bundle_time_move_keeps_approval_or_merges_into_existing_bundle(mdb, mseed):
    a = _make(mdb, mseed, task=0, at=LATER, note="가")
    b = _make(mdb, mseed, task=1, at=LATER + timedelta(hours=1), note="나", made=NOW + timedelta(minutes=1))
    first = _approve(mdb, mseed, a)

    moved = svc.edit_bundle(mdb, first, body=None, scheduled_at=LATER + timedelta(hours=3), now=NOW)
    mdb.commit()
    assert moved.bundle_id == first.bundle_id and moved.approved_at is not None
    assert svc.utc(moved.scheduled_at) == LATER + timedelta(hours=3)

    merged = svc.edit_bundle(mdb, _bundle(mdb, mseed, a), body=None, scheduled_at=LATER + timedelta(hours=1), now=NOW)
    mdb.commit()
    mdb.refresh(first)
    assert merged.bundle_id == b.bundle_id and first.status == ReminderStatus.CANCELLED
    assert merged.body == "가\n\n나"
    assert merged.approved_at is None
    assert {r.reminder_id for r in svc.bundle_reminders(mdb, merged.bundle_id)} == {a.reminder_id, b.reminder_id}


def test_bundle_edit_and_approve_reject_past_time(mdb, mseed):
    r = _make(mdb, mseed)
    bundle = _bundle(mdb, mseed, r)
    with pytest.raises(AppError) as e:
        svc.edit_bundle(mdb, bundle, body=None, scheduled_at=NOW, now=NOW)
    assert e.value.code == ErrorCode.REMINDER_SCHEDULED_AT_PASSED
    with pytest.raises(AppError) as e:
        svc.approve_bundle(mdb, bundle, draft_version=bundle.draft_version, approved_by=None, now=LATER)
    assert e.value.code == ErrorCode.REMINDER_SCHEDULED_AT_PASSED


def test_resending_the_unchanged_time_with_an_edit_after_it_passed_is_not_a_time_change(mdb, mseed):
    r = _make(mdb, mseed, at=LATER)
    after = LATER + timedelta(minutes=1)
    same_time = LATER.astimezone(KST)

    svc.edit_reminder(mdb, svc.get_reminder(mdb, mseed["ws"], r.reminder_id), note="메모만", scheduled_at=same_time,
                      now=after)
    mdb.commit()
    bundle = svc.edit_bundle(mdb, _bundle(mdb, mseed, r), body="문구만", scheduled_at=same_time, now=after)
    mdb.commit()
    assert (r.note, bundle.body, svc.utc(bundle.scheduled_at)) == ("메모만", "문구만", LATER)


def test_create_rejects_past_time_and_foreign_task_and_deleted_member(mdb, mseed):
    with pytest.raises(AppError) as e:
        _make(mdb, mseed, at=NOW)
    assert e.value.code == ErrorCode.REMINDER_SCHEDULED_AT_PASSED
    mseed["carol"].is_deleted = True
    mdb.commit()
    with pytest.raises(AppError) as e:
        _make(mdb, mseed, who="carol")
    assert e.value.code == ErrorCode.MEMBER_NOT_FOUND
    with pytest.raises(AppError) as e:
        svc.create_reminder(
            mdb, workspace_id=mseed["ws"], task_id="nope", member_id=mseed["alice"].member_id,
            scheduled_at=LATER, note=None, created_by=None, now=NOW,
        )
    assert e.value.code == ErrorCode.TASK_NOT_FOUND


# 발송

def test_dispatch_skips_unapproved_future_and_cancelled(mdb, mseed):
    _make(mdb, mseed, task=0, at=LATER)
    _approve(mdb, mseed, _make(mdb, mseed, who="carol", task=1, at=LATER + timedelta(days=5)))
    c = _make(mdb, mseed, who="bob", task=2)
    bundle = _approve(mdb, mseed, c)
    svc.cancel_bundle(mdb, bundle, now=NOW)
    mdb.commit()
    assert svc.dispatch_due(mdb, LATER + timedelta(hours=1)) == []


def test_dispatch_sends_bundle_body_once_and_marks_everything_sent(mdb, mseed):
    a = _make(mdb, mseed, task=0, note="첫째")
    b = _make(mdb, mseed, task=1, made=NOW + timedelta(minutes=1))
    bundle = _bundle(mdb, mseed, a)
    svc.edit_bundle(mdb, bundle, body="둘 다 어때요?", scheduled_at=None, now=NOW)
    svc.approve_bundle(mdb, bundle, draft_version=bundle.draft_version, approved_by=None, now=NOW)
    mdb.commit()

    (msg,) = svc.dispatch_due(mdb, LATER)
    mdb.commit()
    assert msg.body == "둘 다 어때요?" and msg.sender == MessageSender.BOT and msg.dm_status == DmStatus.PENDING
    mdb.refresh(bundle), mdb.refresh(a), mdb.refresh(b)
    assert bundle.status == ReminderStatus.SENT and bundle.message_id == msg.message_id
    assert a.status == b.status == ReminderStatus.SENT
    assert svc.dispatch_due(mdb, LATER) == []


def test_dispatch_marks_unlinked_member_failed_without_offering_to_bot(mdb, mseed):
    _sendable(mdb, mseed, who="bob")
    (msg,) = svc.dispatch_due(mdb, LATER)
    assert msg.dm_status == DmStatus.FAILED and msg.dm_failure_reason == DmFailureReason.DISCORD_NOT_LINKED
    assert svc.claim_for_bot(mdb, LATER) == []


def test_claim_never_returns_same_message_twice(mdb, mseed):
    _sendable(mdb, mseed)
    first = svc.claim_for_bot(mdb, LATER)
    assert [m.message.body for m in first] == ["마감 확인 부탁해요"]
    assert first[0].discord_user_id == "d_alice"
    assert svc.claim_for_bot(mdb, LATER) == []


def test_stale_claim_becomes_failed_unknown_and_is_not_reoffered(mdb, mseed):
    _sendable(mdb, mseed)
    (claimed,) = svc.claim_for_bot(mdb, LATER)
    assert svc.claim_for_bot(mdb, LATER + timedelta(minutes=9)) == []
    assert svc.claim_for_bot(mdb, LATER + timedelta(minutes=11)) == []
    mdb.refresh(claimed.message)
    assert claimed.message.dm_status == DmStatus.FAILED
    assert claimed.message.dm_failure_reason == DmFailureReason.UNKNOWN


# AI 초안

def test_draft_claim_offers_needed_bundles_once_and_again_after_ten_minutes(mdb, mseed):
    mseed["tasks"][0].due_date = date(2026, 11, 14)
    mdb.commit()
    r = _make(mdb, mseed, task=0)
    _make(mdb, mseed, task=1, note="메모", made=NOW + timedelta(minutes=1))
    (item,) = svc.claim_drafts(mdb, NOW)
    mdb.commit()
    assert item.bundle.bundle_id == r.bundle_id and item.recipient_name == "앨리스"
    assert [(x.task.title, x.task.due_date, x.note) for x in item.reminders] == [
        ("할일0", date(2026, 11, 14), None), ("할일1", None, "메모"),
    ]
    assert svc.claim_drafts(mdb, NOW + timedelta(minutes=9)) == []
    (again,) = svc.claim_drafts(mdb, NOW + timedelta(minutes=11))
    assert again.bundle.bundle_id == r.bundle_id


def test_draft_claim_skips_approved_pm_written_past_and_deleted_member_bundles(mdb, mseed):
    _approve(mdb, mseed, _make(mdb, mseed, who="alice"))
    _make(mdb, mseed, who="bob", note="PM 이 씀")
    _make(mdb, mseed, who="carol", at=NOW + timedelta(minutes=5))
    assert svc.claim_drafts(mdb, NOW + timedelta(minutes=6)) == []
    mseed["carol"].is_deleted = True
    mdb.commit()
    assert svc.claim_drafts(mdb, NOW) == []


def test_draft_write_back_sets_ai_text_or_keeps_rule_text(mdb, mseed):
    a = _make(mdb, mseed, who="alice")
    c = _make(mdb, mseed, who="carol")
    items = {i.bundle.bundle_id: i for i in svc.claim_drafts(mdb, NOW)}
    rule_text = items[c.bundle_id].bundle.body

    ai = svc.write_draft(mdb, a.bundle_id, draft_version=items[a.bundle_id].bundle.draft_version,
                         body="앨리스님 할일0 어때요?", now=NOW)
    kept = svc.write_draft(mdb, c.bundle_id, draft_version=items[c.bundle_id].bundle.draft_version,
                           body=None, now=NOW)
    mdb.commit()
    assert (ai.body, ai.body_source, ai.draft_status) == ("앨리스님 할일0 어때요?", "ai", "done")
    assert (kept.body, kept.body_source, kept.draft_status) == (rule_text, "rule", "done")
    assert svc.claim_drafts(mdb, NOW + timedelta(hours=1)) == []


def test_draft_write_back_is_stale_after_membership_change_approval_or_pm_edit(mdb, mseed):
    r = _make(mdb, mseed, task=0)
    (item,) = svc.claim_drafts(mdb, NOW)
    version = item.bundle.draft_version
    _make(mdb, mseed, task=1)
    with pytest.raises(AppError) as e:
        svc.write_draft(mdb, r.bundle_id, draft_version=version, body="늦은 초안", now=NOW)
    assert e.value.code == ErrorCode.DRAFT_STALE

    bundle = _bundle(mdb, mseed, r)
    approved = _approve(mdb, mseed, r)
    with pytest.raises(AppError) as e:
        svc.write_draft(mdb, r.bundle_id, draft_version=approved.draft_version, body="x", now=NOW)
    assert e.value.code == ErrorCode.DRAFT_STALE

    edited = svc.edit_bundle(mdb, bundle, body="PM 이 고침", scheduled_at=None, now=NOW)
    mdb.commit()
    assert edited.approved_at is not None and edited.body_source == "pm"
    with pytest.raises(AppError) as e:
        svc.write_draft(mdb, r.bundle_id, draft_version=edited.draft_version, body="x", now=NOW)
    assert e.value.code == ErrorCode.DRAFT_STALE
    with pytest.raises(AppError) as e:
        svc.write_draft(mdb, "nope", draft_version=1, body="x", now=NOW)
    assert e.value.code == ErrorCode.REMINDER_BUNDLE_NOT_FOUND


def test_approve_is_refused_when_the_text_changed_after_the_pm_saw_it(mdb, mseed):
    a = _make(mdb, mseed, who="alice")
    c = _make(mdb, mseed, who="carol")
    seen = {b: _bundle(mdb, mseed, r).draft_version for b, r in (("a", a), ("c", c))}
    items = {i.bundle.bundle_id: i for i in svc.claim_drafts(mdb, NOW)}
    svc.write_draft(mdb, a.bundle_id, draft_version=items[a.bundle_id].bundle.draft_version,
                    body="AI 가 새로 쓴 문구", now=NOW)
    svc.write_draft(mdb, c.bundle_id, draft_version=items[c.bundle_id].bundle.draft_version, body=None, now=NOW)
    mdb.commit()

    with pytest.raises(AppError) as e:
        svc.approve_bundle(mdb, _bundle(mdb, mseed, a), draft_version=seen["a"], approved_by=None, now=NOW)
    assert e.value.code == ErrorCode.BUNDLE_CHANGED
    assert e.value.details["draft_version"] == seen["a"] + 1
    mdb.rollback()
    assert _bundle(mdb, mseed, a).approved_at is None

    kept = svc.approve_bundle(mdb, _bundle(mdb, mseed, c), draft_version=seen["c"], approved_by=None, now=NOW)
    assert kept.approved_at is not None and kept.body_source == "rule"

    current = _bundle(mdb, mseed, a)
    approved = svc.approve_bundle(mdb, current, draft_version=current.draft_version, approved_by=None, now=NOW)
    assert approved.body == "AI 가 새로 쓴 문구" and approved.approved_at is not None
    again = svc.approve_bundle(mdb, approved, draft_version=seen["a"], approved_by=None, now=NOW + timedelta(hours=1))
    assert svc.utc(again.approved_at) == NOW


def test_style_examples_are_recent_pm_texts_that_were_approved_or_sent(mdb, mseed):
    _sendable(mdb, mseed, who="alice", note="보낸 PM 글")
    svc.dispatch_due(mdb, LATER)
    mdb.commit()
    approved = _make(mdb, mseed, who="bob", at=LATER + timedelta(days=1), note="승인한 PM 글",
                     made=NOW + timedelta(hours=1))
    _approve(mdb, mseed, approved, now=NOW + timedelta(hours=1))
    _make(mdb, mseed, who="carol", at=LATER + timedelta(days=1), note="승인 안 한 PM 글")
    needs_draft = _make(mdb, mseed, who="alice", task=1, at=LATER + timedelta(days=2))

    (item,) = svc.claim_drafts(mdb, LATER)
    assert item.bundle.bundle_id == needs_draft.bundle_id
    assert item.style_examples == ["보낸 PM 글", "승인한 PM 글"]


# 결과 보고와 답장

def _claimed(mdb, mseed, who="alice"):
    _sendable(mdb, mseed, who=who)
    (c,) = svc.claim_for_bot(mdb, LATER)
    return c.message


def _deliver(mdb, msg, ids, now=LATER):
    svc.report_result(mdb, msg.message_id, delivered=True, failure_reason=None, discord_message_ids=ids, now=now)
    mdb.commit()


def test_report_result_is_idempotent_with_same_ids_and_final(mdb, mseed):
    msg = _claimed(mdb, mseed)
    _deliver(mdb, msg, ["dm1", "dm2"])
    _deliver(mdb, msg, ["dm2", "dm1"])
    assert msg.dm_status == DmStatus.DELIVERED and msg.dm_reported_at is not None
    for ids, delivered, reason in ((["dm1"], True, None), ([], False, DmFailureReason.DM_BLOCKED)):
        with pytest.raises(AppError) as e:
            svc.report_result(mdb, msg.message_id, delivered=delivered, failure_reason=reason,
                              discord_message_ids=ids, now=LATER)
        assert e.value.code == ErrorCode.MESSAGE_RESULT_CONFLICT


def test_report_rejects_ids_already_recorded_for_another_message(mdb, mseed):
    _deliver(mdb, _claimed(mdb, mseed, "alice"), ["dm1"])
    other = _claimed(mdb, mseed, "carol")
    with pytest.raises(AppError) as e:
        svc.report_result(mdb, other.message_id, delivered=True, failure_reason=None,
                          discord_message_ids=["dm1"], now=LATER)
    assert e.value.code == ErrorCode.MESSAGE_RESULT_CONFLICT


def test_late_report_after_timeout_wins(mdb, mseed):
    msg = _claimed(mdb, mseed)
    svc.claim_for_bot(mdb, LATER + timedelta(minutes=11))
    _deliver(mdb, msg, ["dm1"], now=LATER + timedelta(minutes=12))
    assert msg.dm_status == DmStatus.DELIVERED and msg.dm_failure_reason is None


def test_report_failure_keeps_reason_and_rejects_unclaimed_or_unlinked(mdb, mseed):
    msg = _claimed(mdb, mseed)
    for _ in range(2):
        svc.report_result(mdb, msg.message_id, delivered=False, failure_reason=DmFailureReason.DM_BLOCKED,
                          discord_message_ids=[], now=LATER)
    assert msg.dm_failure_reason == DmFailureReason.DM_BLOCKED

    _sendable(mdb, mseed, who="bob")
    (unlinked,) = svc.dispatch_due(mdb, LATER)
    with pytest.raises(AppError) as e:
        _deliver(mdb, unlinked, ["dm9"])
    assert e.value.code == ErrorCode.MESSAGE_RESULT_CONFLICT

    _sendable(mdb, mseed, who="carol")
    svc.dispatch_due(mdb, LATER)
    pending = mdb.query(ThreadMessage).filter_by(dm_status=DmStatus.PENDING).one()
    with pytest.raises(AppError) as e:
        _deliver(mdb, pending, ["dm8"])
    assert e.value.code == ErrorCode.MESSAGE_RESULT_CONFLICT


def _ingest(mdb, mid, sent_at=LATER, reply_to=None, user="d_alice"):
    msg, created = svc.ingest_discord_reply(
        mdb, discord_user_id=user, discord_message_id=mid, body="네", sent_at=sent_at, now=sent_at,
        reply_to_discord_message_id=reply_to,
    )
    mdb.commit()
    return msg, created


def test_report_unknown_or_member_message_is_404(mdb, mseed):
    with pytest.raises(AppError) as e:
        svc.report_result(mdb, "nope", delivered=True, failure_reason=None, discord_message_ids=["x"], now=LATER)
    assert e.value.code == ErrorCode.MESSAGE_NOT_FOUND
    reply, _ = _ingest(mdb, "m1")
    with pytest.raises(AppError) as e:
        _deliver(mdb, reply, ["x"])
    assert e.value.code == ErrorCode.MESSAGE_NOT_FOUND


def test_ingest_stores_same_discord_message_once(mdb, mseed):
    a, created_a = _ingest(mdb, "m1")
    b, created_b = _ingest(mdb, "m1")
    assert a.message_id == b.message_id and created_a and not created_b
    assert mdb.query(ThreadMessage).count() == 1
    assert a.sender == MessageSender.MEMBER and a.reply_channel == "discord"


def test_ingest_unknown_or_deleted_discord_user_is_404(mdb, mseed):
    with pytest.raises(AppError) as e:
        _ingest(mdb, "m1", user="stranger")
    assert e.value.code == ErrorCode.MEMBER_NOT_FOUND
    mseed["carol"].is_deleted = True
    mdb.commit()
    with pytest.raises(AppError) as e:
        _ingest(mdb, "m2", user="d_carol")
    assert e.value.code == ErrorCode.MEMBER_NOT_FOUND


def test_thread_made_by_another_request_meanwhile_is_reused(mdb, mseed, monkeypatch):
    from sqlalchemy import insert

    from app.models import MessageThread
    real_scalar, raced = mdb.scalar, []

    def scalar(stmt, *args, **kwargs):
        found = real_scalar(stmt, *args, **kwargs)
        if found is None and not raced and stmt.column_descriptions[0]["entity"] is MessageThread:
            raced.append(True)
            mdb.execute(insert(MessageThread).values(
                thread_id="made-by-other", workspace_id=mseed["ws"], member_id=mseed["alice"].member_id,
            ))
        return found

    monkeypatch.setattr(mdb, "scalar", scalar)
    msg, created = _ingest(mdb, "m1")
    assert raced and created and msg.thread_id == "made-by-other"
    assert mdb.query(MessageThread).count() == 1 and mdb.query(ThreadMessage).count() == 1


def _alice_in_workspace_b(mdb, created_at, name="B"):
    """워크스페이스 B 에도 같은 디스코드 계정의 앨리스가 있다. B 의 PM 이 리마인드를 만들 수 있게 태스크도 둔다."""
    from app.models import Task
    ws = Workspace(name=name)
    mdb.add(ws)
    mdb.flush()
    member = Member(workspace_id=ws.workspace_id, display_name=f"앨리스{name}", role="member",
                    discord_user_id="d_alice", created_at=created_at)
    task = Task(workspace_id=ws.workspace_id, title="B할일", status="todo")
    mdb.add_all([member, task])
    mdb.commit()
    return {"ws": ws.workspace_id, "alice": member, "pm": member, "tasks": [task]}


def _delivered_to(mdb, seed, ids, reported_at):
    """seed 의 앨리스에게 봇 DM 한 통이 나가 reported_at 에 보냄 보고가 왔다."""
    r = svc.create_reminder(
        mdb, workspace_id=seed["ws"], task_id=seed["tasks"][0].task_id, member_id=seed["alice"].member_id,
        scheduled_at=LATER, note="확인", created_by=None, now=NOW,
    )
    mdb.commit()
    _approve(mdb, seed, r)
    (claimed,) = [c for c in svc.claim_for_bot(mdb, reported_at) if c.member_id == seed["alice"].member_id]
    _deliver(mdb, claimed.message, ids, now=reported_at)
    return claimed.message


def test_reply_routing_prefers_replied_dm_then_preceding_dm(mdb, mseed):
    b = _alice_in_workspace_b(mdb, created_at=NOW)
    _delivered_to(mdb, mseed, ["dm_a"], reported_at=LATER)
    _delivered_to(mdb, b, ["dm_b"], reported_at=LATER + timedelta(hours=1))

    to_a, _ = _ingest(mdb, "m1", sent_at=LATER + timedelta(hours=2), reply_to="dm_a")
    assert to_a.thread.member_id == mseed["alice"].member_id

    to_b, _ = _ingest(mdb, "m2", sent_at=LATER + timedelta(hours=2))
    assert to_b.thread.member_id == b["alice"].member_id

    between, _ = _ingest(mdb, "m3", sent_at=LATER + timedelta(minutes=30))
    assert between.thread.member_id == mseed["alice"].member_id

    unknown_target, _ = _ingest(mdb, "m4", sent_at=LATER + timedelta(minutes=30), reply_to="not_ours")
    assert unknown_target.thread.member_id == mseed["alice"].member_id


def test_reply_to_dm_of_member_who_left_falls_through_to_preceding_dm(mdb, mseed):
    b = _alice_in_workspace_b(mdb, created_at=NOW)
    c = _alice_in_workspace_b(mdb, created_at=NOW, name="C")
    _delivered_to(mdb, mseed, ["dm_a"], reported_at=LATER)
    _delivered_to(mdb, c, ["dm_c"], reported_at=LATER + timedelta(minutes=30))
    _delivered_to(mdb, b, ["dm_b"], reported_at=LATER + timedelta(hours=1))
    mseed["alice"].is_deleted = True
    mdb.commit()
    msg, _ = _ingest(mdb, "m1", sent_at=LATER + timedelta(minutes=45), reply_to="dm_a")
    assert msg.thread.member_id == c["alice"].member_id


def test_reply_routing_falls_back_to_latest_bot_message_else_newest_member(mdb, mseed):
    b = _alice_in_workspace_b(mdb, created_at=NOW + timedelta(days=30))
    msg, _ = _ingest(mdb, "m1", sent_at=NOW)
    assert msg.thread.member_id == b["alice"].member_id

    _sendable(mdb, mseed)
    svc.dispatch_due(mdb, LATER)
    mdb.commit()
    msg2, _ = _ingest(mdb, "m2", sent_at=LATER)
    assert msg2.thread.member_id == mseed["alice"].member_id


DISCORD_EPOCH_MS = 1420070400000


def _snowflake(at):
    """그 시각에 보낸 디스코드 메시지의 id. 앞 비트가 보낸 시각(ms)이다."""
    return str((int(at.timestamp() * 1000) - DISCORD_EPOCH_MS) << 22)


def _claimed_in_a(mdb, seed, at):
    """워크스페이스 A 의 앨리스에게 갈 봇 DM 을 at 에 봇이 가져갔다(보고는 아직)."""
    r = svc.create_reminder(
        mdb, workspace_id=seed["ws"], task_id=seed["tasks"][1].task_id, member_id=seed["alice"].member_id,
        scheduled_at=at, note="확인2", created_by=None, now=NOW,
    )
    mdb.commit()
    _approve(mdb, seed, r)
    (c,) = [c for c in svc.claim_for_bot(mdb, at) if c.member_id == seed["alice"].member_id]
    mdb.commit()
    return c.message


def test_preceding_dm_is_the_one_sent_before_the_reply_even_if_reported_after_it(mdb, mseed):
    b = _alice_in_workspace_b(mdb, created_at=NOW)
    _delivered_to(mdb, b, [_snowflake(LATER)], reported_at=LATER)
    t = LATER + timedelta(hours=1)
    msg_a = _claimed_in_a(mdb, mseed, t)
    _deliver(mdb, msg_a, [_snowflake(t + timedelta(milliseconds=500))], now=t + timedelta(seconds=2))

    reply, _ = _ingest(mdb, _snowflake(t + timedelta(seconds=1)), sent_at=t + timedelta(seconds=1))
    assert reply.thread.member_id == mseed["alice"].member_id

    earlier, _ = _ingest(mdb, _snowflake(t - timedelta(minutes=1)), sent_at=t - timedelta(minutes=1))
    assert earlier.thread.member_id == b["alice"].member_id


def test_reply_while_the_dm_is_claimed_and_not_yet_reported_goes_to_that_dm(mdb, mseed):
    b = _alice_in_workspace_b(mdb, created_at=NOW)
    _delivered_to(mdb, b, [_snowflake(LATER)], reported_at=LATER)
    t = LATER + timedelta(hours=1)
    _claimed_in_a(mdb, mseed, t)

    reply, _ = _ingest(mdb, _snowflake(t + timedelta(seconds=1)), sent_at=t + timedelta(seconds=1))
    assert reply.thread.member_id == mseed["alice"].member_id


def test_reply_after_a_timed_out_dm_goes_to_it_before_and_after_the_late_report(mdb, mseed):
    b = _alice_in_workspace_b(mdb, created_at=NOW)
    _delivered_to(mdb, b, [_snowflake(LATER)], reported_at=LATER)
    t = LATER + timedelta(hours=1)
    msg_a = _claimed_in_a(mdb, mseed, t)
    svc.claim_for_bot(mdb, t + timedelta(minutes=11))
    mdb.commit()

    during, _ = _ingest(mdb, _snowflake(t + timedelta(minutes=3)), sent_at=t + timedelta(minutes=3))
    assert during.thread.member_id == mseed["alice"].member_id

    _deliver(mdb, msg_a, [_snowflake(t + timedelta(seconds=1))], now=t + timedelta(minutes=15))
    after, _ = _ingest(mdb, _snowflake(t + timedelta(minutes=4)), sent_at=t + timedelta(minutes=4))
    assert after.thread.member_id == mseed["alice"].member_id


def test_dm_that_failed_without_sending_anything_is_not_the_preceding_dm(mdb, mseed):
    b = _alice_in_workspace_b(mdb, created_at=NOW)
    _delivered_to(mdb, mseed, [_snowflake(LATER)], reported_at=LATER)
    t = LATER + timedelta(hours=1)
    r = svc.create_reminder(
        mdb, workspace_id=b["ws"], task_id=b["tasks"][0].task_id, member_id=b["alice"].member_id,
        scheduled_at=t, note="B 확인", created_by=None, now=NOW,
    )
    mdb.commit()
    _approve(mdb, b, r)
    (blocked,) = svc.claim_for_bot(mdb, t)
    svc.report_result(mdb, blocked.message.message_id, delivered=False, failure_reason=DmFailureReason.DM_BLOCKED,
                      discord_message_ids=[], now=t)
    mdb.commit()

    reply, _ = _ingest(mdb, _snowflake(t + timedelta(minutes=1)), sent_at=t + timedelta(minutes=1))
    assert reply.thread.member_id == mseed["alice"].member_id


def test_dispatch_cancels_bundle_of_member_who_left_instead_of_sending(mdb, mseed):
    r = _sendable(mdb, mseed, who="carol")
    mseed["carol"].is_deleted = True
    mdb.commit()

    assert svc.dispatch_due(mdb, LATER) == []

    mdb.refresh(r)
    assert r.status == ReminderStatus.CANCELLED
    assert r.bundle.status == ReminderStatus.CANCELLED
    assert r.bundle.message_id is None
    assert mdb.scalars(select(ThreadMessage)).all() == []


def test_create_same_task_same_time_returns_existing_reminder(mdb, mseed):
    first = _make(mdb, mseed)
    bundle = _approve(mdb, mseed, first)
    body = bundle.body

    second = _make(mdb, mseed, note="다른 메모")

    assert second.reminder_id == first.reminder_id
    assert svc.bundle_reminders(mdb, bundle.bundle_id) == [first]
    assert bundle.body == body and bundle.approved_at is not None
    assert first.note is None
