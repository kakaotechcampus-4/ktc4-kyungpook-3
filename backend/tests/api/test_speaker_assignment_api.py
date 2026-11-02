"""PM 의 화자 조회·지정 제출(#266 PR-3). 세션 쿠키로 부르고, 대기 회의는 컬럼을 직접 써서 만든다.

TEST_DATABASE_URL 이 있으면 PostgreSQL 에서도 돈다.
"""
import json
import os
import threading
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.services import upload_storage
from app.models import Meeting, MeetingUpload, Member, Session as SessionModel, User, Workspace

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
SERVICE_TOKEN = "test-service-token"
REPORTED = [
    {"label": "SPEAKER_00", "total_sec": 30.0, "samples": [{"start": 1.0, "end": 6.5}]},
    {"label": "SPEAKER_01", "total_sec": 120.5, "samples": [{"start": 10.0, "end": 14.0}]},
    {"label": "SPEAKER_02", "total_sec": 30.0, "samples": [{"start": 20.0, "end": 25.5}]},
]


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
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
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


def _add_user(db, email, token, ws_id, role, name):
    user = User(email=email, name=name)
    db.add(user)
    db.flush()
    db.add(SessionModel(
        user_id=user.user_id, session_token=token,
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    member = Member(workspace_id=ws_id, user_id=user.user_id, display_name=name, role=role)
    db.add(member)
    return member


def _seed_into(db):
    ws, other_ws = Workspace(name="A"), Workspace(name="B")
    db.add_all([ws, other_ws])
    db.flush()
    pm = _add_user(db, "pm@example.com", "pm-token", ws.workspace_id, "pm", "PM")
    member = _add_user(db, "m@example.com", "member-token", ws.workspace_id, "member", "일반")
    other_pm = _add_user(db, "opm@example.com", "other-pm-token", other_ws.workspace_id, "pm", "다른PM")
    jimin = Member(workspace_id=ws.workspace_id, display_name="지민", role="member")
    left = Member(workspace_id=ws.workspace_id, display_name="탈퇴", role="member", is_deleted=True)
    outsider = Member(workspace_id=other_ws.workspace_id, display_name="외부", role="member")
    db.add_all([jimin, left, outsider])
    db.commit()
    return {
        "ws": ws, "pm": pm, "member": member, "other_pm": other_pm,
        "jimin": jimin, "left": left, "outsider": outsider,
    }


@pytest.fixture
def seed(db):
    return _seed_into(db)


def _meeting(db, seed, *, status="awaiting_speakers", speakers=REPORTED, source="manual_upload", upload=True):
    meeting = Meeting(
        workspace_id=seed["ws"].workspace_id, title="주간 회의", source=source, status=status
    )
    db.add(meeting)
    db.flush()
    if upload:
        attendees = [{"member_id": seed["jimin"].member_id, "display_name": "지민"}]
        db.add(MeetingUpload(
            meeting_id=meeting.meeting_id,
            stored_filename="audio.ogg",
            original_filename="회의.ogg",
            size_bytes=1234,
            content_type="audio/ogg",
            attendees=json.dumps(attendees, ensure_ascii=False),
            claimed_at=datetime(2026, 10, 13, tzinfo=timezone.utc),
            speakers=None if speakers is None else json.dumps(speakers),
            speakers_reported_at=None if speakers is None else datetime(2026, 10, 13, tzinfo=timezone.utc),
        ))
    db.commit()
    return meeting


def _client(token="pm-token"):
    c = TestClient(app, base_url="https://testserver")
    if token:
        c.cookies.set("session_token", token)
    return c


def _get(meeting_id, token="pm-token"):
    return _client(token).get(f"/api/v1/meetings/{meeting_id}/speakers")


def _put(meeting_id, mapping, token="pm-token"):
    return _client(token).put(f"/api/v1/meetings/{meeting_id}/speakers", json={"mapping": mapping})


def _full(seed, **over):
    mapping = {
        "SPEAKER_00": seed["jimin"].member_id,
        "SPEAKER_01": seed["pm"].member_id,
        "SPEAKER_02": None,
    }
    mapping.update(over)
    return mapping


def _upload_row(db, meeting):
    db.expire_all()
    return db.get(MeetingUpload, meeting.meeting_id)


def _status(db, meeting):
    db.expire_all()
    return db.get(Meeting, meeting.meeting_id).status


# ── 조회 ──

def test_pm_reads_speakers_sorted_with_candidates_and_audio(db, seed):
    meeting = _meeting(db, seed)

    r = _get(meeting.meeting_id)

    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["meeting_id"] == meeting.meeting_id
    assert data["status"] == "awaiting_speakers"
    # total_sec 내림차순, 같으면 label 오름차순
    assert [s["label"] for s in data["speakers"]] == ["SPEAKER_01", "SPEAKER_00", "SPEAKER_02"]
    assert data["speakers"][0]["samples"] == [{"start": 10.0, "end": 14.0}]
    assert data["candidates"] == [{"member_id": seed["jimin"].member_id, "display_name": "지민"}]
    assert data["mapping"] is None
    assert data["audio"] == {"content_type": "audio/ogg", "size_bytes": 1234}


def test_speakers_is_empty_before_labels_are_reported(db, seed):
    meeting = _meeting(db, seed, status="processing", speakers=None)

    r = _get(meeting.meeting_id)

    assert r.status_code == 200, r.text
    assert r.json()["data"]["speakers"] == []
    assert r.json()["data"]["status"] == "processing"


def test_read_returns_saved_mapping_after_submit(db, seed):
    meeting = _meeting(db, seed)
    mapping = _full(seed)
    assert _put(meeting.meeting_id, mapping).status_code == 200

    assert _get(meeting.meeting_id).json()["data"]["mapping"] == mapping


@pytest.mark.parametrize("token", ["member-token", "other-pm-token"])
def test_read_requires_pm_of_the_workspace(db, seed, token):
    meeting = _meeting(db, seed)

    r = _get(meeting.meeting_id, token)

    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "FORBIDDEN"


def test_read_without_login_gets_401(db, seed):
    meeting = _meeting(db, seed)

    assert _get(meeting.meeting_id, None).status_code == 401


@pytest.mark.parametrize("kind", ["not_upload", "no_upload_row", "missing"])
def test_read_non_upload_meeting_gets_404(db, seed, kind):
    if kind == "not_upload":
        meeting_id = _meeting(db, seed, source="discord_realtime").meeting_id
    elif kind == "no_upload_row":
        meeting_id = _meeting(db, seed, upload=False).meeting_id
    else:
        meeting_id = "00000000-0000-0000-0000-000000000000"

    r = _get(meeting_id)

    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] == "MEETING_NOT_FOUND"


# ── 제출 ──

def test_submit_moves_to_processing_and_saves_mapping(db, seed):
    meeting = _meeting(db, seed)
    mapping = _full(seed, SPEAKER_02=seed["jimin"].member_id)  # 같은 멤버 두 라벨 허용

    r = _put(meeting.meeting_id, mapping)

    assert r.status_code == 200, r.text
    assert r.json()["data"] == {"meeting_id": meeting.meeting_id, "status": "processing"}
    assert _status(db, meeting) == "processing"
    upload = _upload_row(db, meeting)
    assert json.loads(upload.speaker_mapping) == mapping
    assert upload.speakers_assigned_at is not None


def test_submit_allows_null_for_some_labels(db, seed):
    meeting = _meeting(db, seed)
    mapping = {"SPEAKER_00": None, "SPEAKER_01": None, "SPEAKER_02": None}

    assert _put(meeting.meeting_id, mapping).status_code == 200
    assert json.loads(_upload_row(db, meeting).speaker_mapping) == mapping


def _assert_untouched(db, meeting):
    assert _status(db, meeting) == "awaiting_speakers"
    upload = _upload_row(db, meeting)
    assert upload.speaker_mapping is None
    assert upload.speakers_assigned_at is None


def test_unknown_label_gets_400_without_change(db, seed):
    meeting = _meeting(db, seed)

    r = _put(meeting.meeting_id, _full(seed, SPEAKER_99=None))

    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    assert r.json()["error"]["details"]["unknown_labels"] == ["SPEAKER_99"]
    _assert_untouched(db, meeting)


def test_missing_label_gets_400_without_change(db, seed):
    meeting = _meeting(db, seed)
    mapping = _full(seed)
    del mapping["SPEAKER_02"]

    r = _put(meeting.meeting_id, mapping)

    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    assert r.json()["error"]["details"]["missing_labels"] == ["SPEAKER_02"]
    _assert_untouched(db, meeting)


@pytest.mark.parametrize("who", ["outsider", "left"])
def test_member_outside_workspace_or_left_gets_400_without_change(db, seed, who):
    meeting = _meeting(db, seed)
    bad = seed[who].member_id

    r = _put(meeting.meeting_id, _full(seed, SPEAKER_00=bad))

    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    assert r.json()["error"]["details"]["member_ids"] == [bad]
    _assert_untouched(db, meeting)


def test_unknown_member_id_gets_400(db, seed):
    meeting = _meeting(db, seed)

    r = _put(meeting.meeting_id, _full(seed, SPEAKER_00="no-such-member"))

    assert r.status_code == 400, r.text
    assert r.json()["error"]["details"]["member_ids"] == ["no-such-member"]


def test_same_mapping_again_is_idempotent(db, seed):
    meeting = _meeting(db, seed)
    mapping = _full(seed)
    assert _put(meeting.meeting_id, mapping).status_code == 200
    first_at = _upload_row(db, meeting).speakers_assigned_at

    r = _put(meeting.meeting_id, mapping)

    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "processing"
    assert _upload_row(db, meeting).speakers_assigned_at == first_at


def test_same_mapping_again_is_200_even_after_a_member_left(db, seed):
    meeting = _meeting(db, seed)
    mapping = _full(seed)
    assert _put(meeting.meeting_id, mapping).status_code == 200
    seed["jimin"].is_deleted = True
    db.commit()

    r = _put(meeting.meeting_id, mapping)

    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "processing"


def test_different_mapping_after_submit_gets_409(db, seed):
    meeting = _meeting(db, seed)
    mapping = _full(seed)
    assert _put(meeting.meeting_id, mapping).status_code == 200

    r = _put(meeting.meeting_id, _full(seed, SPEAKER_02=seed["pm"].member_id))

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "MEETING_NOT_AWAITING_SPEAKERS"
    assert r.json()["error"]["details"]["status"] == "processing"
    assert json.loads(_upload_row(db, meeting).speaker_mapping) == mapping


def test_submit_when_not_awaiting_gets_409(db, seed):
    meeting = _meeting(db, seed, status="processing", speakers=None)

    r = _put(meeting.meeting_id, {"SPEAKER_00": None})

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "MEETING_NOT_AWAITING_SPEAKERS"
    assert r.json()["error"]["details"]["status"] == "processing"
    assert _status(db, meeting) == "processing"
    assert _upload_row(db, meeting).speaker_mapping is None


def test_submit_after_ended_gets_409_with_status(db, seed):
    meeting = _meeting(db, seed, status="failed")

    r = _put(meeting.meeting_id, _full(seed))

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "MEETING_NOT_AWAITING_SPEAKERS"
    assert r.json()["error"]["details"]["status"] == "failed"


@pytest.mark.parametrize("token", ["member-token", "other-pm-token"])
def test_submit_requires_pm_of_the_workspace(db, seed, token):
    meeting = _meeting(db, seed)

    r = _put(meeting.meeting_id, _full(seed), token)

    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "FORBIDDEN"
    _assert_untouched(db, meeting)


def test_submit_without_login_gets_401(db, seed):
    meeting = _meeting(db, seed)

    assert _put(meeting.meeting_id, _full(seed), None).status_code == 401


def test_submit_to_non_upload_or_missing_meeting_gets_404(db, seed):
    other = _meeting(db, seed, source="discord_realtime")
    for meeting_id in (other.meeting_id, "00000000-0000-0000-0000-000000000000"):
        r = _put(meeting_id, {"SPEAKER_00": None})
        assert r.status_code == 404, r.text
        assert r.json()["error"]["code"] == "MEETING_NOT_FOUND"


def test_submitted_assignment_reaches_the_ai_path(db, seed):
    meeting = _meeting(db, seed)
    mapping = _full(seed)
    assert _put(meeting.meeting_id, mapping).status_code == 200
    ai = TestClient(app, base_url="https://testserver")
    headers = {"X-Service-Token": SERVICE_TOKEN}

    assigned = ai.get("/api/v1/uploads/assigned", headers=headers)
    resumed = ai.patch(f"/api/v1/uploads/{meeting.meeting_id}/resume", headers=headers)

    assert [i["meeting_id"] for i in assigned.json()["data"]["items"]] == [meeting.meeting_id]
    assert assigned.json()["data"]["items"][0]["mapping"] == mapping
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["data"]["mapping"] == mapping


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없습니다. SQLite 로는 동시성을 볼 수 없다")
def test_concurrent_submits_transition_only_once(monkeypatch):
    """같은 대기 회의에 서로 다른 mapping 두 개가 동시에 와도 하나만 이기고 다른 하나는 409 다."""
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
    engine = _pg_engine()
    Base.metadata.create_all(engine)
    make_session = sessionmaker(bind=engine)

    def session_per_request():
        session = make_session()
        try:
            yield session
        finally:
            session.close()

    seed_session = make_session()
    seed = _seed_into(seed_session)
    meeting = _meeting(seed_session, seed)
    meeting_id = meeting.meeting_id
    mappings = [_full(seed), _full(seed, SPEAKER_02=seed["pm"].member_id)]
    seed_session.close()

    barrier = threading.Barrier(2, timeout=10)
    results = []
    app.dependency_overrides[get_db] = session_per_request

    def put(mapping):
        barrier.wait()
        results.append(_put(meeting_id, mapping))

    try:
        threads = [threading.Thread(target=put, args=(m,)) for m in mappings]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        assert sorted(r.status_code for r in results) == [200, 409], [r.text for r in results]
        check = make_session()
        upload = check.get(MeetingUpload, meeting_id)
        assert json.loads(upload.speaker_mapping) in mappings
        assert check.get(Meeting, meeting_id).status == "processing"
        check.close()
    finally:
        app.dependency_overrides.pop(get_db, None)
        Base.metadata.drop_all(engine)
        engine.dispose()


# ── 원본 재생 ──

AUDIO = b"OggS" + bytes(range(256)) * 4
WAV = b"RIFF" + (36).to_bytes(4, "little") + b"WAVE" + bytes(range(256)) * 4


def _put_audio(meeting, content=AUDIO):
    folder = upload_storage.meeting_dir(meeting.meeting_id)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "audio.ogg").write_bytes(content)


