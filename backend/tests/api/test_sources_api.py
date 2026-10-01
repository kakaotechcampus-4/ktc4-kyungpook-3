"""POST /meetings/{id}/sources — 전사 발화 저장, 재전송, 화자-팀원 연결, 회의 길이, 검증, 인증.

같은 seq를 건너뛰는 INSERT가 DB마다 문법이 달라서, TEST_DATABASE_URL이 있으면 PostgreSQL에서도 돈다.
"""
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import sources as sources_api
from app.core.database import Base, get_db
from app.main import app
from app.models import Meeting, MeetingStatus, Member, Source, Workspace

TOKEN = "test-service-token"
HEADERS = {"X-Service-Token": TOKEN}
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
def client(db):
    return TestClient(app)


@pytest.fixture
def meeting(db) -> Meeting:
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    m = Meeting(workspace_id=ws.workspace_id, status=str(MeetingStatus.PROCESSING))
    db.add(m)
    db.commit()
    return m


def _seg(seq: int, *, speaker: str | None = "uid_a", start: float = 0.0, end: float = 1.0, text: str = "말") -> dict:
    return {"speaker": speaker, "start": start, "end": end, "text": text, "seq": seq}


def _post(client, meeting_id: str, segments: list[dict], *, headers=HEADERS, **extra):
    return client.post(
        f"/api/v1/meetings/{meeting_id}/sources",
        json={"source": "meeting", "segments": segments, **extra},
        headers=headers,
    )


def _sources(db, meeting_id: str) -> list[Source]:
    db.expire_all()
    return db.execute(select(Source).where(Source.meeting_id == meeting_id).order_by(Source.seq)).scalars().all()


def test_saves_segments_with_seconds_converted_to_ms(client, db, meeting):
    r = _post(client, meeting.meeting_id, [
        _seg(0, speaker="uid_a", start=12.34, end=15.87, text="로그인은 제가 할게요."),
        _seg(3, speaker=None, start=16.1, end=18.42, text="좋아요."),
    ])

    assert r.status_code == 201
    assert r.json()["data"] == {
        "meeting_id": meeting.meeting_id, "inserted": 2, "skipped": 0, "duration_ms": 18420,
    }
    rows = [(s.seq, s.speaker_discord_user_id, s.start_ms, s.end_ms, s.text) for s in _sources(db, meeting.meeting_id)]
    assert rows == [
        (0, "uid_a", 12340, 15870, "로그인은 제가 할게요."),
        (3, None, 16100, 18420, "좋아요."),
    ]


def test_resend_skips_existing_seq_without_overwriting(client, db, meeting):
    _post(client, meeting.meeting_id, [_seg(0, text="처음"), _seg(1)])

    # 재시도로 같은 줄이 다시 오고, 실패했던 줄(seq 2)이 새로 채워져 온다
    r = _post(client, meeting.meeting_id, [_seg(0, text="바뀐 글"), _seg(1), _seg(2)])

    assert r.status_code == 201
    assert r.json()["data"]["inserted"] == 1
    assert r.json()["data"]["skipped"] == 2
    rows = _sources(db, meeting.meeting_id)
    assert [s.seq for s in rows] == [0, 1, 2]
    assert rows[0].text == "처음"


def test_same_seq_in_other_meeting_is_saved(client, db, meeting):
    other = Meeting(workspace_id=meeting.workspace_id, status=str(MeetingStatus.PROCESSING))
    db.add(other)
    db.commit()
    _post(client, meeting.meeting_id, [_seg(0)])

    r = _post(client, other.meeting_id, [_seg(0)])

    assert r.json()["data"]["inserted"] == 1


def test_empty_segments_saves_nothing(client, db, meeting):
    r = _post(client, meeting.meeting_id, [])

    assert r.status_code == 201
    assert r.json()["data"] == {
        "meeting_id": meeting.meeting_id, "inserted": 0, "skipped": 0, "duration_ms": None,
    }
    db.expire_all()
    assert db.get(Meeting, meeting.meeting_id).duration_ms is None


def _member(db, workspace_id: str, uid: str, *, name: str = "민수", deleted: bool = False) -> Member:
    m = Member(workspace_id=workspace_id, display_name=name, discord_user_id=uid, is_deleted=deleted)
    db.add(m)
    db.commit()
    return m


def test_links_speaker_to_member_of_same_workspace(client, db, meeting):
    minsu = _member(db, meeting.workspace_id, "uid_minsu")

    _post(client, meeting.meeting_id, [_seg(0, speaker="uid_minsu"), _seg(1, speaker=None)])

    rows = _sources(db, meeting.meeting_id)
    assert [(s.speaker_discord_user_id, s.member_id) for s in rows] == [
        ("uid_minsu", minsu.member_id),
        (None, None),
    ]


