"""추출 근거·transcript_path를 저장하지 않고, 상세 응답의 evidence는 source에서 읽는지 확인."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import (
    Evidence,
    Extraction,
    ExtractionItem,
    Meeting,
    Member,
    Session as SessionModel,
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

    def override_get_db():
        yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield session
    finally:
        app.dependency_overrides.pop(get_db, None)
        session.close()


@pytest.fixture
def seed(db):
    user = User(email="pm@example.com", name="pm")
    db.add(user)
    db.flush()
    db.add(SessionModel(
        user_id=user.user_id, session_token="pm-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    db.add(Member(workspace_id=ws.workspace_id, user_id=user.user_id, display_name="pm", role="pm"))
    meeting = Meeting(workspace_id=ws.workspace_id, status="processing")
    db.add(meeting)
    db.commit()
    return {"ws": ws.workspace_id, "meeting": meeting.meeting_id}


@pytest.fixture
def client(db):
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c


def _extract(client, seed):
    r = client.post("/api/v1/extractions", json={
        "meeting_id": seed["meeting"],
        "workspace_id": seed["ws"],
        "transcript_path": "s3://bucket/transcript.json",
        "items": [{
            "task_title": "결제 환불 기능 구현", "task_confidence": 0.6,
            "evidence_quote": "환불 기능은 제가 할게요.", "evidence_speaker": "discord_uid_a",
            "evidence_at_ms": 12_000,
        }],
    })
    assert r.status_code == 201
    return r.json()["data"]["extraction_id"]


def _detail_evidence(client, extraction_id):
    body = client.get(f"/api/v1/extractions/{extraction_id}").json()["data"]
    return body["items"][0]["evidence"]


def test_request_evidence_and_transcript_path_are_not_stored(client, db, seed):
    _extract(client, seed)

    extraction = db.execute(select(Extraction)).scalar_one()
    item = db.execute(select(ExtractionItem)).scalar_one()
    assert extraction.transcript_path is None
    assert (item.evidence_quote, item.evidence_speaker, item.evidence_at_ms) == (None, None, None)


def test_detail_evidence_is_null_without_source(client, seed):
    extraction_id = _extract(client, seed)
    assert _detail_evidence(client, extraction_id) == {"quote": None, "speaker": None, "at_ms": None}


def test_detail_evidence_uses_task_source_with_smallest_seq(client, db, seed):
    extraction_id = _extract(client, seed)
    item = db.execute(select(ExtractionItem)).scalar_one()
    sources = [
        Source(meeting_id=seed["meeting"], seq=seq, speaker_discord_user_id=f"uid{seq}",
               start_ms=seq * 1000, end_ms=seq * 1000 + 900, text=f"발화 {seq}")
        for seq in (1, 2, 3)
    ]
    db.add_all(sources)
    db.flush()
    by_seq = {s.seq: s for s in sources}
    db.add_all([
        Evidence(item_id=item.item_id, source_id=by_seq[3].source_id, type="task"),
        Evidence(item_id=item.item_id, source_id=by_seq[2].source_id, type="task"),
        # 담당자·마감 근거는 대표 근거로 쓰지 않는다
        Evidence(item_id=item.item_id, source_id=by_seq[1].source_id, type="assignee"),
    ])
    db.commit()

    assert _detail_evidence(client, extraction_id) == {
        "quote": "발화 2", "speaker": "uid2", "at_ms": 2000,
    }


def test_progress_transcribed_follows_source(client, db, seed):
    def transcribed():
        return client.get(f"/api/v1/meetings/{seed['meeting']}").json()["data"]["progress"]["transcribed"]

    assert transcribed() is False
    # transcript_path를 보내도 저장하지 않으므로, 추출만으로는 전사된 것으로 보지 않는다
    _extract(client, seed)
    assert transcribed() is False

    db.add(Source(meeting_id=seed["meeting"], seq=0, start_ms=0, end_ms=900, text="발화 0"))
    db.commit()
    assert transcribed() is True
