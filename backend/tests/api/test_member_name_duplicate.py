"""같은 워크스페이스의 활성 팀원과 이름이 같으면 팀원 추가·이름 고치기를 409 로 막는다(#652).

이미 저장된 중복은 그대로 두고 새로 생기는 것만 막는다. 이름은 앞뒤 공백을 지우고 견준다.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import Member, Session as SessionModel, User, Workspace
from app.services.sessions import hash_session_token
from tests.usernames import username_for


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()

    def override_get_db():
        yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield session
    finally:
        app.dependency_overrides.pop(get_db, None)
        session.close()
        engine.dispose()


@pytest.fixture
def seed(db):
    """워크스페이스 A: PM, 민수, 지민, 삭제된 팀원 '지난 팀원', 예전에 생긴 중복 '중복' 둘, 앞뒤 공백이 남은 ' 서연 '.
    워크스페이스 B: 하은."""
    user = User(username=username_for("pm@example.com"), email="pm@example.com", name="pm")
    db.add(user)
    db.flush()
    db.add(SessionModel(
        user_id=user.user_id, session_token=hash_session_token("pm-token"),
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    ws, other_ws = Workspace(name="A"), Workspace(name="B")
    db.add_all([ws, other_ws])
    db.flush()
    members = {
        "pm": Member(workspace_id=ws.workspace_id, user_id=user.user_id, display_name="PM", role="pm"),
        "minsu": Member(workspace_id=ws.workspace_id, display_name="민수"),
        "jimin": Member(workspace_id=ws.workspace_id, display_name="지민"),
        "left": Member(
            workspace_id=ws.workspace_id, display_name="지난 팀원",
            is_deleted=True, deleted_at=datetime.now(timezone.utc),
        ),
        "dup1": Member(workspace_id=ws.workspace_id, display_name="중복"),
        "dup2": Member(workspace_id=ws.workspace_id, display_name="중복"),
        "untrimmed": Member(workspace_id=ws.workspace_id, display_name=" 서연 "),
        "other": Member(workspace_id=other_ws.workspace_id, display_name="하은"),
    }
    db.add_all(members.values())
    db.commit()
    return {"ws": ws, "other_ws": other_ws, **members}


def _client() -> TestClient:
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c


def _create(seed, display_name: str):
    return _client().post("/api/v1/members", json={
        "workspace_id": seed["ws"].workspace_id, "display_name": display_name,
    })


def _rename(member: Member, display_name: str):
    return _client().patch(f"/api/v1/members/{member.member_id}", json={"display_name": display_name})


def _assert_duplicated(r, existing: Member) -> None:
    assert r.status_code == 409, r.text
    error = r.json()["error"]
    assert error["code"] == "MEMBER_NAME_DUPLICATED"
    assert error["details"]["member_id"] == existing.member_id


def _name(db, member: Member) -> str:
    db.expire_all()
    return db.get(Member, member.member_id).display_name


# ── 팀원 추가 ──

@pytest.mark.parametrize("name", ["민수", "  민수  "])
def test_create_with_the_name_of_an_active_member_is_409(db, seed, name):
    _assert_duplicated(_create(seed, name), seed["minsu"])
    assert db.query(Member).filter(Member.display_name == "민수").count() == 1


def test_create_matches_a_stored_name_that_still_has_spaces(db, seed):
    _assert_duplicated(_create(seed, "서연"), seed["untrimmed"])


def test_create_with_the_name_of_a_deleted_member_is_allowed(db, seed):
    assert _create(seed, "지난 팀원").status_code == 201


def test_create_with_a_name_used_only_in_another_workspace_is_allowed(db, seed):
    assert _create(seed, "하은").status_code == 201


# ── 이름 고치기 ──

@pytest.mark.parametrize("name", ["지민", " 지민 "])
def test_rename_to_the_name_of_another_active_member_is_409(db, seed, name):
    _assert_duplicated(_rename(seed["minsu"], name), seed["jimin"])
    assert _name(db, seed["minsu"]) == "민수"


@pytest.mark.parametrize("name", ["민수", "  민수 "])
def test_sending_the_own_name_again_passes(db, seed, name):
    r = _rename(seed["minsu"], name)

    assert r.status_code == 200, r.text
    assert _name(db, seed["minsu"]) == "민수"


def test_existing_duplicates_stay_and_can_still_be_edited(db, seed):
    # 이름을 그대로 보내도, 다른 칸만 고쳐도 막지 않는다
    assert _rename(seed["dup1"], "중복").status_code == 200
    r = _client().patch(f"/api/v1/members/{seed['dup2'].member_id}", json={"notion_name": "노션 중복"})
    assert r.status_code == 200, r.text
    assert (_name(db, seed["dup1"]), _name(db, seed["dup2"])) == ("중복", "중복")


def test_existing_duplicate_can_be_renamed_to_a_free_name(db, seed):
    assert _rename(seed["dup2"], "중복 둘째").status_code == 200


@pytest.mark.parametrize("name", ["﻿민수", "민수﻿", "　민수", "민수\xa0"])
def test_create_trims_like_the_frontend(db, seed, name):
    # FE memberNameKey 는 JS trim 이다. BOM·전각 공백·NBSP 도 지운다. Python strip 은 BOM 을 남겨 같은 이름이 통과했다(#652 리뷰)
    _assert_duplicated(_create(seed, name), seed["minsu"])


@pytest.mark.parametrize("stored", ["서연0　", "서연1\t", "서연2\xa0", "﻿서연3"])
def test_create_matches_stored_names_with_other_spaces(db, seed, stored):
    # 이름 규칙 전에 저장된 이름에 탭·NBSP·전각 공백이 남아 있어도 같은 이름으로 본다. DB trim 은 보통 공백만 지운다
    old = Member(workspace_id=seed["ws"].workspace_id, display_name=stored)
    db.add(old)
    db.commit()
    _assert_duplicated(_create(seed, stored.strip("﻿　\t\xa0")), old)


def test_characters_js_trim_keeps_are_not_stripped(db, seed):
    # JS trim 은 \x1c ~ \x1f 와 \x85 를 남긴다. Python strip 처럼 지우면 FE 가 다르게 보는 이름을 막는다
    from app.api.members import _name_key

    assert _name_key("\x1c민수\x85") == "\x1c민수\x85"
    assert _name_key("﻿  민수 　") == "민수"
