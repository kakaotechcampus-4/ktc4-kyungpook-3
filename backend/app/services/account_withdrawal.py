"""계정 탈퇴에 앞서 모든 활성 소속의 PM 이전·단독 공간 조건을 보여 준다.

계획은 권한 승인이나 예약이 아니다. 실제 탈퇴 transaction은 같은 조건을 잠금 안에서 다시 확인해야 한다.
"""

from dataclasses import dataclass
from enum import StrEnum
import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.core.database import Base
from app.core.errors import AppError, ErrorCode
from app.models import (
    AliasResolutionLog, AliasReview, ApprovalRequest, BotDmPart, Extraction, ExtractionItem,
    Integration, Invitation, Meeting, MeetingAudio, MeetingUpload, Member, MemberRole,
    MessageThread, Notification, PrivacyCleanup, Reminder, ReminderBundle,
    ReminderStatus, ReminderWatch, ReplyJudgment, ReplyJudgmentState,
    SignupEmailCode, Source, ThreadMessage, User, WatchState,
    WithdrawalReceipt, Workspace,
)
from app.schemas.withdrawal import WithdrawalResponse
from app.services import lifecycle, login_limit, meeting_deletion


class WorkspaceDisposition(StrEnum):
    PRESERVE = "preserve"
    DELETE = "delete"
    TRANSFER_PM = "transfer_pm"


@dataclass(frozen=True)
class WorkspaceWithdrawal:
    workspace_id: str
    workspace_name: str
    disposition: WorkspaceDisposition


@dataclass(frozen=True)
class WithdrawalPlan:
    workspaces: tuple[WorkspaceWithdrawal, ...]

    @property
    def blocked_workspace_ids(self) -> tuple[str, ...]:
        return tuple(
            item.workspace_id
            for item in self.workspaces
            if item.disposition == WorkspaceDisposition.TRANSFER_PM
        )


def plan(db: Session, user_id: str) -> WithdrawalPlan:
    if db.get(User, user_id) is None:
        raise AppError(ErrorCode.UNAUTHENTICATED)
    memberships = db.execute(
        select(Member, Workspace.name)
        .join(Workspace, Workspace.workspace_id == Member.workspace_id)
        .where(Member.user_id == user_id, Member.is_deleted.is_(False))
        .order_by(Member.workspace_id)
    ).all()
    if not memberships:
        return WithdrawalPlan(workspaces=())
    by_workspace: dict[str, list[Member]] = {}
    for member in db.scalars(
        select(Member).where(
            Member.workspace_id.in_([member.workspace_id for member, _ in memberships]),
            Member.is_deleted.is_(False),
        )
    ):
        by_workspace.setdefault(member.workspace_id, []).append(member)

    workspaces = []
    for member, name in memberships:
        active = by_workspace[member.workspace_id]
        if len(active) == 1:
            disposition = WorkspaceDisposition.DELETE
        elif member.role == MemberRole.PM and not any(
            other.member_id != member.member_id and other.role == MemberRole.PM and other.has_login_account
            for other in active
        ):
            disposition = WorkspaceDisposition.TRANSFER_PM
        else:
            disposition = WorkspaceDisposition.PRESERVE
        workspaces.append(WorkspaceWithdrawal(member.workspace_id, name, disposition))
    return WithdrawalPlan(workspaces=tuple(workspaces))


def proof_hash(proof: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9_-]{32,128}", proof) is None:
        raise AppError(ErrorCode.INVALID_REQUEST, message="탈퇴 재시도 키가 올바르지 않습니다.")
    return hashlib.sha256(proof.encode()).hexdigest()


def find_receipt(db: Session, proof: str, withdrawal_id: str | None = None) -> WithdrawalResponse | None:
    row = db.scalar(select(WithdrawalReceipt).where(WithdrawalReceipt.proof_hash == proof_hash(proof)))
    if row is None or withdrawal_id is not None and row.withdrawal_id != withdrawal_id:
        return None
    pending = db.scalar(select(PrivacyCleanup.cleanup_id).where(
        PrivacyCleanup.withdrawal_id == row.withdrawal_id,
        or_(PrivacyCleanup.backend_done_at.is_(None), PrivacyCleanup.ai_done_at.is_(None)),
    ).limit(1))
    at = row.account_deleted_at
    return WithdrawalResponse(
        withdrawal_id=row.withdrawal_id,
        account_deleted_at=at.replace(tzinfo=timezone.utc) if at.tzinfo is None else at,
        cleanup_status="pending" if pending else "complete",
    )


