"""AI가 업로드 회의를 가져가는 경로(#219): 대기 목록, 가져가기(claim), 녹음 받기.

TEST_DATABASE_URL이 있으면 PostgreSQL에서도 돈다.
"""
import json
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import Meeting, MeetingUpload, Member, Workspace
from app.services import upload_storage

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
TOKEN = "test-service-token"
HEADERS = {"X-Service-Token": TOKEN}
AUDIO = b"OggS" + bytes(range(256)) * 4
UPLOADED_AT = datetime(2026, 10, 13, 1, 0, tzinfo=timezone.utc)


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
def ws(db):
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    db.add(Member(workspace_id=ws.workspace_id, display_name="지민", role="member"))
    db.commit()
    return ws


@pytest.fixture
def other_ws(db):
    ws = Workspace(name="B")
    db.add(ws)
    db.commit()
    return ws


def _meeting(db, ws, *, source="manual_upload", status="processing", title="주간 회의") -> Meeting:
    meeting = Meeting(workspace_id=ws.workspace_id, title=title, source=source, status=status)
    db.add(meeting)
    db.commit()
    return meeting


def _upload(db, ws, *, uploaded_at=UPLOADED_AT, claimed_at=None, **kwargs) -> Meeting:
    """업로드 API가 남기는 것과 같은 회의 행(처음부터 processing)·업로드 정보·녹음."""
    meeting = _meeting(db, ws, **kwargs)
    db.add(MeetingUpload(
        meeting_id=meeting.meeting_id,
        stored_filename="audio.ogg",
        original_filename="회의.ogg",
        size_bytes=len(AUDIO),
        content_type="audio/ogg",
        uploaded_at=uploaded_at,
        attendees=json.dumps([{"member_id": "m1", "display_name": "지민"}], ensure_ascii=False),
        claimed_at=claimed_at,
    ))
    db.commit()
    folder = upload_storage.meeting_dir(meeting.meeting_id)
    folder.mkdir(parents=True)
    (folder / "audio.ogg").write_bytes(AUDIO)
    return meeting


def _client() -> TestClient:
    return TestClient(app, base_url="https://testserver")


def _pending() -> list[dict]:
    r = _client().get("/api/v1/uploads/pending", headers=HEADERS)
    assert r.status_code == 200, r.text
    return r.json()["data"]["items"]


def _claim(meeting_id: str):
    return _client().patch(f"/api/v1/uploads/{meeting_id}/claim", headers=HEADERS)


@pytest.mark.parametrize(
    "headers", [{}, {"X-Service-Token": "wrong"}], ids=["missing-token", "wrong-token"]
)
@pytest.mark.parametrize(
    ("method", "path"),
    [("get", "/pending"), ("patch", "/m1/claim"), ("get", "/m1/file")],
    ids=["pending", "claim", "file"],
)
def test_requires_service_token(db, headers, method, path):
    r = getattr(_client(), method)(f"/api/v1/uploads{path}", headers=headers)

    assert r.status_code == 401, r.text


def test_pending_lists_only_unclaimed_uploads(db, ws, other_ws):
    waiting = _upload(db, ws)
    _upload(db, other_ws, claimed_at=UPLOADED_AT)  # 이미 가져감
    _upload(db, other_ws, status="done")
    _upload(db, other_ws, status="failed")
    _meeting(db, other_ws, source="discord")
    _meeting(db, other_ws)  # 업로드 API를 거치지 않아 meeting_upload 행이 없는 업로드 회의

    items = _pending()

    assert [item["meeting_id"] for item in items] == [waiting.meeting_id]
    item = items[0]
    assert item["workspace_id"] == ws.workspace_id
    assert item["title"] == "주간 회의"
    assert item["attendees"] == [{"member_id": "m1", "display_name": "지민"}]
    assert item["original_filename"] == "회의.ogg"
    assert item["stored_filename"] == "audio.ogg"
    assert item["size_bytes"] == len(AUDIO)
    assert item["content_type"] == "audio/ogg"
    # SQLite는 시간대를 저장하지 않아 "+00:00" 없이 돌려준다. PostgreSQL은 붙인다
    assert item["uploaded_at"].startswith("2026-10-13T01:00:00")


def test_pending_is_oldest_upload_first(db, ws, other_ws):
    later = _upload(db, ws, uploaded_at=UPLOADED_AT + timedelta(minutes=5))
    earlier = _upload(db, other_ws, uploaded_at=UPLOADED_AT)

    assert [item["meeting_id"] for item in _pending()] == [earlier.meeting_id, later.meeting_id]


def test_pending_does_not_read_the_disk(db, ws):
    """대기 목록은 DB만 읽는다. 녹음 폴더가 사라져도 목록은 그대로이고, 녹음 받기만 404다."""
    meeting = _upload(db, ws)
    upload_storage.remove_upload(meeting.meeting_id)

    assert [item["meeting_id"] for item in _pending()] == [meeting.meeting_id]
    r = _client().get(f"/api/v1/uploads/{meeting.meeting_id}/file", headers=HEADERS)
    assert r.status_code == 404, r.text


def test_claim_records_claimed_at_and_leaves_pending(db, ws):
    meeting = _upload(db, ws)

    r = _claim(meeting.meeting_id)

    assert r.status_code == 200, r.text
    assert r.json()["data"] == {"meeting_id": meeting.meeting_id, "status": "processing"}
    db.expire_all()
    assert meeting.status == "processing"
    assert db.get(MeetingUpload, meeting.meeting_id).claimed_at is not None
    assert _pending() == []


