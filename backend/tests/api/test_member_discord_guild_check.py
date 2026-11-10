"""팀원에 디스코드 계정을 붙이려면 그 계정이 워크스페이스에 연결한 서버의 멤버여야 한다.

연결한 서버가 없거나, 서버에 없는 계정이거나, Discord 로 확인하지 못하면 저장하지 않는다. 계정을 푸는 요청은 확인하지 않는다.
봇이 DM 을 가져갈 때도 디스코드 서버를 연결하지 않은 워크스페이스의 DM 은 보내지 않고 닫는다.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.main import app
from app.models import DmFailureReason, DmStatus, Integration, Member
from app.services import discord
from app.services import messages as svc
from app.services.discord import DiscordApiError

API = "/api/v1"
NOW = datetime(2026, 11, 10, 9, 0, tzinfo=timezone.utc)
LATER = NOW + timedelta(days=1)


@pytest.fixture
def client(mseed):
    c = TestClient(app)
    c.cookies.set("session_token", "pm-token")
    return c


@pytest.fixture
def guild(mdb, mseed, monkeypatch):
    """봇 토큰과 Discord 연동 행(guild g1)을 갖춘다."""
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")
    mdb.execute(delete(Integration).where(Integration.workspace_id == mseed["ws"], Integration.provider == "discord"))
    mdb.add(Integration(workspace_id=mseed["ws"], provider="discord", provider_channel_id="g1"))
    mdb.commit()


@pytest.fixture
def lookups(monkeypatch):
    """get_guild_member 스텁. lookups.error 에 던질 예외를, lookups.during 에 기다리는 동안 할 일을 넣는다."""
    class Lookups(list):
        error: Exception | None = None
        during = None

    rec = Lookups()

    def fake(bot_token, guild_id, user_id, **kwargs):
        rec.append((guild_id, user_id))
        if rec.during is not None:
            rec.during()
        if rec.error is not None:
            raise rec.error
        return {"nick": None, "user": {"id": user_id}}

    monkeypatch.setattr(discord, "get_guild_member", fake)
    return rec


def _post(client, wid, discord_user_id, name="새 팀원"):
    return client.post(
        f"{API}/members", json={"workspace_id": wid, "display_name": name, "discord_user_id": discord_user_id}
    )


def _count(db, wid) -> int:
    db.expire_all()
    return db.scalar(select(func.count()).select_from(Member).where(Member.workspace_id == wid))


def _code(r) -> str:
    return r.json()["error"]["code"]


def test_post_accepts_a_user_in_the_connected_guild(client, mdb, mseed, guild, lookups):
    r = _post(client, mseed["ws"], "d1")

    assert r.status_code == 201
    assert r.json()["data"]["discord_user_id"] == "d1"
    assert lookups == [("g1", "d1")]


def test_post_without_discord_integration_is_rejected(client, mdb, mseed, lookups, monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")
    mdb.execute(delete(Integration).where(Integration.workspace_id == mseed["ws"]))
    mdb.commit()
    before = _count(mdb, mseed["ws"])

    r = _post(client, mseed["ws"], "d1")

    assert (r.status_code, _code(r)) == (409, "INTEGRATION_NOT_CONNECTED")
    assert _count(mdb, mseed["ws"]) == before
    assert lookups == []


@pytest.mark.parametrize("channel_id", [None, ""])
def test_post_with_integration_but_no_guild_is_rejected(client, mdb, mseed, lookups, monkeypatch, channel_id):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")
    mdb.execute(delete(Integration).where(Integration.workspace_id == mseed["ws"]))
    mdb.add(Integration(workspace_id=mseed["ws"], provider="discord", provider_channel_id=channel_id))
    mdb.commit()

    r = _post(client, mseed["ws"], "d1")

    assert (r.status_code, _code(r)) == (409, "INTEGRATION_NOT_CONNECTED")
    assert lookups == []


@pytest.mark.parametrize("error", [
    DiscordApiError("HTTP 404 (Unknown Member)", status_code=404, discord_code=10007),
    DiscordApiError("HTTP 404 (Unknown User)", status_code=404, discord_code=10013),
    DiscordApiError("HTTP 400", status_code=400, discord_code=50035),
], ids=["unknown_member", "unknown_user", "invalid_id"])
def test_post_user_not_in_guild_is_rejected(client, mdb, mseed, guild, lookups, error):
    lookups.error = error
    before = _count(mdb, mseed["ws"])

    r = _post(client, mseed["ws"], "d1")

    assert (r.status_code, _code(r)) == (409, "DISCORD_USER_NOT_IN_GUILD")
    assert r.json()["error"]["details"] == {"discord_user_id": "d1"}
    assert _count(mdb, mseed["ws"]) == before


@pytest.mark.parametrize("error", [
    DiscordApiError("요청 실패: ReadTimeout"),
    DiscordApiError("HTTP 500", status_code=500),
    DiscordApiError("HTTP 403 (Missing Access)", status_code=403, discord_code=50001),
    DiscordApiError("HTTP 404 (Unknown Guild)", status_code=404, discord_code=10004),
], ids=["timeout", "server_error", "missing_access", "unknown_guild"])
def test_post_when_discord_cannot_confirm_is_rejected_as_retryable(client, mdb, mseed, guild, lookups, error):
    lookups.error = error
    before = _count(mdb, mseed["ws"])

    r = _post(client, mseed["ws"], "d1")

    assert (r.status_code, _code(r)) == (502, "DISCORD_API_FAILED")
    assert _count(mdb, mseed["ws"]) == before


def test_post_without_bot_token_is_rejected_without_calling_discord(client, mdb, mseed, guild, lookups, monkeypatch):
    monkeypatch.delenv("DISCORD_BOT_TOKEN", raising=False)
    before = _count(mdb, mseed["ws"])

    r = _post(client, mseed["ws"], "d1")

    assert (r.status_code, _code(r)) == (502, "DISCORD_API_FAILED")
    assert r.json()["error"]["details"]["reason"] == "bot_token_missing"
    assert _count(mdb, mseed["ws"]) == before
    assert lookups == []


def test_post_without_discord_user_needs_no_integration(client, mdb, mseed, lookups):
    mdb.execute(delete(Integration).where(Integration.workspace_id == mseed["ws"]))
    mdb.commit()

    r = _post(client, mseed["ws"], None)

    assert r.status_code == 201
    assert lookups == []


def test_non_pm_cannot_make_the_server_look_up_discord(client, mdb, mseed, guild, lookups):
    client.cookies.set("session_token", "outsider-token")

    r = _post(client, mseed["ws"], "d1")

    assert r.status_code == 403
    assert lookups == []


def test_discord_is_looked_up_with_no_transaction_open(client, mdb, mseed, guild, lookups):
    seen: list[bool] = []
    lookups.during = lambda: seen.append(mdb.in_transaction())

    r = _post(client, mseed["ws"], "d1")

    assert r.status_code == 201
    assert seen == [False]


def test_post_is_rejected_when_the_guild_is_disconnected_during_the_lookup(client, mdb, mseed, guild, lookups):
    def disconnect():
        mdb.execute(delete(Integration).where(Integration.workspace_id == mseed["ws"]))
        mdb.commit()

    lookups.during = disconnect
    before = _count(mdb, mseed["ws"])

    r = _post(client, mseed["ws"], "d1")

    assert (r.status_code, _code(r)) == (409, "INTEGRATION_NOT_CONNECTED")
    assert _count(mdb, mseed["ws"]) == before


def test_post_is_rejected_when_the_guild_changes_during_the_lookup(client, mdb, mseed, guild, lookups):
    def move():
        mdb.execute(
            Integration.__table__.update()
            .where(Integration.workspace_id == mseed["ws"])
            .values(provider_channel_id="g2")
        )
        mdb.commit()

    lookups.during = move
    before = _count(mdb, mseed["ws"])

    r = _post(client, mseed["ws"], "d1")

    assert (r.status_code, _code(r)) == (409, "INTEGRATION_NOT_CONNECTED")
    assert _count(mdb, mseed["ws"]) == before


def test_patch_to_a_user_not_in_guild_keeps_the_old_account(client, mdb, mseed, guild, lookups):
    lookups.error = DiscordApiError("HTTP 404 (Unknown Member)", status_code=404, discord_code=10007)

    r = client.patch(f"{API}/members/{mseed['carol'].member_id}", json={"discord_user_id": "d9"})

    assert (r.status_code, _code(r)) == (409, "DISCORD_USER_NOT_IN_GUILD")
    mdb.refresh(mseed["carol"])
    assert mseed["carol"].discord_user_id == "d_carol"


def test_patch_without_discord_integration_is_rejected(client, mdb, mseed, lookups, monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")
    mdb.execute(delete(Integration).where(Integration.workspace_id == mseed["ws"]))
    mdb.commit()

    r = client.patch(f"{API}/members/{mseed['bob'].member_id}", json={"discord_user_id": "d9"})

    assert (r.status_code, _code(r)) == (409, "INTEGRATION_NOT_CONNECTED")
    mdb.refresh(mseed["bob"])
    assert mseed["bob"].discord_user_id is None
    assert lookups == []


def test_patch_when_discord_cannot_confirm_keeps_the_old_account(client, mdb, mseed, guild, lookups):
    lookups.error = DiscordApiError("요청 실패: ReadTimeout")

    r = client.patch(f"{API}/members/{mseed['carol'].member_id}", json={"discord_user_id": "d9"})

    assert (r.status_code, _code(r)) == (502, "DISCORD_API_FAILED")
    mdb.refresh(mseed["carol"])
    assert mseed["carol"].discord_user_id == "d_carol"


def test_patch_to_a_user_in_guild_is_saved(client, mdb, mseed, guild, lookups):
    r = client.patch(f"{API}/members/{mseed['bob'].member_id}", json={"discord_user_id": "d9"})

    assert r.status_code == 200
    assert r.json()["data"]["discord_user_id"] == "d9"
    assert lookups == [("g1", "d9")]


def test_patch_clearing_the_account_needs_no_lookup_or_integration(client, mdb, mseed, lookups):
    mdb.execute(delete(Integration).where(Integration.workspace_id == mseed["ws"]))
    mdb.commit()

    r = client.patch(f"{API}/members/{mseed['carol'].member_id}", json={"discord_user_id": None})

    assert r.status_code == 200
    assert r.json()["data"]["discord_user_id"] is None
    assert lookups == []


def test_patch_with_the_same_account_needs_no_lookup(client, mdb, mseed, lookups):
    mdb.execute(delete(Integration).where(Integration.workspace_id == mseed["ws"]))
    mdb.commit()

    r = client.patch(
        f"{API}/members/{mseed['carol'].member_id}", json={"discord_user_id": "d_carol", "notion_name": "x"}
    )

    assert r.status_code == 200
    assert lookups == []


def test_patch_on_a_member_deleted_during_the_lookup_is_404(client, mdb, mseed, guild, lookups):
    def remove():
        member = mdb.get(Member, mseed["bob"].member_id)
        member.is_deleted = True
        mdb.commit()

    lookups.during = remove

    r = client.patch(f"{API}/members/{mseed['bob'].member_id}", json={"discord_user_id": "d9"})

    assert (r.status_code, _code(r)) == (404, "MEMBER_NOT_FOUND")
    mdb.refresh(mseed["bob"])
    assert mseed["bob"].discord_user_id is None


def test_claim_closes_dms_of_a_workspace_without_discord_integration(mdb, mseed):
    reminder = svc.create_reminder(
        mdb, workspace_id=mseed["ws"], task_id=mseed["tasks"][0].task_id, member_id=mseed["alice"].member_id,
        scheduled_at=LATER, note="마감 확인 부탁해요", created_by=mseed["pm"].member_id, now=NOW,
    )
    mdb.commit()
    mdb.refresh(reminder)
    bundle = svc.get_bundle(mdb, mseed["ws"], reminder.bundle_id)
    svc.approve_bundle(mdb, bundle, draft_version=bundle.draft_version, approved_by=mseed["pm"].member_id, now=NOW)
    mdb.commit()
    (msg,) = svc.dispatch_due(mdb, LATER)
    assert msg.dm_status == DmStatus.PENDING
    mdb.commit()
    mdb.execute(delete(Integration).where(Integration.workspace_id == mseed["ws"]))
    mdb.commit()

    assert svc.claim_for_bot(mdb, LATER) == []

    mdb.refresh(msg)
    assert msg.dm_status == DmStatus.FAILED
    assert msg.dm_failure_reason == DmFailureReason.DISCORD_NOT_LINKED
    assert msg.claimed_at is None
