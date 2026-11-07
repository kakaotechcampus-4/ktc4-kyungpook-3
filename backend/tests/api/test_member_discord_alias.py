"""디스코드 계정을 연결하면 서버 닉네임(한글만)을 별칭으로 넣는다 (#459).

Discord 호출은 커밋 뒤에 하고 실패해도 팀원 저장·응답은 그대로다. 테스트는 get_guild_member 를 스텁으로 바꾼다.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import Integration, Member, MemberAlias
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


def _texts(db, member_id: str) -> dict[str, str]:
    """팀원의 별칭을 {글자: 출처} 로 돌려준다."""
    db.expire_all()
    rows = db.execute(select(MemberAlias).where(MemberAlias.member_id == member_id)).scalars()
    return {x.alias_text: x.source for x in rows}


def test_patch_name_and_discord_together_keeps_name_alias(client, mdb, mseed, discord_env, calls):
    """이름과 디스코드 계정을 한 번에 바꿔도, 지워지는 닉네임과 같은 글자의 이름 꼴이 남는다."""
    member_id = _post(client, mseed["ws"], "Alice", "d1").json()["data"]["member_id"]
    assert _texts(mdb, member_id) == {"동우": "discord_profile"}
    calls.nick = "dongwoo"

    r = client.patch(f"{API}/members/{member_id}", json={"display_name": "김동우", "discord_user_id": "d2"})

    assert r.status_code == 200
    assert _texts(mdb, member_id) == {"김동우": "display_name", "동우": "display_name"}


def test_patch_name_then_discord_change_refills_name_alias(client, mdb, mseed, discord_env, calls):
    """이름을 먼저 바꿔 닉네임과 겹쳐 건너뛴 꼴이, 나중에 디스코드 계정을 바꾸면 채워진다."""
    member_id = _post(client, mseed["ws"], "Alice", "d1").json()["data"]["member_id"]
    r = client.patch(f"{API}/members/{member_id}", json={"display_name": "김동우"})
    assert r.status_code == 200
    assert _texts(mdb, member_id) == {"김동우": "display_name", "동우": "discord_profile"}
    calls.nick = "dongwoo"

    r = client.patch(f"{API}/members/{member_id}", json={"discord_user_id": "d2"})

    assert r.status_code == 200
    assert _texts(mdb, member_id) == {"김동우": "display_name", "동우": "display_name"}


def test_patch_name_then_discord_unlink_refills_name_alias(client, mdb, mseed, discord_env, calls):
    member_id = _post(client, mseed["ws"], "Alice", "d1").json()["data"]["member_id"]
    client.patch(f"{API}/members/{member_id}", json={"display_name": "김동우"})
    calls.clear()

    r = client.patch(f"{API}/members/{member_id}", json={"discord_user_id": None})

    assert r.status_code == 200
    assert _texts(mdb, member_id) == {"김동우": "display_name", "동우": "display_name"}
    assert calls == []


def _delete_alias(client, db, member_id: str, text: str) -> None:
    """PM 이 팀원의 별칭 한 줄을 지운다(DELETE /members/aliases/{alias_id})."""
    db.expire_all()
    alias = db.execute(
        select(MemberAlias).where(MemberAlias.member_id == member_id, MemberAlias.alias_text == text)
    ).scalar_one()
    assert client.delete(f"{API}/members/aliases/{alias.alias_id}").status_code == 204


def _overlapping_minsu(client, mdb, mseed) -> str:
    """김민수·이민수 모두 자동 별칭 "민수" 를 갖게 한 뒤 PM 이 이민수의 "민수" 를 지운다. 이민수의 member_id 를 돌려준다."""
    _post(client, mseed["ws"], "김민수", None)
    member_id = _post(client, mseed["ws"], "이민수", None).json()["data"]["member_id"]
    assert _texts(mdb, member_id) == {"이민수": "display_name", "민수": "display_name"}
    _delete_alias(client, mdb, member_id, "민수")
    return member_id


def test_patch_discord_change_with_same_name_keeps_name_alias_pm_deleted(client, mdb, mseed, discord_env, calls):
    """이름이 그대로인 PATCH 가 PM 이 지운 이름 별칭을 되살리지 않는다."""
    member_id = _overlapping_minsu(client, mdb, mseed)
    calls.nick = "dongwoo"

    r = client.patch(f"{API}/members/{member_id}", json={"discord_user_id": "d1"})

    assert r.status_code == 200
    assert _texts(mdb, member_id) == {"이민수": "display_name"}


def test_patch_discord_change_again_keeps_name_alias_pm_deleted(client, mdb, mseed, discord_env, calls):
    member_id = _overlapping_minsu(client, mdb, mseed)
    calls.nick = "dongwoo"
    client.patch(f"{API}/members/{member_id}", json={"discord_user_id": "d1"})

    r = client.patch(f"{API}/members/{member_id}", json={"discord_user_id": "d2"})

    assert r.status_code == 200
    assert _texts(mdb, member_id) == {"이민수": "display_name"}


def test_patch_discord_unlink_with_same_name_keeps_name_alias_pm_deleted(client, mdb, mseed, discord_env, calls):
    member_id = _overlapping_minsu(client, mdb, mseed)
    calls.nick = "dongwoo"
    client.patch(f"{API}/members/{member_id}", json={"discord_user_id": "d1"})

    r = client.patch(f"{API}/members/{member_id}", json={"discord_user_id": None})

    assert r.status_code == 200
    assert _texts(mdb, member_id) == {"이민수": "display_name"}


def test_patch_unlink_with_same_name_refills_only_the_removed_nickname_text(client, mdb, mseed, discord_env, calls):
    """지운 닉네임과 겹쳐 건너뛴 이름 꼴만 채운다. 그 밖에 PM 이 지운 이름 별칭은 그대로 둔다."""
    member_id = _post(client, mseed["ws"], "Alice", "d1").json()["data"]["member_id"]
    client.patch(f"{API}/members/{member_id}", json={"display_name": "김동우"})
    assert _texts(mdb, member_id) == {"김동우": "display_name", "동우": "discord_profile"}
    _delete_alias(client, mdb, member_id, "김동우")

    r = client.patch(f"{API}/members/{member_id}", json={"discord_user_id": None})

    assert r.status_code == 200
    assert _texts(mdb, member_id) == {"동우": "display_name"}


@pytest.mark.parametrize(
    "change", [{"discord_user_id": None}, {"discord_user_id": "d9"}, {"is_deleted": True}], ids=["unlinked", "relinked", "deleted"]
)
def test_account_changed_while_waiting_for_discord_adds_no_nickname_alias(
    client, mdb, mseed, discord_env, monkeypatch, change
):
    """Discord 를 기다리는 동안(트랜잭션 닫힘) 다른 요청이 계정을 바꾸거나 팀원을 지우면 옛 닉네임을 넣지 않는다."""
    member_id = _post(client, mseed["ws"], "Alice", None).json()["data"]["member_id"]

    def fake(bot_token, guild_id, user_id, **kwargs):
        # 다른 요청이 끼어들어 커밋한 것과 같다
        member = mdb.get(Member, member_id)
        for field, value in change.items():
            setattr(member, field, value)
        mdb.commit()
        return {"nick": "동우", "user": {}}

    monkeypatch.setattr(member_aliases.discord, "get_guild_member", fake)

    r = client.patch(f"{API}/members/{member_id}", json={"discord_user_id": "d1"})

    assert r.status_code == 200
    assert _profile(mdb, member_id) == []


def test_operational_error_on_alias_commit_is_swallowed(client, mdb, mseed, discord_env, calls, monkeypatch):
    """닉네임 저장 중 DB 오류가 IntegrityError 가 아니어도 팀원 응답은 그대로다."""
    from sqlalchemy.exc import OperationalError

    real_commit = mdb.commit
    state = {"failed": False}

    def commit_that_fails_after_discord():
        if calls and not state["failed"]:
            state["failed"] = True
            raise OperationalError("x", {}, Exception("connection lost"))
        return real_commit()

    monkeypatch.setattr(mdb, "commit", commit_that_fails_after_discord)

    r = _post(client, mseed["ws"], "Alice", "d1")

    assert r.status_code == 201
    assert r.json()["data"]["discord_user_id"] == "d1"
    monkeypatch.setattr(mdb, "commit", real_commit)
    assert _profile(mdb, r.json()["data"]["member_id"]) == []
