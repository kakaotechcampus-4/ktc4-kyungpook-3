"""팀원 초대(#319, #628). PM 이 온보딩에서 만든 팀원(로그인 계정 없음)에게 아이디로 찾은 가입자를 초대하고,
그 사람이 내 초대에서 수락하면 팀원과 계정이 이어진다. 수락 전에는 워크스페이스에 들어갈 수 없다.

TEST_DATABASE_URL 이 있으면 PostgreSQL 에서도 돈다.
"""
import importlib.util
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Event

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as SessionORM, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import invitations
from app.api.members import _ensure_no_pending_invitation, _ensure_other_pm
from app.core.database import Base, get_db
from app.core.errors import AppError
from app.main import app
from app.models import Invitation, Member, Session as SessionModel, User, Workspace
from app.schemas.invitation import InvitationCreateRequest
from app.services.sessions import hash_session_token
from tests.api.conftest import signup_verified
from tests.api.test_withdrawal_concurrency import wait_blocked
from tests.usernames import username_for

pytestmark = pytest.mark.usefixtures("signup_secret")

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")


@pytest.fixture(
    params=[
        "sqlite",
        pytest.param(
            "postgresql",
            marks=pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없습니다."),
        ),
    ]
)
def db(request):
    if request.param == "postgresql":
        engine = create_engine(TEST_DATABASE_URL)
        with engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        Base.metadata.drop_all(engine)
    else:
        engine = create_engine(
            "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
    Base.metadata.create_all(engine)
    # 앱 세션(SessionLocal)과 같이 autoflush 를 끈다.
    session = sessionmaker(bind=engine, autoflush=False)()

    def override_get_db():
        yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield session
    finally:
        app.dependency_overrides.pop(get_db, None)
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def _user(db, name: str) -> User:
    user = User(username=username_for(f"{name}@example.com"), email=f"{name}@example.com", name=name)
    db.add(user)
    db.flush()
    db.add(SessionModel(
        user_id=user.user_id, session_token=hash_session_token(f"{name}-token"),
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    return user


@pytest.fixture
def seed(db):
    """워크스페이스 A: PM(pm), 계정이 연결된 팀원 jimin, 디스코드 명단으로만 만든 팀원 minsu·jiyoung(계정 없음).
    jiyoung 계정은 초대 전에 이미 가입했다. outsider 는 A 와 상관없다. 워크스페이스 B 에도 명단 팀원이 하나 있다."""
    pm_user = _user(db, "pm")
    jimin_user = _user(db, "jimin")
    jiyoung_user = _user(db, "jiyoung")
    outsider_user = _user(db, "outsider")

    ws = Workspace(name="A")
    other_ws = Workspace(name="B")
    db.add_all([ws, other_ws])
    db.flush()
    wid = ws.workspace_id
    pm = Member(workspace_id=wid, user_id=pm_user.user_id, display_name="PM", role="pm")
    jimin = Member(workspace_id=wid, user_id=jimin_user.user_id, display_name="지민", role="member")
    minsu = Member(workspace_id=wid, display_name="민수", role="member", discord_user_id="d_minsu")
    jiyoung = Member(workspace_id=wid, display_name="지영", role="member", discord_user_id="d_jiyoung")
    other = Member(workspace_id=other_ws.workspace_id, display_name="다른팀", role="member")
    db.add_all([pm, jimin, minsu, jiyoung, other])
    db.commit()
    return {
        "ws": wid, "pm": pm, "jimin": jimin, "minsu": minsu, "jiyoung": jiyoung, "other": other,
        "jiyoung_uid": jiyoung_user.user_id, "outsider_uid": outsider_user.user_id,
    }


def _client(token: str | None = None) -> TestClient:
    c = TestClient(app, base_url="https://testserver")
    if token:
        c.cookies.set("session_token", token)
    return c


def _invite(ws: str, member_id: str, user_id: str, token: str = "pm-token"):
    return _client(token).post(
        f"/api/v1/workspaces/{ws}/invitations", json={"member_id": member_id, "user_id": user_id}
    )


def _invite_id(ws: str, member_id: str, user_id: str) -> str:
    res = _invite(ws, member_id, user_id)
    assert res.status_code == 201, res.text
    return res.json()["data"]["invitation_id"]


def _list(ws: str, token: str = "pm-token") -> list[dict]:
    res = _client(token).get(f"/api/v1/workspaces/{ws}/invitations")
    assert res.status_code == 200, res.text
    return res.json()["data"]["items"]


def _mine(token: str) -> list[dict]:
    res = _client(token).get("/api/v1/invitations/me")
    assert res.status_code == 200, res.text
    return res.json()["data"]["items"]


def _act(invitation_id: str, action: str, token: str):
    return _client(token).post(f"/api/v1/invitations/{invitation_id}/{action}")


def _code(res) -> str:
    return res.json()["error"]["code"]


def _workspace_ids(token: str) -> list[str]:
    res = _client(token).get("/api/v1/workspaces")
    assert res.status_code == 200, res.text
    return [w["workspace_id"] for w in res.json()["data"]["items"]]


def _workspace_count(token: str) -> int:
    res = _client(token).get("/api/v1/auth/me")
    assert res.status_code == 200, res.text
    return res.json()["data"]["workspace_count"]


def _signup(email: str, name: str) -> TestClient:
    c = _client()
    res = signup_verified(c, email, name=name)
    assert res.status_code == 201, res.text
    return c


def test_pm_creates_invite_and_sees_it_in_the_list(db, seed):
    res = _invite(seed["ws"], seed["minsu"].member_id, seed["jiyoung_uid"])

    assert res.status_code == 201
    created = res.json()["data"]
    assert created["member_id"] == seed["minsu"].member_id
    assert created["member_display_name"] == "민수"
    assert created["invited_user"] == {
        "user_id": seed["jiyoung_uid"], "username": db.get(User, seed["jiyoung_uid"]).username, "name": "jiyoung",
    }
    assert "email" not in created
    assert created["status"] == "pending"
    assert created["invited_by_name"] == "pm"
    assert created["accepted_user"] is None
    assert created["responded_at"] is None
    assert [i["invitation_id"] for i in _list(seed["ws"])] == [created["invitation_id"]]


@pytest.mark.parametrize("token", ["jimin-token", "outsider-token"])
def test_only_pm_creates_and_lists_invites(seed, token):
    res = _invite(seed["ws"], seed["minsu"].member_id, seed["jiyoung_uid"], token=token)
    assert res.status_code == 403
    assert _client(token).get(f"/api/v1/workspaces/{seed['ws']}/invitations").status_code == 403


def test_member_outside_the_workspace_or_unknown_is_not_found(seed):
    assert _code(_invite(seed["ws"], seed["other"].member_id, seed["jiyoung_uid"])) == "MEMBER_NOT_FOUND"
    res = _invite(seed["ws"], "no-such-member", seed["jiyoung_uid"])
    assert res.status_code == 404
    assert _code(res) == "MEMBER_NOT_FOUND"


def test_unknown_user_is_not_found_and_only_a_pm_learns_it(seed):
    res = _invite(seed["ws"], seed["minsu"].member_id, "no-such-user")

    assert res.status_code == 404
    assert _code(res) == "USER_NOT_FOUND"
    assert _list(seed["ws"]) == []
    assert _invite(seed["ws"], seed["minsu"].member_id, "no-such-user", token="jimin-token").status_code == 403


def test_user_id_is_required(seed):
    res = _client("pm-token").post(
        f"/api/v1/workspaces/{seed['ws']}/invitations", json={"member_id": seed["minsu"].member_id}
    )
    assert res.status_code == 400


def test_user_who_signed_up_before_the_invite_sees_it(seed):
    assert _mine("jiyoung-token") == []
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])

    [item] = _mine("jiyoung-token")
    assert item["invitation_id"] == invitation_id
    assert item["workspace_id"] == seed["ws"]
    assert item["workspace_name"] == "A"
    assert item["member_display_name"] == "지영"
    assert item["invited_by_name"] == "pm"
    assert _mine("outsider-token") == []


def test_invite_follows_the_account_not_its_email(db, seed):
    """초대는 계정에 묶인다. 같은 이메일로 새 계정이 생겨도 그 계정에는 보이지 않는다."""
    invitation_id = _invite_id(seed["ws"], seed["minsu"].member_id, seed["jiyoung_uid"])
    db.get(User, seed["jiyoung_uid"]).email = "jiyoung2@example.com"
    db.commit()

    assert [i["invitation_id"] for i in _mine("jiyoung-token")] == [invitation_id]
    stranger = _client()
    assert signup_verified(stranger, "jiyoung@example.com", name="같은 이메일", username="sameemail").status_code == 201
    assert stranger.get("/api/v1/invitations/me").json()["data"]["items"] == []
    assert stranger.post(f"/api/v1/invitations/{invitation_id}/accept").status_code == 404


def test_before_accepting_the_workspace_is_closed(seed):
    _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])

    c = _client("jiyoung-token")
    assert c.get(f"/api/v1/workspaces/{seed['ws']}").status_code == 403
    assert c.get("/api/v1/members", params={"workspace_id": seed["ws"]}).status_code == 403
    assert _workspace_ids("jiyoung-token") == []
    assert _workspace_count("jiyoung-token") == 0


