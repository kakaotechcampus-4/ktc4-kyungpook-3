from concurrent.futures import ThreadPoolExecutor
from threading import Event
import secrets
import hashlib
import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import Invitation, Meeting, Member, PrivacyCleanup, User, WithdrawalReceipt, Workspace
from app.services import account_withdrawal, lifecycle


def _pg(mdb):
    if mdb.get_bind().dialect.name != "postgresql":
        pytest.skip("실제 PostgreSQL 행·advisory 잠금 검증")
    mdb.commit()
    return mdb.get_bind()


def _timeout(db):
    db.execute(text("SET LOCAL lock_timeout = '3s'"))


def test_promotion_commits_before_withdrawal_checks_last_pm(mdb, mseed):
    engine = _pg(mdb)
    pm_uid, alice_mid, wid = mseed["pm"].user_id, mseed["alice"].member_id, mseed["ws"]
    mdb.commit()
    held, release, attempted = Event(), Event(), Event()

    def promote():
        with Session(engine) as db:
            _timeout(db)
            lifecycle.user(db, pm_uid)
            lifecycle.workspace(db, wid)
            db.get(Member, alice_mid).role = "pm"
            db.flush()
            held.set()
            assert release.wait(3)
            db.commit()

    def withdraw():
        assert held.wait(3)
        with Session(engine) as db:
            _timeout(db)
            attempted.set()
            return account_withdrawal.withdraw(db, pm_uid, secrets.token_urlsafe(32))

    with ThreadPoolExecutor(2) as pool:
        promotion = pool.submit(promote)
        withdrawal = pool.submit(withdraw)
        assert attempted.wait(3)
        release.set()
        promotion.result(5)
        assert withdrawal.result(5).cleanup_status == "pending"
    mdb.expire_all()
    assert mdb.get(User, pm_uid) is None
    assert mdb.get(Member, alice_mid).role == "pm"


def test_two_pms_withdrawing_cannot_leave_shared_workspace_without_pm(mdb, mseed):
    mseed["alice"].role = "pm"
    mdb.commit()
    engine = _pg(mdb)
    ids = [mseed["pm"].user_id, mseed["alice"].user_id]
    wid = mseed["ws"]
    mdb.commit()

    def withdraw(uid):
        with Session(engine) as db:
            _timeout(db)
            try:
                return account_withdrawal.withdraw(db, uid, secrets.token_urlsafe(32)).cleanup_status
            except AppError as exc:
                db.rollback()
                return exc.code.value

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(withdraw, ids))
    assert sorted(results) == ["LAST_PM_REQUIRED", "pending"]
    mdb.expire_all()
    pms = mdb.scalars(select(Member).where(Member.workspace_id == wid, Member.is_deleted.is_(False), Member.role == "pm")).all()
    assert len(pms) == 1 and pms[0].user_id is not None


def test_unrelated_workspace_invitation_cannot_escape_email_cleanup(mdb, mseed):
    other = Workspace(name="다른 팀")
    mdb.add(other)
    mdb.flush()
    member = Member(workspace_id=other.workspace_id, display_name="초대 대상", role="member")
    mdb.add(member)
    mdb.commit()
    engine = _pg(mdb)
    inviter_uid, uid = mseed["pm"].user_id, mseed["alice"].user_id
    wid, mid = other.workspace_id, member.member_id
    mdb.commit()
    held, release, attempted = Event(), Event(), Event()

    def create_invite():
        with Session(engine) as db:
            _timeout(db)
            lifecycle.user(db, inviter_uid)
            lifecycle.identity_lock(db, "alice@example.com")
            lifecycle.workspace(db, wid)
            db.add(Invitation(workspace_id=wid, member_id=mid, email="alice@example.com", invited_by_user_id=inviter_uid))
            db.flush()
            held.set()
            assert release.wait(3)
            db.commit()

    def withdraw():
        assert held.wait(3)
        with Session(engine) as db:
            _timeout(db)
            attempted.set()
            return account_withdrawal.withdraw(db, uid, secrets.token_urlsafe(32))

    with ThreadPoolExecutor(2) as pool:
        invitation = pool.submit(create_invite)
        withdrawal = pool.submit(withdraw)
        assert attempted.wait(3)
        release.set()
        invitation.result(5)
        withdrawal.result(5)
    assert mdb.scalars(select(Invitation).where(Invitation.email == "alice@example.com")).all() == []


def test_crossed_backend_and_ai_completion_cannot_leave_a_deleted_workspace(mdb, monkeypatch):
    engine = _pg(mdb)
    now = datetime.now(timezone.utc)
    workspace = Workspace(name="삭제된 워크스페이스", deleted_at=now)
    receipt = WithdrawalReceipt(proof_hash=hashlib.sha256(secrets.token_bytes(32)).hexdigest(), account_deleted_at=now)
    mdb.add_all([workspace, receipt])
    mdb.flush()
    meeting = Meeting(workspace_id=workspace.workspace_id, title=None, deleted_at=now)
    mdb.add(meeting)
    mdb.flush()
    cleanup = PrivacyCleanup(withdrawal_id=receipt.withdrawal_id, workspace_id=workspace.workspace_id, identity_epoch=1,
                             delete_workspace=True, selectors=json.dumps({"meeting_ids": [meeting.meeting_id], "member_ids": [], "guild_ids": []}))
    mdb.add(cleanup)
    mdb.commit()
    claim = account_withdrawal.claim_cleanup(mdb)
    wid = workspace.workspace_id
    mdb.commit()
    entered, release, ack_started = Event(), Event(), Event()

    def remove_files(_meeting_id):
        entered.set()
        assert release.wait(3)

    monkeypatch.setattr(account_withdrawal.meeting_deletion, "remove_backend_files", remove_files)

    def backend():
        with Session(engine) as db:
            _timeout(db)
            account_withdrawal.purge_backend(db)

    def ai():
        assert entered.wait(3)
        with Session(engine) as db:
            _timeout(db)
            ack_started.set()
            return account_withdrawal.ack_cleanup(db, claim["cleanup_id"], claim["claim_token"])

    with ThreadPoolExecutor(2) as pool:
        backend_job = pool.submit(backend)
        ai_job = pool.submit(ai)
        assert ack_started.wait(3)
        release.set()
        backend_job.result(5)
        assert ai_job.result(5)["complete"] is True
    mdb.expire_all()
    assert mdb.get(Workspace, wid) is None
