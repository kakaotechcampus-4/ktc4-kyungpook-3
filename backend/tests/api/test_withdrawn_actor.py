"""영구 계정 탈퇴의 익명 작성자와 기존 명단 이탈자를 구별한다. 탈퇴 API 자체의 완료 검증은 아니다."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.models import BotDmPart, Member, MemberAlias, ReplyChange, ReplyJudgment, ThreadMessage, Workspace
from app.services import account_withdrawal, messages, replies
from app.services.account_withdrawal import WorkspaceDisposition
from tests.api.test_messages_api import P, _claim, _create, _future, client
from tests.api.test_replies import _remind, _reply
from tests.api.test_scheduler import H, SLOT


def _erase(db, member):
    member.erase_profile(datetime.now(timezone.utc))
    db.commit()


def _base(seed):
    return f"{P}/workspaces/{seed['ws']}/messages"


def test_erased_actor_preserves_thread_body_author_and_pm_read_position(mdb, mseed):
    thread = messages.get_or_create_thread(mdb, mseed["ws"], mseed["alice"].member_id)
    at = datetime.now(timezone.utc) + timedelta(seconds=1)
    message = messages.add_web_reply(mdb, thread, body="공동 기록으로 남길 답장", now=at)
    mdb.commit()
    message_id, thread_id = message.message_id, thread.thread_id
    _erase(mdb, mseed["alice"])

    pm = client("pm")
    inbox = pm.get(_base(mseed)).json()["data"]
    (row,) = inbox["threads"]
    assert row["thread_id"] == thread_id and row["name"] == "탈퇴한 사용자"
    assert row["web_reply_available"] is False and row["unread_count"] == 1
    detail = pm.get(f"{_base(mseed)}/threads/{thread_id}")
    assert detail.status_code == 200, detail.text
    (stored,) = detail.json()["data"]["messages"]
    assert (stored["message_id"], stored["body"]) == (message_id, "공동 기록으로 남길 답장")
    # 팀원 발신은 thread.name, PM 발신은 author_name으로 작성자를 표시하는 기존 계약을 따른다.
    assert stored["author_name"] is None
    read = pm.post(f"{_base(mseed)}/threads/{thread_id}/read")
    assert read.status_code == 200 and read.json()["data"]["total_unread_count"] == 0
    assert client("bob").get(f"{_base(mseed)}/threads/{thread_id}").status_code == 403
    assert client("alice").get(_base(mseed)).status_code == 403


def test_erased_pm_author_is_anonymous_in_someone_elses_thread(mdb, mseed):
    mseed["alice"].role = "pm"
    mdb.commit()
    opened = client("alice").post(f"{_base(mseed)}/threads", json={"member_id": mseed["bob"].member_id})
    thread_id = opened.json()["data"]["thread_id"]
    written = client("alice").post(f"{_base(mseed)}/threads/{thread_id}/replies", json={"body": "공동 PM 기록"})
    assert written.status_code == 201 and written.json()["data"]["author_name"] == "앨리스"
    message_id = written.json()["data"]["message_id"]
    _erase(mdb, mseed["alice"])
    (stored,) = client("pm").get(f"{_base(mseed)}/threads/{thread_id}").json()["data"]["messages"]
    assert (stored["message_id"], stored["body"], stored["author_name"]) == (
        message_id, "공동 PM 기록", "탈퇴한 사용자",
    )


def test_erased_profile_clears_direct_identifiers_aliases_and_cannot_be_relinked(mdb, mseed):
    member = mseed["alice"]
    member.notion_name = "노션 별명"
    member.role = "pm"
    mdb.add(MemberAlias(
        workspace_id=mseed["ws"], member_id=member.member_id, alias_text="개인 별칭",
        alias_type="nickname", source="manual",
    ))
    mdb.commit()
    _erase(mdb, member)
    mdb.expire_all()
    assert (member.user_id, member.discord_user_id, member.notion_name) == (None, None, None)
    assert (member.display_name, member.role, member.is_deleted, member.has_login_account) == (
        "탈퇴한 사용자", "member", True, False,
    )
    assert member.withdrawn_at is not None and member.deleted_at is not None
    assert mdb.scalars(select(MemberAlias).where(MemberAlias.member_id == member.member_id)).all() == []
    with pytest.raises(IntegrityError):
        mdb.execute(update(Member).where(Member.member_id == member.member_id).values(discord_user_id="old-id"))
    mdb.rollback()
    pm = client("pm")
    assert pm.patch(f"{P}/members/{member.member_id}", json={"display_name": "복원"}).status_code == 404
    assert pm.post(f"{P}/members/{member.member_id}/aliases", json={"alias_text": "복원"}).status_code == 404


def test_erased_actor_cannot_receive_new_web_message_or_bot_claim(mdb, mseed):
    thread = messages.get_or_create_thread(mdb, mseed["ws"], mseed["alice"].member_id)
    pending = messages.add_pm_message(
        mdb, thread, author=mseed["pm"], body="이미 발송 대기중인 글", now=datetime.now(timezone.utc),
    )
    mdb.commit()
    _erase(mdb, mseed["alice"])
    response = client("pm").post(f"{_base(mseed)}/threads/{thread.thread_id}/replies", json={"body": "새 글"})
    assert response.status_code == 404
    assert _claim() == []
    mdb.refresh(pending)
    assert pending.body == "이미 발송 대기중인 글" and pending.dm_status == "failed"


def test_erased_actor_rejects_late_dm_identifiers(mdb, mseed):
    thread = messages.get_or_create_thread(mdb, mseed["ws"], mseed["alice"].member_id)
    message = messages.add_pm_message(
        mdb, thread, author=mseed["pm"], body="전송 요청", now=datetime.now(timezone.utc),
    )
    mdb.commit()
    (claim,) = _claim()
    _erase(mdb, mseed["alice"])
    response = client(service=True).post(f"{P}/bot/messages/{claim['message_id']}/result", json={
        "status": "delivered", "discord_message_ids": ["late-private-dm-id"],
    })
    assert response.status_code == 409 and response.json()["error"]["code"] == "MESSAGE_RESULT_CONFLICT"
    assert mdb.get(BotDmPart, "late-private-dm-id") is None
    assert mdb.get(ThreadMessage, message.message_id).body == "전송 요청"


def test_erased_actor_is_not_a_draft_recipient_and_late_draft_is_stale(mdb, mseed):
    created = _create(client("pm"), mseed, at=_future())
    bundle_id = created["bundle"]["bundle_id"]
    drafts = client(service=True).post(f"{P}/bot/drafts/claim")
    assert drafts.status_code == 200 and len(drafts.json()["data"]["items"]) == 1
    _erase(mdb, mseed["alice"])
    assert client(service=True).post(f"{P}/bot/drafts/claim").json()["data"]["items"] == []
    response = client(service=True).post(f"{P}/bot/drafts/{bundle_id}", json={
        "draft_version": created["bundle"]["draft_version"], "body": "옛 이름을 담은 결과",
    })
    assert response.status_code == 409 and response.json()["error"]["code"] == "DRAFT_STALE"


def test_erased_actor_reply_judgment_is_not_claimed(mdb, mseed):
    _remind(mdb, mseed, [mseed["tasks"][0]], SLOT)
    _reply(mdb, mseed, SLOT + H)
    _erase(mdb, mseed["alice"])
    assert replies.claim(mdb, SLOT + H) is None


def test_erased_actor_rejects_late_judgment_without_saving_copied_names(mdb, mseed):
    task = mseed["tasks"][0]
    _remind(mdb, mseed, [task], SLOT)
    message = _reply(mdb, mseed, SLOT + H)
    claimed = replies.claim(mdb, SLOT + H)
    assert claimed is not None
    mdb.commit()
    _erase(mdb, mseed["alice"])
    response = client(service=True).post(f"{P}/bot/replies/{message.message_id}/judgment", json={
        "attempt": claimed.attempt,
        "model_name": "late-model",
        "changes": [{"task_id": task.task_id, "field": "scope", "summary": "옛 이름이 담긴 결과"}],
    })
    assert response.status_code == 409 and response.json()["error"]["code"] == "REPLY_JUDGMENT_STALE"
    assert mdb.scalars(select(ReplyChange).where(ReplyChange.message_id == message.message_id)).all() == []
    row = mdb.get(ReplyJudgment, message.message_id)
    assert row.finished_at is None and row.model_name is None


def test_erased_actor_cannot_receive_or_accept_existing_invitation(mdb, mseed):
    member = mseed["carol"]
    created = client("pm").post(f"{P}/workspaces/{mseed['ws']}/invitations", json={
        "member_id": member.member_id, "email": "outsider@example.com",
    })
    assert created.status_code == 201, created.text
    invitation_id = created.json()["data"]["invitation_id"]
    _erase(mdb, member)
    accepted = client("outsider").post(f"{P}/invitations/{invitation_id}/accept")
    assert accepted.status_code == 409 and accepted.json()["error"]["code"] == "INVITATION_NOT_PENDING"
    again = client("pm").post(f"{P}/workspaces/{mseed['ws']}/invitations", json={
        "member_id": member.member_id, "email": "outsider@example.com",
    })
    assert again.status_code == 404 and again.json()["error"]["code"] == "MEMBER_NOT_FOUND"
    mdb.refresh(member)
    assert member.user_id is None and member.display_name == "탈퇴한 사용자"


def test_plan_counts_discord_only_member_and_all_workspaces_without_writes(mdb, mseed):
    user_id = mseed["pm"].user_id
    only = Workspace(name="단독 공간")
    mdb.add(only)
    mdb.flush()
    mdb.add(Member(workspace_id=only.workspace_id, user_id=user_id, display_name="단독 PM", role="pm"))
    # 계정 없는 Discord 팀원도 활동 멤버다. 공유 공간을 단독으로 판정하면 안 된다.
    mseed["alice"].is_deleted = True
    mseed["bob"].is_deleted = True
    mdb.commit()
    result = account_withdrawal.plan(mdb, user_id)
    assert {item.workspace_id: item.disposition for item in result.workspaces} == {
        mseed["ws"]: WorkspaceDisposition.TRANSFER_PM,
        only.workspace_id: WorkspaceDisposition.DELETE,
    }
    assert result.blocked_workspace_ids == (mseed["ws"],)
    assert mseed["pm"].user_id == user_id and mseed["pm"].withdrawn_at is None


def test_plan_accepts_other_login_bound_pm_and_member_withdrawal(mdb, mseed):
    pm_id, alice_id = mseed["pm"].user_id, mseed["alice"].user_id
    assert account_withdrawal.plan(mdb, alice_id).workspaces[0].disposition == WorkspaceDisposition.PRESERVE
    mseed["carol"].role = "pm"
    mdb.commit()
    assert account_withdrawal.plan(mdb, pm_id).blocked_workspace_ids == (mseed["ws"],)
    mseed["alice"].role = "pm"
    mdb.commit()
    assert account_withdrawal.plan(mdb, pm_id).blocked_workspace_ids == ()


def test_member_response_reports_account_link_without_exposing_user_id(mdb, mseed):
    response = client("pm").get(f"{P}/members", params={"workspace_id": mseed["ws"]})
    assert response.status_code == 200
    by_id = {item["member_id"]: item for item in response.json()["data"]["items"]}
    assert by_id[mseed["alice"].member_id]["has_login_account"] is True
    assert by_id[mseed["carol"].member_id]["has_login_account"] is False
    assert all("user_id" not in item for item in by_id.values())
