"""user.provider 기본값과 alias_resolution_log.source_id를 확인."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models import (
    AliasResolutionLog,
    Meeting,
    Member,
    Source,
    User,
    Workspace,
)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def base(db):
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    member = Member(workspace_id=ws.workspace_id, display_name="pm", role="pm")
    meeting = Meeting(workspace_id=ws.workspace_id)
    db.add_all([member, meeting])
    db.commit()
    return {"ws": ws.workspace_id, "member": member.member_id, "meeting": meeting.meeting_id}


def test_user_provider_defaults_to_local(db):
    user = User(email="a@example.com", name="a")
    db.add(user)
    db.commit()
    assert user.provider == "local"


def test_alias_log_can_point_to_source(db, base):
    source = Source(meeting_id=base["meeting"], seq=0, start_ms=0, end_ms=1, text="민수님이 할게요")
    db.add(source)
    db.flush()
    log = AliasResolutionLog(
        workspace_id=base["ws"], alias_text="민수님", result="not_found",
        meeting_id=base["meeting"], source_id=source.source_id,
    )
    db.add(log)
    db.flush()
    db.commit()
    assert log.source_id == source.source_id
