"""AI 가 디스코드 회의의 섞은 녹음을 올리는 API(PUT /meetings/{id}/recording, #659)."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import Meeting, MeetingAudio, Member, Session as SessionModel, User, Workspace
from app.services import upload_storage
from app.services.sessions import hash_session_token
from tests.usernames import username_for

SERVICE_TOKEN = "test-service-token"
AUDIO = b"\x00\x00\x00\x18ftypM4A " + bytes(range(256)) * 4
AUDIO_2 = b"\x00\x00\x00\x18ftypM4A " + bytes(range(255, -1, -1)) * 3
WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + bytes(64)


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


@pytest.fixture
def ws_id(db):
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    user = User(username=username_for("m@example.com"), email="m@example.com", name="member")
    db.add(user)
    db.flush()
    db.add(SessionModel(
        user_id=user.user_id, session_token=hash_session_token("member-token"),
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    db.add(Member(workspace_id=ws.workspace_id, user_id=user.user_id, display_name="member", role="member"))
    db.commit()
    return ws.workspace_id


def _meeting(db, ws_id, *, source="discord", status="done", ended_at=None):
    meeting = Meeting(workspace_id=ws_id, title="주간 회의", source=source, status=status, ended_at=ended_at)
    db.add(meeting)
    db.commit()
    return meeting.meeting_id


def _put(meeting_id, content=AUDIO, filename="audio.m4a", token=SERVICE_TOKEN):
    headers = {"X-Service-Token": token} if token else {}
    client = TestClient(app, base_url="https://testserver")
    return client.put(
        f"/api/v1/meetings/{meeting_id}/recording",
        files={"file": (filename, content, "audio/mp4")},
        headers=headers,
    )


def _stored(meeting_id):
    path = upload_storage.meeting_dir(meeting_id) / "audio.m4a"
    return path.read_bytes() if path.exists() else None


def test_discord_recording_stored_and_playable(db, ws_id):
    meeting_id = _meeting(db, ws_id)

    r = _put(meeting_id)

    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["meeting_id"] == meeting_id
    assert data["size_bytes"] == len(AUDIO)
    assert data["stored"] is True
    assert datetime.fromisoformat(data["expires_at"]) > datetime.now(timezone.utc) + timedelta(days=6)
    assert _stored(meeting_id) == AUDIO
    row = db.get(MeetingAudio, meeting_id)
    assert (row.filename, row.content_type, row.size_bytes) == ("audio.m4a", "audio/mp4", len(AUDIO))

    member = TestClient(app, base_url="https://testserver")
    member.cookies.set("session_token", "member-token")
    played = member.get(f"/api/v1/meetings/{meeting_id}/audio")
    assert played.status_code == 200, played.text
    assert played.content == AUDIO


def test_discord_retention_counts_from_meeting_end(db, ws_id):
    ended_at = datetime.now(timezone.utc) - timedelta(days=3)
    meeting_id = _meeting(db, ws_id, ended_at=ended_at)

    r = _put(meeting_id)

    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["stored"] is True
    assert datetime.fromisoformat(data["expires_at"]) == ended_at + timedelta(days=7)
    db.expire_all()
    stored = db.get(MeetingAudio, meeting_id).retention_from
    assert stored.replace(tzinfo=timezone.utc) == ended_at


def test_discord_upload_after_retention_not_stored(db, ws_id):
    ended_at = datetime.now(timezone.utc) - timedelta(days=8)
    meeting_id = _meeting(db, ws_id, ended_at=ended_at)

    r = _put(meeting_id)

    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["stored"] is False
    assert datetime.fromisoformat(data["expires_at"]) == ended_at + timedelta(days=7)
    assert _stored(meeting_id) is None
    assert db.get(MeetingAudio, meeting_id) is None


def test_reupload_keeps_retention_from(db, ws_id):
    meeting_id = _meeting(db, ws_id)
    assert _put(meeting_id).status_code == 200
    first = db.get(MeetingAudio, meeting_id).retention_from

    r = _put(meeting_id, AUDIO_2)

    assert r.status_code == 200, r.text
    db.expire_all()
    row = db.get(MeetingAudio, meeting_id)
    assert row.retention_from == first
    assert row.size_bytes == len(AUDIO_2)
    assert _stored(meeting_id) == AUDIO_2


def test_rejects_upload_meeting(db, ws_id):
    meeting_id = _meeting(db, ws_id, source="manual_upload")

    r = _put(meeting_id)

    assert r.status_code == 400
    body = r.json()["error"]
    assert body["code"] == "INVALID_REQUEST"
    assert body["details"] == {"meeting_id": meeting_id, "source": "manual_upload"}
    assert _stored(meeting_id) is None


@pytest.mark.parametrize("status", ["processing", "awaiting_speakers", "failed"])
def test_rejects_not_done(db, ws_id, status):
    meeting_id = _meeting(db, ws_id, status=status)

    r = _put(meeting_id)

    assert r.status_code == 400
    body = r.json()["error"]
    assert body["code"] == "INVALID_REQUEST"
    assert body["details"] == {"meeting_id": meeting_id, "status": status}
    assert db.get(MeetingAudio, meeting_id) is None
    assert _stored(meeting_id) is None


def test_rejects_non_m4a(db, ws_id):
    meeting_id = _meeting(db, ws_id)

    r = _put(meeting_id, WAV)

    assert r.status_code == 422
    assert r.json()["error"]["code"] == "AUDIO_FORMAT_UNSUPPORTED"
    assert db.get(MeetingAudio, meeting_id) is None
    assert _stored(meeting_id) is None


def test_rejects_too_large(db, ws_id, monkeypatch):
    monkeypatch.setenv("UPLOAD_MAX_BYTES", "10")
    meeting_id = _meeting(db, ws_id)

    r = _put(meeting_id)

    assert r.status_code == 413
    assert r.json()["error"]["code"] == "AUDIO_TOO_LARGE"
    assert db.get(MeetingAudio, meeting_id) is None
    assert _stored(meeting_id) is None


def test_requires_service_token(db, ws_id):
    meeting_id = _meeting(db, ws_id)

    assert _put(meeting_id, token=None).status_code == 401
    assert _put(meeting_id, token="wrong").status_code == 401
    assert _stored(meeting_id) is None


def test_deleted_meeting_410(db, ws_id):
    meeting_id = _meeting(db, ws_id)
    meeting = db.get(Meeting, meeting_id)
    meeting.deleted_at = datetime.now(timezone.utc)
    db.commit()

    r = _put(meeting_id)

    assert r.status_code == 410
    assert _stored(meeting_id) is None


def test_after_expiry_cleanup_not_stored(db, ws_id):
    meeting_id = _meeting(db, ws_id)
    received = datetime.now(timezone.utc) - timedelta(days=8)
    db.add(MeetingAudio(
        meeting_id=meeting_id, filename="audio.m4a", content_type="audio/mp4",
        size_bytes=len(AUDIO), retention_from=received, deleted_at=datetime.now(timezone.utc),
    ))
    db.commit()

    r = _put(meeting_id, AUDIO_2)

    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["stored"] is False
    assert data["size_bytes"] == len(AUDIO)
    assert _stored(meeting_id) is None
    db.expire_all()
    assert db.get(MeetingAudio, meeting_id).deleted_at is not None


def test_storage_failure_returns_upload_failed(db, ws_id, monkeypatch):
    meeting_id = _meeting(db, ws_id)

    def boom(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(upload_storage, "save_audio", boom)

    r = _put(meeting_id)

    assert r.status_code == 422
    assert r.json()["error"]["code"] == "AUDIO_UPLOAD_FAILED"
    assert db.get(MeetingAudio, meeting_id) is None


def _existing_recording(db, meeting_id):
    """이전에 정상으로 올라간 녹음(행과 파일)을 만든다."""
    assert _put(meeting_id).status_code == 200
    db.expire_all()


def test_reupload_local_copy_failure_keeps_previous_recording(db, ws_id, monkeypatch):
    meeting_id = _meeting(db, ws_id)
    _existing_recording(db, meeting_id)

    def broken_copy(src, dst, length=0):
        dst.write(b"partial")
        raise OSError("disk full")

    monkeypatch.setattr(upload_storage.shutil, "copyfileobj", broken_copy)

    r = _put(meeting_id, AUDIO_2)

    assert r.status_code == 422
    assert r.json()["error"]["code"] == "AUDIO_UPLOAD_FAILED"
    assert _stored(meeting_id) == AUDIO
    assert db.get(MeetingAudio, meeting_id).size_bytes == len(AUDIO)


def test_reupload_s3_failure_keeps_previous_recording(db, ws_id, monkeypatch):
    from tests.fake_s3 import FakeS3

    fake = FakeS3()
    monkeypatch.setattr(upload_storage, "_s3_client", lambda: fake)
    monkeypatch.setenv("UPLOAD_STORAGE", "s3")
    monkeypatch.setenv("UPLOAD_S3_BUCKET", "b")
    meeting_id = _meeting(db, ws_id)
    _existing_recording(db, meeting_id)
    key = ("b", f"meetings/{meeting_id}/audio.m4a")
    assert fake.objects[key]["body"] == AUDIO
    fake.fail_next = "upload_fileobj"

    r = _put(meeting_id, AUDIO_2)

    assert r.status_code == 422
    assert r.json()["error"]["code"] == "AUDIO_UPLOAD_FAILED"
    assert fake.objects[key]["body"] == AUDIO


def _after_save(monkeypatch, action):
    """save_audio 가 끝난 직후(복사가 끝나고 다시 잠그기 전)에 다른 요청이 끼어든 상황을 만든다."""
    real = upload_storage.save_audio

    def wrapper(*args, **kwargs):
        size = real(*args, **kwargs)
        action()
        return size

    monkeypatch.setattr(upload_storage, "save_audio", wrapper)


def test_meeting_deleted_while_copying_gets_410_and_leaves_no_file(db, ws_id, monkeypatch):
    meeting_id = _meeting(db, ws_id)

    def delete_meeting():
        db.get(Meeting, meeting_id).deleted_at = datetime.now(timezone.utc)
        db.commit()

    _after_save(monkeypatch, delete_meeting)

    r = _put(meeting_id)

    assert r.status_code == 410
    assert _stored(meeting_id) is None
    assert db.get(MeetingAudio, meeting_id) is None


def test_cleanup_failure_after_meeting_deleted_while_copying_still_gets_410(db, ws_id, monkeypatch):
    meeting_id = _meeting(db, ws_id)

    def delete_meeting():
        db.get(Meeting, meeting_id).deleted_at = datetime.now(timezone.utc)
        db.commit()

    def cannot_remove(meeting_id):
        raise OSError("s3 down")

    _after_save(monkeypatch, delete_meeting)
    monkeypatch.setattr(upload_storage, "remove_audio", cannot_remove)

    r = _put(meeting_id)

    assert r.status_code == 410


def test_recording_swept_while_copying_is_not_stored(db, ws_id, monkeypatch):
    meeting_id = _meeting(db, ws_id)
    _existing_recording(db, meeting_id)

    def sweep():
        row = db.get(MeetingAudio, meeting_id)
        row.deleted_at = datetime.now(timezone.utc)
        db.commit()

    _after_save(monkeypatch, sweep)

    r = _put(meeting_id, AUDIO_2)

    assert r.status_code == 200, r.text
    assert r.json()["data"]["stored"] is False
    assert _stored(meeting_id) is None
    db.expire_all()
    assert db.get(MeetingAudio, meeting_id).deleted_at is not None


def test_first_upload_commit_failure_removes_saved_file(db, ws_id, monkeypatch):
    meeting_id = _meeting(db, ws_id)

    def boom(*args, **kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr("app.api.sources.meeting_audio.record", boom)

    with pytest.raises(RuntimeError):
        _put(meeting_id)

    assert _stored(meeting_id) is None
    assert db.get(MeetingAudio, meeting_id) is None


def test_reupload_commit_failure_keeps_file_for_existing_row(db, ws_id, monkeypatch):
    meeting_id = _meeting(db, ws_id)
    _existing_recording(db, meeting_id)

    def boom(*args, **kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr("app.api.sources.meeting_audio.record", boom)

    with pytest.raises(RuntimeError):
        _put(meeting_id, AUDIO_2)

    # 행은 그대로 있고 파일은 새 바이트다. 지우면 행이 가리키는 녹음이 사라진다
    assert _stored(meeting_id) == AUDIO_2
    assert db.get(MeetingAudio, meeting_id) is not None
