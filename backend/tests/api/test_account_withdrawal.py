from datetime import datetime, timedelta, timezone
import json
import secrets
import pytest

from sqlalchemy import select

from app.models import (
    AliasResolutionLog, AliasReview, ApprovalRequest, Extraction, ExtractionItem,
    Invitation, Meeting, MeetingUpload, Member, MemberAlias, Notification, PrivacyCleanup, PushSubscription, Session as LoginSession,
    Source, Task, User, WithdrawalReceipt, Workspace,
)
from app.services import account_withdrawal, messages, notifications
from tests.api.conftest import signup_verified
from tests.api.test_messages_api import P, client


@pytest.fixture(autouse=True)
def _sqlite_foreign_keys_match_runtime(mdb):
    if mdb.get_bind().dialect.name == "sqlite":
        mdb.connection().exec_driver_sql("PRAGMA foreign_keys=ON")


def _headers(seed, who="alice", key=None):
    return {"X-Withdrawal-Key": key or secrets.token_urlsafe(32), "X-Withdrawal-Account-ID": seed[who].user_id}


def _withdraw(seed, who="alice", key=None):
    return client(who).delete(f"{P}/auth/me", headers=_headers(seed, who, key))


def test_scheduler_bundle_notice_erases_only_withdrawn_recipient_name(mdb, mseed):
    from app.models import ReminderBundle
    from app.services import scheduler

    now = datetime.now(timezone.utc)
    mseed["bob"].display_name = mseed["alice"].display_name
    for task, who in zip(mseed["tasks"], ("alice", "bob")):
        task.assignee_member_id = mseed[who].member_id
        task.due_date = (now + timedelta(days=2)).date()
    mdb.commit()
    scheduler.suggest(mdb, now)
    mdb.commit()
    bundle_ids = {
        bundle.thread.member_id: bundle.bundle_id for bundle in mdb.scalars(select(ReminderBundle))
    }
    owned = mdb.scalar(select(Notification).where(Notification.link_id == bundle_ids[mseed["alice"].member_id]))
    other = mdb.scalar(select(Notification).where(Notification.link_id == bundle_ids[mseed["bob"].member_id]))
    assert owned.kind == other.kind == "nudge_suggested"
    assert "앨리스" in owned.text and "앨리스" in other.text
    owned_id, other_id, other_text = owned.notification_id, other.notification_id, other.text
    assert _withdraw(mseed).status_code == 202
    notes = client("pm").get(f"{P}/workspaces/{mseed['ws']}/notifications").json()["data"]["items"]
    by_id = {note["notification_id"]: note for note in notes}
    assert "앨리스" not in by_id[owned_id]["text"]
    assert by_id[other_id]["text"] == other_text


def test_scheduler_task_notice_erases_withdrawn_watch_recipient_name(mdb, mseed):
    from tests.api.test_scheduler import _silence_blocked

    task = _silence_blocked(mdb, mseed)
    note = mdb.scalar(select(Notification).where(Notification.kind == "silence_blocked"))
    assert note.link_type == "task" and note.link_id == task.task_id and "앨리스" in note.text
    note_id, title = note.notification_id, task.title
    assert _withdraw(mseed).status_code == 202
    mdb.expire_all()
    assert "앨리스" not in mdb.get(Notification, note_id).text
    assert mdb.get(Task, task.task_id).title == title


@pytest.mark.parametrize("picked", [False, True])
def test_reply_task_notice_keeps_other_same_named_author_on_same_task(mdb, mseed, picked):
    from tests.api.test_replies import _remind, _reply
    from tests.api.test_reply_judgment import _change, _claim, _judge
    from tests.api.test_scheduler import H, SLOT

    task = mseed["tasks"][0]
    task.status = "in_progress"
    _remind(mdb, mseed, [task], SLOT)
    _reply(mdb, mseed, SLOT + H, body="완료했어요")
    item = _claim()
    if picked:
        _judge(item, _change(None, "unknown"))
        response = client("pm").post(
            f"{P}/workspaces/{mseed['ws']}/messages/replies/{item['message_id']}/attribution",
            json={"task_id": task.task_id},
        )
        assert response.status_code == 200, response.text
        item = _claim()
    _judge(item, _change(task, "status", "done", evidence="certain", claimed=item))
    owned = mdb.scalar(select(Notification).where(Notification.link_type == "task"))
    assert "앨리스" in owned.text
    owned_id = owned.notification_id

    mseed["bob"].display_name, mseed["bob"].discord_user_id = "앨리스", "d_bob"
    task.status = "in_progress"
    _remind(mdb, mseed, [task], SLOT + 2 * H, who="bob")
    _reply(mdb, mseed, SLOT + 3 * H, who="bob", body="다른 사람도 완료했어요")
    other_item = _claim()
    _judge(other_item, _change(task, "status", "done", evidence="certain", claimed=other_item))
    other = mdb.scalar(select(Notification).where(Notification.dedupe_key.like(f"reply:{other_item['message_id']}:%")))
    assert other.link_type == "task" and other.link_id == task.task_id
    other_id, other_text = other.notification_id, other.text

    assert _withdraw(mseed).status_code == 202
    mdb.expire_all()
    assert "앨리스" not in mdb.get(Notification, owned_id).text
    assert mdb.get(Notification, other_id).text == other_text