_JSON_IDENTITY_OWNERS = {
    "discord_user_id": ("member_id", "speaker_member_id"),
    "speaker_discord_user_id": ("speaker_member_id", "member_id"),
    "evidence_speaker": ("evidence_speaker_member_id",),
    "notion_name": ("member_id", "speaker_member_id"),
}
_JSON_NAME_OWNERS = {
    "display_name": ("member_id", "speaker_member_id"),
    "name": ("member_id", "speaker_member_id"),
    "speaker_name": ("speaker_member_id", "member_id"),
    "assignee_raw": ("assignee_member_id",),
    "aliases": ("member_id", "speaker_member_id"),
}


def _scrub_json(value, member_ids: set[str], discord_ids: set[str]):
    if isinstance(value, list):
        return [_scrub_json(item, member_ids, discord_ids) for item in value]
    if not isinstance(value, dict):
        return value
    cleaned = {}
    for key, item in value.items():
        owner_keys = _JSON_IDENTITY_OWNERS.get(key, _JSON_NAME_OWNERS.get(key, ()))
        owner = next((value[owner_key] for owner_key in owner_keys if value.get(owner_key) is not None), None)
        if key in _JSON_IDENTITY_OWNERS and (owner in member_ids or (
            owner is None and key != "notion_name" and isinstance(item, str) and item in discord_ids
        )):
            cleaned[key] = None
        elif key in _JSON_NAME_OWNERS and owner in member_ids and key != "aliases":
            cleaned[key] = "탈퇴한 사용자" if item is not None else None
        elif key == "aliases" and owner in member_ids:
            cleaned[key] = []
        else:
            cleaned[key] = _scrub_json(item, member_ids, discord_ids)
    return cleaned


