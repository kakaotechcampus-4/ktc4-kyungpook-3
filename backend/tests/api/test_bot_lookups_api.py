"""녹음 봇이 전사 힌트로 쓰는 조회. 팀원 이름(GET /workspaces/{id}/members/names).

TEST_DATABASE_URL이 있으면 PostgreSQL에서도 돈다.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import Meeting, Member, MemberAlias, Session as SessionModel, User, Workspace
from app.services.sessions import hash_session_token

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
TOKEN = "test-token"
HEADERS = {"X-Service-Token": TOKEN}
T0 = datetime(2026, 10, 13, 10, 0, tzinfo=timezone.utc)


def _at(minutes: int) -> datetime:
    return T0 + timedelta(minutes=minutes)


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
def db(request, monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", TOKEN)
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
    """워크스페이스 A(팀원·별칭·task), 다른 워크스페이스 B(같은 모양의 행 하나씩), 빈 워크스페이스 C, A의 PM 세션.

    정렬의 동점 비교가 DB 콜레이션에 흔들리지 않게 ID는 영숫자로만 정한다.
    """
    user = User(email="pm@example.com", name="pm")
    a = Workspace(workspace_id="wsa", name="A")
    b = Workspace(workspace_id="wsb", name="B")
    c = Workspace(workspace_id="wsc", name="C")
    db.add_all([user, a, b, c])
    db.flush()
    db.add_all([
        SessionModel(
            user_id=user.user_id, session_token=hash_session_token("pm-session"),
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        ),
        # A의 팀원. 만든 순서는 m2, 그다음 같은 시각의 m1과 m3이다. 넣는 순서를 member_id 순서와 일부러 엇갈리게 했다.
        Member(member_id="m3", workspace_id="wsa", display_name="장원준", discord_user_id="300", created_at=_at(10)),
        Member(
            member_id="m1", workspace_id="wsa", user_id=user.user_id, display_name="김동우",
            discord_user_id="100", notion_name="dongwoo", role="pm", created_at=_at(10),
        ),
        Member(member_id="m2", workspace_id="wsa", display_name="유재환", created_at=_at(0)),
        Member(
            member_id="m4", workspace_id="wsa", display_name="탈퇴한사람", discord_user_id="400",
            is_deleted=True, deleted_at=_at(20), created_at=_at(5),
        ),
        Member(member_id="m9", workspace_id="wsb", display_name="다른팀원", discord_user_id="900", created_at=_at(0)),
    ])
    db.flush()
    db.add_all([
        # m1의 별칭. verified가 먼저, 같은 verified 안에서는 만든 순서, 같은 시각이면 alias_id 순이다.
        MemberAlias(
            alias_id="al3", member_id="m1", workspace_id="wsa", alias_text="도우", alias_type="inferred",
            source="manual", verified=False, created_at=_at(1),
        ),
        MemberAlias(
            alias_id="al2", member_id="m1", workspace_id="wsa", alias_text="동우님", alias_type="mention",
            source="manual", verified=True, created_at=_at(3),
        ),
        MemberAlias(
            alias_id="al1", member_id="m1", workspace_id="wsa", alias_text="동우", alias_type="nickname",
            source="manual", verified=True, created_at=_at(2),
        ),
        MemberAlias(
            alias_id="al0", member_id="m1", workspace_id="wsa", alias_text="DW", alias_type="nickname",
            source="manual", verified=True, created_at=_at(3),
        ),
        MemberAlias(
            alias_id="al4", member_id="m4", workspace_id="wsa", alias_text="탈퇴자", alias_type="nickname",
            source="manual", verified=True, created_at=_at(1),
        ),
        MemberAlias(
            alias_id="al9", member_id="m9", workspace_id="wsb", alias_text="남의별칭", alias_type="nickname",
            source="manual", verified=True, created_at=_at(1),
        ),
    ])
    db.commit()


def _names_url(workspace_id: str) -> str:
    return f"/api/v1/workspaces/{workspace_id}/members/names"


# ---------- 공통: 인증과 없는 워크스페이스 ----------

@pytest.mark.parametrize(
    "client_kwargs",
    [
        {},
        {"headers": {"X-Service-Token": "wrong"}},
        # 그 워크스페이스 PM의 세션이어도 서비스 토큰을 대신하지 못한다.
        {"cookies": {"session_token": "pm-session"}},
    ],
    ids=["missing-token", "wrong-token", "member-session-only"],
)
def test_rejects_requests_without_valid_service_token(seed, client_kwargs):
    r = TestClient(app, **client_kwargs).get(_names_url("wsa"))

    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "UNAUTHENTICATED"


def test_rejects_all_requests_when_server_has_no_service_token(seed, monkeypatch):
    monkeypatch.delenv("SERVICE_TOKEN")

    assert TestClient(app).get(_names_url("wsa"), headers=HEADERS).status_code == 401


def test_unknown_workspace_is_404(seed):
    r = TestClient(app).get(_names_url("no-such-workspace"), headers=HEADERS)

    assert r.status_code == 404, r.text
    error = r.json()["error"]
    assert error["code"] == "WORKSPACE_NOT_FOUND"
    assert error["details"] == {"workspace_id": "no-such-workspace"}


# ---------- 팀원 이름 ----------

def test_member_names_use_display_name_and_aliases_in_creation_order(seed):
    r = TestClient(app).get(_names_url("wsa"), headers=HEADERS)

    assert r.status_code == 200, r.text
    assert r.json() == {
        "data": {
            "identity_epoch": 0,
            "items": [
                {"member_id": "m2", "name": "유재환", "discord_user_id": None, "aliases": []},
                {
                    "member_id": "m1", "name": "김동우", "discord_user_id": "100",
                    "aliases": ["동우", "DW", "동우님", "도우"],
                },
                {"member_id": "m3", "name": "장원준", "discord_user_id": "300", "aliases": []},
            ]
        },
        "error": None,
    }


def test_member_names_exclude_deleted_members_and_their_aliases(seed):
    members = TestClient(app).get(_names_url("wsa"), headers=HEADERS).json()["data"]["items"]

    assert "m4" not in [m["member_id"] for m in members]
    assert all("탈퇴자" not in m["aliases"] for m in members)


def test_member_names_do_not_leak_other_workspaces(seed):
    client = TestClient(app, headers=HEADERS)

    b = client.get(_names_url("wsb")).json()["data"]["items"]
    assert b == [{"member_id": "m9", "name": "다른팀원", "discord_user_id": "900", "aliases": ["남의별칭"]}]
    assert client.get(_names_url("wsc")).json() == {"data": {"items": [], "identity_epoch": 0}, "error": None}


# ---------- 채팅 커서 ----------

def _cursor_url(workspace_id: str) -> str:
    return f"/api/v1/workspaces/{workspace_id}/chat-cursor"


def _meeting(db, meeting_id, source, status, day, duration_ms=3_600_000):
    db.add(Meeting(
        meeting_id=meeting_id, workspace_id="wsa", source=source, status=status,
        started_at=datetime(2026, 11, day, tzinfo=timezone.utc), duration_ms=duration_ms,
    ))
    db.commit()


def test_chat_cursor_null_when_no_chat_meeting(seed, db):
    _meeting(db, "d1", "discord", "done", 4)

    r = TestClient(app).get(_cursor_url("wsa"), headers=HEADERS)

    assert r.status_code == 200, r.text
    assert r.json() == {"data": None, "error": None}


def test_chat_cursor_uses_latest_done_chat_meeting(seed, db):
    _meeting(db, "c1", "chat", "done", 1)
    _meeting(db, "c2", "chat", "done", 2)
    _meeting(db, "c3", "chat", "failed", 3)
    _meeting(db, "c4", "chat", "processing", 3)
    _meeting(db, "d1", "discord", "done", 4)

    r = TestClient(app).get(_cursor_url("wsa"), headers=HEADERS)

    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["meeting_id"] == "c2"
    assert datetime.fromisoformat(data["last_message_at"]) == datetime(2026, 11, 2, 1, tzinfo=timezone.utc)
    assert data["last_message_at"].endswith("+00:00")


def test_chat_cursor_tie_on_started_at_picks_longer_meeting_then_id(seed, db):
    _meeting(db, "c1", "chat", "done", 2, duration_ms=1_000)
    _meeting(db, "c2", "chat", "done", 2, duration_ms=5_000)
    _meeting(db, "c3", "chat", "done", 2, duration_ms=5_000)

    data = TestClient(app).get(_cursor_url("wsa"), headers=HEADERS).json()["data"]

    assert data["meeting_id"] == "c3"
    assert datetime.fromisoformat(data["last_message_at"]) == datetime(2026, 11, 2, 0, 0, 5, tzinfo=timezone.utc)


def test_chat_cursor_response_shape_is_in_openapi():
    schema = app.openapi()["paths"]["/api/v1/workspaces/{workspace_id}/chat-cursor"]["get"]
    assert "ChatCursorResponse" in str(schema["responses"]["200"])


def test_chat_cursor_requires_service_token(seed):
    assert TestClient(app).get(_cursor_url("wsa")).status_code == 401


def test_chat_cursor_unknown_workspace_is_404(seed):
    r = TestClient(app).get(_cursor_url("nope"), headers=HEADERS)

    assert r.status_code == 404