def test_accept_links_the_member_and_opens_the_workspace(seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])

    res = _act(invitation_id, "accept", "jiyoung-token")

    assert res.status_code == 200
    assert res.json()["data"] == {"workspace_id": seed["ws"], "member_id": seed["jiyoung"].member_id}
    assert _workspace_ids("jiyoung-token") == [seed["ws"]]
    assert _workspace_count("jiyoung-token") == 1
    workspace = _client("jiyoung-token").get(f"/api/v1/workspaces/{seed['ws']}")
    assert workspace.status_code == 200
    assert workspace.json()["data"]["role"] == "member"
    assert _mine("jiyoung-token") == []
    [item] = _list(seed["ws"])
    assert item["status"] == "accepted"
    assert item["responded_at"] is not None
    assert item["accepted_user"]["name"] == "jiyoung"
    assert item["accepted_user"]["email"] == "jiyoung@example.com"


def test_new_user_with_no_workspace_can_still_use_me_and_list(seed):
    c = _signup("newbie@example.com", "새사람")
    me = c.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["data"]["workspace_count"] == 0
    listed = c.get("/api/v1/workspaces")
    assert listed.status_code == 200
    assert listed.json()["data"] == {"items": [], "total": 0}


def test_decline_closes_the_invite(seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])

    res = _act(invitation_id, "decline", "jiyoung-token")

    assert res.status_code == 200
    assert _mine("jiyoung-token") == []
    assert _list(seed["ws"])[0]["status"] == "declined"
    assert _code(_act(invitation_id, "accept", "jiyoung-token")) == "INVITATION_NOT_PENDING"
    assert _workspace_count("jiyoung-token") == 0


