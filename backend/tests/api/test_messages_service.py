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


def _first(middle, who="앨리스", pm="PM(이)에요"):
    """그 대화의 첫 봇 DM 틀. 시드의 PM 표시 이름은 한글이 아니라 조사가 (이)에요 다."""
    return f"안녕하세요 {who}님, A {pm}.\n앞으로 확인용 메시지는 이 봇으로 보낼게요.\n\n{middle}\n여기로 답장하시면 저한테 바로 전달돼요."


def _rule(title):
    return f"'{title}' 진행 상황 한번 여쭤봐요.\n{TAIL}"


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
        "안녕하세요 앨리스님, A PM(이)에요.\n앞으로 확인용 메시지는 이 봇으로 보낼게요.\n\n"
        "'할일0' 마감이 11/14(토)이라 한번 여쭤봐요.\n지금 어디까지 됐는지 편하게 알려 주세요!\n\n"
        "'할일1' 진행 상황 한번 여쭤봐요.\n지금 어디까지 됐는지 편하게 알려 주세요!\n"
        "여기로 답장하시면 저한테 바로 전달돼요."
    )
    assert (bundle.body_source, bundle.draft_status) == ("rule", "needed")
    assert b.bundle_id == bundle.bundle_id


def test_single_reminder_with_note_is_pm_text_and_needs_no_draft(mdb, mseed):
    r = _make(mdb, mseed, note="API 명세서 어디까지 됐어요?")
    bundle = _bundle(mdb, mseed, r)
    assert (bundle.body, bundle.body_source, bundle.draft_status) == (_first("API 명세서 어디까지 됐어요?"), "pm", "done")

    _make(mdb, mseed, task=1, made=NOW + timedelta(minutes=1))
    mdb.refresh(bundle)
    assert bundle.body == _first(f"API 명세서 어디까지 됐어요?\n\n{_rule('할일1')}")
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
    assert bundle.status == ReminderStatus.SCHEDULED and bundle.body == _first("첫째")

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
    assert source.body == _first("남음") and source.body_source == "pm"
    assert target.approved_at is None
    assert target.body == _first(f"저쪽\n\n{_rule('할일1')}")


def test_note_edit_rebuilds_text_and_clears_approval(mdb, mseed):
    r = _make(mdb, mseed, note="처음")
    _approve(mdb, mseed, r)
    svc.edit_reminder(mdb, svc.get_reminder(mdb, mseed["ws"], r.reminder_id), note="바꿈", now=NOW)
    mdb.commit()
    bundle = _bundle(mdb, mseed, r)
    assert bundle.body == _first("바꿈") and bundle.approved_at is None

    svc.edit_reminder(mdb, svc.get_reminder(mdb, mseed["ws"], r.reminder_id), note=None, now=NOW)
    mdb.commit()
    mdb.refresh(bundle)
    assert bundle.body == _first(_rule("할일0")) and bundle.draft_status == "needed"


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
    assert merged.body == _first("가\n\n나")
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


# 첫 DM 소개와 PM 이름

def test_after_a_delivered_dm_the_thread_gets_the_short_frame_but_a_failed_dm_does_not_count(mdb, mseed):
    mseed["pm"].display_name = "재환"
    mseed["tasks"][1].due_date = date(2026, 11, 14)
    mdb.commit()
    _deliver(mdb, _claimed(mdb, mseed, "alice"), ["dm1"])
    blocked = _claimed(mdb, mseed, "carol")
    svc.report_result(mdb, blocked.message_id, delivered=False, failure_reason=DmFailureReason.DM_BLOCKED,
                      discord_message_ids=[], now=LATER)
    mdb.commit()

    alice = _bundle(mdb, mseed, _make(mdb, mseed, who="alice", task=1, at=LATER + timedelta(days=1)))
    carol = _bundle(mdb, mseed, _make(mdb, mseed, who="carol", task=1, at=LATER + timedelta(days=1)))
    assert alice.body == "앨리스님, 재환이에요.\n'할일1' 마감이 11/14(토)이라 한번 여쭤봐요.\n지금 어디까지 됐는지 편하게 알려 주세요!"
    assert carol.body.startswith("안녕하세요 캐럴님, A 재환이에요.\n")


