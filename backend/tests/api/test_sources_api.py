"""POST /meetings/{id}/sources — 전사 발화 저장, 재전송, 화자-팀원 연결, 회의 길이, 검증, 인증.

같은 seq를 건너뛰는 INSERT가 DB마다 문법이 달라서, TEST_DATABASE_URL이 있으면 PostgreSQL에서도 돈다.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import sources as sources_api
from app.core.database import Base, get_db
from app.main import app
from app.models import Meeting, MeetingStatus, Member, Session as SessionModel, Source, User, Workspace
from app.schemas.source import MAX_SECONDS

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


def test_saves_speaker_name_from_speaker_names(client, db, meeting):
    _post(
        client, meeting.meeting_id,
        [_seg(0, speaker="uid_a"), _seg(1, speaker="uid_b"), _seg(2, speaker=None), _seg(3, speaker="uid_a")],
        speaker_names={"uid_a": "김서연", "uid_b": "  박민수 ", "uid_absent": "안 나온 사람"},
    )

    rows = _sources(db, meeting.meeting_id)
    assert [(s.speaker_discord_user_id, s.speaker_name) for s in rows] == [
        ("uid_a", "김서연"),
        ("uid_b", "박민수"),
        (None, None),
        ("uid_a", "김서연"),
    ]


@pytest.mark.parametrize(
    "speaker_names",
    [None, {}, {"uid_other": "다른 사람"}, {"uid_a": ""}, {"uid_a": "   "}, {"uid_a": "uid_a"}],
    ids=["missing", "empty", "not-listed", "blank", "spaces", "same-as-uid"],
)
def test_speaker_name_is_null_without_usable_name(client, db, meeting, speaker_names):
    # 봇은 이름을 못 찾으면 uid를 이름 자리에 넣는다
    extra = {} if speaker_names is None else {"speaker_names": speaker_names}
    _post(client, meeting.meeting_id, [_seg(0, speaker="uid_a")], **extra)

    [row] = _sources(db, meeting.meeting_id)
    assert row.speaker_name is None


@pytest.mark.parametrize(
    "speaker_names",
    [{"x" * 65: "이름"}, {"uid_a": "가" * 101}],
    ids=["uid-too-long", "name-too-long"],
)
def test_too_long_speaker_names_is_400(client, db, meeting, speaker_names):
    r = _post(client, meeting.meeting_id, [_seg(0, speaker="uid_a")], speaker_names=speaker_names)

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


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


def _login_member(client, db, workspace_id: str) -> None:
    """회의 상세는 워크스페이스 멤버만 읽는다. 그 워크스페이스 멤버로 client에 세션 쿠키를 심는다."""
    user = User(email="member@example.com", name="member")
    db.add(user)
    db.flush()
    db.add_all([
        Member(workspace_id=workspace_id, user_id=user.user_id, display_name="member"),
        SessionModel(
            user_id=user.user_id,
            session_token="member-token",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        ),
    ])
    db.commit()
    client.cookies.set("session_token", "member-token")


def test_saved_sources_mark_meeting_as_transcribed(client, db, meeting):
    _login_member(client, db, meeting.workspace_id)
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
        # int4 컬럼을 넘는 값은 저장할 때 500이 나므로 받을 때 막는다
        _seg(2**31),
        _seg(0, start=0.0, end=MAX_SECONDS + 1),
    ],
    ids=["end-before-start", "negative-seq", "speaker-too-long", "missing-seq", "seq-over-int4", "end-over-a-day"],
)
def test_invalid_segment_is_400(client, db, meeting, segment):
    r = _post(client, meeting.meeting_id, [segment])

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


@pytest.mark.parametrize("value", ["Infinity", "NaN"])
def test_non_finite_time_is_400(client, db, meeting, value):
    # 파이썬 json은 Infinity·NaN을 읽는다. 그대로 두면 ms로 바꿀 때 500이 난다
    body = (
        '{"source": "meeting", "segments": '
        f'[{{"speaker": "uid_a", "start": 0, "end": {value}, "text": "말", "seq": 0}}]}}'
    )
    r = client.post(
        f"/api/v1/meetings/{meeting.meeting_id}/sources",
        content=body,
        headers={**HEADERS, "Content-Type": "application/json"},
    )

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    assert _sources(db, meeting.meeting_id) == []


@pytest.mark.parametrize("blank", ["", "  "])
def test_blank_speaker_is_saved_as_null(client, db, meeting, blank):
    _post(client, meeting.meeting_id, [_seg(0, speaker=blank)])

    [row] = _sources(db, meeting.meeting_id)
    assert (row.speaker_discord_user_id, row.member_id) == (None, None)


def test_long_transcript_is_saved_in_batches(client, db, meeting):
    # 한 문장에 다 넣으면 SQLite는 약 3600행, PostgreSQL은 약 7300행에서 바인드 변수 한도를 넘는다
    count = 8000
    segments = [_seg(seq, start=seq * 0.5, end=seq * 0.5 + 0.4) for seq in reversed(range(count))]

    r = _post(client, meeting.meeting_id, segments)

    assert r.status_code == 201
    assert r.json()["data"]["inserted"] == count
    assert r.json()["data"]["duration_ms"] == round(((count - 1) * 0.5 + 0.4) * 1000)
    assert len(_sources(db, meeting.meeting_id)) == count


def test_locks_meeting_row_on_postgresql(client, db, meeting):
    if db.get_bind().dialect.name != "postgresql":
        pytest.skip("SQLite는 FOR UPDATE를 쓰지 않는다")
    statements: list[str] = []

    def listener(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(db.get_bind(), "before_cursor_execute", listener)
    try:
        _post(client, meeting.meeting_id, [_seg(0)])
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", listener)

    assert any("FROM meeting" in s and "FOR UPDATE" in s for s in statements)


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
    # 봇이 "이미 처리됨"으로 넘기는 MEETING_ALREADY_ENDED와 구분한다
    assert r.json()["error"]["code"] == "MEETING_FAILED"
    assert r.json()["error"]["details"]["status"] == "failed"
    assert _sources(db, meeting.meeting_id) == []


@pytest.mark.parametrize(
    "headers", [{}, {"X-Service-Token": "wrong"}], ids=["missing-token", "wrong-token"]
)
def test_rejects_requests_without_valid_service_token(client, db, meeting, headers):
    r = _post(client, meeting.meeting_id, [_seg(0)], headers=headers)

    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHENTICATED"
    assert _sources(db, meeting.meeting_id) == []
