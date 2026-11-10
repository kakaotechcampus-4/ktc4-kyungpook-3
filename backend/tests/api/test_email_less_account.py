"""카카오만으로 가입해 이메일이 없는 계정(#610)이 이메일을 키로 쓰던 경로에서 깨지지 않는다."""
import secrets

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import Invitation, Member, User
from app.services import kakao_oauth
from app.services.kakao_oauth import KakaoIdentity
from tests.api.conftest import signup_verified
from tests.api.test_messages_api import client as session_client

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


def _invite(mseed, user_id: str, member: str = "carol") -> str:
    res = session_client("pm").post(
        f"{P}/workspaces/{mseed['ws']}/invitations", json={"member_id": mseed[member].member_id, "user_id": user_id}
    )
    assert res.status_code == 201, res.text
    return res.json()["data"]["invitation_id"]


def test_me_shows_a_null_email(mdb):
    client, user_id = _kakao_only()

    res = client.get(f"{P}/auth/me")

    assert res.status_code == 200
    assert res.json()["data"]["user"] == {
        "user_id": user_id, "username": "kakaouser", "email": None, "name": "동우", "avatar_url": None,
    }


def test_an_invitation_by_user_id_reaches_an_email_less_account_and_accepting_links_the_member(mdb, mseed):
    client, user_id = _kakao_only()
    invitation_id = _invite(mseed, user_id)

    [item] = client.get(f"{P}/invitations/me").json()["data"]["items"]
    assert item["invitation_id"] == invitation_id
    res = client.post(f"{P}/invitations/{invitation_id}/accept")

    assert res.status_code == 200, res.text
    assert res.json()["data"] == {"workspace_id": mseed["ws"], "member_id": mseed["carol"].member_id}
    mdb.expire_all()
    assert mdb.get(Member, mseed["carol"].member_id).user_id == user_id
    assert [w["workspace_id"] for w in client.get(f"{P}/workspaces").json()["data"]["items"]] == [mseed["ws"]]


def test_an_email_less_account_can_decline_its_invitation(mdb, mseed):
    client, user_id = _kakao_only()
    invitation_id = _invite(mseed, user_id)

    assert client.post(f"{P}/invitations/{invitation_id}/decline").status_code == 200

    assert client.get(f"{P}/invitations/me").json()["data"]["items"] == []
    mdb.expire_all()
    assert mdb.get(Invitation, invitation_id).status == "declined"


def test_withdrawal_deletes_invitations_addressed_to_the_account(mdb, mseed):
    client, user_id = _kakao_only()
    mine = _invite(mseed, user_id)
    outsider_id = mdb.scalar(select(User.user_id).where(User.email == "outsider@example.com"))
    stranger = Member(workspace_id=mseed["ws"], display_name="다른 사람", role="member")
    mdb.add(stranger)
    mdb.commit()
    mseed["stranger"] = stranger
    theirs = _invite(mseed, outsider_id, member="stranger")

    res = client.delete(
        f"{P}/auth/me", headers={"X-Withdrawal-Key": secrets.token_urlsafe(32), "X-Withdrawal-Account-ID": user_id}
    )

    assert res.status_code == 202, res.text
    mdb.expire_all()
    assert mdb.get(User, user_id) is None
    assert mdb.get(Invitation, mine) is None
    assert mdb.get(Invitation, theirs).status == "pending"


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