def _scrub_shared(db: Session, workspace_id: str, members: list[Member], now: datetime) -> None:
    member_ids = {row.member_id for row in members}
    discord_ids = {row.discord_user_id for row in members if row.discord_user_id}
    meeting_ids = select(Meeting.meeting_id).where(Meeting.workspace_id == workspace_id)
    sources = db.scalars(select(Source).where(Source.meeting_id.in_(meeting_ids), or_(
        Source.member_id.in_(member_ids), (Source.member_id.is_(None) & Source.speaker_discord_user_id.in_(discord_ids)),
    ))).all()
    for source in sources:
        source.speaker_discord_user_id = None
        source.speaker_name = "탈퇴한 사용자"
    logs = db.scalars(select(AliasResolutionLog.log_id).where(
        AliasResolutionLog.workspace_id == workspace_id,
        or_(AliasResolutionLog.resolved_member_id.in_(member_ids), AliasResolutionLog.log_id.in_(
            select(AliasReview.log_id).where(AliasReview.corrected_member_id.in_(member_ids))
        )),
    )).all()
    db.execute(delete(AliasReview).where(AliasReview.log_id.in_(logs)))
    db.execute(delete(AliasResolutionLog).where(AliasResolutionLog.log_id.in_(logs)))
    item_ids = select(ExtractionItem.item_id).join(
        Extraction, Extraction.extraction_id == ExtractionItem.extraction_id,
    ).where(Extraction.meeting_id.in_(meeting_ids))
    db.execute(update(ExtractionItem).where(ExtractionItem.item_id.in_(item_ids), ExtractionItem.assignee_member_id.in_(member_ids)).values(assignee_raw=None))
    for upload in db.scalars(select(MeetingUpload).where(MeetingUpload.meeting_id.in_(meeting_ids))):
        if upload.uploaded_by_member_id in member_ids:
            upload.original_filename = None
        for field in ("attendees", "speaker_mapping", "speakers"):
            raw = getattr(upload, field)
            if raw:
                cleaned = _scrub_json(json.loads(raw), member_ids, discord_ids)
                if field == "speaker_mapping":
                    cleaned = {label: None if mid in member_ids else mid for label, mid in cleaned.items()}
                setattr(upload, field, json.dumps(cleaned, ensure_ascii=False))
    for card in db.scalars(select(ApprovalRequest).where(ApprovalRequest.workspace_id == workspace_id)):
        card.payload = json.dumps(_scrub_json(json.loads(card.payload), member_ids, discord_ids), ensure_ascii=False)
    thread_ids = list(db.scalars(select(MessageThread.thread_id).where(
        MessageThread.workspace_id == workspace_id, MessageThread.member_id.in_(member_ids),
    )))
    message_ids = select(ThreadMessage.message_id).where(or_(
        ThreadMessage.thread_id.in_(thread_ids), ThreadMessage.author_member_id.in_(member_ids),
    ))
    authored_threads = list(db.scalars(select(ThreadMessage.thread_id).where(ThreadMessage.author_member_id.in_(member_ids)).distinct()))
    affected_thread_ids = sorted(set(thread_ids) | set(authored_threads))
    db.execute(delete(BotDmPart).where(BotDmPart.message_id.in_(message_ids)))
    db.execute(update(ThreadMessage).where(ThreadMessage.message_id.in_(message_ids)).values(discord_message_id=None))
    db.execute(update(ThreadMessage).where(
        ThreadMessage.thread_id.in_(thread_ids), ThreadMessage.dm_status.in_(("pending", "claimed")),
    ).values(dm_status="failed", dm_failure_reason="discord_not_linked", claimed_at=None))
    db.execute(update(ReplyJudgment).where(ReplyJudgment.thread_id.in_(thread_ids), ReplyJudgment.state == "pending").values(
        state=str(ReplyJudgmentState.FAILED), claimed_at=None, finished_at=now, failure_reason="ACCOUNT_WITHDRAWN",
    ))
    db.execute(update(ReminderWatch).where(ReminderWatch.thread_id.in_(thread_ids)).values(state=str(WatchState.STOPPED), closed_at=now, paused_at=None))
    db.execute(delete(Notification).where(Notification.member_id.in_(member_ids)))
    # 생성된 알림의 수신자 이름은 thread 외에도 bundle·task 링크로 복사된다.
    bundle_ids = select(ReminderBundle.bundle_id).where(
        ReminderBundle.workspace_id == workspace_id, ReminderBundle.thread_id.in_(thread_ids),
    )
    notification_links = {
        "thread": (affected_thread_ids, "대화 기록이 업데이트되었습니다."),
        "bundle": (bundle_ids, "재촉 알림이 업데이트되었습니다."),
    }
    for link_type, (link_ids, text) in notification_links.items():
        db.execute(update(Notification).where(
            Notification.workspace_id == workspace_id, Notification.link_type == link_type,
            Notification.link_id.in_(link_ids),
        ).values(text=text))
    watch_keys = select("silence:" + ReminderWatch.watch_id + ":" + Notification.member_id).where(
        ReminderWatch.thread_id.in_(thread_ids),
    ).correlate(Notification)
    reply_keys = select("reply:" + ReplyJudgment.message_id + ":" + Notification.member_id).where(
        ReplyJudgment.thread_id.in_(thread_ids),
    ).correlate(Notification).union(
        select("reply:" + ReplyJudgment.message_id + ":picked:" + Notification.member_id).where(
            ReplyJudgment.thread_id.in_(thread_ids),
        ).correlate(Notification),
    )
    db.execute(update(Notification).where(
        Notification.workspace_id == workspace_id, Notification.link_type == "task",
        or_(Notification.dedupe_key.in_(watch_keys), Notification.dedupe_key.in_(reply_keys)),
    ).values(text="업무 알림이 업데이트되었습니다."))
    for member in members:
        member.erase_profile(now)
    db.flush()
    bundles = db.scalars(select(ReminderBundle).where(ReminderBundle.workspace_id == workspace_id, or_(
        ReminderBundle.thread_id.in_(thread_ids), ReminderBundle.bundle_id.in_(
            select(Reminder.bundle_id).where(Reminder.created_by.in_(member_ids))
        ),
    ))).all()
    for bundle in bundles:
        if bundle.body_source != "pm":
            from app.services.messages import framed_body, rule_middle, bundle_reminders
            reminders = bundle_reminders(db, bundle.bundle_id, bundle.status)
            bundle.body = framed_body(db, bundle, reminders, rule_middle(reminders)) if reminders else "탈퇴한 사용자 관련 알림"
            bundle.body_source = "rule"
        bundle.draft_version += 1
        bundle.draft_claimed_at = None
        if bundle.thread_id in thread_ids and bundle.status == ReminderStatus.SCHEDULED:
            bundle.status = str(ReminderStatus.CANCELLED)
            db.execute(update(Reminder).where(Reminder.bundle_id == bundle.bundle_id, Reminder.status == "scheduled").values(status="cancelled", cancelled_at=now))


