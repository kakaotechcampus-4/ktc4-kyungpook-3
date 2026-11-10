"""AI가 업로드 회의를 가져가는 경로(#219): 대기 목록, 가져가기(claim), 녹음 받기.

TEST_DATABASE_URL이 있으면 PostgreSQL에서도 돈다.
"""
import json
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.responses import FileResponse
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import uploads as uploads_api
from app.core.database import Base, get_db
from app.main import app
from app.models import Meeting, MeetingAudio, MeetingUpload, Member, Workspace
from app.services import meeting_audio, upload_storage

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
    meeting_audio.record(db, meeting.meeting_id, "audio.ogg", "audio/ogg", len(AUDIO), uploaded_at)
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
    [
        ("get", "/pending"), ("patch", "/m1/claim"), ("get", "/m1/file"),
        ("post", "/m1/speakers"), ("get", "/assigned"), ("patch", "/m1/resume"),
    ],
    ids=["pending", "claim", "file", "speakers", "assigned", "resume"],
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


def test_file_returns_the_db_connection_before_sending_the_file(db, ws, monkeypatch):
    # FastAPI 0.118 부터 get_db 정리는 응답을 다 보낸 뒤라, 닫지 않으면 파일을 보내는 동안 연결을 잡고 있다
    meeting = _upload(db, ws)
    in_transaction_when_sending = []

    class RecordingFileResponse(FileResponse):
        async def __call__(self, scope, receive, send):
            in_transaction_when_sending.append(db.in_transaction())
            await super().__call__(scope, receive, send)

    monkeypatch.setattr(uploads_api, "FileResponse", RecordingFileResponse)

    r = _client().get(f"/api/v1/uploads/{meeting.meeting_id}/file", headers=HEADERS)

    assert r.status_code == 200, r.text
    assert in_transaction_when_sending == [False]


def _register_extraction(meeting: Meeting):
    return _client().post("/api/v1/extractions", headers=HEADERS, json={
        "meeting_id": meeting.meeting_id, "workspace_id": meeting.workspace_id, "items": [],
    })


def _fail(meeting: Meeting):
    return _client().patch(
        f"/api/v1/meetings/{meeting.meeting_id}/fail", headers=HEADERS, json={"failed_stage": "STT"}
    )


def test_done_upload_keeps_its_recording(db, ws, other_ws):
    meeting = _upload(db, ws)
    other = _upload(db, other_ws)
    _claim(meeting.meeting_id)

    r = _register_extraction(meeting)

    assert r.status_code == 201, r.text
    db.expire_all()
    assert meeting.status == "done"
    # 처리가 끝나도 녹음은 보관 기간 동안 남긴다(원문 듣기)
    assert upload_storage.meeting_dir(meeting.meeting_id).exists()
    assert (upload_storage.meeting_dir(meeting.meeting_id) / "audio.ogg").exists()
    assert upload_storage.meeting_dir(other.meeting_id).exists()
    row = db.get(MeetingAudio, meeting.meeting_id)
    assert row is not None
    assert row.deleted_at is None


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
    """이미 끝난 회의에 결과가 다시 와도(멱등 응답·409) 폴더를 건드리지 않는다. done 은 녹음을 남기고 failed 만 지운다."""
    done = _upload(db, ws)
    assert _register_extraction(done).status_code == 201
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


# ── 화자 지정 대기 상태(awaiting_speakers, #266 PR-1) ──
# 이 상태로 바꾸는 API는 아직 없다. 그래서 회의 행에 상태를 직접 넣고, 기존 경로가 이 상태를 맞게 다루는지 본다.


def test_awaiting_speakers_status_is_saved_and_read_back(db, ws):
    """상태 이름(17자)이 meeting.status 컬럼 길이를 넘으면 PostgreSQL에서만 저장이 실패한다."""
    meeting = _upload(db, ws, status="awaiting_speakers", claimed_at=UPLOADED_AT)

    db.expire_all()

    assert db.get(Meeting, meeting.meeting_id).status == "awaiting_speakers"


@pytest.mark.parametrize("claimed_at", [None, UPLOADED_AT], ids=["unclaimed", "claimed"])
def test_awaiting_upload_is_not_pending_and_cannot_be_claimed(db, ws, claimed_at):
    """claimed_at 이 비어 있어도 상태만으로 빠져야 한다. claimed_at 조건만 보면 상태를 잘못 다뤄도 통과한다."""
    meeting = _upload(db, ws, status="awaiting_speakers", claimed_at=claimed_at)

    assert _pending() == []
    r = _claim(meeting.meeting_id)

    assert r.status_code == 409, r.text
    error = r.json()["error"]
    assert error["code"] == "MEETING_ALREADY_ENDED"
    assert error["details"]["status"] == "awaiting_speakers"