@pytest.mark.parametrize("departing_role", ["assignee", "evidence"])
def test_approval_assignee_and_evidence_metadata_have_independent_owners(mdb, mseed, departing_role):
    alice, bob = mseed["alice"], mseed["bob"]
    bob.display_name, bob.discord_user_id = alice.display_name, "d_bob"
    assignee, evidence = (alice, bob) if departing_role == "assignee" else (bob, alice)
    alias = "개인 담당 별칭" if departing_role == "assignee" else "동명이인 담당 별칭"
    mdb.add(MemberAlias(workspace_id=mseed["ws"], member_id=assignee.member_id, alias_text=alias,
                        alias_type="nickname", source="manual", confidence=1, verified=True))
    meeting = Meeting(workspace_id=mseed["ws"], status="processing")
    mdb.add(meeting)
    mdb.commit()
    response = client(service=True).post(f"{P}/extractions", json={
        "workspace_id": mseed["ws"], "meeting_id": meeting.meeting_id,
        "items": [{"task_title": "공동 작업", "task_confidence": 0.6, "assignee_type": "thirdname",
                   "assignee_raw": alias, "evidence_speaker": evidence.discord_user_id,
                   "evidence_speaker_member_id": evidence.member_id}],
    })
    assert response.status_code == 201, response.text
    card = mdb.scalar(select(ApprovalRequest))
    before = json.loads(card.payload)
    assert before["assignee_member_id"] == assignee.member_id
    assert before["evidence_speaker_member_id"] == evidence.member_id
    assert _withdraw(mseed).status_code == 202
    mdb.refresh(card)
    after = json.loads(card.payload)
    if departing_role == "assignee":
        assert after["assignee_raw"] == "탈퇴한 사용자"
        assert after["evidence_speaker"] == before["evidence_speaker"]
    else:
        assert after["assignee_raw"] == before["assignee_raw"]
        assert after["evidence_speaker"] is None


def test_shared_withdrawal_erases_account_sessions_profile_and_preserves_records(mdb, mseed):
    member = mseed["alice"]
    uid, mid, wid = member.user_id, member.member_id, mseed["ws"]
    meeting = Meeting(workspace_id=wid, title="공동 회의", status="done")
    mdb.add(meeting)
    mdb.flush()
    source = Source(meeting_id=meeting.meeting_id, seq=0, speaker_discord_user_id="d_alice", speaker_name="앨리스", member_id=mid,
                    start_ms=0, end_ms=10, text="공동 기록 본문")
    thread = messages.get_or_create_thread(mdb, wid, mid)
    msg = messages.add_web_reply(mdb, thread, body="공동 답장", now=datetime.now(timezone.utc))
    mdb.add_all([source, PushSubscription(user_id=uid, endpoint="https://example.invalid/push", p256dh="key", auth="auth")])
    mdb.commit()
    headers = _headers(mseed)
    c = client("alice")
    response = c.delete(f"{P}/auth/me", headers=headers)
    assert response.status_code == 202, response.text
    receipt = response.json()["data"]
    assert receipt["cleanup_status"] == "pending"
    assert mdb.get(User, uid) is None
    assert mdb.scalars(select(LoginSession).where(LoginSession.user_id == uid)).all() == []
    assert mdb.scalars(select(PushSubscription).where(PushSubscription.user_id == uid)).all() == []
    mdb.refresh(member)
    mdb.refresh(source)
    assert member.display_name == source.speaker_name == "탈퇴한 사용자"
    assert member.discord_user_id is None and source.speaker_discord_user_id is None
    assert source.text == "공동 기록 본문"
    shown = client("pm").get(f"{P}/workspaces/{wid}/messages/threads/{thread.thread_id}")
    assert shown.status_code == 200
    assert shown.json()["data"]["messages"][0]["message_id"] == msg.message_id
    assert c.get(f"{P}/auth/me").status_code == 401
    retry = client().delete(f"{P}/auth/me", headers=headers)
    assert retry.status_code == 202 and retry.json()["data"] == receipt
    assert len(mdb.scalars(select(WithdrawalReceipt)).all()) == 1
    denied = client().get(f"{P}/auth/withdrawals/{receipt['withdrawal_id']}", headers={"X-Withdrawal-Key": secrets.token_urlsafe(32)})
    assert denied.status_code == 401