def test_pm_cancels_a_pending_invite(seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])
    assert _act(invitation_id, "cancel", "jimin-token").status_code == 403
    outsider = _act(invitation_id, "cancel", "outsider-token")
    assert outsider.status_code == 404
    assert _code(outsider) == "INVITATION_NOT_FOUND"

    res = _act(invitation_id, "cancel", "pm-token")

    assert res.status_code == 200
    assert res.json()["data"]["status"] == "canceled"
    assert _mine("jiyoung-token") == []
    accept = _act(invitation_id, "accept", "jiyoung-token")
    assert accept.status_code == 409
    assert _code(accept) == "INVITATION_NOT_PENDING"
    assert _code(_act(invitation_id, "cancel", "pm-token")) == "INVITATION_NOT_PENDING"
    assert _workspace_count("jiyoung-token") == 0


def test_someone_elses_invite_is_not_found(seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])

    for action in ("accept", "decline"):
        res = _act(invitation_id, action, "outsider-token")
        assert res.status_code == 404
        assert _code(res) == "INVITATION_NOT_FOUND"
    assert _act("no-such-invite", "accept", "jiyoung-token").status_code == 404
    assert _act("no-such-invite", "cancel", "pm-token").status_code == 404
    assert _list(seed["ws"])[0]["status"] == "pending"
    assert _workspace_count("outsider-token") == 0


def test_member_already_linked_cannot_be_invited(seed):
    res = _invite(seed["ws"], seed["jimin"].member_id, seed["outsider_uid"])
    assert res.status_code == 409
    assert _code(res) == "MEMBER_ALREADY_LINKED"


