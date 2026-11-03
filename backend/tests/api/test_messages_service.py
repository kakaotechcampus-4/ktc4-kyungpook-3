"""리마인드 상태 전이 서비스(app/services/messages.py). 스케줄러가 시각을 넘겨 부르므로 now 를 직접 준다."""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.errors import AppError, ErrorCode
from app.models import (
    DmFailureReason,
    DmStatus,
    Member,
    MessageSender,
    ReminderStatus,
    ThreadMessage,
)
from app.services import messages as svc

NOW = datetime(2026, 11, 10, 9, 0, tzinfo=timezone.utc)
LATER = NOW + timedelta(days=1)


def _make(db, seed, who="alice", task=0, at=LATER, body="마감 확인 부탁해요", approve=True, made=NOW):
    r = svc.create_reminder(
        db, workspace_id=seed["ws"], task_id=seed["tasks"][task].task_id, member_id=seed[who].member_id,
        body=body, scheduled_at=at, created_by=seed["pm"].member_id, now=made,
    )
    if approve:
        svc.approve_reminder(db, r, approved_by=seed["pm"].member_id, now=NOW)
    db.commit()
    return r


def test_create_reminder_makes_thread_once_per_member(mdb, mseed):
    a = _make(mdb, mseed, task=0, approve=False)
    b = _make(mdb, mseed, task=1, approve=False)
    assert a.thread_id == b.thread_id
    assert a.status == ReminderStatus.SCHEDULED and a.origin == "pm" and a.kind == "nudge"


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
            body="x", scheduled_at=LATER, created_by=None, now=NOW,
        )
    assert e.value.code == ErrorCode.TASK_NOT_FOUND


def test_expire_only_scheduled(mdb, mseed):
    r = _make(mdb, mseed)
    svc.expire_reminder(mdb, r.reminder_id, now=NOW)
    assert r.status == ReminderStatus.EXPIRED and r.expired_at is not None
    with pytest.raises(AppError) as e:
        svc.expire_reminder(mdb, r.reminder_id, now=NOW)
    assert e.value.code == ErrorCode.REMINDER_NOT_EDITABLE


def test_dispatch_skips_unapproved_future_and_cancelled(mdb, mseed):
    _make(mdb, mseed, task=0, approve=False)
    _make(mdb, mseed, task=1, at=LATER + timedelta(days=5))
    c = _make(mdb, mseed, task=2)
    svc.cancel_reminder(mdb, c, now=NOW)
    assert svc.dispatch_due(mdb, LATER + timedelta(hours=1)) == []


def test_dispatch_merges_same_member_and_time_in_creation_order(mdb, mseed):
    first = _make(mdb, mseed, task=0, body="첫째", made=NOW)
    second = _make(mdb, mseed, task=1, body="둘째", made=NOW + timedelta(minutes=1))
    other_time = _make(mdb, mseed, task=2, body="다른 시각", at=LATER + timedelta(hours=1))
    sent = svc.dispatch_due(mdb, LATER + timedelta(hours=2))
    assert len(sent) == 2
    merged = next(m for m in sent if m.body != "다른 시각")
    assert merged.body == "첫째\n\n둘째"
    assert merged.sender == MessageSender.BOT and merged.dm_status == DmStatus.PENDING
    mdb.refresh(first), mdb.refresh(second), mdb.refresh(other_time)
    assert first.message_id == second.message_id != other_time.message_id
    assert {first.status, second.status, other_time.status} == {ReminderStatus.SENT}
    assert svc.dispatch_due(mdb, LATER + timedelta(hours=2)) == []


def test_dispatch_marks_unlinked_member_failed_without_offering_to_bot(mdb, mseed):
    _make(mdb, mseed, who="bob")
    (msg,) = svc.dispatch_due(mdb, LATER)
    assert msg.dm_status == DmStatus.FAILED and msg.dm_failure_reason == DmFailureReason.DISCORD_NOT_LINKED
    assert svc.claim_for_bot(mdb, LATER) == []


def test_claim_never_returns_same_message_twice(mdb, mseed):
    _make(mdb, mseed)
    first = svc.claim_for_bot(mdb, LATER)
    assert [m.message.body for m in first] == ["마감 확인 부탁해요"]
    assert first[0].discord_user_id == "d_alice"
    assert svc.claim_for_bot(mdb, LATER) == []


def test_stale_claim_becomes_failed_unknown_and_is_not_reoffered(mdb, mseed):
    _make(mdb, mseed)
    (claimed,) = svc.claim_for_bot(mdb, LATER)
    assert svc.claim_for_bot(mdb, LATER + timedelta(minutes=9)) == []
    assert svc.claim_for_bot(mdb, LATER + timedelta(minutes=11)) == []
    mdb.refresh(claimed.message)
    assert claimed.message.dm_status == DmStatus.FAILED
    assert claimed.message.dm_failure_reason == DmFailureReason.UNKNOWN


def _claimed(mdb, mseed):
    _make(mdb, mseed)
    (c,) = svc.claim_for_bot(mdb, LATER)
    return c.message


