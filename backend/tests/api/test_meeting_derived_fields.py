"""회의 참석자·길이·진행 상태가 오디오 테이블 없이 source 기준으로 계산되는지 확인."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import (
    Extraction,
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
    db.add(
        SessionModel(
            user_id=user.user_id,
            session_token="pm-token",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
    )
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    alice = Member(workspace_id=ws.workspace_id, user_id=user.user_id, display_name="alice", role="pm")
    bob = Member(workspace_id=ws.workspace_id, display_name="bob", role="member")
    db.add_all([alice, bob])
    db.flush()
    empty = Meeting(workspace_id=ws.workspace_id, status="done")
    spoken = Meeting(workspace_id=ws.workspace_id, status="done", duration_ms=90_000)
    db.add_all([empty, spoken])
    db.flush()
    # bob이 먼저, alice가 나중, bob이 다시 말한다. 화자를 모르는 발화도 있다.
    for seq, member in enumerate([bob, alice, bob, None]):
        db.add(
            Source(
                meeting_id=spoken.meeting_id,
                seq=seq,
                member_id=member.member_id if member else None,
                start_ms=seq * 1000,
                end_ms=seq * 1000 + 900,
                text=f"발화 {seq}",
            )
        )
    db.commit()
    return {
        "ws": ws.workspace_id,
        "alice": alice.member_id,
        "bob": bob.member_id,
        "empty": empty.meeting_id,
        "spoken": spoken.meeting_id,
    }


@pytest.fixture
def client(db):
    c = TestClient(app)
    c.cookies.set("session_token", "pm-token")
    return c


def test_minutes_without_source_has_no_attendees_and_zero_duration(client, seed):
    body = client.get(f"/api/v1/meetings/{seed['empty']}/minutes").json()["data"]
    assert body["attendees"] == []
    assert body["duration_ms"] == 0


def test_minutes_attendees_are_distinct_members_in_speaking_order(client, seed):
    body = client.get(f"/api/v1/meetings/{seed['spoken']}/minutes").json()["data"]
    assert [a["member_id"] for a in body["attendees"]] == [seed["bob"], seed["alice"]]
    assert [a["display_name"] for a in body["attendees"]] == ["bob", "alice"]
    assert body["duration_ms"] == 90_000


def test_minutes_transcript_lists_sources_in_seq_order_without_extraction(client, seed):
    # spoken 회의에는 추출 결과가 없다. 전사본은 그래도 나온다
    body = client.get(f"/api/v1/meetings/{seed['spoken']}/minutes").json()["data"]
    lines = [
        (t["at_ms"], t["speaker_member_id"], t["speaker_display_name"], t["text"])
        for t in body["transcript"]
    ]
    assert lines == [
        (0, seed["bob"], "bob", "발화 0"),
        (1000, seed["alice"], "alice", "발화 1"),
        (2000, seed["bob"], "bob", "발화 2"),
        (3000, None, None, "발화 3"),
    ]


def test_minutes_transcript_falls_back_to_discord_uid(client, db, seed):
    meeting = Meeting(workspace_id=seed["ws"], status="done")
    db.add(meeting)
    db.flush()
    speakers = [("uid_bob", seed["bob"]), ("uid_guest", None), (None, None)]
    for seq, (uid, member_id) in enumerate(speakers):
        db.add(Source(
            meeting_id=meeting.meeting_id, seq=seq, speaker_discord_user_id=uid,
            member_id=member_id, start_ms=seq, end_ms=seq + 1, text="말",
        ))
    db.commit()

    body = client.get(f"/api/v1/meetings/{meeting.meeting_id}/minutes").json()["data"]

    assert [(t["speaker_display_name"], t["speaker_fallback"]) for t in body["transcript"]] == [
        ("bob", "uid_bob"),
        (None, "uid_guest"),
        (None, "Unknown"),
    ]


def test_minutes_transcript_is_empty_without_source(client, seed):
    body = client.get(f"/api/v1/meetings/{seed['empty']}/minutes").json()["data"]
    assert body["transcript"] == []


def test_workspace_meeting_list_counts_attendees_and_duration(client, seed):
    items = client.get(f"/api/v1/workspaces/{seed['ws']}/meetings").json()["data"]["items"]
    by_id = {i["meeting_id"]: i for i in items}
    assert (by_id[seed["empty"]]["attendee_count"], by_id[seed["empty"]]["duration_ms"]) == (0, 0)
    assert (by_id[seed["spoken"]]["attendee_count"], by_id[seed["spoken"]]["duration_ms"]) == (2, 90_000)


def test_workspace_meeting_list_reads_source_once(client, db, seed):
    statements = []

    def record(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(db.get_bind(), "before_cursor_execute", record)
    try:
        client.get(f"/api/v1/workspaces/{seed['ws']}/meetings")
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", record)

    assert len([s for s in statements if "FROM source" in s]) == 1


def test_audio_merged_follows_source(client, db, seed):
    def merged(meeting_id):
        body = client.get(f"/api/v1/meetings/{meeting_id}").json()["data"]
        return body["progress"]["audio_merged"]

    assert merged(seed["empty"]) is False
    assert merged(seed["spoken"]) is True

    # 추출 결과만 있고 source가 없으면 아직 병합된 것으로 보지 않는다
    db.add(Extraction(meeting_id=seed["empty"]))
    db.commit()
    assert merged(seed["empty"]) is False
