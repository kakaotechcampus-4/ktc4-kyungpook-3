"""팀원을 만들거나 이름을 바꾸면 이름 별칭(성 뗀 꼴 포함)이 자동으로 채워진다 (#459).

사람이 정한(manual·learned) 별칭과 같은 글자는 자동으로 넣지 않는다.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import Member, MemberAlias

API = "/api/v1"


@pytest.fixture
def client(mseed):
    c = TestClient(app)
    c.cookies.set("session_token", "pm-token")
    return c


def _aliases(db, member_id: str, source: str | None = None) -> list[MemberAlias]:
    db.expire_all()
    stmt = select(MemberAlias).where(MemberAlias.member_id == member_id)
    if source is not None:
        stmt = stmt.where(MemberAlias.source == source)
    return list(db.execute(stmt).scalars())


def _texts(rows) -> set[str]:
    return {r.alias_text for r in rows}


def _post(client, wid: str, name: str, **extra):
    return client.post(f"{API}/members", json={"workspace_id": wid, "display_name": name, **extra})


def _add_alias(db, member: Member, text: str, source: str) -> None:
    db.add(MemberAlias(
        workspace_id=member.workspace_id, member_id=member.member_id, alias_text=text,
        alias_type="nickname", source=source, confidence=0.3, verified=False,
    ))
    db.commit()


def test_post_member_creates_name_aliases(client, mdb, mseed):
    r = _post(client, mseed["ws"], "김동우")
    assert r.status_code == 201
    rows = _aliases(mdb, r.json()["data"]["member_id"])
    assert _texts(rows) == {"김동우", "동우"}
    for row in rows:
        assert (row.source, row.alias_type, row.verified, row.confidence) == (
            "display_name", "realname", True, 1.0,
        )
        assert row.workspace_id == mseed["ws"]


def test_post_member_with_non_korean_name_has_no_alias(client, mdb, mseed):
    r = _post(client, mseed["ws"], "Alice")
    assert r.status_code == 201
    assert _aliases(mdb, r.json()["data"]["member_id"]) == []


def test_create_workspace_gives_pm_member_name_aliases(client, mdb, mseed):
    from datetime import datetime, timedelta, timezone

    from app.models import Session as SessionModel, User

    user = User(email="korean@example.com", name="김동우")
    mdb.add(user)
    mdb.flush()
    mdb.add(SessionModel(
        user_id=user.user_id, session_token="korean-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    mdb.commit()
    c = TestClient(app)
    c.cookies.set("session_token", "korean-token")
    r = c.post(f"{API}/workspaces", json={"name": "새 워크스페이스"})
    assert r.status_code == 201
    member_id = r.json()["data"]["member_id"]
    assert _texts(_aliases(mdb, member_id)) == {"김동우", "동우"}


def test_create_workspace_with_non_korean_user_name_has_no_alias(client, mdb, mseed):
    # mseed 의 pm 사용자 이름은 영문 "pm"
    r = client.post(f"{API}/workspaces", json={"name": "새 워크스페이스"})
    assert r.status_code == 201
    assert _aliases(mdb, r.json()["data"]["member_id"]) == []


def test_patch_display_name_replaces_only_display_name_aliases(client, mdb, mseed):
    member_id = _post(client, mseed["ws"], "김동우").json()["data"]["member_id"]
    member = mdb.get(Member, member_id)
    _add_alias(mdb, member, "동우형", "manual")
    # 같은 (팀원, 글자) 는 한 행뿐이라, 자동으로 생긴 "동우" 를 디스코드 프로필 출처로 바꿔 둔다
    next(a for a in _aliases(mdb, member_id) if a.alias_text == "동우").source = "discord_profile"
    mdb.commit()

    r = client.patch(f"{API}/members/{member_id}", json={"display_name": "김도윤"})
    assert r.status_code == 200
    assert _texts(_aliases(mdb, member_id, "display_name")) == {"김도윤", "도윤"}
    assert "동우형" in _texts(_aliases(mdb, member_id, "manual"))
    assert "동우" in _texts(_aliases(mdb, member_id, "discord_profile"))


def test_patch_without_display_name_keeps_alias_rows(client, mdb, mseed):
    member_id = _post(client, mseed["ws"], "김동우").json()["data"]["member_id"]
    before = {a.alias_id for a in _aliases(mdb, member_id)}

    assert client.patch(f"{API}/members/{member_id}", json={"notion_name": "동우"}).status_code == 200
    assert {a.alias_id for a in _aliases(mdb, member_id)} == before


def test_patch_same_display_name_keeps_alias_rows(client, mdb, mseed):
    member_id = _post(client, mseed["ws"], "김동우").json()["data"]["member_id"]
    before = {a.alias_id for a in _aliases(mdb, member_id)}

    assert client.patch(f"{API}/members/{member_id}", json={"display_name": "김동우"}).status_code == 200
    assert {a.alias_id for a in _aliases(mdb, member_id)} == before


def test_patch_to_non_korean_name_removes_display_name_aliases(client, mdb, mseed):
    member_id = _post(client, mseed["ws"], "김동우").json()["data"]["member_id"]

    assert client.patch(f"{API}/members/{member_id}", json={"display_name": "Alice"}).status_code == 200
    assert _aliases(mdb, member_id, "display_name") == []


def test_patch_keeps_alias_that_is_in_both_old_and_new_forms(client, mdb, mseed):
    # 김동우 → 박동우: "동우" 는 새 꼴에도 있으니 행을 지웠다 다시 만들지 않고 그대로 둔다
    member_id = _post(client, mseed["ws"], "김동우").json()["data"]["member_id"]
    kept = next(a.alias_id for a in _aliases(mdb, member_id) if a.alias_text == "동우")

    assert client.patch(f"{API}/members/{member_id}", json={"display_name": "박동우"}).status_code == 200
    rows = _aliases(mdb, member_id, "display_name")
    assert _texts(rows) == {"박동우", "동우"}
    assert next(a.alias_id for a in rows if a.alias_text == "동우") == kept


def test_post_skips_text_the_same_member_already_has(client, mdb, mseed):
    # 같은 팀원에게 이미 있는 글자는 출처가 무엇이든 건너뛴다. PATCH 로 확인한다(POST 는 새 팀원이라 기존 별칭이 없다).
    member_id = _post(client, mseed["ws"], "Alice").json()["data"]["member_id"]
    member = mdb.get(Member, member_id)
    _add_alias(mdb, member, "동우", "manual")

    assert client.patch(f"{API}/members/{member_id}", json={"display_name": "김동우"}).status_code == 200
    rows = [a for a in _aliases(mdb, member_id) if a.alias_text == "동우"]
    assert len(rows) == 1
    assert rows[0].source == "manual"
    assert _texts(_aliases(mdb, member_id, "display_name")) == {"김동우"}


def test_other_member_manual_alias_blocks_auto_alias(client, mdb, mseed):
    _add_alias(mdb, mseed["bob"], "민수", "manual")

    member_id = _post(client, mseed["ws"], "이민수").json()["data"]["member_id"]
    assert _texts(_aliases(mdb, member_id)) == {"이민수"}


def test_other_member_learned_alias_blocks_auto_alias(client, mdb, mseed):
    _add_alias(mdb, mseed["bob"], "민수", "learned")

    member_id = _post(client, mseed["ws"], "이민수").json()["data"]["member_id"]
    assert _texts(_aliases(mdb, member_id)) == {"이민수"}


def test_other_member_auto_alias_does_not_block(client, mdb, mseed):
    first = _post(client, mseed["ws"], "박민수").json()["data"]["member_id"]
    second = _post(client, mseed["ws"], "이민수").json()["data"]["member_id"]

    assert _texts(_aliases(mdb, first)) == {"박민수", "민수"}
    assert _texts(_aliases(mdb, second)) == {"이민수", "민수"}


def test_deleted_member_manual_alias_does_not_block(client, mdb, mseed):
    bob = mseed["bob"]
    _add_alias(mdb, bob, "민수", "manual")
    bob.is_deleted = True
    mdb.commit()

    member_id = _post(client, mseed["ws"], "이민수").json()["data"]["member_id"]
    assert _texts(_aliases(mdb, member_id)) == {"이민수", "민수"}


def test_other_workspace_manual_alias_does_not_block(client, mdb, mseed):
    from app.models import Workspace

    other = Workspace(name="B")
    mdb.add(other)
    mdb.flush()
    stranger = Member(workspace_id=other.workspace_id, display_name="타팀")
    mdb.add(stranger)
    mdb.commit()
    _add_alias(mdb, stranger, "민수", "manual")

    member_id = _post(client, mseed["ws"], "이민수").json()["data"]["member_id"]
    assert _texts(_aliases(mdb, member_id)) == {"이민수", "민수"}


def test_post_with_taken_discord_user_is_409_and_leaves_no_alias(client, mdb, mseed):
    r = _post(client, mseed["ws"], "김동우", discord_user_id="d_alice")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "DISCORD_USER_ALREADY_MAPPED"
    mdb.expire_all()
    assert mdb.execute(select(MemberAlias).where(MemberAlias.alias_text == "김동우")).first() is None


def test_post_409_even_when_precheck_is_bypassed(client, mdb, mseed, monkeypatch):
    # 사전 검사를 지나쳐 DB 유일 인덱스에서 막혀도 409 여야 한다. 별칭을 flush 로 먼저 넣으면 여기서 500 이 된다.
    from app.api import members as members_api

    monkeypatch.setattr(members_api, "_ensure_discord_user_free", lambda *a, **k: None)
    r = _post(client, mseed["ws"], "김동우", discord_user_id="d_alice")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "DISCORD_USER_ALREADY_MAPPED"


def _create_alias(client, member_id: str, **body):
    return client.post(f"{API}/members/{member_id}/aliases", json=body)


def test_post_alias_same_text_as_auto_name_alias_promotes_it_to_manual(client, mdb, mseed):
    first = _post(client, mseed["ws"], "김민수").json()["data"]["member_id"]
    before = next(a for a in _aliases(mdb, first) if a.alias_text == "민수")
    assert (before.source, before.verified, before.confidence) == ("display_name", True, 1.0)
    alias_id = before.alias_id

    r = _create_alias(client, first, alias_text="민수")

    assert r.status_code == 201
    data = r.json()["data"]
    assert (data["alias_id"], data["alias_text"], data["source"], data["alias_type"]) == (
        alias_id, "민수", "manual", "nickname",
    )
    rows = [a for a in _aliases(mdb, first) if a.alias_text == "민수"]
    assert [(a.alias_id, a.source, a.alias_type, a.verified, a.confidence) for a in rows] == [
        (alias_id, "manual", "nickname", True, 1.0)
    ]


def test_promoted_alias_keeps_other_member_from_getting_the_same_auto_alias(client, mdb, mseed):
    first = _post(client, mseed["ws"], "김민수").json()["data"]["member_id"]
    _create_alias(client, first, alias_text="민수")

    second = _post(client, mseed["ws"], "이민수").json()["data"]["member_id"]

    assert _texts(_aliases(mdb, second)) == {"이민수"}


def test_promoted_alias_survives_the_name_change(client, mdb, mseed):
    first = _post(client, mseed["ws"], "김민수").json()["data"]["member_id"]
    _create_alias(client, first, alias_text="민수")

    r = client.patch(f"{API}/members/{first}", json={"display_name": "김철수"})

    assert r.status_code == 200
    assert _texts(_aliases(mdb, first, "manual")) == {"민수"}
    assert _texts(_aliases(mdb, first, "display_name")) == {"김철수", "철수"}


def test_post_alias_verified_promotes_unverified_nickname_alias(client, mdb, mseed):
    member = mseed["bob"]
    mdb.add(MemberAlias(
        workspace_id=member.workspace_id, member_id=member.member_id, alias_text="동우",
        alias_type="nickname", source="discord_profile", confidence=0.8, verified=False,
    ))
    mdb.commit()

    r = _create_alias(client, member.member_id, alias_text="동우", verified=True)

    assert r.status_code == 201
    rows = _aliases(mdb, member.member_id)
    assert [(a.alias_text, a.source, a.verified, a.confidence) for a in rows] == [
        ("동우", "manual", True, 1.0)
    ]
    assert r.json()["data"]["verified"] is True


def test_post_alias_on_existing_manual_row_changes_nothing(client, mdb, mseed):
    member = mseed["bob"]
    mdb.add(MemberAlias(
        workspace_id=member.workspace_id, member_id=member.member_id, alias_text="동우형",
        alias_type="nickname", source="manual", confidence=0.3, verified=False,
    ))
    mdb.commit()

    r = _create_alias(client, member.member_id, alias_text="동우형", alias_type="realname", confidence=0.9, verified=True)

    assert r.status_code == 201
    rows = _aliases(mdb, member.member_id)
    assert [(a.alias_text, a.alias_type, a.source, a.verified, a.confidence) for a in rows] == [
        ("동우형", "nickname", "manual", False, 0.3)
    ]
    assert (r.json()["data"]["verified"], r.json()["data"]["confidence"]) == (False, 0.3)
