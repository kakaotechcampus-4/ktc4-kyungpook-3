"""카카오만으로 가입해 이메일이 없는 계정(#610)이 이메일을 키로 쓰던 경로에서 깨지지 않는다."""
import secrets

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import Invitation, Member, User, Workspace
from app.services import kakao_oauth
from app.services.kakao_oauth import KakaoIdentity
from tests.api.conftest import signup_verified

P = "/api/v1"


@pytest.fixture(autouse=True)
def _secret(signup_secret):
    pass


def _client():
    return TestClient(app, base_url="https://testserver")


def _kakao_only(provider_id="77", username="kakaouser"):
    """카카오 이메일이 있어도 저장되지 않는 새 카카오 가입. 로그인된 클라이언트와 user_id 를 돌려준다."""
    client = _client()
    identity = KakaoIdentity(provider_id, "동우")
    client.cookies.set(kakao_oauth.PENDING_COOKIE, kakao_oauth.seal_pending(identity))
    res = client.post(f"{P}/auth/signup", json={"name": "동우", "username": username, "link_kakao": True})
    assert res.status_code == 201, res.text
    assert res.json()["data"]["user"]["email"] is None
    return client, res.json()["data"]["user"]["user_id"]


def _pending_invitation(db, email="kim@example.com") -> str:
    workspace = Workspace(name="A")
    db.add(workspace)
    db.flush()
    member = Member(workspace_id=workspace.workspace_id, display_name="동우", role="member")
    db.add(member)
    db.flush()
    invitation = Invitation(workspace_id=workspace.workspace_id, member_id=member.member_id, email=email)
    db.add(invitation)
    db.commit()
    return invitation.invitation_id


def test_me_shows_a_null_email(mdb):
    client, user_id = _kakao_only()

    res = client.get(f"{P}/auth/me")

    assert res.status_code == 200
    assert res.json()["data"]["user"] == {
        "user_id": user_id, "username": "kakaouser", "email": None, "name": "동우", "avatar_url": None,
    }


def test_my_invitations_is_empty_even_with_an_invitation_to_the_kakao_email(mdb):
    _pending_invitation(mdb)
    client, _ = _kakao_only()

    res = client.get(f"{P}/invitations/me")

    assert res.status_code == 200
    assert res.json()["data"] == {"items": [], "total": 0}


@pytest.mark.parametrize("action", ["accept", "decline"])
def test_an_email_invitation_is_not_found_for_an_email_less_account(mdb, action):
    invitation_id = _pending_invitation(mdb)
    client, _ = _kakao_only()

    res = client.post(f"{P}/invitations/{invitation_id}/{action}")

    assert res.status_code == 404
    assert res.json()["error"]["code"] == "INVITATION_NOT_FOUND"
    mdb.expire_all()
    assert mdb.get(Invitation, invitation_id).status == "pending"


def test_withdrawal_removes_the_account_and_leaves_email_rows_alone(mdb):
    invitation_id = _pending_invitation(mdb)
    client, user_id = _kakao_only()

    res = client.delete(
        f"{P}/auth/me", headers={"X-Withdrawal-Key": secrets.token_urlsafe(32), "X-Withdrawal-Account-ID": user_id}
    )

    assert res.status_code == 202, res.text
    mdb.expire_all()
    assert mdb.get(User, user_id) is None
    assert mdb.get(Invitation, invitation_id) is not None


def test_same_kakao_can_sign_up_again_after_withdrawal(mdb):
    client, user_id = _kakao_only()
    client.delete(
        f"{P}/auth/me", headers={"X-Withdrawal-Key": secrets.token_urlsafe(32), "X-Withdrawal-Account-ID": user_id}
    )

    _, again = _kakao_only()

    assert again != user_id
    assert mdb.scalars(select(User.user_id)).all() == [again]


def test_two_email_less_accounts_can_coexist(mdb):
    _kakao_only("77", "first1")
    _kakao_only("78", "second2")
    signup_verified(_client(), "other@example.com")

    assert sorted(mdb.scalars(select(User.email)).all(), key=str) == [None, None, "other@example.com"]