def test_report_result_is_idempotent_and_final(mdb, mseed):
    msg = _claimed(mdb, mseed)
    svc.report_result(mdb, msg.message_id, delivered=True, failure_reason=None, now=LATER)
    svc.report_result(mdb, msg.message_id, delivered=True, failure_reason=None, now=LATER)
    assert msg.dm_status == DmStatus.DELIVERED and msg.dm_reported_at is not None
    with pytest.raises(AppError) as e:
        svc.report_result(mdb, msg.message_id, delivered=False, failure_reason=DmFailureReason.DM_BLOCKED, now=LATER)
    assert e.value.code == ErrorCode.MESSAGE_RESULT_CONFLICT


def test_late_report_after_timeout_wins(mdb, mseed):
    msg = _claimed(mdb, mseed)
    svc.claim_for_bot(mdb, LATER + timedelta(minutes=11))
    svc.report_result(mdb, msg.message_id, delivered=True, failure_reason=None, now=LATER + timedelta(minutes=12))
    assert msg.dm_status == DmStatus.DELIVERED and msg.dm_failure_reason is None


def test_report_failure_keeps_reason_and_rejects_unclaimed_or_unlinked(mdb, mseed):
    msg = _claimed(mdb, mseed)
    svc.report_result(mdb, msg.message_id, delivered=False, failure_reason=DmFailureReason.DM_BLOCKED, now=LATER)
    svc.report_result(mdb, msg.message_id, delivered=False, failure_reason=DmFailureReason.DM_BLOCKED, now=LATER)
    assert msg.dm_failure_reason == DmFailureReason.DM_BLOCKED

    _make(mdb, mseed, who="bob")
    (unlinked,) = svc.dispatch_due(mdb, LATER)
    with pytest.raises(AppError) as e:
        svc.report_result(mdb, unlinked.message_id, delivered=True, failure_reason=None, now=LATER)
    assert e.value.code == ErrorCode.MESSAGE_RESULT_CONFLICT

    _make(mdb, mseed, who="carol")
    svc.dispatch_due(mdb, LATER)
    pending = mdb.query(ThreadMessage).filter_by(dm_status=DmStatus.PENDING).one()
    with pytest.raises(AppError) as e:
        svc.report_result(mdb, pending.message_id, delivered=True, failure_reason=None, now=LATER)
    assert e.value.code == ErrorCode.MESSAGE_RESULT_CONFLICT


def test_report_unknown_or_member_message_is_404(mdb, mseed):
    with pytest.raises(AppError) as e:
        svc.report_result(mdb, "nope", delivered=True, failure_reason=None, now=LATER)
    assert e.value.code == ErrorCode.MESSAGE_NOT_FOUND
    reply, _ = svc.ingest_discord_reply(
        mdb, discord_user_id="d_alice", discord_message_id="m1", body="네", sent_at=NOW, now=NOW)
    with pytest.raises(AppError) as e:
        svc.report_result(mdb, reply.message_id, delivered=True, failure_reason=None, now=LATER)
    assert e.value.code == ErrorCode.MESSAGE_NOT_FOUND


def test_ingest_stores_same_discord_message_once(mdb, mseed):
    a, created_a = svc.ingest_discord_reply(
        mdb, discord_user_id="d_alice", discord_message_id="m1", body="네", sent_at=NOW, now=NOW)
    b, created_b = svc.ingest_discord_reply(
        mdb, discord_user_id="d_alice", discord_message_id="m1", body="네", sent_at=NOW, now=NOW)
    assert a.message_id == b.message_id and created_a and not created_b
    assert mdb.query(ThreadMessage).count() == 1
    assert a.sender == MessageSender.MEMBER and a.reply_channel == "discord"


def test_ingest_unknown_discord_user_is_404(mdb, mseed):
    with pytest.raises(AppError) as e:
        svc.ingest_discord_reply(
            mdb, discord_user_id="stranger", discord_message_id="m1", body="x", sent_at=NOW, now=NOW)
    assert e.value.code == ErrorCode.MEMBER_NOT_FOUND


def _second_workspace_alice(mdb, created_at):
    from app.models import Workspace
    ws2 = Workspace(name="B")
    mdb.add(ws2)
    mdb.flush()
    m = Member(workspace_id=ws2.workspace_id, display_name="앨리스B", role="member",
               discord_user_id="d_alice", created_at=created_at)
    mdb.add(m)
    mdb.commit()
    return m


def test_ingest_picks_workspace_with_latest_bot_message_else_newest_member(mdb, mseed):
    alice_b = _second_workspace_alice(mdb, created_at=NOW + timedelta(days=30))
    msg, _ = svc.ingest_discord_reply(
        mdb, discord_user_id="d_alice", discord_message_id="m1", body="x", sent_at=NOW, now=NOW)
    assert msg.thread.member_id == alice_b.member_id  # 봇 메시지가 없으면 가장 나중에 만든 팀원

    _make(mdb, mseed)
    svc.dispatch_due(mdb, LATER)
    msg2, _ = svc.ingest_discord_reply(
        mdb, discord_user_id="d_alice", discord_message_id="m2", body="y", sent_at=LATER, now=LATER)
    assert msg2.thread.member_id == mseed["alice"].member_id


def test_ingest_ignores_deleted_member(mdb, mseed):
    mseed["carol"].is_deleted = True
    mdb.commit()
    with pytest.raises(AppError):
        svc.ingest_discord_reply(
            mdb, discord_user_id="d_carol", discord_message_id="m1", body="x", sent_at=NOW, now=NOW)