def test_pm_member_cannot_be_invited(db, seed):
    # 초대로 들어온 계정이 바로 PM 이 되면 원래 PM 을 내려 연결 끊기를 막을 수 있다.
    seed["minsu"].role = "pm"
    db.commit()

    res = _invite(seed["ws"], seed["minsu"].member_id, seed["jiyoung_uid"])

    assert res.status_code == 409
    assert _code(res) == "PM_MEMBER_NOT_INVITABLE"
    assert _list(seed["ws"]) == []


def test_member_with_pending_invite_cannot_be_promoted_until_accepted(db, seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])
    member_url = f"/api/v1/members/{seed['jiyoung'].member_id}"

    res = _client("pm-token").patch(member_url, json={"role": "pm"})

    assert res.status_code == 409
    assert _code(res) == "MEMBER_HAS_PENDING_INVITATION"
    db.expire_all()
    assert db.get(Member, seed["jiyoung"].member_id).role == "member"
    assert len(_mine("jiyoung-token")) == 1

    assert _act(invitation_id, "accept", "jiyoung-token").status_code == 200
    assert _client("pm-token").patch(member_url, json={"role": "pm"}).status_code == 200


def test_member_can_be_promoted_after_the_pending_invite_is_canceled(seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])
    assert _client("pm-token").post(f"/api/v1/invitations/{invitation_id}/cancel").status_code == 200

    res = _client("pm-token").patch(f"/api/v1/members/{seed['jiyoung'].member_id}", json={"role": "pm"})

    assert res.status_code == 200


def test_pending_invite_does_not_block_other_member_updates(seed):
    _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])

    res = _client("pm-token").patch(
        f"/api/v1/members/{seed['jiyoung'].member_id}", json={"display_name": "지영2", "role": "member"}
    )

    assert res.status_code == 200


def test_pm_of_another_workspace_can_be_invited_as_a_member(db, seed):
    jiyoung_user = db.get(User, seed["jiyoung_uid"])
    seed["other"].user_id = jiyoung_user.user_id
    seed["other"].role = "pm"
    db.commit()

    invitation_id = _invite_id(seed["ws"], seed["minsu"].member_id, seed["jiyoung_uid"])

    assert _act(invitation_id, "accept", "jiyoung-token").status_code == 200


def test_accept_refused_when_the_member_got_linked_meanwhile(db, seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])
    outsider = db.get(User, seed["outsider_uid"])
    seed["jiyoung"].user_id = outsider.user_id
    db.commit()

    res = _act(invitation_id, "accept", "jiyoung-token")

    assert res.status_code == 409
    assert _code(res) == "MEMBER_ALREADY_LINKED"
    assert _workspace_count("jiyoung-token") == 0
    assert _list(seed["ws"])[0]["status"] == "pending"


@pytest.mark.parametrize("who", ["jimin", "pm"])
def test_account_already_in_the_workspace_cannot_be_invited(seed, who):
    res = _invite(seed["ws"], seed["minsu"].member_id, seed[who].user_id)
    assert res.status_code == 409
    assert _code(res) == "ALREADY_WORKSPACE_MEMBER"
    assert _list(seed["ws"]) == []


def test_withdrawn_member_account_can_be_invited_again(db, seed):
    """탈퇴한(is_deleted) 팀원 행에 이어진 계정은 이 공간의 팀원이 아니다."""
    seed["jimin"].is_deleted = True
    db.commit()

    assert _invite(seed["ws"], seed["minsu"].member_id, seed["jimin"].user_id).status_code == 201


def test_accept_refused_when_the_account_is_already_a_member(db, seed):
    invitation_id = _invite_id(seed["ws"], seed["minsu"].member_id, seed["jiyoung_uid"])
    jiyoung = db.get(User, seed["jiyoung_uid"])
    seed["jiyoung"].user_id = jiyoung.user_id
    db.commit()

    res = _act(invitation_id, "accept", "jiyoung-token")

    assert res.status_code == 409
    assert _code(res) == "ALREADY_WORKSPACE_MEMBER"
    assert _workspace_count("jiyoung-token") == 1


