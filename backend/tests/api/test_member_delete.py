"""팀원 삭제(#637). PM 이 잘못 만들었거나 떠난 팀원을 명단에서 뺀다. 행은 남기고 is_deleted 만 켠다.

이름·디스코드 계정·로그인 계정은 이력용으로 남기고, 끝나지 않은 태스크의 담당과 대기 초대, 예약 DM 을 정리한다.
TEST_DATABASE_URL 이 있으면 PostgreSQL 에서도 돈다.
"""
from datetime import datetime, timezone

from sqlalchemy import select

from app.models import (
    ChangeSource, Invitation, Member, MemberAlias, MessageThread, NotionSyncJob, Reminder, ReminderBundle,
    ReminderWatch, Task, TaskHistory, ThreadMessage, User, Workspace,
)
from app.services import matching, messages, thread_signals
from tests.api.test_messages_api import P, _create, client


def _delete(who, member):
    return client(who).delete(f"{P}/members/{member.member_id}")


def test_member_cannot_delete_a_teammate(mdb, mseed):
    r = _delete("alice", mseed["carol"])
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "FORBIDDEN"
    mdb.refresh(mseed["carol"])
    assert mseed["carol"].is_deleted is False


def test_pm_of_another_workspace_cannot_delete(mdb, mseed):
    outsider = mdb.scalar(select(User).where(User.name == "outsider"))
    other = Workspace(name="B")
    mdb.add(other)
    mdb.flush()
    mdb.add(Member(workspace_id=other.workspace_id, user_id=outsider.user_id, display_name="외부", role="pm"))
    mdb.commit()
    r = _delete("outsider", mseed["carol"])
    assert r.status_code == 403
    mdb.refresh(mseed["carol"])
    assert mseed["carol"].is_deleted is False


def test_last_pm_cannot_delete_self(mdb, mseed):
    r = _delete("pm", mseed["pm"])
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "LAST_PM_REQUIRED"
    mdb.refresh(mseed["pm"])
    assert mseed["pm"].is_deleted is False


def test_pm_can_delete_another_pm_while_one_remains(mdb, mseed):
    mseed["bob"].role = "pm"
    mdb.commit()
    assert _delete("pm", mseed["bob"]).status_code == 204
    mdb.refresh(mseed["bob"])
    assert mseed["bob"].is_deleted is True


def test_missing_withdrawn_or_already_deleted_member_is_404(mdb, mseed):
    assert client("pm").delete(f"{P}/members/no-such-member").status_code == 404
    mseed["alice"].erase_profile(datetime.now(timezone.utc))
    mdb.commit()
    r = _delete("pm", mseed["alice"])
    assert r.status_code == 404 and r.json()["error"]["code"] == "MEMBER_NOT_FOUND"
    assert _delete("pm", mseed["carol"]).status_code == 204
    again = _delete("pm", mseed["carol"])
    assert again.status_code == 404 and again.json()["error"]["code"] == "MEMBER_NOT_FOUND"


def test_deleted_member_keeps_its_row_and_leaves_roster_and_matching(mdb, mseed):
    carol = mseed["carol"]
    mdb.add(MemberAlias(workspace_id=mseed["ws"], member_id=carol.member_id, alias_text="캐럴",
                       alias_type="realname", source="manual", confidence=1.0, verified=True))
    mdb.commit()
    assert matching.resolve_assignee(mdb, mseed["ws"], "캐럴").member_id == carol.member_id

    r = _delete("pm", carol)
    assert r.status_code == 204 and r.content == b""

    mdb.expire_all()
    row = mdb.get(Member, carol.member_id)
    assert row.is_deleted is True and row.deleted_at is not None and row.withdrawn_at is None
    assert row.display_name == "캐럴" and row.discord_user_id == "d_carol"
    listed = client("pm").get(f"{P}/members", params={"workspace_id": mseed["ws"]}).json()["data"]
    assert carol.member_id not in {m["member_id"] for m in listed["items"]}
    assert listed["total"] == 3
    assert matching.resolve_assignee(mdb, mseed["ws"], "캐럴").member_id is None
    names = client(service=True).get(f"{P}/workspaces/{mseed['ws']}/members/names").json()["data"]["items"]
    assert carol.member_id not in {m["member_id"] for m in names}