def _empty_workspace(db: Session, workspace: Workspace, now: datetime) -> None:
    workspace.deleted_at = now
    workspace.name = "삭제된 워크스페이스"
    workspace.onboarding_completed = False
    meetings = db.scalars(select(Meeting).where(Meeting.workspace_id == workspace.workspace_id)).all()
    for meeting in meetings:
        meeting.deleted_at = now
        meeting.title = None
        meeting.failed_stage = None
        meeting.processing_stage = None
        meeting.processing_stage_at = None
        meeting.processing_stt_done = None
        meeting.processing_stt_total = None
        meeting.duration_ms = None
        meeting.status = "failed"
    db.flush()
    # 기록이 참조하는 Member는 업무 행·검토 행을 지운 다음 제거한다.
    log_ids = select(AliasResolutionLog.log_id).where(AliasResolutionLog.workspace_id == workspace.workspace_id)
    db.execute(delete(AliasReview).where(AliasReview.log_id.in_(log_ids)))
    for table in reversed(Base.metadata.sorted_tables):
        if "workspace_id" in table.c and table.name not in ("workspace", "meeting", "privacy_cleanup"):
            db.execute(delete(table).where(table.c.workspace_id == workspace.workspace_id))
    db.execute(delete(MeetingUpload).where(MeetingUpload.meeting_id.in_([m.meeting_id for m in meetings])))
    db.execute(delete(MeetingAudio).where(MeetingAudio.meeting_id.in_([m.meeting_id for m in meetings])))
    db.execute(delete(Source).where(Source.meeting_id.in_([m.meeting_id for m in meetings])))
    db.execute(delete(Extraction).where(Extraction.meeting_id.in_([m.meeting_id for m in meetings])))


def withdraw(db: Session, user_id: str, proof: str) -> WithdrawalResponse:
    prior = find_receipt(db, proof)
    if prior is not None:
        return prior
    user = db.scalar(select(User).where(User.user_id == user_id).with_for_update().execution_options(populate_existing=True))
    if user is None:
        prior = find_receipt(db, proof)
        if prior is not None:
            return prior
        raise AppError(ErrorCode.UNAUTHENTICATED)
    email = user.email
    for identity in lifecycle.user_identities(user):
        lifecycle.identity_lock(db, identity)
    lifecycle.worker_gate(db)
    historical = select(Invitation.member_id).where(Invitation.accepted_user_id == user_id)
    owned = db.scalars(select(Member).where(or_(
        Member.user_id == user_id,
        Member.user_id.is_(None) & Member.member_id.in_(historical),
    )).order_by(Member.workspace_id, Member.member_id)).all()
    owned_member_ids = [member.member_id for member in owned]
    workspace_ids = sorted({member.workspace_id for member in owned})
    spaces = {wid: lifecycle.workspace(db, wid, check_epoch=False) for wid in workspace_ids}
    # 다른 계정의 PM 변경·초대 수락은 같은 공간 잠금을 먼저 얻는다.
    for wid in workspace_ids:
        db.scalars(select(Member).where(Member.workspace_id == wid).order_by(Member.member_id).with_for_update().execution_options(populate_existing=True)).all()
    decision = plan(db, user_id)
    if decision.blocked_workspace_ids:
        raise AppError(ErrorCode.LAST_PM_REQUIRED, details={"workspace_ids": list(decision.blocked_workspace_ids)})
    actions = {item.workspace_id: item.disposition for item in decision.workspaces}
    now = datetime.now(timezone.utc)
    receipt = WithdrawalReceipt(proof_hash=proof_hash(proof), account_deleted_at=now)
    db.add(receipt)
    db.flush()
    for wid in workspace_ids:
        space = spaces[wid]
        space.identity_epoch += 1
        members = [member for member in owned if member.workspace_id == wid]
        sole = actions.get(wid) == WorkspaceDisposition.DELETE
        meeting_ids = sorted(db.scalars(select(Meeting.meeting_id).where(Meeting.workspace_id == wid)))
        guild_ids = list(db.scalars(select(Integration.provider_channel_id).where(
            Integration.workspace_id == wid, Integration.provider == "discord", Integration.provider_channel_id.is_not(None),
        )))
        member_ids = [member.member_id for member in members]
        message_ids = list(db.scalars(select(ThreadMessage.message_id).join(
            MessageThread, MessageThread.thread_id == ThreadMessage.thread_id,
        ).where(MessageThread.member_id.in_(member_ids))))
        db.add(PrivacyCleanup(
            withdrawal_id=receipt.withdrawal_id, workspace_id=wid, identity_epoch=space.identity_epoch,
            delete_workspace=sole, selectors=json.dumps({"member_ids": member_ids, "meeting_ids": meeting_ids, "message_ids": message_ids, "guild_ids": guild_ids}),
            backend_done_at=None if sole else now,
        ))
        if sole:
            _empty_workspace(db, space, now)
        else:
            _scrub_shared(db, wid, members, now)
    db.execute(delete(Invitation).where(or_(
        Invitation.invited_user_id == user_id, Invitation.member_id.in_(owned_member_ids), Invitation.accepted_user_id == user_id,
    )))
    # 카카오만으로 가입한 계정은 이메일이 없어 이메일로 찾을 인증 코드·로그인 제한이 없다(#610).
    if email:
        db.execute(delete(SignupEmailCode).where(SignupEmailCode.email == email))
    db.execute(delete(User).where(User.user_id == user_id))
    db.commit()
    from app.services import thread_signals
    thread_signals.revoke(owned_member_ids)
    if email:
        login_limit.clear_email(email)
    purge_backend(db, withdrawal_id=receipt.withdrawal_id)
    return find_receipt(db, proof)