def test_awaiting_upload_file_is_still_served(db, ws):
    """PM이 화자를 지정하는 동안 원본이 남아 있어야 한다. 원본 받기는 상태를 보지 않는다."""
    meeting = _upload(db, ws, status="awaiting_speakers", claimed_at=UPLOADED_AT)

    r = _client().get(f"/api/v1/uploads/{meeting.meeting_id}/file", headers=HEADERS)

    assert r.status_code == 200, r.text
    assert r.content == AUDIO


def test_awaiting_upload_rejects_extraction_and_keeps_the_folder(db, ws):
    """화자 지정 전에는 추출을 받지 않는다(processing일 때만 받는다). 폴더도 그대로다."""
    meeting = _upload(db, ws, status="awaiting_speakers", claimed_at=UPLOADED_AT)

    r = _register_extraction(meeting)

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "MEETING_NOT_PROCESSING"
    db.expire_all()
    assert meeting.status == "awaiting_speakers"
    assert upload_storage.meeting_dir(meeting.meeting_id).exists()


def test_awaiting_upload_can_be_failed_and_removes_its_folder(db, ws):
    """AI가 없거나 지정이 멈춘 공간을 푸는 방법은 실패 보고다. 대기 상태에서도 된다."""
    meeting = _upload(db, ws, status="awaiting_speakers", claimed_at=UPLOADED_AT)

    r = _fail(meeting)

    assert r.status_code == 200, r.text
    db.expire_all()
    assert meeting.status == "failed"
    assert not upload_storage.meeting_dir(meeting.meeting_id).exists()


def test_end_report_does_not_pull_an_awaiting_meeting_back_to_processing(db, ws):
    """회의 종료(/end)는 대기 회의를 건드리지 않는다. 건드리면 PM의 화자 지정을 건너뛰게 된다."""
    meeting = _upload(db, ws, status="awaiting_speakers", claimed_at=UPLOADED_AT)

    r = _client().patch(f"/api/v1/meetings/{meeting.meeting_id}/end", headers=HEADERS)

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "MEETING_ALREADY_ENDED"
    assert r.json()["error"]["details"]["status"] == "awaiting_speakers"
    db.expire_all()
    assert meeting.status == "awaiting_speakers"


# ── 화자 라벨 전달·지정 결과 가져가기(#266 PR-2) ──
# 지정 제출 API(PM, PR-3)는 아직 없으므로 지정 완료 상태는 컬럼을 직접 써서 만든다.

LABELS = [
    {"label": "SPEAKER_00", "total_sec": 120.5, "samples": [{"start": 1.0, "end": 6.5}]},
    {"label": "SPEAKER_01", "total_sec": 30, "samples": [{"start": 10, "end": 14}, {"start": 20, "end": 25.5}]},
]
ASSIGNED_AT = datetime(2026, 10, 13, 2, 0, tzinfo=timezone.utc)


def _report(meeting_id: str, speakers=None):
    body = {"speakers": LABELS if speakers is None else speakers}
    return _client().post(f"/api/v1/uploads/{meeting_id}/speakers", headers=HEADERS, json=body)


def _report_raw(meeting_id: str, raw_json: str):
    """NaN·Infinity 처럼 표준 JSON 이 아닌 원문을 그대로 보낸다."""
    return _client().post(
        f"/api/v1/uploads/{meeting_id}/speakers",
        headers={**HEADERS, "Content-Type": "application/json"},
        content=raw_json,
    )


def _resume(meeting_id: str):
    return _client().patch(f"/api/v1/uploads/{meeting_id}/resume", headers=HEADERS)


def _assigned() -> list[dict]:
    r = _client().get("/api/v1/uploads/assigned", headers=HEADERS)
    assert r.status_code == 200, r.text
    return r.json()["data"]["items"]


def _assign(db, meeting: Meeting, mapping=None, *, assigned_at=ASSIGNED_AT, status="processing"):
    """PM 이 지정을 제출한 뒤의 상태: 회의는 processing, 지정 시각과 매핑이 저장된다."""
    mapping = {"SPEAKER_00": "m1", "SPEAKER_01": None} if mapping is None else mapping
    upload = db.get(MeetingUpload, meeting.meeting_id)
    upload.speakers = json.dumps(LABELS)
    upload.speakers_reported_at = UPLOADED_AT
    upload.speaker_mapping = json.dumps(mapping)
    upload.speakers_assigned_at = assigned_at
    db.get(Meeting, meeting.meeting_id).status = status
    db.commit()