def test_reinviting_a_member_cancels_the_open_invite(seed):
    """다른 사람을 잘못 초대했으면 같은 팀원에게 다시 초대해서 고친다."""
    old_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["outsider_uid"])
    new_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])

    by_id = {i["invitation_id"]: i for i in _list(seed["ws"])}
    assert by_id[old_id]["status"] == "canceled"
    assert by_id[old_id]["responded_at"] is not None
    assert by_id[new_id]["status"] == "pending"
    assert [i["invitation_id"] for i in _list(seed["ws"])] == [new_id, old_id]
    assert [i["invitation_id"] for i in _mine("jiyoung-token")] == [new_id]
    assert _mine("outsider-token") == []
    assert _act(new_id, "accept", "jiyoung-token").status_code == 200


def test_reinviting_the_same_user_replaces_the_open_invite(seed):
    old_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])
    new_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])

    assert [i["invitation_id"] for i in _mine("jiyoung-token")] == [new_id]
    assert _code(_act(old_id, "accept", "jiyoung-token")) == "INVITATION_NOT_PENDING"


def test_same_user_cannot_be_pending_for_two_members(seed):
    _invite_id(seed["ws"], seed["minsu"].member_id, seed["jiyoung_uid"])

    res = _invite(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])

    assert res.status_code == 409
    assert _code(res) == "USER_ALREADY_INVITED"
    assert len(_list(seed["ws"])) == 1


def test_same_user_race_lost_at_the_db_is_409_not_500(seed, monkeypatch):
    # 다른 팀원에게 같은 사용자 초대가 사전 검사와 저장 사이에 생기고, 재확인 전에 닫힌 경우를 흉내 낸다.
    _invite_id(seed["ws"], seed["minsu"].member_id, seed["outsider_uid"])
    monkeypatch.setattr(invitations, "_user_pending_for_other_member", lambda *args: False)

    res = _invite(seed["ws"], seed["jiyoung"].member_id, seed["outsider_uid"])

    assert res.status_code == 409
    assert _code(res) == "USER_ALREADY_INVITED"


def test_reinvite_after_decline_works(seed):
    first = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])
    assert _act(first, "decline", "jiyoung-token").status_code == 200

    second = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])

    assert _act(second, "accept", "jiyoung-token").status_code == 200
    assert _workspace_ids("jiyoung-token") == [seed["ws"]]


def test_revoke_unlinks_the_account_and_keeps_the_member(seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])
    assert _act(invitation_id, "accept", "jiyoung-token").status_code == 200
    assert _act(invitation_id, "revoke", "jimin-token").status_code == 403

    res = _act(invitation_id, "revoke", "pm-token")

    assert res.status_code == 200
    revoked = res.json()["data"]
    assert revoked["status"] == "revoked"
    assert revoked["accepted_user"]["email"] == "jiyoung@example.com"
    assert _client("jiyoung-token").get(f"/api/v1/workspaces/{seed['ws']}").status_code == 403
    assert _workspace_ids("jiyoung-token") == []
    members = _client("pm-token").get("/api/v1/members", params={"workspace_id": seed["ws"]}).json()["data"]
    assert seed["jiyoung"].member_id in [m["member_id"] for m in members["items"]]
    assert _code(_act(invitation_id, "revoke", "pm-token")) == "INVITATION_NOT_ACCEPTED"


def test_revoke_closes_a_leftover_pending_invite_for_the_same_user(db, seed):
    # 수락과 새 초대가 겹치면 같은 사용자의 대기 초대가 남을 수 있다. 끊긴 계정이 그 초대로 돌아오면 안 된다.
    invitation_id = _invite_id(seed["ws"], seed["minsu"].member_id, seed["jiyoung_uid"])
    assert _act(invitation_id, "accept", "jiyoung-token").status_code == 200
    leftover = Invitation(
        workspace_id=seed["ws"], member_id=seed["jiyoung"].member_id, invited_user_id=seed["jiyoung_uid"]
    )
    db.add(leftover)
    third = Member(workspace_id=seed["ws"], display_name="셋째", role="member")
    db.add(third)
    db.commit()
    leftover_id = leftover.invitation_id
    others_id = _invite_id(seed["ws"], third.member_id, seed["outsider_uid"])

    assert _act(invitation_id, "revoke", "pm-token").status_code == 200

    assert _mine("jiyoung-token") == []
    res = _act(leftover_id, "accept", "jiyoung-token")
    assert res.status_code == 409
    assert _code(res) == "INVITATION_NOT_PENDING"
    assert _workspace_count("jiyoung-token") == 0
    statuses = {i["invitation_id"]: i["status"] for i in _list(seed["ws"])}
    assert statuses[leftover_id] == "canceled"
    assert statuses[others_id] == "pending"


