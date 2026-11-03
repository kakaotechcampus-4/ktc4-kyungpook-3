"""리마인드·보낼 메시지(묶음) 상태 전이 서비스(app/services/messages.py). 스케줄러가 시각을 넘겨 부르므로 now 를 직접 준다."""
from datetime import date, datetime, timedelta, timezone

import pytest

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
    bundle = svc.approve_bundle(db, _bundle(db, seed, reminder), approved_by=seed["pm"].member_id, now=now)
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
        svc.approve_bundle(mdb, bundle, approved_by=None, now=LATER)
    assert e.value.code == ErrorCode.REMINDER_SCHEDULED_AT_PASSED


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
    svc.approve_bundle(mdb, bundle, approved_by=None, now=NOW)
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


# 결과 보고와 답장

def _claimed(mdb, mseed, who="alice"):
    _sendable(mdb, mseed, who=who)
    (c,) = svc.claim_for_bot(mdb, LATER)
    return c.message


def _deliver(mdb, msg, now=LATER):
    svc.report_result(mdb, msg.message_id, delivered=True, failure_reason=None, now=now)
    mdb.commit()


def test_report_result_is_idempotent_and_final(mdb, mseed):
    msg = _claimed(mdb, mseed)
    _deliver(mdb, msg)
    _deliver(mdb, msg)
    assert msg.dm_status == DmStatus.DELIVERED and msg.dm_reported_at is not None
    with pytest.raises(AppError) as e:
        svc.report_result(mdb, msg.message_id, delivered=False, failure_reason=DmFailureReason.DM_BLOCKED, now=LATER)
    assert e.value.code == ErrorCode.MESSAGE_RESULT_CONFLICT


def test_late_report_after_timeout_wins(mdb, mseed):
    msg = _claimed(mdb, mseed)
    svc.claim_for_bot(mdb, LATER + timedelta(minutes=11))
    _deliver(mdb, msg, now=LATER + timedelta(minutes=12))
    assert msg.dm_status == DmStatus.DELIVERED and msg.dm_failure_reason is None


def test_report_failure_keeps_reason_and_rejects_unclaimed_or_unlinked(mdb, mseed):
    msg = _claimed(mdb, mseed)
    for _ in range(2):
        svc.report_result(mdb, msg.message_id, delivered=False, failure_reason=DmFailureReason.DM_BLOCKED,
                          now=LATER)
    assert msg.dm_failure_reason == DmFailureReason.DM_BLOCKED

    _sendable(mdb, mseed, who="bob")
    (unlinked,) = svc.dispatch_due(mdb, LATER)
    with pytest.raises(AppError) as e:
        _deliver(mdb, unlinked)
    assert e.value.code == ErrorCode.MESSAGE_RESULT_CONFLICT

    _sendable(mdb, mseed, who="carol")
    svc.dispatch_due(mdb, LATER)
    pending = mdb.query(ThreadMessage).filter_by(dm_status=DmStatus.PENDING).one()
    with pytest.raises(AppError) as e:
        _deliver(mdb, pending)
    assert e.value.code == ErrorCode.MESSAGE_RESULT_CONFLICT


def _ingest(mdb, mid, sent_at=LATER, user="d_alice"):
    msg, created = svc.ingest_discord_reply(
        mdb, discord_user_id=user, discord_message_id=mid, body="네", sent_at=sent_at, now=sent_at,
    )
    mdb.commit()
    return msg, created


def test_report_unknown_or_member_message_is_404(mdb, mseed):
    with pytest.raises(AppError) as e:
        svc.report_result(mdb, "nope", delivered=True, failure_reason=None, now=LATER)
    assert e.value.code == ErrorCode.MESSAGE_NOT_FOUND
    reply, _ = _ingest(mdb, "m1")
    with pytest.raises(AppError) as e:
        _deliver(mdb, reply)
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


def _alice_in_workspace_b(mdb, created_at):
    """워크스페이스 B 에도 같은 디스코드 계정의 앨리스가 있다."""
    ws = Workspace(name="B")
    mdb.add(ws)
    mdb.flush()
    member = Member(workspace_id=ws.workspace_id, display_name="앨리스B", role="member",
                    discord_user_id="d_alice", created_at=created_at)
    mdb.add(member)
    mdb.commit()
    return {"ws": ws.workspace_id, "alice": member}


def test_reply_routing_falls_back_to_latest_bot_message_else_newest_member(mdb, mseed):
    b = _alice_in_workspace_b(mdb, created_at=NOW + timedelta(days=30))
    msg, _ = _ingest(mdb, "m1", sent_at=NOW)
    assert msg.thread.member_id == b["alice"].member_id

    _sendable(mdb, mseed)
    svc.dispatch_due(mdb, LATER)
    mdb.commit()
    msg2, _ = _ingest(mdb, "m2", sent_at=LATER)
    assert msg2.thread.member_id == mseed["alice"].member_id