def _audio(meeting_id, token="pm-token", **headers):
    return _client(token).get(f"/api/v1/meetings/{meeting_id}/audio", headers=headers)


def test_pm_plays_the_whole_audio_inline(db, seed):
    meeting = _meeting(db, seed)
    _put_audio(meeting)

    r = _audio(meeting.meeting_id)

    assert r.status_code == 200, r.text
    assert r.content == AUDIO
    assert r.headers["content-type"] == "audio/ogg"
    assert "attachment" not in r.headers.get("content-disposition", "")
    assert r.headers["accept-ranges"] == "bytes"


def test_audio_range_request_gets_206_with_exact_bytes(db, seed):
    meeting = _meeting(db, seed)
    _put_audio(meeting)

    r = _audio(meeting.meeting_id, Range="bytes=0-99")

    assert r.status_code == 206, r.text
    assert r.headers["content-range"] == f"bytes 0-99/{len(AUDIO)}"
    assert r.content == AUDIO[:100]
    assert len(r.content) == 100


def _stored(db, meeting, *, filename, content_type):
    upload = db.get(MeetingUpload, meeting.meeting_id)
    upload.stored_filename = filename
    upload.content_type = content_type
    db.commit()
    folder = upload_storage.meeting_dir(meeting.meeting_id)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / filename).write_bytes(AUDIO)