def test_revoke_only_applies_to_accepted_invites(seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])

    res = _act(invitation_id, "revoke", "pm-token")

    assert res.status_code == 409
    assert _code(res) == "INVITATION_NOT_ACCEPTED"
    assert _list(seed["ws"])[0]["status"] == "pending"


def test_reinvite_after_revoke_links_again(seed):
    first = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])
    assert _act(first, "accept", "jiyoung-token").status_code == 200
    assert _act(first, "revoke", "pm-token").status_code == 200

    second = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])

    assert _act(second, "accept", "jiyoung-token").status_code == 200
    assert _workspace_ids("jiyoung-token") == [seed["ws"]]
    statuses = {i["invitation_id"]: i["status"] for i in _list(seed["ws"])}
    assert statuses == {first: "revoked", second: "accepted"}


def test_revoking_the_last_web_pm_is_refused(db, seed):
    invitation_id = _invite_id(seed["ws"], seed["minsu"].member_id, seed["jiyoung_uid"])
    assert _act(invitation_id, "accept", "jiyoung-token").status_code == 200
    seed["minsu"].role = "pm"
    db.commit()
    demote = _client("pm-token").patch(f"/api/v1/members/{seed['pm'].member_id}", json={"role": "member"})
    assert demote.status_code == 200

    res = _act(invitation_id, "revoke", "jiyoung-token")

    assert res.status_code == 409
    assert _code(res) == "LAST_PM_REQUIRED"
    assert _workspace_ids("jiyoung-token") == [seed["ws"]]
    assert _list(seed["ws"], token="jiyoung-token")[0]["status"] == "accepted"


def test_revoking_a_pm_is_allowed_while_another_web_pm_remains(db, seed):
    invitation_id = _invite_id(seed["ws"], seed["minsu"].member_id, seed["jiyoung_uid"])
    assert _act(invitation_id, "accept", "jiyoung-token").status_code == 200
    seed["minsu"].role = "pm"
    db.commit()

    assert _act(invitation_id, "revoke", "pm-token").status_code == 200
    assert _workspace_ids("jiyoung-token") == []


def test_deleted_members_invite_is_hidden_and_cannot_be_accepted(db, seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])
    seed["jiyoung"].is_deleted = True
    db.commit()

    assert _mine("jiyoung-token") == []
    res = _act(invitation_id, "accept", "jiyoung-token")
    assert res.status_code == 409
    assert _code(res) == "INVITATION_NOT_PENDING"
    assert _workspace_count("jiyoung-token") == 0
    assert _code(_invite(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])) == "MEMBER_NOT_FOUND"


def test_db_allows_one_pending_invite_per_member_and_per_workspace_user(db, seed):
    wid, minsu, jiyoung = seed["ws"], seed["minsu"].member_id, seed["jiyoung"].member_id
    a, b = seed["jiyoung_uid"], seed["outsider_uid"]
    db.add(Invitation(workspace_id=wid, member_id=minsu, invited_user_id=a))
    db.commit()

    for member_id, user_id in ((minsu, b), (jiyoung, a)):
        db.add(Invitation(workspace_id=wid, member_id=member_id, invited_user_id=user_id))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

    db.add_all([
        Invitation(workspace_id=wid, member_id=minsu, invited_user_id=a, status="canceled"),
        Invitation(workspace_id=wid, member_id=jiyoung, invited_user_id=a, status="declined"),
        Invitation(workspace_id=seed["other"].workspace_id, member_id=seed["other"].member_id, invited_user_id=a),
    ])
    db.commit()


def _row_is_locked(db, member_id: str) -> bool:
    """다른 연결에서 이 팀원 행을 잠글 수 없으면 True."""
    with db.get_bind().connect() as other:
        free = other.execute(
            text("SELECT member_id FROM member WHERE member_id = :id FOR UPDATE SKIP LOCKED"), {"id": member_id}
        ).first()
    return free is None