def test_pm_name_is_the_creator_else_the_earliest_pm_else_pm_with_matching_josa(mdb, mseed):
    mseed["pm"].display_name = "재환"
    early = Member(workspace_id=mseed["ws"], display_name="동우", role="pm",
                   created_at=datetime(2020, 1, 1, tzinfo=timezone.utc))
    late = Member(workspace_id=mseed["ws"], display_name="Kim", role="pm",
                  created_at=datetime(2099, 1, 1, tzinfo=timezone.utc))
    mdb.add_all([early, late])
    mdb.commit()

    def body(created_by, hours):
        r = svc.create_reminder(
            mdb, workspace_id=mseed["ws"], task_id=mseed["tasks"][0].task_id, member_id=mseed["alice"].member_id,
            scheduled_at=LATER + timedelta(hours=hours), note="확인 부탁해요", created_by=created_by, now=NOW,
        )
        mdb.commit()
        return _bundle(mdb, mseed, r).body

    assert body(mseed["pm"].member_id, 0) == (
        "안녕하세요 앨리스님, A 재환이에요.\n앞으로 확인용 메시지는 이 봇으로 보낼게요.\n\n"
        "확인 부탁해요\n여기로 답장하시면 저한테 바로 전달돼요."
    )
    assert body(late.member_id, 1).startswith("안녕하세요 앨리스님, A Kim(이)에요.\n")
    assert body(None, 2).startswith("안녕하세요 앨리스님, A 동우예요.\n")
    early.is_deleted = True
    mdb.commit()
    assert body(early.member_id, 3).startswith("안녕하세요 앨리스님, A 재환이에요.\n")
    mseed["pm"].is_deleted = late.is_deleted = True
    mdb.commit()
    assert body(None, 4).startswith("안녕하세요 앨리스님, A PM(이)에요.\n")


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
    assert [m.message.body for m in first] == [_first("마감 확인 부탁해요")]
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
                         body="'할일0' 어디까지 됐는지 궁금해요!", now=NOW)
    kept = svc.write_draft(mdb, c.bundle_id, draft_version=items[c.bundle_id].bundle.draft_version,
                           body=None, now=NOW)
    mdb.commit()
    assert ai.body == (
        "안녕하세요 앨리스님, A PM(이)에요.\n앞으로 확인용 메시지는 이 봇으로 보낼게요.\n\n"
        "'할일0' 어디까지 됐는지 궁금해요!\n여기로 답장하시면 저한테 바로 전달돼요."
    )
    assert (ai.body_source, ai.draft_status) == ("ai", "done")
    assert (kept.body, kept.body_source, kept.draft_status) == (rule_text, "rule", "done")
    assert svc.claim_drafts(mdb, NOW + timedelta(hours=1)) == []


def test_draft_over_the_limit_once_framed_is_refused_and_leaves_the_bundle(mdb, mseed):
    r = _make(mdb, mseed)
    (item,) = svc.claim_drafts(mdb, NOW)
    version = item.bundle.draft_version
    room = 2000 - len(_first(""))
    with pytest.raises(AppError) as e:
        svc.write_draft(mdb, r.bundle_id, draft_version=version, body="가" * (room + 1), now=NOW)
    assert e.value.code == ErrorCode.INVALID_REQUEST
    assert (item.bundle.body, item.bundle.draft_version) == (_first(_rule("할일0")), version)

    written = svc.write_draft(mdb, r.bundle_id, draft_version=version, body="가" * room, now=NOW)
    assert len(written.body) == 2000 and written.body_source == "ai"


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
    assert approved.body == _first("AI 가 새로 쓴 문구") and approved.approved_at is not None
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
    assert item.style_examples == [_first("보낸 PM 글"), _first("승인한 PM 글", who="밥")]


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


