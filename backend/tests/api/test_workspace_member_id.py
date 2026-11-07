"""워크스페이스 응답이 로그인 사용자의 팀원 행 ID(member_id)를 싣는지 확인한다(#367).

기준은 require_member 와 같다: 이 공간에서 탈퇴하지 않은 내 팀원 행이고 role 과 같은 행이다.
"""
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import event

from app.api.workspaces import _build_workspace_response
from app.main import app
from app.models import Member, MessageThread, Workspace

P = "/api/v1"


def client(who: str) -> TestClient:
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", f"{who}-token")
    return c


def test_create_returns_the_creators_pm_member_id(mdb, mseed):
    r = client("outsider").post(f"{P}/workspaces", json={"name": "새 공간"})

    assert r.status_code == 201
    data = r.json()["data"]
    row = mdb.query(Member).filter(Member.workspace_id == data["workspace_id"]).one()
    assert data["role"] == "pm"
    assert data["member_id"] == row.member_id


def test_detail_returns_each_callers_own_member_id(mdb, mseed):
    ws = mseed["ws"]
    for who in ("pm", "alice", "bob"):
        data = client(who).get(f"{P}/workspaces/{ws}").json()["data"]
        assert data["member_id"] == mseed[who].member_id


def test_list_matches_each_workspace_to_its_own_member_row(mdb, mseed):
    pm_user_id = mseed["pm"].user_id
    other = Workspace(name="B")
    mdb.add(other)
    mdb.flush()
    other_pm = Member(workspace_id=other.workspace_id, user_id=pm_user_id, display_name="PM-B", role="member")
    mdb.add(other_pm)
    mdb.commit()

    items = client("pm").get(f"{P}/workspaces").json()["data"]["items"]

    by_ws = {i["workspace_id"]: i for i in items}
    assert by_ws[mseed["ws"]]["member_id"] == mseed["pm"].member_id
    assert by_ws[other.workspace_id]["member_id"] == other_pm.member_id
    assert by_ws[other.workspace_id]["role"] == "member"


def test_left_row_is_skipped_for_the_new_active_row(mdb, mseed):
    old = mseed["alice"]
    old.is_deleted = True
    fresh = Member(workspace_id=mseed["ws"], user_id=old.user_id, display_name="앨리스", role="member")
    mdb.add(fresh)
    mdb.commit()

    detail = client("alice").get(f"{P}/workspaces/{mseed['ws']}").json()["data"]
    listed = client("alice").get(f"{P}/workspaces").json()["data"]["items"]

    assert detail["member_id"] == fresh.member_id
    assert [i["member_id"] for i in listed] == [fresh.member_id]


def test_member_id_from_detail_is_what_reply_permission_checks(mdb, mseed):
    ws = mseed["ws"]
    threads = {}
    for who in ("alice", "bob", "pm"):
        t = MessageThread(workspace_id=ws, member_id=mseed[who].member_id)
        mdb.add(t)
        threads[who] = t
    mdb.commit()

    for who in ("alice", "pm"):
        c = client(who)
        my_id = c.get(f"{P}/workspaces/{ws}").json()["data"]["member_id"]
        mine = next(t for t in threads.values() if t.member_id == my_id)
        url = f"{P}/workspaces/{ws}/messages/threads/{mine.thread_id}/replies"
        assert c.post(url, json={"body": "내 대화"}).status_code == 201
        theirs = threads["bob"]
        url = f"{P}/workspaces/{ws}/messages/threads/{theirs.thread_id}/replies"
        assert c.post(url, json={"body": "남의 대화"}).status_code == 403


def test_builder_without_member_gives_null_member_id():
    ws = Workspace(workspace_id="w1", name="x", created_at=datetime.now(timezone.utc))

    data = _build_workspace_response(ws, None)

    assert data["member_id"] is None
    assert data["role"] is None


def test_list_query_count_does_not_grow_with_workspaces(mdb, mseed):
    pm_user_id = mseed["pm"].user_id
    statements = []

    def record(conn, cursor, statement, *args):
        statements.append(statement)

    def count_list_queries():
        statements.clear()
        event.listen(mdb.get_bind(), "before_cursor_execute", record)
        try:
            assert client("pm").get(f"{P}/workspaces").status_code == 200
        finally:
            event.remove(mdb.get_bind(), "before_cursor_execute", record)
        return len(statements)

    one = count_list_queries()
    for i in range(2):
        extra = Workspace(name=f"추가{i}")
        mdb.add(extra)
        mdb.flush()
        mdb.add(Member(workspace_id=extra.workspace_id, user_id=pm_user_id, display_name="PM", role="pm"))
    mdb.commit()
    three = count_list_queries()

    assert len(client("pm").get(f"{P}/workspaces").json()["data"]["items"]) == 3
    assert three == one