def test_last_pm_in_any_workspace_rejects_all_changes(mdb, mseed):
    before = mseed["alice"].user_id
    second = Workspace(name="이전이 필요한 공간")
    mdb.add(second)
    mdb.flush()
    mdb.add_all([
        Member(workspace_id=second.workspace_id, user_id=before, display_name="앨리스", role="pm"),
        Member(workspace_id=second.workspace_id, display_name="Discord 팀원", role="member", discord_user_id="only-discord"),
    ])
    mdb.commit()
    response = _withdraw(mseed)
    assert response.status_code == 409
    assert response.json()["error"]["details"]["workspace_ids"] == [second.workspace_id]
    assert client("alice").get(f"{P}/auth/me").status_code == 200
    assert mdb.get(User, before) is not None and mseed["alice"].withdrawn_at is None
    assert mdb.scalars(select(PrivacyCleanup)).all() == []


def test_account_switch_protection_and_old_receipt_do_not_log_out_new_user(mdb, mseed):
    headers = _headers(mseed)
    switched = client("bob").delete(f"{P}/auth/me", headers=headers)
    assert switched.status_code == 409 and switched.json()["error"]["code"] == "WITHDRAWAL_ACCOUNT_CHANGED"
    completed = client("alice").delete(f"{P}/auth/me", headers=headers)
    assert completed.status_code == 202
    bob = client("bob")
    retry = bob.delete(f"{P}/auth/me", headers=headers)
    assert retry.status_code == 202 and "set-cookie" not in retry.headers
    assert bob.get(f"{P}/auth/me").status_code == 200


def test_sole_workspace_is_unavailable_immediately_and_purged_after_both_workers(mdb, mseed, monkeypatch):
    sole = Workspace(name="개인 공간")
    mdb.add(sole)
    mdb.flush()
    mdb.add(Member(workspace_id=sole.workspace_id, user_id=mseed["alice"].user_id, display_name="앨리스", role="pm"))
    meeting = Meeting(workspace_id=sole.workspace_id, title="진행중 개인 회의", status="recording",
                      title_original="고치기 전 개인 회의", title_edited_at=datetime.now(timezone.utc))
    mdb.add(meeting)
    mdb.commit()
    wid, meeting_id = sole.workspace_id, meeting.meeting_id
    original = account_withdrawal.meeting_deletion.remove_backend_files
    monkeypatch.setattr(account_withdrawal.meeting_deletion, "remove_backend_files", lambda _id: (_ for _ in ()).throw(OSError("disk")))
    headers = _headers(mseed)
    response = client("alice").delete(f"{P}/auth/me", headers=headers)
    assert response.status_code == 202, response.text
    assert mdb.get(Workspace, wid).deleted_at is not None
    emptied = mdb.get(Meeting, meeting_id)
    assert (emptied.title, emptied.title_original, emptied.title_edited_at) == (None, None, None)
    service = client(service=True)
    assert service.post(f"{P}/meetings", json={"workspace_id": wid}).status_code == 404
    row = mdb.scalar(select(PrivacyCleanup).where(PrivacyCleanup.workspace_id == wid))
    assert row.backend_done_at is None and row.last_error_code == "BACKEND_STORAGE_DELETE_FAILED"
    monkeypatch.setattr(account_withdrawal.meeting_deletion, "remove_backend_files", original)
    account_withdrawal.purge_backend(mdb)
    while True:
        item = service.post(f"{P}/bot/privacy-cleanups/claim").json()["data"]["item"]
        if item is None:
            break
        ack = service.post(f"{P}/bot/privacy-cleanups/{item['cleanup_id']}/ack", json={"claim_token": item["claim_token"]})
        assert ack.status_code == 200, ack.text
    receipt = client().get(f"{P}/auth/withdrawals/{response.json()['data']['withdrawal_id']}", headers=headers)
    assert receipt.json()["data"]["cleanup_status"] == "complete"
    assert mdb.get(Workspace, wid) is None and mdb.get(Meeting, meeting_id) is None


