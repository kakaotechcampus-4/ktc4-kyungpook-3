"""리마인드·대화 메시지 테스트(test_messages_*.py)가 같이 쓰는 픽스처. sqlite in-memory, TEST_DATABASE_URL이 있으면 PostgreSQL도 돈다."""
import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import Member, Session as SessionModel, Task, User, Workspace
from app.schemas.email import normalize_email
from app.services import oauth_state, signup_codes

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
SERVICE_TOKEN = "test-service-token"


@pytest.fixture(
    params=[
        "sqlite",
        pytest.param(
            "postgresql",
            marks=pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없습니다."),
        ),
    ]
)
def mdb(request, monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
    if request.param == "postgresql":
        engine = create_engine(TEST_DATABASE_URL)
        with engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        Base.metadata.drop_all(engine)
    else:
        engine = create_engine(
            "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
    Base.metadata.create_all(engine)
    # 앱 세션(SessionLocal)과 같이 autoflush 를 끈다. 서비스가 조회 전에 flush 를 빠뜨리면 여기서 드러난다.
    session = sessionmaker(bind=engine, autoflush=False)()

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
def signup_secret(monkeypatch):
    """`signup_verified` 가 증명을 서명할 키. 키 없는 경우를 재는 Notion·Discord 테스트 때문에 전역으로 두지 않는다."""
    monkeypatch.setenv("OAUTH_STATE_SECRET", "k" * 40)


def signup_verified(client, email: str, password: str = "pw-123456", name: str = "테스터"):
    """코드 메일을 거치지 않고 인증을 마친 상태로 가입한다. 코드 흐름은 test_signup_api.py 가 잰다."""
    proof = oauth_state.seal(signup_codes.PROOF_KIND, 60, {"m": normalize_email(email)})
    return client.post(
        "/api/v1/auth/signup", json={"verification_token": proof, "password": password, "name": name}
    )


def _user(db, name: str) -> User:
    user = User(email=f"{name}@example.com", name=name)
    db.add(user)
    db.flush()
    db.add(SessionModel(
        user_id=user.user_id, session_token=f"{name}-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    return user


@pytest.fixture
def mseed(mdb):
    """워크스페이스 A: PM(pm), 계정과 디스코드가 있는 팀원 alice, 계정은 있고 디스코드가 없는 bob,
    계정 없는 디스코드 팀원 carol. 태스크 셋. outsider 는 A에 속하지 않는다."""
    pm_user, alice_user, bob_user = _user(mdb, "pm"), _user(mdb, "alice"), _user(mdb, "bob")
    _user(mdb, "outsider")
    ws = Workspace(name="A")
    mdb.add(ws)
    mdb.flush()
    wid = ws.workspace_id
    pm = Member(workspace_id=wid, user_id=pm_user.user_id, display_name="PM", role="pm")
    alice = Member(workspace_id=wid, user_id=alice_user.user_id, display_name="앨리스", role="member",
                   discord_user_id="d_alice")
    bob = Member(workspace_id=wid, user_id=bob_user.user_id, display_name="밥", role="member")
    carol = Member(workspace_id=wid, display_name="캐럴", role="member", discord_user_id="d_carol")
    mdb.add_all([pm, alice, bob, carol])
    tasks = [Task(workspace_id=wid, title=f"할일{i}", status="todo") for i in range(3)]
    mdb.add_all(tasks)
    mdb.commit()
    return {"ws": wid, "pm": pm, "alice": alice, "bob": bob, "carol": carol, "tasks": tasks}

