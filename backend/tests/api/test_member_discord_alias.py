"""디스코드 계정을 연결하면 서버 닉네임(한글만)을 별칭으로 넣는다 (#459).

Discord 호출은 커밋 뒤에 하고 실패해도 팀원 저장·응답은 그대로다. 테스트는 get_guild_member 를 스텁으로 바꾼다.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import Integration, MemberAlias
from app.services import member_aliases
from app.services.discord import DiscordApiError

API = "/api/v1"


@pytest.fixture
def client(mseed):
    c = TestClient(app)
    c.cookies.set("session_token", "pm-token")
    return c


@pytest.fixture
def discord_env(mdb, mseed, monkeypatch):
    """봇 토큰과 Discord 연동 행(guild g1)을 갖춘다."""
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")
    mdb.add(Integration(workspace_id=mseed["ws"], provider="discord", provider_channel_id="g1"))
    mdb.commit()


@pytest.fixture
def calls(monkeypatch):
    """get_guild_member 스텁. calls.nick 에 돌려줄 닉네임을, calls.error 에 던질 예외를 넣는다."""
    class Calls(list):
        nick: str | None = "동우"
        error: Exception | None = None

    rec = Calls()

    def fake(bot_token, guild_id, user_id, **kwargs):
        rec.append((guild_id, user_id, kwargs))
        if rec.error is not None:
            raise rec.error
        return {"nick": rec.nick, "user": {"id": user_id}}

    monkeypatch.setattr(member_aliases.discord, "get_guild_member", fake)
    return rec


def _profile(db, member_id: str) -> list[MemberAlias]:
    db.expire_all()
    stmt = select(MemberAlias).where(
        MemberAlias.member_id == member_id, MemberAlias.source == "discord_profile"
    )
    return list(db.execute(stmt).scalars())


def _post(client, wid, name, discord_user_id, **extra):
    return client.post(
        f"{API}/members",
        json={"workspace_id": wid, "display_name": name, "discord_user_id": discord_user_id, **extra},
    )


def test_post_member_adds_korean_nickname_alias(client, mdb, mseed, discord_env, calls):
    r = _post(client, mseed["ws"], "Alice", "d1")

    assert r.status_code == 201
    rows = _profile(mdb, r.json()["data"]["member_id"])
    assert [(x.alias_text, x.alias_type, x.verified, x.confidence, x.workspace_id) for x in rows] == [
        ("동우", "nickname", False, 0.8, mseed["ws"])
    ]
    assert [(g, u, kw.get("timeout")) for g, u, kw in calls] == [("g1", "d1", 3.0)]


def test_post_member_without_korean_nickname_adds_nothing(client, mdb, mseed, discord_env, calls):
    calls.nick = "dongwoo"

    r = _post(client, mseed["ws"], "Alice", "d1")

    assert r.status_code == 201
    assert _profile(mdb, r.json()["data"]["member_id"]) == []


def test_discord_failure_keeps_member_and_response(client, mdb, mseed, discord_env, calls):
    calls.error = DiscordApiError("요청 실패: ReadTimeout")

    r = _post(client, mseed["ws"], "Alice", "d1")

    assert r.status_code == 201
    assert r.json()["data"]["discord_user_id"] == "d1"
    assert _profile(mdb, r.json()["data"]["member_id"]) == []
    assert len(calls) == 1


def test_no_bot_token_skips_discord(client, mdb, mseed, calls, monkeypatch):
    monkeypatch.delenv("DISCORD_BOT_TOKEN", raising=False)
    mdb.add(Integration(workspace_id=mseed["ws"], provider="discord", provider_channel_id="g1"))
    mdb.commit()

    r = _post(client, mseed["ws"], "Alice", "d1")

    assert r.status_code == 201
    assert calls == []


@pytest.mark.parametrize("channel_id", ["missing_row", None, ""])
def test_no_discord_integration_skips_discord(client, mdb, mseed, calls, monkeypatch, channel_id):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")
    if channel_id != "missing_row":
        mdb.add(Integration(workspace_id=mseed["ws"], provider="discord", provider_channel_id=channel_id))
        mdb.commit()

    r = _post(client, mseed["ws"], "Alice", "d1")

    assert r.status_code == 201
    assert calls == []


def test_nickname_equal_to_name_form_stays_one_row(client, mdb, mseed, discord_env, calls):
    r = _post(client, mseed["ws"], "김동우", "d1")

    assert r.status_code == 201
    mdb.expire_all()
    rows = list(mdb.execute(
        select(MemberAlias).where(
            MemberAlias.member_id == r.json()["data"]["member_id"], MemberAlias.alias_text == "동우"
        )
    ).scalars())
    assert [x.source for x in rows] == ["display_name"]


def test_nickname_taken_by_manual_alias_of_other_member_is_skipped(client, mdb, mseed, discord_env, calls):
    mdb.add(MemberAlias(
        workspace_id=mseed["ws"], member_id=mseed["bob"].member_id, alias_text="동우",
        alias_type="nickname", source="manual", confidence=1.0, verified=True,
    ))
    mdb.commit()

    r = _post(client, mseed["ws"], "Alice", "d1")

    assert r.status_code == 201
    assert _profile(mdb, r.json()["data"]["member_id"]) == []


def test_patch_discord_user_replaces_profile_aliases(client, mdb, mseed, discord_env, calls):
    member_id = _post(client, mseed["ws"], "Alice", "d1").json()["data"]["member_id"]
    calls.nick = "민수"
    calls.clear()

    r = client.patch(f"{API}/members/{member_id}", json={"discord_user_id": "d2"})

    assert r.status_code == 200
    assert [x.alias_text for x in _profile(mdb, member_id)] == ["민수"]
    assert [(g, u) for g, u, _ in calls] == [("g1", "d2")]


def test_patch_discord_user_to_none_only_deletes(client, mdb, mseed, discord_env, calls):
    member_id = _post(client, mseed["ws"], "Alice", "d1").json()["data"]["member_id"]
    assert len(_profile(mdb, member_id)) == 1
    calls.clear()

    r = client.patch(f"{API}/members/{member_id}", json={"discord_user_id": None})

    assert r.status_code == 200
    assert _profile(mdb, member_id) == []
    assert calls == []


def test_patch_same_discord_user_keeps_aliases_and_skips_discord(client, mdb, mseed, discord_env, calls):
    member_id = _post(client, mseed["ws"], "Alice", "d1").json()["data"]["member_id"]
    calls.clear()

    r = client.patch(f"{API}/members/{member_id}", json={"discord_user_id": "d1", "notion_name": "x"})

    assert r.status_code == 200
    assert [x.alias_text for x in _profile(mdb, member_id)] == ["동우"]
    assert calls == []


def test_patch_without_discord_user_does_not_call_discord(client, mdb, mseed, discord_env, calls):
    member_id = _post(client, mseed["ws"], "Alice", "d1").json()["data"]["member_id"]
    calls.clear()

    r = client.patch(f"{API}/members/{member_id}", json={"notion_name": "x"})

    assert r.status_code == 200
    assert calls == []


def test_discord_is_called_with_no_transaction_open(client, mdb, mseed, discord_env, monkeypatch):
    seen: list[bool] = []

    def fake(bot_token, guild_id, user_id, **kwargs):
        seen.append(mdb.in_transaction())
        return {"nick": "동우", "user": {}}

    monkeypatch.setattr(member_aliases.discord, "get_guild_member", fake)

    r = _post(client, mseed["ws"], "Alice", "d1")

    assert r.status_code == 201
    assert seen == [False]


def test_failed_alias_insert_is_swallowed(client, mdb, mseed, discord_env, calls, monkeypatch):
    from sqlalchemy.exc import IntegrityError

    real_commit = mdb.commit
    state = {"after_discord": False}

    def commit_that_fails_after_discord():
        if calls and not state["after_discord"]:
            state["after_discord"] = True
            raise IntegrityError("x", {}, Exception("boom"))
        return real_commit()

    monkeypatch.setattr(mdb, "commit", commit_that_fails_after_discord)

    r = _post(client, mseed["ws"], "Alice", "d1")

    assert r.status_code == 201
    assert r.json()["data"]["discord_user_id"] == "d1"
    monkeypatch.setattr(mdb, "commit", real_commit)
    assert _profile(mdb, r.json()["data"]["member_id"]) == []