def test_revoke_lock_covers_the_target_member_with_the_pms(db, seed):
    # 대상이 PM 이 아니어도 PM 행과 한 쿼리로 member_id 순으로 잠가야, 역할을 바꾸는 요청과 교착하지 않는다.
    if db.get_bind().dialect.name != "postgresql":
        pytest.skip("SQLite 는 FOR UPDATE 를 무시한다.")

    _ensure_other_pm(db, seed["jimin"])

    try:
        assert _row_is_locked(db, seed["jimin"].member_id)
        assert _row_is_locked(db, seed["pm"].member_id)
    finally:
        db.rollback()


def test_promotion_check_locks_the_member_row_shared_with_invite_creation(db, seed):
    # 이 잠금이 없으면 초대 만들기와 동시에 들어온 승격이 PM 역할에 대기 초대를 남긴다.
    if db.get_bind().dialect.name != "postgresql":
        pytest.skip("SQLite 는 FOR UPDATE 를 무시한다.")

    _ensure_no_pending_invitation(db, seed["minsu"])

    try:
        assert _row_is_locked(db, seed["minsu"].member_id)
    finally:
        db.rollback()


def test_invite_racing_an_accept_by_the_same_user_waits_and_is_refused(db, seed):
    """같은 사용자가 다른 팀원 초대를 수락하는 중에 새 초대를 만들면, 공간 잠금에서 기다렸다가 이어진 소속을 본다."""
    if db.get_bind().dialect.name != "postgresql":
        pytest.skip("SQLite 는 FOR UPDATE 를 무시한다.")
    engine = db.get_bind()
    ws, uid, pm_uid, minsu = seed["ws"], seed["jiyoung_uid"], seed["pm"].user_id, seed["minsu"].member_id
    first = _invite_id(ws, seed["jiyoung"].member_id, uid)
    db.commit()
    pids, held, release = {}, Event(), Event()

    def accept():
        with SessionORM(engine) as s:
            s.execute(text("SET LOCAL lock_timeout = '3s'"))
            pids["accept"] = s.scalar(text("SELECT pg_backend_pid()"))
            event.listen(s, "before_commit", lambda _: (held.set(), release.wait(3)), once=True)
            return invitations.accept_invitation(first, s.get(User, uid), s)

    def invite():
        assert held.wait(3)
        with SessionORM(engine) as s:
            s.execute(text("SET LOCAL lock_timeout = '3s'"))
            pids["invite"] = s.scalar(text("SELECT pg_backend_pid()"))
            payload = InvitationCreateRequest(member_id=minsu, user_id=uid)
            try:
                pm = invitations._invitation_pm(ws, payload, s.get(User, pm_uid), s)
                invitations.create_invitation(ws, payload, pm, s)
            except AppError as exc:
                return exc.code.value
            return "created"

    with ThreadPoolExecutor(2) as pool:
        accepted = pool.submit(accept)
        invited = pool.submit(invite)
        assert held.wait(3)
        wait_blocked(engine, pids, "invite", "accept")
        release.set()
        assert accepted.result(5)["data"] == {"workspace_id": ws, "member_id": seed["jiyoung"].member_id}
        assert invited.result(5) == "ALREADY_WORKSPACE_MEMBER"
    assert {i["invitation_id"]: i["status"] for i in _list(ws)} == {first: "accepted"}


@pytest.mark.parametrize("action", ["cancel", "revoke"])
def test_pm_of_another_workspace_cannot_tell_the_invite_exists(db, seed, action):
    other_pm_user = _user(db, "otherpm")
    other_ws = seed["other"].workspace_id
    db.add(Member(workspace_id=other_ws, user_id=other_pm_user.user_id, display_name="다른PM", role="pm"))
    db.commit()
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])
    if action == "revoke":
        assert _act(invitation_id, "accept", "jiyoung-token").status_code == 200

    res = _act(invitation_id, action, "otherpm-token")

    assert res.status_code == 404
    assert _code(res) == "INVITATION_NOT_FOUND"
    assert "workspace_id" not in res.text
    assert len(_workspace_ids("jiyoung-token")) == (1 if action == "revoke" else 0)