def test_second_claim_gets_409(db, ws):
    meeting = _upload(db, ws)
    assert _claim(meeting.meeting_id).status_code == 200

    r = _claim(meeting.meeting_id)

    assert r.status_code == 409, r.text
    error = r.json()["error"]
    assert error["code"] == "MEETING_PROCESSING_IN_PROGRESS"
    assert error["details"] == {"meeting_id": meeting.meeting_id}


@pytest.mark.parametrize("status", ["done", "failed"])
def test_claim_of_ended_upload_gets_409(db, ws, status):
    meeting = _upload(db, ws, status=status)

    r = _claim(meeting.meeting_id)

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "MEETING_ALREADY_ENDED"
    db.expire_all()
    assert db.get(MeetingUpload, meeting.meeting_id).claimed_at is None


def test_claim_of_unknown_discord_or_rowless_meeting_gets_404(db, ws):
    discord = _meeting(db, ws, source="discord")
    rowless = _meeting(db, ws)

    for meeting_id in ["no-such-meeting", discord.meeting_id, rowless.meeting_id]:
        r = _claim(meeting_id)
        assert r.status_code == 404, r.text
        assert r.json()["error"]["code"] == "MEETING_NOT_FOUND"


@pytest.mark.parametrize("claimed", [False, True])
def test_file_streams_saved_audio(db, ws, claimed):
    meeting = _upload(db, ws, claimed_at=UPLOADED_AT if claimed else None)

    r = _client().get(f"/api/v1/uploads/{meeting.meeting_id}/file", headers=HEADERS)

    assert r.status_code == 200, r.text
    assert r.content == AUDIO
    assert r.headers["content-type"] == "audio/ogg"


def test_file_of_missing_audio_gets_404(db, ws):
    rowless = _meeting(db, ws)
    audio_deleted = _upload(db, ws)
    (upload_storage.meeting_dir(audio_deleted.meeting_id) / "audio.ogg").unlink()
    discord = _meeting(db, ws, source="discord")

    for meeting_id in ["no-such-meeting", rowless.meeting_id, audio_deleted.meeting_id, discord.meeting_id]:
        r = _client().get(f"/api/v1/uploads/{meeting_id}/file", headers=HEADERS)
        assert r.status_code == 404, r.text
        assert r.json()["error"]["code"] == "MEETING_NOT_FOUND"


def _register_extraction(meeting: Meeting):
    return _client().post("/api/v1/extractions", headers=HEADERS, json={
        "meeting_id": meeting.meeting_id, "workspace_id": meeting.workspace_id, "items": [],
    })


def _fail(meeting: Meeting):
    return _client().patch(
        f"/api/v1/meetings/{meeting.meeting_id}/fail", headers=HEADERS, json={"failed_stage": "STT"}
    )


def test_done_upload_removes_its_folder(db, ws, other_ws):
    meeting = _upload(db, ws)
    other = _upload(db, other_ws)
    _claim(meeting.meeting_id)

    r = _register_extraction(meeting)

    assert r.status_code == 201, r.text
    db.expire_all()
    assert meeting.status == "done"
    assert not upload_storage.meeting_dir(meeting.meeting_id).exists()
    assert upload_storage.meeting_dir(other.meeting_id).exists()


@pytest.mark.parametrize("claimed", [False, True])
def test_failed_upload_removes_its_folder(db, ws, claimed):
    """가져가기 전이든 후든 실패 보고로 끝난다. AI가 없을 때 막힌 공간을 푸는 방법이기도 하다."""
    meeting = _upload(db, ws, claimed_at=UPLOADED_AT if claimed else None)

    r = _fail(meeting)

    assert r.status_code == 200, r.text
    db.expire_all()
    assert meeting.status == "failed"
    assert not upload_storage.meeting_dir(meeting.meeting_id).exists()
    assert _pending() == []


def test_failing_discord_meeting_leaves_upload_folders(db, ws, other_ws):
    upload = _upload(db, ws)
    discord = _meeting(db, other_ws, source="discord")

    assert _fail(discord).status_code == 200
    assert upload_storage.meeting_dir(upload.meeting_id).exists()


def test_rejected_end_reports_keep_the_folder(db, ws, other_ws):
    """이미 끝난 회의에 결과가 다시 와도(멱등 응답·409) 폴더를 건드리지 않는다. 폴더는 끝날 때 한 번만 지운다."""
    done = _upload(db, ws)
    assert _register_extraction(done).status_code == 201
    # 끝난 뒤 폴더가 남은 경우(삭제 실패 등)를 만든다
    upload_storage.meeting_dir(done.meeting_id).mkdir(parents=True)
    failed = _upload(db, other_ws, status="failed")

    assert _register_extraction(done).status_code == 201  # 멱등 응답
    assert _fail(failed).status_code == 409

    assert upload_storage.meeting_dir(done.meeting_id).exists()
    assert upload_storage.meeting_dir(failed.meeting_id).exists()


def test_folder_removal_failure_does_not_fail_the_report(db, ws, monkeypatch):
    meeting = _upload(db, ws)

    def broken_rmtree(path):
        raise PermissionError("권한이 없습니다")

    monkeypatch.setattr(upload_storage.shutil, "rmtree", broken_rmtree)

    r = _fail(meeting)

    assert r.status_code == 200, r.text
    db.expire_all()
    assert meeting.status == "failed"