def test_cleanup_lease_replacement_rejects_old_token_and_clears_shared_resource_selector(mdb, mseed):
    result = _withdraw(mseed)
    assert result.status_code == 202
    first = account_withdrawal.claim_cleanup(mdb)
    row = mdb.get(PrivacyCleanup, first["cleanup_id"])
    row.lease_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    mdb.commit()
    second = account_withdrawal.claim_cleanup(mdb)
    service = client(service=True)
    assert service.post(f"{P}/bot/privacy-cleanups/{row.cleanup_id}/ack", json={"claim_token": first["claim_token"]}).status_code == 409
    assert service.post(f"{P}/bot/privacy-cleanups/{row.cleanup_id}/ack", json={"claim_token": second["claim_token"]}).status_code == 200
    assert json.loads(row.selectors)["guild_ids"] == []


def test_same_email_signup_is_new_identity_without_old_membership_or_invitation(mdb, mseed, signup_secret):
    old_uid, old_mid = mseed["alice"].user_id, mseed["alice"].member_id
    other = Member(workspace_id=mseed["ws"], display_name="예전 초대", role="member")
    mdb.add(other)
    mdb.flush()
    invitation = Invitation(workspace_id=mseed["ws"], member_id=other.member_id, invited_user_id=old_uid, invited_by_user_id=mseed["pm"].user_id)
    mdb.add(invitation)
    mdb.commit()
    invitation_id = invitation.invitation_id
    assert _withdraw(mseed).status_code == 202
    fresh = client()
    response = signup_verified(fresh, "alice@example.com", name="새 앨리스")
    assert response.status_code == 201, response.text
    assert response.json()["data"]["user"]["user_id"] != old_uid
    assert response.json()["data"]["workspace_count"] == 0
    assert fresh.post(f"{P}/invitations/{invitation_id}/accept").status_code == 404
    assert mdb.get(Member, old_mid).user_id is None


def test_service_write_requires_new_roster_epoch_after_withdrawal(mdb, mseed):
    assert _withdraw(mseed).status_code == 202
    service = client(service=True)
    body = {"workspace_id": mseed["ws"], "source": "chat"}
    denied = service.post(f"{P}/meetings", json=body)
    assert denied.status_code == 409 and denied.json()["error"]["code"] == "PRIVACY_VERSION_CHANGED"
    service.headers["X-Privacy-Epoch"] = "1"
    created = service.post(f"{P}/meetings", json=body)
    assert created.status_code == 201, created.text
    meeting_id = created.json()["data"]["meeting_id"]
    stored = service.post(f"{P}/meetings/{meeting_id}/sources", json={"source": "chat", "speaker_names": {"d_alice": "앨리스"}, "segments": [
        {"seq": 0, "speaker": "d_alice", "start": 0, "end": 1, "text": "남길 본문"},
    ]})
    assert stored.status_code == 201, stored.text
    source = mdb.scalar(select(Source).where(Source.meeting_id == meeting_id))
    assert source.speaker_discord_user_id is None and source.speaker_name is None and source.text == "남길 본문"


