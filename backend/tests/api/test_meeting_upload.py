"""웹 녹음 업로드(#219). 녹음을 먼저 저장하고 `processing` 회의와 업로드 정보(`meeting_upload`)를 만든다.

TEST_DATABASE_URL이 있으면 PostgreSQL에서도 돈다.
"""
import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import Meeting, MeetingUpload, Member, Session as SessionModel, User, Workspace
from app.services import upload_storage

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
# 형식 검사는 파일 첫 부분만 본다. 머리만 진짜 모양이고 나머지는 아무 바이트다
BODY = bytes(range(256)) * 10
AUDIO = b"RIFF\x24\x00\x00\x00WAVE" + BODY
OGG = b"OggS" + BODY


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
def db(request):
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
def seed(db):
    """워크스페이스 A의 PM(pm-token)과 팀원 둘, 탈퇴한 팀원, 다른 워크스페이스 B의 팀원."""
    user = User(email="pm@example.com", name="pm")
    db.add(user)
    db.flush()
    db.add(SessionModel(
        user_id=user.user_id, session_token="pm-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    ws, other_ws = Workspace(name="A"), Workspace(name="B")
    db.add_all([ws, other_ws])
    db.flush()
    pm = Member(workspace_id=ws.workspace_id, user_id=user.user_id, display_name="PM", role="pm")
    jimin = Member(workspace_id=ws.workspace_id, display_name="지민", role="member")
    minsu = Member(workspace_id=ws.workspace_id, display_name="민수", role="member")
    left = Member(workspace_id=ws.workspace_id, display_name="탈퇴", role="member", is_deleted=True)
    outsider = Member(workspace_id=other_ws.workspace_id, display_name="외부", role="member")
    db.add_all([pm, jimin, minsu, left, outsider])
    db.commit()
    return {"ws": ws, "pm": pm, "jimin": jimin, "minsu": minsu, "left": left, "outsider": outsider}


def _upload(seed, attendee_ids, filename="회의.wav", content=AUDIO):
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c.post(
        f"/api/v1/workspaces/{seed['ws'].workspace_id}/meetings/upload",
        data={
            "title": "주간 회의",
            "started_at": "2026-10-13T10:00:00+09:00",
            "attendee_member_ids": attendee_ids,
        },
        files={"file": (filename, content, "audio/wav")},
    )


def _upload_root() -> Path:
    return upload_storage.upload_dir()


def _meetings(db):
    db.expire_all()
    return db.scalars(select(Meeting)).all()


def test_upload_saves_audio_and_upload_row_and_creates_processing_meeting(db, seed):
    ids = [seed["pm"].member_id, seed["jimin"].member_id, seed["minsu"].member_id]

    r = _upload(seed, ids)

    assert r.status_code == 202, r.text
    data = r.json()["data"]
    # 처음부터 processing이라 프론트가 Discord 회의처럼 정리 중으로 추적한다
    assert data["status"] == "processing"
    [meeting] = _meetings(db)
    assert meeting.meeting_id == data["meeting_id"]
    assert (meeting.status, meeting.source) == ("processing", "manual_upload")
    assert meeting.ended_at is not None

    folder = _upload_root() / meeting.meeting_id
    assert (folder / "audio.wav").read_bytes() == AUDIO
    assert [p.name for p in folder.iterdir()] == ["audio.wav"]
    upload = db.get(MeetingUpload, meeting.meeting_id)
    assert json.loads(upload.attendees) == [
        {"member_id": seed["pm"].member_id, "display_name": "PM"},
        {"member_id": seed["jimin"].member_id, "display_name": "지민"},
        {"member_id": seed["minsu"].member_id, "display_name": "민수"},
    ]
    assert upload.original_filename == "회의.wav"
    assert upload.stored_filename == "audio.wav"
    assert upload.size_bytes == len(AUDIO)
    assert upload.content_type == "audio/wav"
    assert upload.uploaded_by_member_id == seed["pm"].member_id
    assert upload.uploaded_at is not None


def test_repeated_attendee_is_saved_once(db, seed):
    r = _upload(seed, [seed["jimin"].member_id, seed["jimin"].member_id])

    assert r.status_code == 202, r.text
    upload = db.get(MeetingUpload, r.json()["data"]["meeting_id"])
    assert [a["member_id"] for a in json.loads(upload.attendees)] == [seed["jimin"].member_id]


def test_too_large_file_gets_413_without_meeting(db, seed, monkeypatch):
    monkeypatch.setenv("UPLOAD_MAX_BYTES", str(len(AUDIO) - 1))

    r = _upload(seed, [seed["pm"].member_id])

    assert r.status_code == 413, r.text
    assert r.json()["error"]["code"] == "AUDIO_TOO_LARGE"
    assert _meetings(db) == []
    assert not _upload_root().exists()


def test_file_at_the_limit_is_accepted(db, seed, monkeypatch):
    monkeypatch.setenv("UPLOAD_MAX_BYTES", str(len(AUDIO)))

    assert _upload(seed, [seed["pm"].member_id]).status_code == 202


@pytest.mark.parametrize("who", ["outsider", "left"])
def test_attendee_outside_workspace_gets_400(db, seed, who):
    r = _upload(seed, [seed["pm"].member_id, seed[who].member_id, "no-such-member"])

    assert r.status_code == 400, r.text
    error = r.json()["error"]
    assert error["code"] == "INVALID_REQUEST"
    assert error["details"]["attendee_member_ids"] == [seed[who].member_id, "no-such-member"]
    assert _meetings(db) == []


def test_missing_attendees_gets_400(db, seed):
    r = _upload(seed, [])

    assert r.status_code == 400, r.text
    assert _meetings(db) == []


def test_title_longer_than_the_column_gets_400_before_saving(db, seed):
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")

    def post(title):
        return c.post(
            f"/api/v1/workspaces/{seed['ws'].workspace_id}/meetings/upload",
            data={"title": title, "attendee_member_ids": [seed["pm"].member_id]},
            files={"file": ("회의.wav", AUDIO, "audio/wav")},
        )

    r = post("가" * 201)

    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    assert _meetings(db) == []
    assert not _upload_root().exists()
    assert post("가" * 200).status_code == 202


def test_db_connection_is_released_while_saving_audio(db, seed, monkeypatch):
    """녹음을 복사하는 동안 트랜잭션을 열어 두지 않는다. 동시 업로드가 연결 풀을 다 쓰지 않게 한다."""
    real_save = upload_storage.save_upload
    in_transaction = []

    def watch_save(*args, **kwargs):
        in_transaction.append(db.in_transaction())
        return real_save(*args, **kwargs)

    monkeypatch.setattr(upload_storage, "save_upload", watch_save)

    r = _upload(seed, [seed["pm"].member_id, seed["jimin"].member_id])

    assert r.status_code == 202, r.text
    assert in_transaction == [False]
    upload = db.get(MeetingUpload, r.json()["data"]["meeting_id"])
    assert upload.uploaded_by_member_id == seed["pm"].member_id
    assert len(json.loads(upload.attendees)) == 2


def test_disk_failure_leaves_no_meeting_and_no_folder(db, seed, monkeypatch):
    def broken_copy(src, dst, length=0):
        dst.write(src.read(10))
        raise OSError("디스크가 가득 찼습니다")

    monkeypatch.setattr(upload_storage.shutil, "copyfileobj", broken_copy)

    r = _upload(seed, [seed["pm"].member_id])

    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "AUDIO_UPLOAD_FAILED"
    assert _meetings(db) == []
    assert list(_upload_root().iterdir()) == []


def test_commit_failure_removes_saved_folder(db, seed, monkeypatch):
    def broken_commit():
        raise RuntimeError("DB 연결이 끊겼습니다")

    monkeypatch.setattr(db, "commit", broken_commit)

    with pytest.raises(RuntimeError):
        _upload(seed, [seed["pm"].member_id])

    assert list(_upload_root().iterdir()) == []


@pytest.mark.parametrize(
    ("filename", "stored"),
    [
        ("../../x.wav", "audio.wav"),
        ("..\\..\\x.wav", "audio.wav"),
        ("회의.WAV", "audio.wav"),
    ],
)
def test_stored_name_never_uses_the_original_path(db, seed, filename, stored):
    r = _upload(seed, [seed["pm"].member_id], filename=filename)

    assert r.status_code == 202, r.text
    meeting_id = r.json()["data"]["meeting_id"]
    saved = sorted(p.relative_to(_upload_root()).as_posix() for p in _upload_root().rglob("*") if p.is_file())
    assert saved == [f"{meeting_id}/{stored}"]


def test_second_upload_waits_until_the_first_one_ends(db, seed):
    """업로드 회의도 처리 중이므로 같은 공간의 다음 업로드는 409다(D-088·D-089). 끝나면 다시 받는다."""
    first = _upload(seed, [seed["pm"].member_id]).json()["data"]["meeting_id"]

    r = _upload(seed, [seed["pm"].member_id])

    assert r.status_code == 409, r.text
    assert r.json()["error"]["details"] == {"meeting_id": first}
    db.get(Meeting, first).status = "failed"
    db.commit()
    assert _upload(seed, [seed["pm"].member_id]).status_code == 202


def test_processing_meeting_still_blocks_upload(db, seed):
    db.add(Meeting(workspace_id=seed["ws"].workspace_id, source="discord", status="processing"))
    db.commit()

    r = _upload(seed, [seed["pm"].member_id])

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "MEETING_PROCESSING_IN_PROGRESS"
    assert not _upload_root().exists()


def test_ai_can_pick_up_what_the_upload_saved(db, seed, monkeypatch):
    """업로드가 남긴 정보를 AI 경로가 그대로 읽는다: 대기 목록 → 가져가기 → 녹음 받기."""
    monkeypatch.setenv("SERVICE_TOKEN", "svc")
    ai = TestClient(app, base_url="https://testserver", headers={"X-Service-Token": "svc"})
    meeting_id = _upload(seed, [seed["jimin"].member_id]).json()["data"]["meeting_id"]

    [item] = ai.get("/api/v1/uploads/pending").json()["data"]["items"]
    assert item["meeting_id"] == meeting_id
    assert item["attendees"] == [{"member_id": seed["jimin"].member_id, "display_name": "지민"}]
    assert ai.patch(f"/api/v1/uploads/{meeting_id}/claim").status_code == 200
    r = ai.get(f"/api/v1/uploads/{meeting_id}/file")
    assert r.status_code == 200, r.text
    assert r.content == AUDIO


@pytest.mark.parametrize(
    ("filename", "content", "stored"),
    [
        ("회의.wav", AUDIO, "audio.wav"),
        ("회의.mp3", b"ID3\x04\x00" + BODY, "audio.mp3"),
        ("태그없음.MP3", b"\xff\xfb\x90\x64" + BODY, "audio.mp3"),
        ("회의.m4a", b"\x00\x00\x00\x20ftypM4A " + BODY, "audio.m4a"),
        ("회의.ogg", OGG, "audio.ogg"),
        ("회의.webm", b"\x1a\x45\xdf\xa3" + BODY, "audio.webm"),
    ],
    ids=["wav", "mp3-id3", "mp3-frame-upper", "m4a", "ogg", "webm"],
)
def test_supported_formats_are_saved(db, seed, filename, content, stored):
    r = _upload(seed, [seed["pm"].member_id], filename=filename, content=content)

    assert r.status_code == 202, r.text
    folder = _upload_root() / r.json()["data"]["meeting_id"]
    assert (folder / stored).read_bytes() == content


@pytest.mark.parametrize(
    ("filename", "content"),
    [
        ("회의.wav", OGG),
        ("회의.mp3", AUDIO),
        ("회의.flac", b"fLaC" + BODY),
        ("메모.txt", b"hello"),
        ("회의.wav", b""),
        ("확장자없음", AUDIO),
        ("a.w@v", AUDIO),
        ("a.wav/../../../etc", AUDIO),
    ],
    ids=["ogg-as-wav", "wav-as-mp3", "flac", "txt", "empty", "no-extension", "odd-extension", "path"],
)
def test_unsupported_format_gets_422_without_saving(db, seed, filename, content):
    r = _upload(seed, [seed["pm"].member_id], filename=filename, content=content)

    assert r.status_code == 422, r.text
    error = r.json()["error"]
    assert error["code"] == "AUDIO_FORMAT_UNSUPPORTED"
    assert error["details"]["supported"] == ["wav", "mp3", "m4a", "ogg", "webm"]
    assert _meetings(db) == []
    assert not _upload_root().exists()


def test_long_original_filename_is_cut_to_the_column(db, seed):
    """원래 파일명은 사용자가 보낸 값이라 길어도 업로드를 거절하지 않고 칼럼 길이에 맞춘다."""
    name = "가" * 300 + ".wav"

    r = _upload(seed, [seed["pm"].member_id], filename=name)

    assert r.status_code == 202, r.text
    upload = db.get(MeetingUpload, r.json()["data"]["meeting_id"])
    assert upload.original_filename == name[:255]
    assert upload.stored_filename == "audio.wav"


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없습니다. SQLite는 FOR UPDATE를 무시한다")
def test_concurrent_uploads_to_one_workspace_accept_only_one(monkeypatch):
    """같은 공간에 동시에 온 두 업로드가 둘 다 처리 중 검사를 통과해도, 커밋 직전 다시 확인해 하나만 받는다.

    두 요청이 모두 녹음 저장까지 마친 뒤 함께 커밋하러 가도록 맞춘다. 잠금이 없으면 둘 다 202가 된다.
    """
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
    user = User(email="pm@example.com", name="pm")
    seed_session.add(user)
    seed_session.flush()
    seed_session.add(SessionModel(
        user_id=user.user_id, session_token="pm-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    ws = Workspace(name="A")
    seed_session.add(ws)
    seed_session.flush()
    pm = Member(workspace_id=ws.workspace_id, user_id=user.user_id, display_name="PM", role="pm")
    seed_session.add(pm)
    seed_session.commit()
    ws_id, pm_id = ws.workspace_id, pm.member_id
    seed_session.close()

    both_saved = threading.Barrier(2, timeout=10)
    real_save = upload_storage.save_upload

    def save_then_wait(*args, **kwargs):
        saved = real_save(*args, **kwargs)
        both_saved.wait()
        return saved

    monkeypatch.setattr(upload_storage, "save_upload", save_then_wait)
    app.dependency_overrides[get_db] = session_per_request
    results = []

    def post():
        c = TestClient(app, base_url="https://testserver")
        c.cookies.set("session_token", "pm-token")
        results.append(c.post(
            f"/api/v1/workspaces/{ws_id}/meetings/upload",
            data={"title": "회의", "attendee_member_ids": [pm_id]},
            files={"file": ("회의.wav", AUDIO, "audio/wav")},
        ))

    try:
        threads = [threading.Thread(target=post) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        assert sorted(r.status_code for r in results) == [202, 409], [r.text for r in results]
        check = make_session()
        processing = check.scalars(select(Meeting).where(Meeting.status == "processing")).all()
        check.close()
        assert len(processing) == 1
        # 거절된 업로드의 녹음 폴더는 남지 않는다
        assert sorted(p.name for p in _upload_root().iterdir()) == [processing[0].meeting_id]
    finally:
        app.dependency_overrides.pop(get_db, None)
        Base.metadata.drop_all(engine)
        engine.dispose()
