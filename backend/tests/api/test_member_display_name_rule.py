"""팀원 표시명은 가입 이름과 같은 규칙(NameStr)을 따르고, PATCH 로 null 을 보낼 수 없다 (#447)."""
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import func, select

from app.main import app
from app.models import Member, MemberAlias
from app.schemas.member import MemberCreateRequest, MemberUpdateRequest

API = "/api/v1"

INVALID_NAMES = [
    "",
    "   ",
    "\u200b \u200b",
    "김\n도윤",
    "\u202e김도윤",
    "\u0301",
    "가" * 101,
]


# ---- 스키마 단위 테스트 (DB 없이 돈다) ----

@pytest.mark.parametrize("schema", [MemberCreateRequest, MemberUpdateRequest])
@pytest.mark.parametrize("name", INVALID_NAMES)
def test_schema_rejects_invalid_display_name(schema, name):
    data = {"display_name": name}
    if schema is MemberCreateRequest:
        data["workspace_id"] = "w"
    with pytest.raises(ValidationError) as exc:
        schema.model_validate(data)
    assert [e["loc"] for e in exc.value.errors()] == [("display_name",)]


@pytest.mark.parametrize("schema", [MemberCreateRequest, MemberUpdateRequest])
def test_schema_strips_display_name(schema):
    data = {"display_name": "  김도윤  "}
    if schema is MemberCreateRequest:
        data["workspace_id"] = "w"
    assert schema.model_validate(data).display_name == "김도윤"


@pytest.mark.parametrize("schema", [MemberCreateRequest, MemberUpdateRequest])
def test_schema_accepts_100_chars_after_strip(schema):
    data = {"display_name": "  " + "가" * 100 + "  "}
    if schema is MemberCreateRequest:
        data["workspace_id"] = "w"
    assert len(schema.model_validate(data).display_name) == 100


def test_update_schema_rejects_explicit_null_display_name():
    with pytest.raises(ValidationError) as exc:
        MemberUpdateRequest.model_validate({"display_name": None})
    assert [e["loc"] for e in exc.value.errors()] == [("display_name",)]


def test_update_schema_null_display_name_message_names_null_not_the_length_rule():
    with pytest.raises(ValidationError) as exc:
        MemberUpdateRequest.model_validate({"display_name": None})
    msg = exc.value.errors()[0]["msg"]
    assert "null" in msg
    assert "1~100자" not in msg


def test_update_schema_omitted_display_name_is_unset():
    req = MemberUpdateRequest.model_validate({"notion_name": "x"})
    assert "display_name" not in req.model_dump(exclude_unset=True)


# ---- API 테스트 (PostgreSQL 이 있을 때만 돈다) ----

@pytest.fixture
def client(mseed):
    c = TestClient(app)
    c.cookies.set("session_token", "pm-token")
    return c


def _post(client, wid: str, name):
    return client.post(f"{API}/members", json={"workspace_id": wid, "display_name": name})


def _count(db, wid: str) -> int:
    db.expire_all()
    return db.execute(select(func.count()).select_from(Member).where(Member.workspace_id == wid)).scalar_one()


def _alias_ids(db, member_id: str) -> set[str]:
    db.expire_all()
    rows = db.execute(select(MemberAlias).where(MemberAlias.member_id == member_id)).scalars()
    return {r.alias_id for r in rows}


def _assert_display_name_rejected(res):
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "INVALID_REQUEST"
    assert any("display_name" in f["loc"] for f in body["error"]["details"]["fields"])


@pytest.mark.parametrize("name", INVALID_NAMES)
def test_post_rejects_invalid_display_name(client, mdb, mseed, name):
    before = _count(mdb, mseed["ws"])
    _assert_display_name_rejected(_post(client, mseed["ws"], name))
    assert _count(mdb, mseed["ws"]) == before


def test_post_strips_display_name(client, mdb, mseed):
    r = _post(client, mseed["ws"], "  김도윤  ")
    assert r.status_code == 201
    data = r.json()["data"]
    assert data["display_name"] == "김도윤"
    mdb.expire_all()
    assert mdb.get(Member, data["member_id"]).display_name == "김도윤"
    rows = mdb.execute(
        select(MemberAlias).where(MemberAlias.member_id == data["member_id"], MemberAlias.source == "display_name")
    ).scalars()
    assert {r.alias_text for r in rows} == {"김도윤", "도윤"}


def test_post_accepts_100_chars_after_strip(client, mseed):
    r = _post(client, mseed["ws"], "  " + "가" * 100 + "  ")
    assert r.status_code == 201
    assert len(r.json()["data"]["display_name"]) == 100


@pytest.mark.parametrize("name", ["👨\u200d👩\u200d👧", "김 도윤", "e\u0301mile"])
def test_post_accepts_valid_unicode_names(client, mseed, name):
    assert _post(client, mseed["ws"], name).status_code == 201


@pytest.mark.parametrize("name", INVALID_NAMES)
def test_patch_rejects_invalid_display_name(client, mdb, mseed, name):
    alice = mseed["alice"]
    mid, old = alice.member_id, alice.display_name
    aliases = _alias_ids(mdb, mid)
    _assert_display_name_rejected(client.patch(f"{API}/members/{mid}", json={"display_name": name}))
    mdb.expire_all()
    assert mdb.get(Member, mid).display_name == old
    assert _alias_ids(mdb, mid) == aliases


def test_patch_rejects_null_display_name(client, mdb, mseed):
    mid, old = mseed["alice"].member_id, mseed["alice"].display_name
    _assert_display_name_rejected(client.patch(f"{API}/members/{mid}", json={"display_name": None}))
    mdb.expire_all()
    assert mdb.get(Member, mid).display_name == old


def test_patch_same_name_with_spaces_keeps_aliases(client, mdb, mseed):
    r = _post(client, mseed["ws"], "김도윤")
    mid = r.json()["data"]["member_id"]
    before = _alias_ids(mdb, mid)
    assert before
    res = client.patch(f"{API}/members/{mid}", json={"display_name": " 김도윤 "})
    assert res.status_code == 200
    assert res.json()["data"]["display_name"] == "김도윤"
    assert _alias_ids(mdb, mid) == before


@pytest.mark.parametrize("name", ["", "김\n도윤"])
def test_existing_invalid_name_still_editable_and_listed(client, mdb, mseed, name):
    m = Member(workspace_id=mseed["ws"], display_name=name, role="member")
    mdb.add(m)
    mdb.commit()
    mid = m.member_id
    assert client.patch(f"{API}/members/{mid}", json={"notion_name": "x"}).status_code == 200
    assert client.patch(f"{API}/members/{mid}", json={"role": "member"}).status_code == 200
    res = client.get(f"{API}/members", params={"workspace_id": mseed["ws"]})
    assert res.status_code == 200
    assert mid in {i["member_id"] for i in res.json()["data"]["items"]}
