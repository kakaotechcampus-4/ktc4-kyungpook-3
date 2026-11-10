"""디스코드 연결 옮기기와 지난 발화 화자 다시 붙이기(#652).

PATCH /members/{id} 에 move_discord_link: true 를 같이 보내면, 그 계정을 가진 다른 활성 팀원의 연결을 풀고
이 팀원에 한 트랜잭션으로 잇는다. 계정을 팀원에 이으면 이 워크스페이스 회의의 발화 중 그 계정이 말한 행의
member_id 를 이 팀원으로 바꾼다. 연결을 풀기만 하면 발화는 그대로다.
TEST_DATABASE_URL 이 있으면 PostgreSQL 에서도 돈다.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import (
    AliasSource,
    Meeting,
    Member,
    MemberAlias,
    Session as SessionModel,
    Source,
    User,
    Workspace,
)
from app.services.sessions import hash_session_token
from tests.usernames import username_for

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


# 옮겨 받는 팀원의 id 가 앞 팀원보다 앞인 경우와 뒤인 경우. 두 행을 바꾸는 순서가 id 에 따라 달라져도 유일
# 인덱스에 걸리지 않아야 한다.
ID_ORDERS = {"target_first": ("a-target", "z-holder"), "holder_first": ("z-target", "a-holder")}


@pytest.fixture(params=list(ID_ORDERS))
def seed(request, db):
    """워크스페이스 A: PM, disc_x 에 연결된 민수(holder), 연결 없는 지민(target), 삭제된 팀원(left, disc_left).
    A 회의 발화: disc_x 가 말한 행(민수에 붙음 하나, 연결 없음 하나), disc_other 가 말한 행, 화자 모름 행,
    삭제된 팀원이 말한 행. 워크스페이스 B 에도 disc_x 팀원과 그 발화가 있다."""
    target_id, holder_id = ID_ORDERS[request.param]
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
    pm = Member(workspace_id=ws.workspace_id, user_id=user.user_id, display_name="PM", role="pm")
    holder = Member(member_id=holder_id, workspace_id=ws.workspace_id, display_name="민수", discord_user_id="disc_x")
    target = Member(member_id=target_id, workspace_id=ws.workspace_id, display_name="지민")
    left = Member(
        workspace_id=ws.workspace_id, display_name="지난 팀원", discord_user_id="disc_left",
        is_deleted=True, deleted_at=datetime.now(timezone.utc),
    )
    other = Member(workspace_id=other_ws.workspace_id, display_name="민수", discord_user_id="disc_x")
    db.add_all([pm, holder, target, left, other])
    db.flush()
    meeting = Meeting(workspace_id=ws.workspace_id, status="done")
    other_meeting = Meeting(workspace_id=other_ws.workspace_id, status="done")
    db.add_all([meeting, other_meeting])
    db.flush()
    rows = [
        (meeting, "disc_x", holder.member_id),
        (meeting, "disc_x", None),
        (meeting, "disc_other", None),
        (meeting, None, None),
        (meeting, "disc_left", left.member_id),
        (other_meeting, "disc_x", other.member_id),
    ]
    for seq, (m, uid, member_id) in enumerate(rows):
        db.add(Source(
            meeting_id=m.meeting_id, seq=seq, speaker_discord_user_id=uid, member_id=member_id,
            start_ms=seq * 1000, end_ms=seq * 1000 + 900, text=f"발화 {seq}",
        ))
    db.add(MemberAlias(
        member_id=holder.member_id, workspace_id=ws.workspace_id, alias_text="민수닉",
        alias_type="nickname", source=str(AliasSource.DISCORD_PROFILE), confidence=0.8, verified=False,
    ))
    db.commit()
    return {
        "ws": ws, "other_ws": other_ws, "pm": pm, "holder": holder, "target": target, "left": left,
        "other": other, "meeting": meeting, "other_meeting": other_meeting,
    }


def _client() -> TestClient:
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c


def _patch(member: Member, body: dict):
    return _client().patch(f"/api/v1/members/{member.member_id}", json=body)


def _member(db, member: Member) -> Member:
    db.expire_all()
    return db.get(Member, member.member_id)


def _speakers(db, meeting: Meeting) -> list[tuple[str | None, str | None]]:
    """회의 발화의 (화자 uid, member_id) 를 seq 순서로."""
    db.expire_all()
    return [
        (uid, member_id)
        for uid, member_id in db.execute(
            select(Source.speaker_discord_user_id, Source.member_id)
            .where(Source.meeting_id == meeting.meeting_id)
            .order_by(Source.seq)
        ).all()
    ]


# ── 옮기기 ──

def test_move_takes_the_account_from_the_other_member_in_one_request(db, seed):
    r = _patch(seed["target"], {"discord_user_id": "disc_x", "move_discord_link": True})

    assert r.status_code == 200, r.text
    assert r.json()["data"]["discord_user_id"] == "disc_x"
    target, holder = _member(db, seed["target"]), _member(db, seed["holder"])
    assert target.discord_user_id == "disc_x"
    assert holder.discord_user_id is None
    # 이름은 둘 다 그대로다
    assert (target.display_name, holder.display_name) == ("지민", "민수")
    assert not holder.is_deleted


def test_move_removes_the_nickname_alias_of_the_previous_member(db, seed):
    r = _patch(seed["target"], {"discord_user_id": "disc_x", "move_discord_link": True})

    assert r.status_code == 200, r.text
    db.expire_all()
    texts = set(db.scalars(select(MemberAlias.alias_text).where(MemberAlias.member_id == seed["holder"].member_id)))
    assert "민수닉" not in texts


@pytest.mark.parametrize("body", [
    {"discord_user_id": "disc_x"},
    {"discord_user_id": "disc_x", "move_discord_link": False},
])
def test_without_the_flag_the_account_of_an_active_member_is_still_409(db, seed, body):
    before = _speakers(db, seed["meeting"])

    r = _patch(seed["target"], body)

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "DISCORD_USER_ALREADY_MAPPED"
    assert _member(db, seed["target"]).discord_user_id is None
    assert _member(db, seed["holder"]).discord_user_id == "disc_x"
    assert _speakers(db, seed["meeting"]) == before


def test_move_flag_on_a_free_account_just_links_it(db, seed):
    r = _patch(seed["target"], {"discord_user_id": "disc_new", "move_discord_link": True})

    assert r.status_code == 200, r.text
    assert _member(db, seed["target"]).discord_user_id == "disc_new"
    assert _member(db, seed["holder"]).discord_user_id == "disc_x"


def test_move_flag_without_an_account_changes_nothing(db, seed):
    r = _patch(seed["target"], {"move_discord_link": True})

    assert r.status_code == 200, r.text
    assert _member(db, seed["target"]).discord_user_id is None
    assert _member(db, seed["holder"]).discord_user_id == "disc_x"


def test_move_to_the_member_who_already_has_it_is_a_no_op(db, seed):
    r = _patch(seed["holder"], {"discord_user_id": "disc_x", "move_discord_link": True})

    assert r.status_code == 200, r.text
    assert _member(db, seed["holder"]).discord_user_id == "disc_x"


# ── 지난 발화의 화자 ──

def test_move_reattributes_past_utterances_of_the_account_in_this_workspace(db, seed):
    target, holder, left = seed["target"].member_id, seed["holder"].member_id, seed["left"].member_id

    r = _patch(seed["target"], {"discord_user_id": "disc_x", "move_discord_link": True})

    assert r.status_code == 200, r.text
    # disc_x 가 말한 행은 앞 팀원에 붙었던 것도, 연결이 없던 것도 이 팀원으로 바뀐다. 나머지는 그대로다
    assert _speakers(db, seed["meeting"]) == [
        ("disc_x", target),
        ("disc_x", target),
        ("disc_other", None),
        (None, None),
        ("disc_left", left),
    ]
    assert holder != target


def test_reattribution_does_not_touch_other_workspaces(db, seed):
    r = _patch(seed["target"], {"discord_user_id": "disc_x", "move_discord_link": True})

    assert r.status_code == 200, r.text
    assert _speakers(db, seed["other_meeting"]) == [("disc_x", seed["other"].member_id)]


def test_new_link_reattributes_utterances_that_had_no_member(db, seed):
    r = _patch(seed["target"], {"discord_user_id": "disc_other"})

    assert r.status_code == 200, r.text
    assert _speakers(db, seed["meeting"])[2] == ("disc_other", seed["target"].member_id)


def test_create_with_an_account_reattributes_utterances(db, seed):
    r = _client().post("/api/v1/members", json={
        "workspace_id": seed["ws"].workspace_id, "display_name": "새 팀원", "discord_user_id": "disc_other",
    })

    assert r.status_code == 201, r.text
    assert _speakers(db, seed["meeting"])[2] == ("disc_other", r.json()["data"]["member_id"])


def test_unlink_only_keeps_past_utterances(db, seed):
    before = _speakers(db, seed["meeting"])

    r = _patch(seed["holder"], {"discord_user_id": None})

    assert r.status_code == 200, r.text
    assert _member(db, seed["holder"]).discord_user_id is None
    assert _speakers(db, seed["meeting"]) == before


def test_minutes_after_move_show_the_new_member_name(db, seed):
    r = _patch(seed["target"], {"discord_user_id": "disc_x", "move_discord_link": True})
    assert r.status_code == 200, r.text

    minutes = _client().get(f"/api/v1/meetings/{seed['meeting'].meeting_id}/minutes")

    assert minutes.status_code == 200, minutes.text
    names = [line["speaker_display_name"] for line in minutes.json()["data"]["transcript"]]
    assert names[:2] == ["지민", "지민"]
    assert "민수" not in names


# ── 삭제·탈퇴한 팀원의 계정 ──

def test_taking_the_account_of_a_deleted_member_needs_no_flag_and_moves_its_utterances(db, seed):
    r = _patch(seed["target"], {"discord_user_id": "disc_left"})

    assert r.status_code == 200, r.text
    # 삭제한 팀원의 행은 이력으로 계정을 남긴다. 그 계정이 말한 지난 발화는 새로 이은 팀원으로 바뀐다
    assert _member(db, seed["left"]).discord_user_id == "disc_left"
    assert _speakers(db, seed["meeting"])[4] == ("disc_left", seed["target"].member_id)


def test_move_flag_does_not_unlink_a_deleted_member(db, seed):
    r = _patch(seed["target"], {"discord_user_id": "disc_left", "move_discord_link": True})

    assert r.status_code == 200, r.text
    assert _member(db, seed["left"]).discord_user_id == "disc_left"


def test_withdrawn_member_utterances_are_not_reattributed(db, seed):
    # 계정 탈퇴는 그 팀원 발화의 화자 uid 를 지운다(account_withdrawal._scrub_shared). uid 가 없으니 다시 붙지 않는다
    gone = Member(workspace_id=seed["ws"].workspace_id, display_name="곧 탈퇴", discord_user_id="disc_gone")
    db.add(gone)
    db.flush()
    db.add(Source(
        meeting_id=seed["meeting"].meeting_id, seq=99, speaker_discord_user_id=None, speaker_name="탈퇴한 사용자",
        member_id=gone.member_id, start_ms=0, end_ms=1, text="탈퇴 전 발화",
    ))
    gone.erase_profile(datetime.now(timezone.utc))
    db.commit()

    r = _patch(seed["target"], {"discord_user_id": "disc_gone"})

    assert r.status_code == 200, r.text
    assert _speakers(db, seed["meeting"])[-1] == (None, gone.member_id)
    # 탈퇴한 팀원은 고칠 수 없다
    assert _patch(gone, {"discord_user_id": "disc_x", "move_discord_link": True}).status_code == 404
    assert _member(db, seed["holder"]).discord_user_id == "disc_x"


def test_a_deleted_member_cannot_take_an_account(db, seed):
    # 삭제한 팀원에 옮기기 플래그를 보내면 활성 팀원의 계정을 빼앗고 발화도 가져갔다(#652 리뷰). #637 과 머지 순서와 상관없이 막는다
    r = _patch(seed["left"], {"discord_user_id": "disc_x", "move_discord_link": True})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "MEMBER_NOT_FOUND"
    assert _member(db, seed["holder"]).discord_user_id == "disc_x"


def test_moving_onto_a_member_who_already_has_another_account(db, seed, monkeypatch):
    # 옮겨 받는 팀원에게 이미 계정 V 가 있으면, V 닉네임 별칭은 지우고 V 발화는 그 팀원에 남기고, U 를 잇고
    # U 발화를 붙이고 U 닉네임을 별칭으로 읽어 온다(#463). 옮기기 순서를 고정한다(#662 리뷰)
    from app.models import Integration
    from app.services import member_aliases

    target, holder, meeting = seed["target"], seed["holder"], seed["meeting"]
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")
    db.add(Integration(workspace_id=seed["ws"].workspace_id, provider="discord", provider_channel_id="g1"))
    target.discord_user_id = "disc_v"
    db.add(MemberAlias(
        member_id=target.member_id, workspace_id=seed["ws"].workspace_id, alias_text="브이닉",
        alias_type="nickname", source=str(AliasSource.DISCORD_PROFILE), confidence=0.8, verified=False,
    ))
    db.add(Source(meeting_id=meeting.meeting_id, seq=100, speaker_discord_user_id="disc_v", member_id=target.member_id,
                  start_ms=100000, end_ms=100900, text="V 발화"))
    db.commit()
    looked_up = []

    def fake(bot_token, guild_id, user_id, **kwargs):
        looked_up.append(user_id)
        return {"nick": "유닉", "user": {"id": user_id}}

    monkeypatch.setattr(member_aliases.discord, "get_guild_member", fake)

    r = _patch(target, {"discord_user_id": "disc_x", "move_discord_link": True})

    assert r.status_code == 200, r.text
    assert (_member(db, target).discord_user_id, _member(db, holder).discord_user_id) == ("disc_x", None)
    profile = {a.alias_text for a in db.scalars(select(MemberAlias).where(
        MemberAlias.member_id == target.member_id, MemberAlias.source == str(AliasSource.DISCORD_PROFILE)))}
    assert profile == {"유닉"} and looked_up == ["disc_x"]
    speakers = _speakers(db, meeting)
    assert ("disc_v", target.member_id) in speakers
    assert [m for uid, m in speakers if uid == "disc_x"] == [target.member_id, target.member_id]