def _state(db, meeting: Meeting):
    db.expire_all()
    return db.get(Meeting, meeting.meeting_id).status, db.get(MeetingUpload, meeting.meeting_id)


def test_report_moves_claimed_upload_to_awaiting_speakers(db, ws):
    meeting = _upload(db, ws, claimed_at=UPLOADED_AT)

    r = _report(meeting.meeting_id)

    assert r.status_code == 200, r.text
    assert r.json()["data"] == {"meeting_id": meeting.meeting_id, "status": "awaiting_speakers"}
    status, upload = _state(db, meeting)
    assert status == "awaiting_speakers"
    assert json.loads(upload.speakers) == LABELS
    assert upload.speakers_reported_at is not None
    assert upload.speakers_assigned_at is None


def test_same_report_again_is_idempotent_even_if_label_order_differs(db, ws):
    meeting = _upload(db, ws, claimed_at=UPLOADED_AT)
    assert _report(meeting.meeting_id).status_code == 200
    _, before = _state(db, meeting)
    reported_at = before.speakers_reported_at

    r = _report(meeting.meeting_id, list(reversed(LABELS)))

    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "awaiting_speakers"
    status, upload = _state(db, meeting)
    assert status == "awaiting_speakers"
    assert upload.speakers_reported_at == reported_at


def test_different_report_gets_409_and_keeps_stored_labels(db, ws):
    meeting = _upload(db, ws, claimed_at=UPLOADED_AT)
    assert _report(meeting.meeting_id).status_code == 200

    r = _report(meeting.meeting_id, [{"label": "SPEAKER_00", "total_sec": 1, "samples": []}])

    assert r.status_code == 409, r.text
    error = r.json()["error"]
    assert error["code"] == "SPEAKERS_ALREADY_REPORTED"
    assert error["details"]["status"] == "awaiting_speakers"
    # AI 가 분리를 다시 돌려 라벨이 달라졌는지 알 수 있게 저장된 라벨을 준다
    assert error["details"]["labels"] == ["SPEAKER_00", "SPEAKER_01"]
    status, upload = _state(db, meeting)
    assert status == "awaiting_speakers"
    assert json.loads(upload.speakers) == LABELS


def test_same_report_with_samples_in_another_order_is_idempotent(db, ws):
    meeting = _upload(db, ws, claimed_at=UPLOADED_AT)
    assert _report(meeting.meeting_id).status_code == 200
    shuffled = [
        LABELS[0],
        {**LABELS[1], "samples": list(reversed(LABELS[1]["samples"]))},
    ]

    r = _report(meeting.meeting_id, shuffled)

    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "awaiting_speakers"


def test_same_report_after_assignment_is_idempotent_with_current_status(db, ws):
    """멱등은 라벨 목록이 같을 때만이다. 지정이 제출돼 processing 으로 돌아온 뒤에도 같은 내용이면 200."""
    meeting = _upload(db, ws, claimed_at=UPLOADED_AT)
    assert _report(meeting.meeting_id).status_code == 200
    _assign(db, meeting)

    r = _report(meeting.meeting_id)

    assert r.status_code == 200, r.text
    assert r.json()["data"] == {"meeting_id": meeting.meeting_id, "status": "processing"}
    assert _state(db, meeting)[0] == "processing"


def test_report_after_assignment_gets_409_already_reported(db, ws):
    """지정이 제출돼 processing 으로 돌아온 뒤에도 다시 보고할 수 없다."""
    meeting = _upload(db, ws, claimed_at=UPLOADED_AT)
    assert _report(meeting.meeting_id).status_code == 200
    _assign(db, meeting)

    r = _report(meeting.meeting_id, [{"label": "X", "total_sec": 1, "samples": []}])

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "SPEAKERS_ALREADY_REPORTED"
    assert r.json()["error"]["details"]["status"] == "processing"
    assert r.json()["error"]["details"]["labels"] == ["SPEAKER_00", "SPEAKER_01"]
    assert _state(db, meeting)[0] == "processing"


