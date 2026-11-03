"""팀원 초대(#319). PM 이 온보딩에서 만든 팀원(로그인 계정 없음)에게 가입 이메일로 초대를 만들고,
그 이메일로 로그인한 사람이 내 초대에서 수락하면 팀원과 계정이 이어진다. 수락 전에는 워크스페이스에 들어갈 수 없다.

TEST_DATABASE_URL 이 있으면 PostgreSQL 에서도 돈다.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import invitations
from app.core.database import Base, get_db
from app.main import app
from app.models import Invitation, Member, Session as SessionModel, User, Workspace

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


def _user(db, name: str, email: str | None = None) -> User:
    user = User(email=email or f"{name}@example.com", name=name)
    db.add(user)
    db.flush()
    db.add(SessionModel(
        user_id=user.user_id, session_token=f"{name}-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    return user


@pytest.fixture
def seed(db):
    """워크스페이스 A: PM(pm), 계정이 연결된 팀원 jimin, 디스코드 명단으로만 만든 팀원 minsu·jiyoung(계정 없음).
    jiyoung 계정은 초대 전에 이미 가입했다. outsider 는 A 와 상관없다. 워크스페이스 B 에도 명단 팀원이 하나 있다."""
    pm_user = _user(db, "pm")
    jimin_user = _user(db, "jimin")
    _user(db, "jiyoung")
    _user(db, "outsider")

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
    return {"ws": wid, "pm": pm, "jimin": jimin, "minsu": minsu, "jiyoung": jiyoung, "other": other}


def _client(token: str | None = None) -> TestClient:
    c = TestClient(app, base_url="https://testserver")
    if token:
        c.cookies.set("session_token", token)
    return c


def _invite(ws: str, member_id: str, email: str, token: str = "pm-token"):
    return _client(token).post(
        f"/api/v1/workspaces/{ws}/invitations", json={"member_id": member_id, "email": email}
    )


def _invite_id(ws: str, member_id: str, email: str) -> str:
    res = _invite(ws, member_id, email)
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
    res = c.post("/api/v1/auth/signup", json={"email": email, "password": "pw-123456", "name": name})
    assert res.status_code == 201, res.text
    return c


def test_pm_creates_invite_and_sees_it_in_the_list(seed):
    res = _invite(seed["ws"], seed["minsu"].member_id, "minsu@example.com")

    assert res.status_code == 201
    created = res.json()["data"]
    assert created["member_id"] == seed["minsu"].member_id
    assert created["member_display_name"] == "민수"
    assert created["email"] == "minsu@example.com"
    assert created["status"] == "pending"
    assert created["invited_by_name"] == "pm"
    assert created["accepted_user"] is None
    assert created["responded_at"] is None
    assert [i["invitation_id"] for i in _list(seed["ws"])] == [created["invitation_id"]]


@pytest.mark.parametrize("token", ["jimin-token", "outsider-token"])
def test_only_pm_creates_and_lists_invites(seed, token):
    res = _invite(seed["ws"], seed["minsu"].member_id, "minsu@example.com", token=token)
    assert res.status_code == 403
    assert _client(token).get(f"/api/v1/workspaces/{seed['ws']}/invitations").status_code == 403


def test_member_outside_the_workspace_or_unknown_is_not_found(seed):
    assert _code(_invite(seed["ws"], seed["other"].member_id, "x@example.com")) == "MEMBER_NOT_FOUND"
    res = _invite(seed["ws"], "no-such-member", "x@example.com")
    assert res.status_code == 404
    assert _code(res) == "MEMBER_NOT_FOUND"


def test_invalid_email_is_rejected(seed):
    assert _invite(seed["ws"], seed["minsu"].member_id, "not-an-email").status_code == 400


def test_user_who_signed_up_before_the_invite_sees_it(seed):
    assert _mine("jiyoung-token") == []
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")

    [item] = _mine("jiyoung-token")
    assert item["invitation_id"] == invitation_id
    assert item["workspace_id"] == seed["ws"]
    assert item["workspace_name"] == "A"
    assert item["member_display_name"] == "지영"
    assert item["invited_by_name"] == "pm"
    assert _mine("outsider-token") == []


def test_email_match_ignores_case_and_spaces_for_a_user_who_signs_up_after(seed):
    res = _invite(seed["ws"], seed["minsu"].member_id, "  Minsu@Example.COM ")
    assert res.json()["data"]["email"] == "minsu@example.com"

    minsu = _signup("MINSU@example.com", "민수")
    [item] = minsu.get("/api/v1/invitations/me").json()["data"]["items"]
    accepted = minsu.post(f"/api/v1/invitations/{item['invitation_id']}/accept")

    assert accepted.status_code == 200
    assert accepted.json()["data"] == {"workspace_id": seed["ws"], "member_id": seed["minsu"].member_id}


def test_before_accepting_the_workspace_is_closed(seed):
    _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")

    c = _client("jiyoung-token")
    assert c.get(f"/api/v1/workspaces/{seed['ws']}").status_code == 403
    assert c.get("/api/v1/members", params={"workspace_id": seed["ws"]}).status_code == 403
    assert _workspace_ids("jiyoung-token") == []
    assert _workspace_count("jiyoung-token") == 0


def test_accept_links_the_member_and_opens_the_workspace(seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")

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
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")

    res = _act(invitation_id, "decline", "jiyoung-token")

    assert res.status_code == 200
    assert _mine("jiyoung-token") == []
    assert _list(seed["ws"])[0]["status"] == "declined"
    assert _code(_act(invitation_id, "accept", "jiyoung-token")) == "INVITATION_NOT_PENDING"
    assert _workspace_count("jiyoung-token") == 0


def test_pm_cancels_a_pending_invite(seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")
    assert _act(invitation_id, "cancel", "jimin-token").status_code == 403
    assert _act(invitation_id, "cancel", "outsider-token").status_code == 403

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
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")

    for action in ("accept", "decline"):
        res = _act(invitation_id, action, "outsider-token")
        assert res.status_code == 404
        assert _code(res) == "INVITATION_NOT_FOUND"
    assert _act("no-such-invite", "accept", "jiyoung-token").status_code == 404
    assert _act("no-such-invite", "cancel", "pm-token").status_code == 404
    assert _list(seed["ws"])[0]["status"] == "pending"
    assert _workspace_count("outsider-token") == 0


def test_member_already_linked_cannot_be_invited(seed):
    res = _invite(seed["ws"], seed["jimin"].member_id, "someone@example.com")
    assert res.status_code == 409
    assert _code(res) == "MEMBER_ALREADY_LINKED"


def test_pm_member_cannot_be_invited(db, seed):
    # 초대로 들어온 계정이 바로 PM 이 되면 원래 PM 을 내려 연결 끊기를 막을 수 있다.
    seed["minsu"].role = "pm"
    db.commit()

    res = _invite(seed["ws"], seed["minsu"].member_id, "jiyoung@example.com")

    assert res.status_code == 409
    assert _code(res) == "PM_MEMBER_NOT_INVITABLE"
    assert _list(seed["ws"]) == []


def test_member_promoted_to_pm_while_pending_cannot_be_accepted(seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")
    member_url = f"/api/v1/members/{seed['jiyoung'].member_id}"
    assert _client("pm-token").patch(member_url, json={"role": "pm"}).status_code == 200

    assert _mine("jiyoung-token") == []
    res = _act(invitation_id, "accept", "jiyoung-token")

    assert res.status_code == 409
    assert _code(res) == "PM_MEMBER_NOT_INVITABLE"
    assert _workspace_count("jiyoung-token") == 0

    assert _client("pm-token").patch(member_url, json={"role": "member"}).status_code == 200
    assert len(_mine("jiyoung-token")) == 1
    assert _act(invitation_id, "accept", "jiyoung-token").status_code == 200


def test_non_ascii_member_email_blocks_inviting_it_again(db, seed):
    jiyoung_user = db.query(User).filter(User.email == "jiyoung@example.com").one()
    jiyoung_user.email = "Émile@example.com"
    seed["jiyoung"].user_id = jiyoung_user.user_id
    db.commit()

    res = _invite(seed["ws"], seed["minsu"].member_id, "Émile@example.com")

    assert res.status_code == 409
    assert _code(res) == "ALREADY_WORKSPACE_MEMBER"


def test_accept_refused_when_the_member_got_linked_meanwhile(db, seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")
    outsider = db.query(User).filter(User.email == "outsider@example.com").one()
    seed["jiyoung"].user_id = outsider.user_id
    db.commit()

    res = _act(invitation_id, "accept", "jiyoung-token")

    assert res.status_code == 409
    assert _code(res) == "MEMBER_ALREADY_LINKED"
    assert _workspace_count("jiyoung-token") == 0
    assert _list(seed["ws"])[0]["status"] == "pending"


@pytest.mark.parametrize("email", ["jimin@example.com", " JIMIN@Example.com"])
def test_account_already_in_the_workspace_cannot_be_invited(db, seed, email):
    db.get(User, seed["jimin"].user_id).email = "Jimin@Example.com"
    db.commit()

    res = _invite(seed["ws"], seed["minsu"].member_id, email)
    assert res.status_code == 409
    assert _code(res) == "ALREADY_WORKSPACE_MEMBER"


def test_accept_refused_when_the_account_is_already_a_member(db, seed):
    invitation_id = _invite_id(seed["ws"], seed["minsu"].member_id, "jiyoung@example.com")
    jiyoung = db.query(User).filter(User.email == "jiyoung@example.com").one()
    seed["jiyoung"].user_id = jiyoung.user_id
    db.commit()

    res = _act(invitation_id, "accept", "jiyoung-token")

    assert res.status_code == 409
    assert _code(res) == "ALREADY_WORKSPACE_MEMBER"
    assert _workspace_count("jiyoung-token") == 1


def test_reinviting_a_member_cancels_the_open_invite(seed):
    old_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@exmaple.com")
    new_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")

    by_id = {i["invitation_id"]: i for i in _list(seed["ws"])}
    assert by_id[old_id]["status"] == "canceled"
    assert by_id[old_id]["responded_at"] is not None
    assert by_id[new_id]["status"] == "pending"
    assert [i["invitation_id"] for i in _list(seed["ws"])] == [new_id, old_id]
    assert [i["invitation_id"] for i in _mine("jiyoung-token")] == [new_id]
    assert _act(new_id, "accept", "jiyoung-token").status_code == 200


def test_reinviting_with_the_same_email_replaces_the_open_invite(seed):
    old_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")
    new_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")

    assert [i["invitation_id"] for i in _mine("jiyoung-token")] == [new_id]
    assert _code(_act(old_id, "accept", "jiyoung-token")) == "INVITATION_NOT_PENDING"


def test_same_email_cannot_be_pending_for_two_members(seed):
    _invite_id(seed["ws"], seed["minsu"].member_id, "jiyoung@example.com")

    res = _invite(seed["ws"], seed["jiyoung"].member_id, "JIYOUNG@example.com")

    assert res.status_code == 409
    assert _code(res) == "EMAIL_ALREADY_INVITED"
    assert len(_list(seed["ws"])) == 1


def test_same_email_race_lost_at_the_db_is_409_not_500(seed, monkeypatch):
    # 다른 팀원에게 같은 이메일 초대가 사전 검사와 저장 사이에 생기고, 재확인 전에 닫힌 경우를 흉내 낸다.
    _invite_id(seed["ws"], seed["minsu"].member_id, "same@example.com")
    monkeypatch.setattr(invitations, "_email_pending_for_other_member", lambda *args: False)

    res = _invite(seed["ws"], seed["jiyoung"].member_id, "same@example.com")

    assert res.status_code == 409
    assert _code(res) == "EMAIL_ALREADY_INVITED"


def test_reinvite_after_decline_works(seed):
    first = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")
    assert _act(first, "decline", "jiyoung-token").status_code == 200

    second = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")

    assert _act(second, "accept", "jiyoung-token").status_code == 200
    assert _workspace_ids("jiyoung-token") == [seed["ws"]]


def test_revoke_unlinks_the_account_and_keeps_the_member(seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")
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


def test_revoke_closes_a_leftover_pending_invite_for_the_same_email(db, seed):
    # 수락과 새 초대가 겹치면 같은 이메일의 대기 초대가 남을 수 있다. 끊긴 계정이 그 초대로 돌아오면 안 된다.
    invitation_id = _invite_id(seed["ws"], seed["minsu"].member_id, "jiyoung@example.com")
    assert _act(invitation_id, "accept", "jiyoung-token").status_code == 200
    leftover = Invitation(
        workspace_id=seed["ws"], member_id=seed["jiyoung"].member_id, email="jiyoung@example.com"
    )
    db.add(leftover)
    db.commit()
    leftover_id = leftover.invitation_id

    assert _act(invitation_id, "revoke", "pm-token").status_code == 200

    assert _mine("jiyoung-token") == []
    res = _act(leftover_id, "accept", "jiyoung-token")
    assert res.status_code == 409
    assert _code(res) == "INVITATION_NOT_PENDING"
    assert _workspace_count("jiyoung-token") == 0
    assert {i["invitation_id"]: i["status"] for i in _list(seed["ws"])}[leftover_id] == "canceled"


def test_revoke_only_applies_to_accepted_invites(seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")

    res = _act(invitation_id, "revoke", "pm-token")

    assert res.status_code == 409
    assert _code(res) == "INVITATION_NOT_ACCEPTED"
    assert _list(seed["ws"])[0]["status"] == "pending"


def test_reinvite_after_revoke_links_again(seed):
    first = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")
    assert _act(first, "accept", "jiyoung-token").status_code == 200
    assert _act(first, "revoke", "pm-token").status_code == 200

    second = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")

    assert _act(second, "accept", "jiyoung-token").status_code == 200
    assert _workspace_ids("jiyoung-token") == [seed["ws"]]
    statuses = {i["invitation_id"]: i["status"] for i in _list(seed["ws"])}
    assert statuses == {first: "revoked", second: "accepted"}


def test_revoking_the_last_web_pm_is_refused(db, seed):
    invitation_id = _invite_id(seed["ws"], seed["minsu"].member_id, "jiyoung@example.com")
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
    invitation_id = _invite_id(seed["ws"], seed["minsu"].member_id, "jiyoung@example.com")
    assert _act(invitation_id, "accept", "jiyoung-token").status_code == 200
    seed["minsu"].role = "pm"
    db.commit()

    assert _act(invitation_id, "revoke", "pm-token").status_code == 200
    assert _workspace_ids("jiyoung-token") == []


def test_deleted_members_invite_is_hidden_and_cannot_be_accepted(db, seed):
    invitation_id = _invite_id(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")
    seed["jiyoung"].is_deleted = True
    db.commit()

    assert _mine("jiyoung-token") == []
    res = _act(invitation_id, "accept", "jiyoung-token")
    assert res.status_code == 409
    assert _code(res) == "INVITATION_NOT_PENDING"
    assert _workspace_count("jiyoung-token") == 0
    assert _code(_invite(seed["ws"], seed["jiyoung"].member_id, "jiyoung@example.com")) == "MEMBER_NOT_FOUND"


def test_db_allows_one_pending_invite_per_member_and_per_workspace_email(db, seed):
    wid, minsu, jiyoung = seed["ws"], seed["minsu"].member_id, seed["jiyoung"].member_id
    db.add(Invitation(workspace_id=wid, member_id=minsu, email="a@example.com"))
    db.commit()

    for member_id, email in ((minsu, "b@example.com"), (jiyoung, "a@example.com")):
        db.add(Invitation(workspace_id=wid, member_id=member_id, email=email))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

    db.add_all([
        Invitation(workspace_id=wid, member_id=minsu, email="a@example.com", status="canceled"),
        Invitation(workspace_id=wid, member_id=jiyoung, email="a@example.com", status="declined"),
    ])
    db.commit()