def test_open_tasks_lose_the_assignee_through_task_history(mdb, mseed):
    alice, pm = mseed["alice"], mseed["pm"]
    todo, done, doing = mseed["tasks"]
    for task, status in ((todo, "todo"), (done, "done"), (doing, "in_progress")):
        task.assignee_member_id = alice.member_id
        task.status = status
    gone = Task(workspace_id=mseed["ws"], title="지운 할일", status="todo",
                assignee_member_id=alice.member_id, is_deleted=True)
    mdb.add(gone)
    mdb.commit()
    versions = {t.task_id: t.version for t in (todo, done, doing, gone)}

    assert _delete("pm", alice).status_code == 204

    mdb.expire_all()
    for task in (todo, doing):
        row = mdb.get(Task, task.task_id)
        assert row.assignee_member_id is None
        assert row.version == versions[task.task_id] + 1
        [entry] = mdb.scalars(select(TaskHistory).where(TaskHistory.task_id == task.task_id)).all()
        assert entry.changed_field == "assignee"
        assert entry.old_value == alice.member_id and entry.new_value is None
        assert entry.change_source == str(ChangeSource.MANUAL) and entry.changed_by == pm.member_id
        assert mdb.scalar(select(NotionSyncJob).where(NotionSyncJob.task_id == task.task_id)) is not None
    for task in (done, gone):
        row = mdb.get(Task, task.task_id)
        assert row.assignee_member_id == alice.member_id
        assert row.version == versions[task.task_id]
        assert mdb.scalars(select(TaskHistory).where(TaskHistory.task_id == task.task_id)).all() == []


def test_pending_invitation_is_canceled(mdb, mseed):
    outsider = mdb.scalar(select(User).where(User.name == "outsider"))
    made = client("pm").post(
        f"{P}/workspaces/{mseed['ws']}/invitations",
        json={"member_id": mseed["carol"].member_id, "user_id": outsider.user_id},
    )
    assert made.status_code == 201, made.text
    invitation_id = made.json()["data"]["invitation_id"]

    assert _delete("pm", mseed["carol"]).status_code == 204

    mdb.expire_all()
    invitation = mdb.get(Invitation, invitation_id)
    assert invitation.status == "canceled" and invitation.responded_at is not None
    mine = client("outsider").get(f"{P}/invitations/me").json()["data"]["items"]
    assert mine == []


def test_scheduled_dm_and_pending_message_are_stopped_but_thread_stays(mdb, mseed):
    pm_client = client("pm")
    bundle_id = _create(pm_client, mseed, "alice")["bundle"]["bundle_id"]
    thread = mdb.scalar(select(MessageThread).where(MessageThread.member_id == mseed["alice"].member_id))
    pending = ThreadMessage(thread_id=thread.thread_id, sender="pm", body="곧 보낼 글", dm_status="pending")
    mdb.add(pending)
    mdb.commit()

    assert _delete("pm", mseed["alice"]).status_code == 204

    mdb.expire_all()
    bundle = mdb.get(ReminderBundle, bundle_id)
    assert bundle.status == "cancelled"
    reminders = mdb.scalars(select(Reminder).where(Reminder.bundle_id == bundle_id)).all()
    assert reminders and {r.status for r in reminders} == {"cancelled"}
    assert all(r.cancelled_at is not None for r in reminders)
    message = mdb.get(ThreadMessage, pending.message_id)
    assert message.dm_status == "failed" and message.dm_failure_reason == "discord_not_linked"
    assert mdb.get(MessageThread, thread.thread_id) is not None
    assert messages.claim_for_bot(mdb, datetime.now(timezone.utc)) == []


def test_running_reply_watch_is_stopped(mdb, mseed):
    from tests.api.test_scheduler import _suggested_and_sent

    _suggested_and_sent(mdb, mseed)
    watch = mdb.scalar(select(ReminderWatch))
    assert watch.state == "watching"

    assert _delete("pm", mseed["alice"]).status_code == 204

    mdb.expire_all()
    watch = mdb.get(ReminderWatch, watch.watch_id)
    assert watch.state == "stopped" and watch.closed_at is not None


def test_discord_account_can_be_linked_to_another_member_after_delete(mdb, mseed):
    body = {"workspace_id": mseed["ws"], "display_name": "새앨리스", "discord_user_id": "d_alice"}
    assert client("pm").post(f"{P}/members", json=body).status_code == 409
    assert _delete("pm", mseed["alice"]).status_code == 204
    r = client("pm").post(f"{P}/members", json=body)
    assert r.status_code == 201, r.text


def test_deleted_member_loses_access_and_open_sockets(mdb, mseed, monkeypatch):
    revoked = []
    monkeypatch.setattr(thread_signals, "revoke", lambda ids: revoked.extend(ids))
    assert client("alice").get(f"{P}/members", params={"workspace_id": mseed["ws"]}).status_code == 200

    assert _delete("pm", mseed["alice"]).status_code == 204

    assert revoked == [mseed["alice"].member_id]
    assert client("alice").get(f"{P}/members", params={"workspace_id": mseed["ws"]}).status_code == 403


def test_deleted_member_cannot_be_edited(mdb, mseed):
    # 지운 팀원에 디스코드를 다시 잇거나 이름을 바꾸면 명단에 없는 사람이 다시 일을 받는다(#652 와 맞물림). 조회는 이력용으로 둔다
    assert _delete("pm", mseed["carol"]).status_code == 204
    r = client("pm").patch(f"{P}/members/{mseed['carol'].member_id}", json={"display_name": "캐롤2"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "MEMBER_NOT_FOUND"
    assert client("pm").get(f"{P}/members/{mseed['carol'].member_id}").status_code == 200