def test_report_of_unclaimed_upload_gets_409(db, ws):
    meeting = _upload(db, ws)

    r = _report(meeting.meeting_id)

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "UPLOAD_NOT_CLAIMED"
    assert r.json()["error"]["details"]["status"] == "processing"
    status, upload = _state(db, meeting)
    assert status == "processing"
    assert upload.speakers is None and upload.speakers_reported_at is None


@pytest.mark.parametrize("status", ["done", "failed"])
def test_report_of_ended_upload_gets_409(db, ws, status):
    meeting = _upload(db, ws, status=status, claimed_at=UPLOADED_AT)

    r = _report(meeting.meeting_id)

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "MEETING_ALREADY_ENDED"
    assert r.json()["error"]["details"]["status"] == status
    assert _state(db, meeting)[0] == status


def test_report_of_unknown_discord_or_rowless_meeting_gets_404(db, ws):
    discord = _meeting(db, ws, source="discord")
    rowless = _meeting(db, ws)
    # 가져갔고 아직 보고하지 않은 다른 업로드가 있어도, EXISTS 가 대상 회의와 상관되지 않아 옮겨지면 안 된다
    bystander = _upload(db, ws, claimed_at=UPLOADED_AT)

    for meeting in [discord, rowless]:
        r = _report(meeting.meeting_id)
        assert r.status_code == 404, r.text
        assert r.json()["error"]["code"] == "MEETING_NOT_FOUND"
        db.expire_all()
        assert db.get(Meeting, meeting.meeting_id).status == "processing"
    assert _report("no-such-meeting").status_code == 404
    assert _state(db, bystander)[0] == "processing"


@pytest.mark.parametrize(
    "speakers",
    [
        [],
        [LABELS[0], LABELS[0]],
        [{"label": "   ", "total_sec": 1, "samples": []}],
        [{"label": "", "total_sec": 1, "samples": []}],
        [{"label": "x" * 65, "total_sec": 1, "samples": []}],
        [{"label": "A", "total_sec": -1, "samples": []}],
        [{"label": "A", "total_sec": 1, "samples": [{"start": 5, "end": 5}]}],
        [{"label": "A", "total_sec": 1, "samples": [{"start": 6, "end": 5}]}],
        [{"label": "A", "total_sec": 1, "samples": [{"start": -1, "end": 5}]}],
    ],
    ids=[
        "empty", "duplicate", "blank-label", "empty-label", "long-label", "negative-total",
        "start-equals-end", "start-after-end", "negative-start",
    ],
)
def test_report_validation_gets_400_and_changes_nothing(db, ws, speakers):
    meeting = _upload(db, ws, claimed_at=UPLOADED_AT)

    r = _report(meeting.meeting_id, speakers)

    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    status, upload = _state(db, meeting)
    assert status == "processing"
    assert upload.speakers is None


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
@pytest.mark.parametrize("field", ["total_sec", "start", "end"])
def test_report_with_non_finite_number_in_raw_json_gets_400(db, ws, field, value):
    meeting = _upload(db, ws, claimed_at=UPLOADED_AT)
    numbers = {"total_sec": "10", "start": "1", "end": "5"}
    numbers[field] = value
    raw = (
        '{"speakers":[{"label":"A","total_sec":%s,"samples":[{"start":%s,"end":%s}]}]}'
        % (numbers["total_sec"], numbers["start"], numbers["end"])
    )

    r = _report_raw(meeting.meeting_id, raw)

    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    status, upload = _state(db, meeting)
    assert status == "processing" and upload.speakers is None


def test_assigned_lists_only_assigned_unresumed_processing_uploads_oldest_first(db, ws, other_ws):
    later = _upload(db, ws, claimed_at=UPLOADED_AT)
    _assign(db, later, assigned_at=ASSIGNED_AT + timedelta(minutes=5))
    earlier = _upload(db, other_ws, claimed_at=UPLOADED_AT)
    _assign(db, earlier, {"SPEAKER_00": None, "SPEAKER_01": "m1"})
    awaiting = _upload(db, other_ws, status="awaiting_speakers", claimed_at=UPLOADED_AT)
    _assign(db, awaiting, status="awaiting_speakers")  # 지정 시각이 있어도 대기 상태면 제외
    resumed = _upload(db, other_ws, claimed_at=UPLOADED_AT)
    _assign(db, resumed)
    assert _resume(resumed.meeting_id).status_code == 200
    done = _upload(db, other_ws, claimed_at=UPLOADED_AT)
    _assign(db, done, status="done")
    _upload(db, other_ws, claimed_at=UPLOADED_AT)  # 지정 전

    items = _assigned()

    assert [item["meeting_id"] for item in items] == [earlier.meeting_id, later.meeting_id]
    item = items[0]
    assert item["workspace_id"] == other_ws.workspace_id
    assert item["title"] == "주간 회의"
    assert item["mapping"] == {"SPEAKER_00": None, "SPEAKER_01": "m1"}
    assert item["assigned_at"].startswith("2026-10-13T02:00:00")
    assert "started_at" in item


