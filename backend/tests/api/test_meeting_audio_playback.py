"""회의 녹음 원문 듣기(#659): 재생 권한·응답, minutes `audio`, speaker view `audio`, AI 다운로드의 S3 스트리밍.

기본은 local 저장소이고, s3 는 tests/fake_s3.py 의 가짜로 바꿔 실제 AWS 를 부르지 않는다.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import Meeting, MeetingAudio, MeetingUpload, Member, Session as SessionModel, User, Workspace
from app.services import upload_storage
from app.services.sessions import hash_session_token
from tests.fake_s3 import FakeS3
from tests.usernames import username_for

SERVICE_TOKEN = "test-service-token"
AUDIO = b"\x00\x00\x00\x18ftypM4A " + bytes(range(256)) * 4
BUCKET = "b"


@pytest.fixture
def db(monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
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
        engine.dispose()


def _user(db, email, token, ws_id, role):
    user = User(username=username_for(email), email=email, name=role)
    db.add(user)
    db.flush()
    db.add(SessionModel(
        user_id=user.user_id, session_token=hash_session_token(token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    if ws_id is not None:
        db.add(Member(workspace_id=ws_id, user_id=user.user_id, display_name=role, role=role))


@pytest.fixture
def seed(db):
    ws, other = Workspace(name="A"), Workspace(name="B")
    db.add_all([ws, other])
    db.flush()
    ws_id, other_id = ws.workspace_id, other.workspace_id
    _user(db, "pm@example.com", "pm-token", ws_id, "pm")
    _user(db, "m@example.com", "member-token", ws_id, "member")
    _user(db, "o@example.com", "outsider-token", other_id, "pm")
    db.commit()
    return ws_id


def _meeting(db, ws_id, *, status="done", received_ago=timedelta(hours=1), recorded=True, source="manual_upload"):
    meeting = Meeting(workspace_id=ws_id, title="주간 회의", source=source, status=status)
    db.add(meeting)
    db.flush()
    meeting_id = meeting.meeting_id
    received_at = datetime.now(timezone.utc) - received_ago
    if recorded:
        db.add(MeetingAudio(
            meeting_id=meeting_id, filename="audio.m4a", content_type="audio/mp4",
            size_bytes=len(AUDIO), received_at=received_at,
        ))
        db.add(MeetingUpload(
            meeting_id=meeting_id, stored_filename="audio.m4a", original_filename="회의.m4a",
            size_bytes=len(AUDIO), content_type="audio/mp4", attendees="[]", uploaded_at=received_at,
        ))
    db.commit()
    return meeting_id, received_at


def _put_local(meeting_id):
    folder = upload_storage.meeting_dir(meeting_id)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "audio.m4a").write_bytes(AUDIO)


def _client(token="member-token"):
    c = TestClient(app, base_url="https://testserver")
    if token:
        c.cookies.set("session_token", token)
    return c


def _audio(meeting_id, token="member-token", **headers):
    return _client(token).get(f"/api/v1/meetings/{meeting_id}/audio", headers=headers, follow_redirects=False)


@pytest.fixture
def s3(monkeypatch):
    fake = FakeS3()
    monkeypatch.setattr(upload_storage, "_s3_client", lambda: fake)
    monkeypatch.setenv("UPLOAD_STORAGE", "s3")
    monkeypatch.setenv("UPLOAD_S3_BUCKET", BUCKET)
    return fake


# ── 재생 권한 ──

def test_member_can_play_done_meeting(db, seed):
    meeting_id, _ = _meeting(db, seed)
    _put_local(meeting_id)

    r = _audio(meeting_id)

    assert r.status_code == 200, r.text
    assert r.content == AUDIO
    assert r.headers["content-type"] == "audio/mp4"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "private, no-store"

    ranged = _audio(meeting_id, Range="bytes=0-3")
    assert ranged.status_code == 206
    assert ranged.content == AUDIO[:4]


@pytest.mark.parametrize("status", ["processing", "awaiting_speakers"])
def test_member_cannot_play_unfinished_meeting(db, seed, status):
    meeting_id, _ = _meeting(db, seed, status=status)
    _put_local(meeting_id)

    r = _audio(meeting_id)

    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "FORBIDDEN"


@pytest.mark.parametrize("status", ["processing", "awaiting_speakers"])
def test_pm_can_play_unfinished_meeting(db, seed, status):
    meeting_id, _ = _meeting(db, seed, status=status)
    _put_local(meeting_id)

    assert _audio(meeting_id, token="pm-token").status_code == 200


def test_non_member_gets_403(db, seed):
    meeting_id, _ = _meeting(db, seed)
    _put_local(meeting_id)

    r = _audio(meeting_id, token="outsider-token")

    assert r.status_code == 403, r.text


def test_without_login_gets_401(db, seed):
    meeting_id, _ = _meeting(db, seed)
    _put_local(meeting_id)

    assert _audio(meeting_id, token=None).status_code == 401


def test_deleted_meeting_gets_410(db, seed):
    meeting_id, _ = _meeting(db, seed)
    _put_local(meeting_id)
    db.get(Meeting, meeting_id).deleted_at = datetime.now(timezone.utc)
    db.commit()

    r = _audio(meeting_id)

    assert r.status_code == 410, r.text


# ── 못 들을 때 ──

def test_expired_returns_audio_not_available(db, seed):
    meeting_id, _ = _meeting(db, seed, received_ago=timedelta(days=8))
    _put_local(meeting_id)

    r = _audio(meeting_id)

    assert r.status_code == 404, r.text
    error = r.json()["error"]
    assert error["code"] == "AUDIO_NOT_AVAILABLE"
    assert error["details"] == {"meeting_id": meeting_id, "reason": "expired"}


def test_chat_meeting_returns_no_recording(db, seed):
    meeting_id, _ = _meeting(db, seed, recorded=False, source="chat")

    r = _audio(meeting_id)

    assert r.status_code == 404, r.text
    assert r.json()["error"]["details"]["reason"] == "no_recording"


def test_local_file_gone_returns_no_recording(db, seed):
    meeting_id, _ = _meeting(db, seed)

    r = _audio(meeting_id)

    assert r.status_code == 404, r.text
    error = r.json()["error"]
    assert error["code"] == "AUDIO_NOT_AVAILABLE"
    assert error["details"]["reason"] == "no_recording"


# ── S3 ──

def test_s3_mode_redirects_with_no_store(db, seed, s3):
    meeting_id, _ = _meeting(db, seed)

    r = _audio(meeting_id)

    assert r.status_code == 302, r.text
    assert r.headers["location"] == f"https://fake-s3.example/{BUCKET}/meetings/{meeting_id}/audio.m4a?expires=3600"
    assert r.headers["cache-control"] == "private, no-store"
    assert s3.presign_calls[0]["Params"]["ResponseContentType"] == "audio/mp4"


def test_s3_mode_returns_db_connection_before_redirect(db, seed, s3):
    meeting_id, _ = _meeting(db, seed)
    closed = []
    original_close = db.close
    db.close = lambda: (closed.append(True), original_close())[1]
    try:
        r = _audio(meeting_id)
    finally:
        db.close = original_close

    assert r.status_code == 302
    assert closed


def test_s3_mode_still_checks_permission_first(db, seed, s3):
    meeting_id, _ = _meeting(db, seed, status="processing")

    assert _audio(meeting_id).status_code == 403
    assert s3.presign_calls == []


# ── minutes.audio ──

def _minutes(meeting_id, token="member-token"):
    return _client(token).get(f"/api/v1/meetings/{meeting_id}/minutes")


def test_minutes_audio_present_for_member_on_done(db, seed):
    meeting_id, received_at = _meeting(db, seed)

    r = _minutes(meeting_id)

    assert r.status_code == 200, r.text
    audio = r.json()["data"]["audio"]
    assert audio["content_type"] == "audio/mp4"
    assert set(audio) == {"content_type", "expires_at"}
    assert datetime.fromisoformat(audio["expires_at"].replace("Z", "+00:00")).replace(tzinfo=timezone.utc) == (
        received_at + timedelta(days=7)
    ).replace(microsecond=received_at.microsecond)


def test_minutes_audio_null_when_expired(db, seed):
    meeting_id, _ = _meeting(db, seed, received_ago=timedelta(days=8))

    assert _minutes(meeting_id).json()["data"]["audio"] is None


def test_minutes_audio_null_for_chat_meeting(db, seed):
    meeting_id, _ = _meeting(db, seed, recorded=False, source="chat")

    assert _minutes(meeting_id).json()["data"]["audio"] is None


def test_minutes_audio_null_for_member_on_processing(db, seed):
    meeting_id, _ = _meeting(db, seed, status="processing")

    assert _minutes(meeting_id).json()["data"]["audio"] is None


def test_minutes_audio_present_for_pm_on_processing(db, seed):
    meeting_id, _ = _meeting(db, seed, status="processing")

    assert _minutes(meeting_id, token="pm-token").json()["data"]["audio"]["content_type"] == "audio/mp4"


# ── AI 다운로드 ──

def test_ai_download_streams_from_s3(db, seed, s3):
    meeting_id, _ = _meeting(db, seed, status="processing")
    s3.put(BUCKET, f"meetings/{meeting_id}/audio.m4a", AUDIO, "audio/mp4")

    r = TestClient(app, base_url="https://testserver").get(
        f"/api/v1/uploads/{meeting_id}/file", headers={"X-Service-Token": SERVICE_TOKEN}, follow_redirects=False
    )

    assert r.status_code == 200, r.text
    assert r.content == AUDIO
    assert r.headers["content-length"] == str(len(AUDIO))
    assert r.headers["content-type"] == "audio/mp4"
    assert 'filename="audio.m4a"' in r.headers["content-disposition"]


def test_ai_download_of_missing_s3_object_gets_404(db, seed, s3):
    meeting_id, _ = _meeting(db, seed, status="processing")

    r = TestClient(app, base_url="https://testserver").get(
        f"/api/v1/uploads/{meeting_id}/file", headers={"X-Service-Token": SERVICE_TOKEN}
    )

    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] == "MEETING_NOT_FOUND"


# ── speaker view ──

def test_speaker_view_audio_follows_the_retention_rule(db, seed):
    meeting_id, _ = _meeting(db, seed, status="awaiting_speakers")
    _put_local(meeting_id)

    r = _client("pm-token").get(f"/api/v1/meetings/{meeting_id}/speakers")

    assert r.status_code == 200, r.text
    assert r.json()["data"]["audio"] == {"content_type": "audio/mp4", "size_bytes": len(AUDIO)}


def test_speaker_view_audio_is_null_when_expired(db, seed):
    meeting_id, _ = _meeting(db, seed, status="done", received_ago=timedelta(days=8))
    _put_local(meeting_id)

    r = _client("pm-token").get(f"/api/v1/meetings/{meeting_id}/speakers")

    assert r.status_code == 200, r.text
    assert r.json()["data"]["audio"] is None