@pytest.mark.parametrize("ext,expected", [
    ("wav", "audio/wav"), ("mp3", "audio/mpeg"), ("m4a", "audio/mp4"),
    ("ogg", "audio/ogg"), ("webm", "audio/webm"), ("bin", "application/octet-stream"),
])
def test_audio_content_type_comes_from_the_stored_extension_not_the_client(db, seed, ext, expected):
    meeting = _meeting(db, seed)
    _stored(db, meeting, filename=f"audio.{ext}", content_type="text/html")

    r = _audio(meeting.meeting_id)

    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == expected
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "private, no-store"
    view = _get(meeting.meeting_id).json()["data"]
    assert view["audio"]["content_type"] == expected


@pytest.mark.parametrize("status", ["awaiting_speakers", "processing"])
def test_audio_is_served_regardless_of_status_while_folder_exists(db, seed, status):
    meeting = _meeting(db, seed, status=status)
    _put_audio(meeting)

    assert _audio(meeting.meeting_id).status_code == 200


@pytest.mark.parametrize("token", ["member-token", "other-pm-token"])
def test_audio_requires_pm_of_the_workspace(db, seed, token):
    meeting = _meeting(db, seed)
    _put_audio(meeting)

    r = _audio(meeting.meeting_id, token=token)

    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "FORBIDDEN"