def test_owned_structured_copies_are_scrubbed_without_touching_same_named_teammate(mdb, mseed):
    alice, bob, wid = mseed["alice"], mseed["bob"], mseed["ws"]
    bob.display_name, bob.discord_user_id = alice.display_name, "d_bob"
    meeting = Meeting(workspace_id=wid, title="공동 회의", status="done")
    mdb.add(meeting)
    mdb.flush()
    extraction = Extraction(meeting_id=meeting.meeting_id)
    mdb.add(extraction)
    mdb.flush()
    item = ExtractionItem(extraction_id=extraction.extraction_id, task_title="보존", assignee_member_id=alice.member_id, assignee_raw=alice.display_name)
    upload = MeetingUpload(meeting_id=meeting.meeting_id, uploaded_by_member_id=alice.member_id,
                           stored_filename="random.wav", original_filename="개인 이름.wav", size_bytes=1,
                           attendees=json.dumps([{"member_id": alice.member_id, "display_name": alice.display_name}, {"member_id": bob.member_id, "display_name": bob.display_name}]),
                           speaker_mapping=json.dumps({"A": alice.member_id, "B": bob.member_id}))
    card = ApprovalRequest(workspace_id=wid, type="task_create", payload=json.dumps({
        "assignee_member_id": alice.member_id, "assignee_raw": alice.display_name,
        "evidence_speaker": "d_alice", "evidence_speaker_member_id": alice.member_id,
        "merged_items": [{"assignee_member_id": bob.member_id, "assignee_raw": bob.display_name}],
    }))
    log = AliasResolutionLog(workspace_id=wid, alias_text="개인 별칭", result="ambiguous")
    mdb.add_all([item, upload, card, log])
    mdb.flush()
    mdb.add(AliasReview(log_id=log.log_id, decision="correct", corrected_member_id=alice.member_id, reviewed_by=mseed["pm"].member_id))
    alice.role = "pm"
    thread = messages.get_or_create_thread(mdb, wid, bob.member_id)
    message = messages.add_pm_message(mdb, thread, author=alice, body="공동 메시지 본문", now=datetime.now(timezone.utc))
    mdb.commit()
    log_id = log.log_id
    assert mdb.scalar(select(Notification.notification_id).where(Notification.text.like("%앨리스%"))) is not None
    assert _withdraw(mseed).status_code == 202
    mdb.refresh(bob)
    mdb.refresh(upload)
    mdb.refresh(card)
    mdb.refresh(item)
    assert bob.display_name == "앨리스" and bob.discord_user_id == "d_bob"
    attendees = json.loads(upload.attendees)
    assert attendees[0]["display_name"] == "탈퇴한 사용자" and attendees[1]["display_name"] == "앨리스"
    assert json.loads(upload.speaker_mapping) == {"A": None, "B": bob.member_id}
    assert upload.original_filename is None and item.assignee_raw is None
    payload = json.loads(card.payload)
    assert payload["assignee_raw"] == "탈퇴한 사용자" and payload["evidence_speaker"] is None
    assert payload["merged_items"][0]["assignee_raw"] == "앨리스"
    assert mdb.scalar(select(AliasResolutionLog.log_id).where(AliasResolutionLog.log_id == log_id)) is None
    assert mdb.scalar(select(Notification.notification_id).where(Notification.text.like("%앨리스%"))) is None
    assert mdb.get(type(message), message.message_id).body == "공동 메시지 본문"


def test_sole_workspace_removes_task_approval_alias_review_and_message_children(mdb, mseed):
    workspace = Workspace(name="단독 기록 공간")
    mdb.add(workspace)
    mdb.flush()
    member = Member(workspace_id=workspace.workspace_id, user_id=mseed["alice"].user_id, display_name="단독 PM", role="pm")
    mdb.add(member)
    mdb.flush()
    task = Task(workspace_id=workspace.workspace_id, title="삭제할 태스크", assignee_member_id=member.member_id)
    log = AliasResolutionLog(workspace_id=workspace.workspace_id, alias_text="단독 별칭", result="resolved", resolved_member_id=member.member_id)
    mdb.add_all([task, log])
    mdb.flush()
    mdb.add_all([
        ApprovalRequest(workspace_id=workspace.workspace_id, type="task_create", payload="{}", requested_by=member.member_id),
        AliasReview(log_id=log.log_id, decision="correct", reviewed_by=member.member_id),
    ])
    thread = messages.get_or_create_thread(mdb, workspace.workspace_id, member.member_id)
    messages.add_web_reply(mdb, thread, body="단독 대화", now=datetime.now(timezone.utc))
    mdb.commit()
    tid, mid, wid = task.task_id, member.member_id, workspace.workspace_id
    result = _withdraw(mseed)
    assert result.status_code == 202, result.text
    assert mdb.scalar(select(Task.task_id).where(Task.task_id == tid)) is None
    assert mdb.scalar(select(Member.member_id).where(Member.member_id == mid)) is None
    assert mdb.scalars(select(ApprovalRequest).where(ApprovalRequest.workspace_id == wid)).all() == []


def test_push_snapshot_revoked_before_delivery_does_not_send_or_restore_notification(mdb, mseed, monkeypatch):
    uid = mseed["alice"].user_id
    notification = Notification(workspace_id=mseed["ws"], member_id=mseed["alice"].member_id,
                                kind="test", text="개인 알림 사본", link_type="thread", link_id="test")
    mdb.add_all([notification, PushSubscription(user_id=uid, endpoint="https://example.invalid/push", p256dh="key", auth="auth")])
    mdb.commit()
    notification_id = notification.notification_id
    original = notifications._claim_pushes

    def claim_then_withdraw(db, now, can_send):
        snapshot = original(db, now, can_send)
        db.commit()
        account_withdrawal.withdraw(db, uid, secrets.token_urlsafe(32))
        return snapshot

    monkeypatch.setattr(notifications, "_claim_pushes", claim_then_withdraw)
    sent = []
    notifications.send_pending_pushes(mdb, now=datetime.now(timezone.utc), send=lambda sub, body: sent.append(body))
    assert sent == []
    assert mdb.scalar(select(Notification.notification_id).where(Notification.notification_id == notification_id)) is None