def test_speaker_not_linked_to_other_workspace_or_deleted_member(client, db, meeting):
    other_ws = Workspace(name="B")
    db.add(other_ws)
    db.commit()
    _member(db, other_ws.workspace_id, "uid_other")
    _member(db, meeting.workspace_id, "uid_left", deleted=True)

    _post(client, meeting.meeting_id, [
        _seg(0, speaker="uid_other"), _seg(1, speaker="uid_left"), _seg(2, speaker="uid_unknown"),
    ])

    rows = _sources(db, meeting.meeting_id)
    assert [s.member_id for s in rows] == [None, None, None]
    # 팀원이 아니어도 화자 uid는 남긴다
    assert [s.speaker_discord_user_id for s in rows] == ["uid_other", "uid_left", "uid_unknown"]


def test_looks_up_each_speaker_once(client, db, meeting, monkeypatch):
    calls: list[str] = []
    real = sources_api.resolve_speaker

    def counting(db, workspace_id, uid):
        calls.append(uid)
        return real(db, workspace_id, uid)

    monkeypatch.setattr(sources_api, "resolve_speaker", counting)

    _post(client, meeting.meeting_id, [
        _seg(0, speaker="uid_a"), _seg(1, speaker="uid_b"), _seg(2, speaker="uid_a"), _seg(3, speaker="uid_a"),
    ])

    assert sorted(calls) == ["uid_a", "uid_b"]


def test_duration_is_max_end_not_last_seq(client, db, meeting):
    # 앞 사람이 길게 말하는 중에 뒷사람이 짧게 끼어들면 마지막 seq가 먼저 끝난다
    r = _post(client, meeting.meeting_id, [
        _seg(0, speaker="uid_a", start=0.0, end=30.0),
        _seg(1, speaker="uid_b", start=10.0, end=12.5),
    ])

    assert r.json()["data"]["duration_ms"] == 30000
    db.expire_all()
    assert db.get(Meeting, meeting.meeting_id).duration_ms == 30000


def test_duration_counts_all_saved_segments_and_never_shrinks(client, db, meeting):
    _post(client, meeting.meeting_id, [_seg(0, start=0.0, end=10.0)])
    r = _post(client, meeting.meeting_id, [_seg(1, start=10.0, end=25.0)])
    assert r.json()["data"]["duration_ms"] == 25000

    # 앞부분만 다시 보내도 저장된 발화 전체로 세므로 줄지 않는다
    r = _post(client, meeting.meeting_id, [_seg(0, start=0.0, end=10.0)])

    assert r.json()["data"]["duration_ms"] == 25000


def test_saved_sources_mark_meeting_as_transcribed(client, db, meeting):
    before = client.get(f"/api/v1/meetings/{meeting.meeting_id}").json()["data"]["progress"]
    _post(client, meeting.meeting_id, [_seg(0)])

    after = client.get(f"/api/v1/meetings/{meeting.meeting_id}").json()["data"]["progress"]

    assert (before["audio_merged"], before["transcribed"]) == (False, False)
    assert (after["audio_merged"], after["transcribed"]) == (True, True)


@pytest.mark.parametrize("status", [MeetingStatus.CREATED, MeetingStatus.DONE])
def test_accepts_meetings_that_are_not_failed(client, db, meeting, status):
    meeting.status = str(status)
    db.commit()

    r = _post(client, meeting.meeting_id, [_seg(0)])

    assert r.status_code == 201


def test_duplicated_seq_in_one_request_is_400(client, db, meeting):
    # seq를 매기지 않은 전사는 전부 0으로 온다
    r = _post(client, meeting.meeting_id, [_seg(0), _seg(0), _seg(1)])

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    assert _sources(db, meeting.meeting_id) == []


@pytest.mark.parametrize(
    "segment",
    [
        _seg(0, start=5.0, end=4.0),
        _seg(-1),
        _seg(0, speaker="x" * 65),
        {"speaker": "uid_a", "start": 0.0, "end": 1.0, "text": "seq 없음"},
    ],
    ids=["end-before-start", "negative-seq", "speaker-too-long", "missing-seq"],
)
def test_invalid_segment_is_400(client, db, meeting, segment):
    r = _post(client, meeting.meeting_id, [segment])

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


def test_chat_transcript_is_400(client, db, meeting):
    r = client.post(
        f"/api/v1/meetings/{meeting.meeting_id}/sources",
        json={"source": "chat", "segments": [_seg(0)]},
        headers=HEADERS,
    )

    assert r.status_code == 400


def test_unknown_meeting_is_404(client, db, meeting):
    r = _post(client, "no-such-meeting", [_seg(0)])

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "MEETING_NOT_FOUND"


def test_failed_meeting_is_409(client, db, meeting):
    meeting.status = str(MeetingStatus.FAILED)
    db.commit()

    r = _post(client, meeting.meeting_id, [_seg(0)])

    assert r.status_code == 409
    assert r.json()["error"]["code"] == "MEETING_ALREADY_ENDED"
    assert r.json()["error"]["details"]["status"] == "failed"


@pytest.mark.parametrize(
    "headers", [{}, {"X-Service-Token": "wrong"}], ids=["missing-token", "wrong-token"]
)
def test_rejects_requests_without_valid_service_token(client, db, meeting, headers):
    r = _post(client, meeting.meeting_id, [_seg(0)], headers=headers)

    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHENTICATED"
    assert _sources(db, meeting.meeting_id) == []