def test_last_workspace_is_the_one_just_accepted(db, seed):
    user = db.get(User, seed["jiyoung_uid"])
    own_ws = Workspace(name="내 공간")
    db.add(own_ws)
    db.flush()
    db.add(Member(workspace_id=own_ws.workspace_id, user_id=user.user_id, display_name="지영", role="pm",
                  created_at=datetime.now(timezone.utc) + timedelta(hours=1)))
    db.commit()
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, seed["jiyoung_uid"])
    assert _client("jiyoung-token").get("/api/v1/auth/me").json()["data"]["last_workspace_id"] == own_ws.workspace_id

    accept = _act(invitation_id, "accept", "jiyoung-token")
    assert accept.status_code == 200
    db.execute(
        text("UPDATE invitation SET responded_at = :at WHERE invitation_id = :id"),
        {"at": datetime.now(timezone.utc) + timedelta(hours=2), "id": invitation_id},
    )
    db.commit()

    assert _client("jiyoung-token").get("/api/v1/auth/me").json()["data"]["last_workspace_id"] == seed["ws"]


def _search(q: str, ws: str, token: str = "pm-token"):
    return _client(token).get("/api/v1/users/search", params={"q": q, "workspace_id": ws})


def _found(q: str, ws: str) -> list[dict]:
    res = _search(q, ws)
    assert res.status_code == 200, res.text
    return res.json()["data"]["items"]


@pytest.mark.parametrize("token", ["jimin-token", "outsider-token"])
def test_only_the_workspace_pm_can_search_users(db, seed, token):
    res = _search(db.get(User, seed["jiyoung_uid"]).username, seed["ws"], token)
    assert res.status_code == 403


@pytest.mark.parametrize("workspace_state", ["missing", "deleted"])
def test_search_rejects_missing_or_deleted_workspaces(db, seed, workspace_state):
    workspace_id = seed["ws"]
    if workspace_state == "missing":
        workspace_id = "missing-workspace"
    else:
        db.get(Workspace, workspace_id).deleted_at = datetime.now(timezone.utc)
        db.commit()

    res = _search("outsider", workspace_id)

    assert res.status_code == 404
    assert _code(res) == "WORKSPACE_NOT_FOUND"


def test_search_finds_one_user_by_the_exact_username_ignoring_case(db, seed):
    username = db.get(User, seed["jiyoung_uid"]).username

    items = _found(f"  {username.upper()} ", seed["ws"])

    assert items == [{"user_id": seed["jiyoung_uid"], "username": username, "name": "jiyoung"}]


def test_search_does_not_match_part_of_a_username_or_a_name(db, seed):
    username = db.get(User, seed["jiyoung_uid"]).username

    assert _found(username[:-1], seed["ws"]) == []
    assert _found(username[1:], seed["ws"]) == []
    assert _found("jiyoung", seed["ws"]) == []


@pytest.mark.parametrize("q", ["", "abc", "a" * 21, "한글아이디", "jiyo ung", "jiyoung@example.com"])
def test_search_with_a_query_that_cannot_be_a_username_is_empty(seed, q):
    assert _found(q, seed["ws"]) == []


def test_search_leaves_out_active_members_of_the_workspace(db, seed):
    for who in ("pm", "jimin"):
        assert _found(db.get(User, seed[who].user_id).username, seed["ws"]) == []
    seed["jimin"].is_deleted = True
    db.commit()

    assert [i["user_id"] for i in _found(db.get(User, seed["jimin"].user_id).username, seed["ws"])] == [
        seed["jimin"].user_id
    ]


def test_found_user_can_be_invited(db, seed):
    [found] = _found(db.get(User, seed["outsider_uid"]).username, seed["ws"])

    assert _invite(seed["ws"], seed["minsu"].member_id, found["user_id"]).status_code == 201


def test_migration_keeps_the_open_invite_indexes_partial_on_sqlite():
    path = Path(__file__).parents[2] / "migrations" / "versions" / "e8b2f4c6a1d9_add_invitation.py"
    spec = importlib.util.spec_from_file_location("add_invitation_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite:///:memory:")

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()
        indexes = conn.execute(
            text("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE 'uq_invitation_pending_%'")
        ).all()

    assert {name for name, _ in indexes} == {"uq_invitation_pending_member", "uq_invitation_pending_email"}
    assert all("WHERE status = 'pending'" in sql for _, sql in indexes)
