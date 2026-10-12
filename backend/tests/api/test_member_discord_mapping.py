"""팀원 디스코드 계정 연결의 사전 검사와 DB 유일 인덱스(#166).

탈퇴(is_deleted)한 팀원은 행과 discord_user_id를 남긴다. 같은 디스코드 계정은 탈퇴하지 않은 팀원끼리만
겹치지 않게 막고, 사전 검사를 지나쳐 DB에서 막혀도 500이 아니라 409로 돌려준다.
TEST_DATABASE_URL이 있으면 PostgreSQL에서도 돈다.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import members as members_api
from app.core.database import Base, get_db
from app.main import app
from app.models import Member, Session as SessionModel, User, Workspace

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")


def _sqlite_engine():
    return create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )


def _pg_engine():
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.drop_all(engine)
    return engine


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
    engine = _pg_engine() if request.param == "postgresql" else _sqlite_engine()
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
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture
def seed(db):
    """워크스페이스 A: PM(pm-token), 디스코드 계정이 연결된 팀원(disc_active), 탈퇴한 팀원(disc_left),
    디스코드 계정이 없는 팀원. 워크스페이스 B는 비어 있다."""
    user = User(email="pm@example.com", name="pm")
    db.add(user)
    db.flush()
    db.add(SessionModel(
        user_id=user.user_id, session_token="pm-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    ws, other_ws = Workspace(name="A"), Workspace(name="B")
    db.add_all([ws, other_ws])
    db.flush()
    pm = Member(workspace_id=ws.workspace_id, user_id=user.user_id, display_name="PM", role="pm")
    active = Member(workspace_id=ws.workspace_id, display_name="민수", discord_user_id="disc_active")
    left = Member(
        workspace_id=ws.workspace_id, display_name="지난 팀원", discord_user_id="disc_left",
        is_deleted=True, deleted_at=datetime.now(timezone.utc),
    )
    unlinked = Member(workspace_id=ws.workspace_id, display_name="지민")
    db.add_all([pm, active, left, unlinked])
    db.commit()
    return {"ws": ws, "other_ws": other_ws, "active": active, "left": left, "unlinked": unlinked}


def _client() -> TestClient:
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c


def _create(seed, discord_user_id, *, display_name="새 팀원"):
    return _client().post("/api/v1/members", json={
        "workspace_id": seed["ws"].workspace_id, "display_name": display_name, "discord_user_id": discord_user_id,
    })


def _link(member: Member, discord_user_id):
    return _client().patch(f"/api/v1/members/{member.member_id}", json={"discord_user_id": discord_user_id})


def _discord_user_id(db, member: Member) -> str | None:
    db.expire_all()
    return db.get(Member, member.member_id).discord_user_id


def _assert_already_mapped(r, discord_user_id: str) -> None:
    assert r.status_code == 409, r.text
    error = r.json()["error"]
    assert error["code"] == "DISCORD_USER_ALREADY_MAPPED"
    assert error["details"] == {"discord_user_id": discord_user_id}


# ── 탈퇴한 팀원의 계정 다시 연결 ──

def test_new_member_can_take_the_discord_account_of_a_member_who_left(db, seed):
    r = _create(seed, "disc_left")

    assert r.status_code == 201, r.text
    assert r.json()["data"]["discord_user_id"] == "disc_left"
    # 탈퇴한 행의 값은 기록으로 남는다
    assert _discord_user_id(db, seed["left"]) == "disc_left"


def test_existing_member_can_take_the_discord_account_of_a_member_who_left(db, seed):
    r = _link(seed["unlinked"], "disc_left")

    assert r.status_code == 200, r.text
    assert _discord_user_id(db, seed["unlinked"]) == "disc_left"
    assert _discord_user_id(db, seed["left"]) == "disc_left"


# ── 탈퇴하지 않은 팀원과 겹치면 409 ──

def test_create_with_the_account_of_an_active_member_is_409(db, seed):
    _assert_already_mapped(_create(seed, "disc_active"), "disc_active")


def test_link_to_the_account_of_an_active_member_is_409(db, seed):
    _assert_already_mapped(_link(seed["unlinked"], "disc_active"), "disc_active")
    assert _discord_user_id(db, seed["unlinked"]) is None


def test_relinking_a_member_to_its_own_account_is_not_a_conflict(db, seed):
    r = _link(seed["active"], "disc_active")

    assert r.status_code == 200, r.text


# ── 사전 검사를 지나쳐 DB 유일 인덱스에 걸려도 409 ──

@pytest.fixture
def skip_precheck(monkeypatch):
    """두 요청이 동시에 사전 검사를 통과한 상황. 사전 검사만 끄고 커밋 때의 DB 유일 인덱스로 막히게 한다."""
    monkeypatch.setattr(members_api, "_ensure_discord_user_free", lambda *args, **kwargs: None)


def test_create_caught_by_the_db_index_is_409_not_500(db, seed, skip_precheck):
    _assert_already_mapped(_create(seed, "disc_active"), "disc_active")

    db.expire_all()
    assert db.query(Member).filter(Member.discord_user_id == "disc_active").count() == 1


def test_link_caught_by_the_db_index_is_409_not_500(db, seed, skip_precheck):
    _assert_already_mapped(_link(seed["unlinked"], "disc_active"), "disc_active")
    assert _discord_user_id(db, seed["unlinked"]) is None


def test_db_index_still_lets_a_member_who_left_keep_the_account(db, seed, skip_precheck):
    r = _create(seed, "disc_left")

    assert r.status_code == 201, r.text


# ── 입력 정리 ──

@pytest.mark.parametrize("blank", ["", "   "])
def test_blank_account_is_stored_as_null_for_every_member(db, seed, blank):
    first = _create(seed, blank, display_name="첫째")
    second = _create(seed, blank, display_name="둘째")

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["data"]["discord_user_id"] is None
    assert second.json()["data"]["discord_user_id"] is None


@pytest.mark.parametrize("blank", ["", "   ", None])
def test_blank_or_null_link_clears_the_account(db, seed, blank):
    r = _link(seed["active"], blank)

    assert r.status_code == 200, r.text
    assert _discord_user_id(db, seed["active"]) is None


def test_surrounding_spaces_do_not_slip_past_the_precheck(db, seed):
    _assert_already_mapped(_create(seed, "  disc_active "), "disc_active")


@pytest.mark.parametrize("call", ["create", "link"])
def test_account_longer_than_the_column_is_rejected(db, seed, call):
    too_long = "1" * 65
    r = _create(seed, too_long) if call == "create" else _link(seed["unlinked"], too_long)

    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


def test_account_at_the_column_length_is_accepted(db, seed):
    r = _create(seed, "1" * 64)

    assert r.status_code == 201, r.text


# ── DB 유일 인덱스 자체 ──

def test_db_index_allows_a_member_who_left_and_an_active_member_to_share_an_account(db, seed):
    db.add(Member(workspace_id=seed["ws"].workspace_id, display_name="다시 온 팀원", discord_user_id="disc_left"))
    db.commit()


def test_db_index_blocks_two_active_members_with_the_same_account(db, seed):
    db.add(Member(workspace_id=seed["ws"].workspace_id, display_name="겹침", discord_user_id="disc_active"))

    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_db_index_is_per_workspace(db, seed):
    db.add(Member(workspace_id=seed["other_ws"].workspace_id, display_name="민수", discord_user_id="disc_active"))
    db.commit()


def test_db_index_allows_many_members_without_an_account(db, seed):
    db.add_all([Member(workspace_id=seed["ws"].workspace_id, display_name=f"명단{i}") for i in range(2)])
    db.commit()