def test_first_delivered_dm_reframes_unapproved_bundles_but_not_text_the_pm_edited(mdb, mseed):
    ai = _make(mdb, mseed, task=1, at=LATER + timedelta(days=2))
    (item,) = svc.claim_drafts(mdb, NOW)
    svc.write_draft(mdb, ai.bundle_id, draft_version=item.bundle.draft_version, body="AI 가 쓴 가운데", now=NOW)
    mdb.commit()
    rule = _make(mdb, mseed, task=2, at=LATER + timedelta(days=1))
    note = _make(mdb, mseed, task=0, at=LATER + timedelta(days=3), note="PM 메모")
    edited = _make(mdb, mseed, task=2, at=LATER + timedelta(days=5))
    svc.edit_bundle(mdb, _bundle(mdb, mseed, edited), body="PM 이 고친 글", scheduled_at=None, now=NOW)
    approved = _make(mdb, mseed, task=1, at=LATER + timedelta(days=4))
    _approve(mdb, mseed, approved)
    other = _make(mdb, mseed, who="carol", task=2, at=LATER + timedelta(days=1))
    bundles = {k: _bundle(mdb, mseed, r) for k, r in
               (("ai", ai), ("rule", rule), ("note", note), ("edited", edited), ("approved", approved), ("other", other))}
    before = {k: (b.body, b.draft_version) for k, b in bundles.items()}
    assert bundles["ai"].body_source == "ai"

    _deliver(mdb, _claimed(mdb, mseed), ["dm1"])
    for b in bundles.values():
        mdb.refresh(b)
    short = "앨리스님, PM(이)에요.\n'{}' 진행 상황 한번 여쭤봐요.\n지금 어디까지 됐는지 편하게 알려 주세요!"
    for k, title in (("rule", "할일2"), ("ai", "할일1")):
        b = bundles[k]
        assert (b.body, b.body_source, b.draft_status) == (short.format(title), "rule", "needed"), k
        assert b.draft_version == before[k][1] + 1, k
    assert (bundles["note"].body, bundles["note"].body_source) == ("앨리스님, PM(이)에요.\nPM 메모", "pm")
    assert bundles["note"].draft_version == before["note"][1] + 1
    for k in ("edited", "approved", "other"):
        assert (bundles[k].body, bundles[k].draft_version) == before[k], k

    after = {k: b.draft_version for k, b in bundles.items()}
    _deliver(mdb, _claimed(mdb, mseed), ["dm2"])
    for b in bundles.values():
        mdb.refresh(b)
    assert {k: b.draft_version for k, b in bundles.items()} == after


def test_a_memo_bundle_loses_the_intro_even_if_a_name_changed_after_it_was_framed(mdb, mseed):
    note = _make(mdb, mseed, task=0, at=LATER + timedelta(days=3), note="PM 메모")
    b = _bundle(mdb, mseed, note)
    version = b.draft_version
    mseed["alice"].display_name = "새이름"
    mdb.commit()
    _deliver(mdb, _claimed(mdb, mseed), ["dm1"])
    mdb.refresh(b)
    assert b.body == "새이름님, PM(이)에요.\nPM 메모"
    assert b.draft_version == version + 1


def test_a_memo_bundle_with_text_the_pm_changed_inside_the_frame_stays_as_written(mdb, mseed):
    note = _make(mdb, mseed, task=0, at=LATER + timedelta(days=3), note="PM 메모")
    b = _bundle(mdb, mseed, note)
    svc.edit_bundle(mdb, b, body=b.body.replace("PM 메모", "PM 메모에 한 줄 더"), scheduled_at=None, now=NOW)
    mdb.commit()
    edited = b.body
    _deliver(mdb, _claimed(mdb, mseed), ["dm1"])
    mdb.refresh(b)
    assert b.body == edited


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