def test_audio_without_login_gets_401(db, seed):
    meeting = _meeting(db, seed)
    _put_audio(meeting)

    assert _audio(meeting.meeting_id, token=None).status_code == 401


@pytest.mark.parametrize("kind", ["not_upload", "no_upload_row", "missing", "no_folder", "no_file"])
def test_audio_gets_404_when_there_is_nothing_to_play(db, seed, kind):
    if kind == "not_upload":
        meeting = _meeting(db, seed, source="discord_realtime")
        _put_audio(meeting)
        meeting_id = meeting.meeting_id
    elif kind == "no_upload_row":
        meeting = _meeting(db, seed, upload=False)
        _put_audio(meeting)
        meeting_id = meeting.meeting_id
    elif kind == "missing":
        meeting_id = "00000000-0000-0000-0000-000000000000"
    elif kind == "no_folder":
        meeting_id = _meeting(db, seed).meeting_id
    else:
        meeting = _meeting(db, seed)
        _put_audio(meeting)
        (upload_storage.meeting_dir(meeting.meeting_id) / "audio.ogg").unlink()
        meeting_id = meeting.meeting_id

    r = _audio(meeting_id)

    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] == "MEETING_NOT_FOUND"


# ── 전체 흐름 ──

def test_upload_to_done_flow_with_speaker_assignment(db, seed):
    ai = TestClient(app, base_url="https://testserver")
    headers = {"X-Service-Token": SERVICE_TOKEN}
    pm = _client()

    up = pm.post(
        f"/api/v1/workspaces/{seed['ws'].workspace_id}/meetings/upload",
        data={"title": "주간 회의", "attendee_member_ids": [seed["jimin"].member_id]},
        files={"file": ("회의.wav", WAV, "audio/wav")},
    )
    assert up.status_code == 202, up.text
    meeting_id = up.json()["data"]["meeting_id"]
    folder = upload_storage.meeting_dir(meeting_id)

    assert ai.patch(f"/api/v1/uploads/{meeting_id}/claim", headers=headers).status_code == 200
    labels = ai.post(f"/api/v1/uploads/{meeting_id}/speakers", headers=headers, json={"speakers": REPORTED})
    assert labels.status_code == 200, labels.text
    assert labels.json()["data"]["status"] == "awaiting_speakers"

    view = pm.get(f"/api/v1/meetings/{meeting_id}/speakers")
    assert view.status_code == 200, view.text
    assert [s["label"] for s in view.json()["data"]["speakers"]] == ["SPEAKER_01", "SPEAKER_00", "SPEAKER_02"]
    assert pm.get(f"/api/v1/meetings/{meeting_id}/audio").content == WAV

    def register():
        return ai.post("/api/v1/extractions", headers=headers, json={
            "meeting_id": meeting_id, "workspace_id": seed["ws"].workspace_id, "items": [],
        })

    early = register()
    assert early.status_code == 409, early.text
    assert early.json()["error"]["code"] == "MEETING_NOT_PROCESSING"
    assert early.json()["error"]["details"]["status"] == "awaiting_speakers"
    assert folder.exists()

    mapping = {
        "SPEAKER_00": seed["jimin"].member_id, "SPEAKER_01": seed["pm"].member_id, "SPEAKER_02": None,
    }
    put = pm.put(f"/api/v1/meetings/{meeting_id}/speakers", json={"mapping": mapping})
    assert put.status_code == 200, put.text
    assert put.json()["data"]["status"] == "processing"

    assigned = ai.get("/api/v1/uploads/assigned", headers=headers).json()["data"]["items"]
    assert [i["meeting_id"] for i in assigned] == [meeting_id]
    assert assigned[0]["mapping"] == mapping
    resumed = ai.patch(f"/api/v1/uploads/{meeting_id}/resume", headers=headers)
    assert resumed.status_code == 200, resumed.text

    done = register()
    assert done.status_code == 201, done.text
    assert _status(db, Meeting(meeting_id=meeting_id)) == "done"
    assert not folder.exists()
    assert pm.get(f"/api/v1/meetings/{meeting_id}/audio").status_code == 404