def _finalize_workspace(db: Session, row: PrivacyCleanup) -> None:
    if row.delete_workspace and row.backend_done_at and row.ai_done_at:
        db.execute(update(Meeting).where(Meeting.workspace_id == row.workspace_id).values(recording_root_id=None, replaces_meeting_id=None))
        db.execute(delete(Workspace).where(Workspace.workspace_id == row.workspace_id, Workspace.deleted_at.is_not(None)))


def purge_backend(db: Session, *, withdrawal_id: str | None = None) -> None:
    stmt = select(PrivacyCleanup.cleanup_id).where(PrivacyCleanup.backend_done_at.is_(None))
    if withdrawal_id:
        stmt = stmt.where(PrivacyCleanup.withdrawal_id == withdrawal_id)
    for cleanup_id in db.scalars(stmt.limit(100)).all():
        row = db.scalar(select(PrivacyCleanup).where(
            PrivacyCleanup.cleanup_id == cleanup_id, PrivacyCleanup.backend_done_at.is_(None),
        ).with_for_update(skip_locked=True).execution_options(populate_existing=True))
        if row is None:
            continue
        try:
            for meeting_id in json.loads(row.selectors)["meeting_ids"]:
                meeting_deletion.remove_backend_files(meeting_id)
        except (OSError, ValueError):
            row.last_error_code = "BACKEND_STORAGE_DELETE_FAILED"
        else:
            row.backend_done_at = datetime.now(timezone.utc)
            row.last_error_code = None
            _finalize_workspace(db, row)
        db.commit()


def claim_cleanup(db: Session) -> dict | None:
    now = datetime.now(timezone.utc)
    available = or_(PrivacyCleanup.lease_until.is_(None), PrivacyCleanup.lease_until <= now)
    for cleanup_id in db.scalars(select(PrivacyCleanup.cleanup_id).where(PrivacyCleanup.ai_done_at.is_(None), available).order_by(PrivacyCleanup.cleanup_id).limit(20)).all():
        token = secrets.token_urlsafe(32)
        until = now + timedelta(seconds=120)
        won = db.execute(update(PrivacyCleanup).where(PrivacyCleanup.cleanup_id == cleanup_id, PrivacyCleanup.ai_done_at.is_(None), available).values(
            claim_token_hash=hashlib.sha256(token.encode()).hexdigest(), lease_until=until, attempts=PrivacyCleanup.attempts + 1,
        ).execution_options(synchronize_session=False))
        db.commit()
        if won.rowcount:
            row = db.get(PrivacyCleanup, cleanup_id)
            return {"cleanup_id": row.cleanup_id, "workspace_id": row.workspace_id, "identity_epoch": row.identity_epoch,
                    "delete_workspace": row.delete_workspace, **json.loads(row.selectors), "claim_token": token, "lease_until": until}
    return None


def ack_cleanup(db: Session, cleanup_id: str, token: str) -> dict:
    row = db.scalar(select(PrivacyCleanup).where(PrivacyCleanup.cleanup_id == cleanup_id).with_for_update().execution_options(populate_existing=True))
    digest = hashlib.sha256(token.encode()).hexdigest()
    if row is None or not row.claim_token_hash or not hmac.compare_digest(row.claim_token_hash, digest):
        raise AppError(ErrorCode.PURGE_CLAIM_EXPIRED)
    if row.ai_done_at is None:
        now = datetime.now(timezone.utc)
        until = row.lease_until
        if until is None or (until.replace(tzinfo=timezone.utc) if until.tzinfo is None else until) <= now:
            raise AppError(ErrorCode.PURGE_CLAIM_EXPIRED)
        row.ai_done_at = now
        row.last_error_code = None
        # 공간 공유 리소스 selector도 AI 정리가 확인된 뒤에는 영수증에 남기지 않는다.
        selectors = json.loads(row.selectors)
        selectors["guild_ids"] = []
        row.selectors = json.dumps(selectors)
        _finalize_workspace(db, row)
        db.commit()
    return {"cleanup_id": cleanup_id, "complete": bool(row.backend_done_at and row.ai_done_at)}