def test_resume_records_once_and_returns_the_same_mapping_again(db, ws):
    """resume 이 커밋된 뒤 응답을 잃은 재시도도 mapping 을 다시 받아야 이어서 처리할 수 있다."""
    meeting = _upload(db, ws, claimed_at=UPLOADED_AT)
    _assign(db, meeting)

    r = _resume(meeting.meeting_id)

    assert r.status_code == 200, r.text
    assert r.json()["data"] == {
        "meeting_id": meeting.meeting_id, "status": "processing",
        "identity_epoch": 0,
        "mapping": {"SPEAKER_00": "m1", "SPEAKER_01": None},
    }
    status, upload = _state(db, meeting)
    assert status == "processing"
    assert upload.resumed_at is not None
    assert _assigned() == []

    resumed_at = upload.resumed_at

    again = _resume(meeting.meeting_id)

    assert again.status_code == 200, again.text
    assert again.json()["data"] == r.json()["data"]
    status, upload = _state(db, meeting)
    assert status == "processing"
    assert upload.resumed_at == resumed_at


def test_resume_before_assignment_gets_409(db, ws):
    waiting = _upload(db, ws, status="awaiting_speakers", claimed_at=UPLOADED_AT)
    other = _upload(db, ws, claimed_at=UPLOADED_AT)

    for meeting, status in [(waiting, "awaiting_speakers"), (other, "processing")]:
        r = _resume(meeting.meeting_id)
        assert r.status_code == 409, r.text
        assert r.json()["error"]["code"] == "SPEAKERS_NOT_ASSIGNED"
        assert r.json()["error"]["details"]["status"] == status
        state, upload = _state(db, meeting)
        assert state == status and upload.resumed_at is None


@pytest.mark.parametrize("status", ["done", "failed"])
def test_resume_again_after_the_meeting_ended_gets_409(db, ws, status):
    """멱등 응답은 processing 일 때만이다. 이미 끝난 회의는 다시 가져가도 이어 갈 것이 없다."""
    meeting = _upload(db, ws, claimed_at=UPLOADED_AT)
    _assign(db, meeting)
    assert _resume(meeting.meeting_id).status_code == 200
    db.get(Meeting, meeting.meeting_id).status = status
    db.commit()

    r = _resume(meeting.meeting_id)

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "MEETING_ALREADY_ENDED"
    assert r.json()["error"]["details"]["status"] == status


@pytest.mark.parametrize("status", ["done", "failed"])
def test_resume_of_ended_upload_gets_409(db, ws, status):
    meeting = _upload(db, ws, claimed_at=UPLOADED_AT)
    _assign(db, meeting, status=status)

    r = _resume(meeting.meeting_id)

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "MEETING_ALREADY_ENDED"
    assert r.json()["error"]["details"]["status"] == status
    state, upload = _state(db, meeting)
    assert state == status
    assert upload.resumed_at is None


def test_resume_of_unknown_discord_or_rowless_meeting_gets_404(db, ws):
    discord = _meeting(db, ws, source="discord")
    rowless = _meeting(db, ws)

    for meeting_id in ["no-such-meeting", discord.meeting_id, rowless.meeting_id]:
        r = _resume(meeting_id)
        assert r.status_code == 404, r.text
        assert r.json()["error"]["code"] == "MEETING_NOT_FOUND"


def test_extraction_after_resume_finishes_and_keeps_folder(db, ws):
    meeting = _upload(db, ws, claimed_at=UPLOADED_AT)
    assert _report(meeting.meeting_id).status_code == 200
    early = _register_extraction(meeting)  # 지정 전에는 받지 않는다
    assert early.status_code == 409, early.text
    assert early.json()["error"]["code"] == "MEETING_NOT_PROCESSING"
    assert upload_storage.meeting_dir(meeting.meeting_id).exists()
    _assign(db, meeting)
    assert _resume(meeting.meeting_id).status_code == 200

    r = _register_extraction(meeting)

    assert r.status_code == 201, r.text
    assert _state(db, meeting)[0] == "done"
    assert upload_storage.meeting_dir(meeting.meeting_id).exists()
