"""회의 녹음 보관 기록과 재생 가능 판단(#659). now 를 주입해 보관 기간 경계를 본다.

TEST_DATABASE_URL 이 있으면 PostgreSQL 에서도 돈다.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.core.errors import AppError, ErrorCode
from app.models import Meeting, MeetingAudio, Workspace
from app.services import meeting_audio

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
RECEIVED = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)
DAY = timedelta(days=1)
SECOND = timedelta(seconds=1)


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
    if request.param == "postgresql":
        engine = _pg_engine()
    else:
        engine = create_engine(
            "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def _meeting(db, status="done") -> Meeting:
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    meeting = Meeting(workspace_id=ws.workspace_id, title="회의", source="manual_upload", status=status)
    db.add(meeting)
    db.flush()
    return meeting


def _recorded(db, status="done") -> Meeting:
    meeting = _meeting(db, status)
    meeting_audio.record(db, meeting.meeting_id, "audio.wav", "audio/wav", 1234, RECEIVED)
    db.commit()
    return meeting


def test_record_keeps_first_retention_from(db):
    meeting = _meeting(db)
    later = RECEIVED + DAY

    meeting_audio.record(db, meeting.meeting_id, "audio.wav", "audio/wav", 10, RECEIVED)
    meeting_audio.record(db, meeting.meeting_id, "audio.mp3", "audio/mpeg", 20, later)
    db.commit()

    row = db.get(MeetingAudio, meeting.meeting_id)
    assert row.retention_from.replace(tzinfo=timezone.utc) == RECEIVED
    assert (row.filename, row.content_type, row.size_bytes) == ("audio.mp3", "audio/mpeg", 20)
    assert row.deleted_at is None


def test_reason_none_within_retention_for_done(db):
    meeting = _recorded(db)

    assert meeting_audio.unavailable_reason(db, meeting, RECEIVED + 7 * DAY - SECOND) is None


def test_reason_expired_after_retention_for_done(db):
    meeting = _recorded(db)

    assert meeting_audio.unavailable_reason(db, meeting, RECEIVED + 7 * DAY + SECOND) == "expired"


def test_expires_exactly_at_deadline(db):
    meeting = _recorded(db)

    assert meeting_audio.unavailable_reason(db, meeting, RECEIVED + 7 * DAY) == "expired"
    assert meeting_audio.expires_at(db.get(MeetingAudio, meeting.meeting_id)) == RECEIVED + 7 * DAY


def test_processing_not_expired_even_after_retention(db):
    meeting = _recorded(db, status="processing")

    assert meeting_audio.unavailable_reason(db, meeting, RECEIVED + 8 * DAY) is None


def test_failed_is_no_recording(db):
    meeting = _recorded(db, status="failed")

    assert meeting_audio.unavailable_reason(db, meeting, RECEIVED + SECOND) == "no_recording"


def test_missing_row_is_no_recording(db):
    meeting = _meeting(db)

    assert meeting_audio.unavailable_reason(db, meeting, RECEIVED) == "no_recording"


def test_deleted_row_is_no_recording(db):
    meeting = _recorded(db)
    db.get(MeetingAudio, meeting.meeting_id).deleted_at = RECEIVED + DAY
    db.commit()

    assert meeting_audio.unavailable_reason(db, meeting, RECEIVED + 2 * DAY) == "no_recording"


def test_swept_after_retention_is_still_expired(db):
    # 만료 정리가 파일을 지우고 deleted_at 을 채운 뒤에도, 지운 이유는 보관 기간이 지나서다
    meeting = _recorded(db)
    db.get(MeetingAudio, meeting.meeting_id).deleted_at = RECEIVED + 7 * DAY + SECOND
    db.commit()

    assert meeting_audio.unavailable_reason(db, meeting, RECEIVED + 8 * DAY) == "expired"


def test_retention_days_env(db, monkeypatch):
    monkeypatch.setenv("UPLOAD_AUDIO_RETENTION_DAYS", "2")
    meeting = _recorded(db)

    assert meeting_audio.retention() == 2 * DAY
    assert meeting_audio.unavailable_reason(db, meeting, RECEIVED + 2 * DAY - SECOND) is None
    assert meeting_audio.unavailable_reason(db, meeting, RECEIVED + 2 * DAY + SECOND) == "expired"


def test_retention_defaults_to_seven_days(monkeypatch):
    monkeypatch.delenv("UPLOAD_AUDIO_RETENTION_DAYS", raising=False)

    assert meeting_audio.retention() == 7 * DAY


def test_require_playable_raises_with_reason(db):
    meeting = _recorded(db)

    with pytest.raises(AppError) as caught:
        meeting_audio.require_playable(db, meeting, RECEIVED + 8 * DAY)

    error = caught.value
    assert error.code == ErrorCode.AUDIO_NOT_AVAILABLE
    assert error.status_code == 404
    assert error.details == {"meeting_id": meeting.meeting_id, "reason": "expired"}


def test_require_playable_returns_row_when_playable(db):
    meeting = _recorded(db)

    row = meeting_audio.require_playable(db, meeting, RECEIVED + DAY)

    assert row.meeting_id == meeting.meeting_id


def test_playback_info_when_playable_and_none_otherwise(db):
    meeting = _recorded(db)

    info = meeting_audio.playback_info(db, meeting, RECEIVED + DAY)

    assert info == {
        "content_type": "audio/wav",
        "expires_at": RECEIVED + 7 * DAY,
        "size_bytes": 1234,
    }
    assert meeting_audio.playback_info(db, meeting, RECEIVED + 8 * DAY) is None


@pytest.mark.parametrize("raw", ["0", "-3", "abc", "1.5"])
def test_retention_invalid_value_warns_and_uses_default(monkeypatch, caplog, raw):
    monkeypatch.setenv("UPLOAD_AUDIO_RETENTION_DAYS", raw)

    with caplog.at_level("WARNING"):
        assert meeting_audio.retention() == 7 * DAY

    assert "UPLOAD_AUDIO_RETENTION_DAYS" in caplog.text


def test_retention_empty_value_uses_default_without_warning(monkeypatch, caplog):
    monkeypatch.setenv("UPLOAD_AUDIO_RETENTION_DAYS", "")

    with caplog.at_level("WARNING"):
        assert meeting_audio.retention() == 7 * DAY

    assert caplog.text == ""


# --- 만료 정리(sweep_expired_audio) ---

@pytest.fixture
def storage(tmp_path, monkeypatch):
    monkeypatch.delenv("UPLOAD_STORAGE", raising=False)
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    return tmp_path


def _with_file(storage, meeting: Meeting):
    folder = storage / meeting.meeting_id
    folder.mkdir()
    (folder / "audio.wav").write_bytes(b"RIFF")
    return folder


def test_sweep_deletes_expired_done_and_marks_row(db, storage):
    meeting = _recorded(db)
    folder = _with_file(storage, meeting)
    now = RECEIVED + 7 * DAY + SECOND

    assert meeting_audio.sweep_expired_audio(db, now) == [meeting.meeting_id]

    assert not folder.exists()
    assert _aware_deleted_at(db, meeting) == now


def _aware_deleted_at(db, meeting):
    db.expire_all()
    return meeting_audio._aware(db.get(MeetingAudio, meeting.meeting_id).deleted_at)


def test_sweep_keeps_unexpired(db, storage):
    meeting = _recorded(db)
    folder = _with_file(storage, meeting)

    assert meeting_audio.sweep_expired_audio(db, RECEIVED + 7 * DAY - SECOND) == []

    assert folder.exists()
    assert db.get(MeetingAudio, meeting.meeting_id).deleted_at is None


def test_sweep_keeps_processing_even_if_old(db, storage):
    meeting = _recorded(db, status="processing")
    folder = _with_file(storage, meeting)

    assert meeting_audio.sweep_expired_audio(db, RECEIVED + 30 * DAY) == []

    assert folder.exists()
    assert db.get(MeetingAudio, meeting.meeting_id).deleted_at is None


def test_sweep_deletes_failed_immediately(db, storage):
    meeting = _recorded(db, status="failed")
    folder = _with_file(storage, meeting)
    now = RECEIVED + SECOND

    assert meeting_audio.sweep_expired_audio(db, now) == [meeting.meeting_id]

    assert not folder.exists()
    assert _aware_deleted_at(db, meeting) == now


def test_sweep_retries_after_remove_failure(db, storage, monkeypatch):
    meeting = _recorded(db)
    folder = _with_file(storage, meeting)
    now = RECEIVED + 8 * DAY

    real_remove = meeting_audio.upload_storage.remove_audio
    calls = []

    def fail_once(meeting_id):
        calls.append(meeting_id)
        if len(calls) == 1:
            raise OSError("busy")
        real_remove(meeting_id)

    monkeypatch.setattr(meeting_audio.upload_storage, "remove_audio", fail_once)
    assert meeting_audio.sweep_expired_audio(db, now) == []
    assert db.get(MeetingAudio, meeting.meeting_id).deleted_at is None
    assert folder.exists()

    assert meeting_audio.sweep_expired_audio(db, now) == [meeting.meeting_id]
    assert not folder.exists()
    assert _aware_deleted_at(db, meeting) == now


def test_sweep_skips_deleted_meeting(db, storage):
    meeting = _recorded(db)
    folder = _with_file(storage, meeting)
    meeting.deleted_at = RECEIVED + DAY
    db.commit()

    assert meeting_audio.sweep_expired_audio(db, RECEIVED + 8 * DAY) == []

    assert folder.exists()
    assert db.get(MeetingAudio, meeting.meeting_id).deleted_at is None


def test_sweep_skips_deleted_workspace(db, storage):
    meeting = _recorded(db)
    folder = _with_file(storage, meeting)
    db.get(Workspace, meeting.workspace_id).deleted_at = RECEIVED + DAY
    db.commit()

    assert meeting_audio.sweep_expired_audio(db, RECEIVED + 8 * DAY) == []

    assert folder.exists()


def test_sweep_skips_already_deleted_row(db, storage):
    meeting = _recorded(db)
    folder = _with_file(storage, meeting)
    db.get(MeetingAudio, meeting.meeting_id).deleted_at = RECEIVED + DAY
    db.commit()

    assert meeting_audio.sweep_expired_audio(db, RECEIVED + 8 * DAY) == []

    assert folder.exists()


def test_sweep_removes_files_without_holding_a_transaction(db, storage, monkeypatch):
    """S3 를 지우는 동안 워크스페이스·회의 잠금(트랜잭션)을 쥐지 않는다. 잠금은 deleted_at 을 남길 때만 짧게 잡는다."""
    meeting = _recorded(db)
    folder = _with_file(storage, meeting)
    real_remove = meeting_audio.upload_storage.remove_audio
    in_transaction = []

    def remove(meeting_id):
        in_transaction.append(db.in_transaction())
        real_remove(meeting_id)

    monkeypatch.setattr(meeting_audio.upload_storage, "remove_audio", remove)
    now = RECEIVED + 8 * DAY

    assert meeting_audio.sweep_expired_audio(db, now) == [meeting.meeting_id]

    assert in_transaction == [False]
    assert not folder.exists()
    assert _aware_deleted_at(db, meeting) == now


def test_sweep_failure_of_one_meeting_does_not_block_others(db, storage, monkeypatch):
    first, second = _recorded(db), _recorded(db)
    first_folder, second_folder = _with_file(storage, first), _with_file(storage, second)
    real_remove = meeting_audio.upload_storage.remove_audio

    def remove(meeting_id):
        if meeting_id == first.meeting_id:
            raise OSError("s3 down")
        real_remove(meeting_id)

    monkeypatch.setattr(meeting_audio.upload_storage, "remove_audio", remove)

    assert meeting_audio.sweep_expired_audio(db, RECEIVED + 8 * DAY) == [second.meeting_id]

    assert first_folder.exists() and not second_folder.exists()
    db.expire_all()
    assert db.get(MeetingAudio, first.meeting_id).deleted_at is None
    assert db.get(MeetingAudio, second.meeting_id).deleted_at is not None


@pytest.mark.parametrize("deleted", ["meeting", "workspace"])
def test_sweep_skips_meeting_deleted_while_removing(db, storage, monkeypatch, deleted):
    """파일을 지우는 사이 회의·공간이 지워지면 deleted_at 을 남기지 않는다. 그 뒤 정리는 삭제 경로(purge)가 맡는다."""
    meeting = _recorded(db)
    _with_file(storage, meeting)
    real_remove = meeting_audio.upload_storage.remove_audio

    def remove_then_delete(meeting_id):
        real_remove(meeting_id)
        target = db.get(Meeting, meeting_id) if deleted == "meeting" else db.get(Workspace, meeting.workspace_id)
        target.deleted_at = RECEIVED + 8 * DAY
        db.commit()

    monkeypatch.setattr(meeting_audio.upload_storage, "remove_audio", remove_then_delete)

    assert meeting_audio.sweep_expired_audio(db, RECEIVED + 8 * DAY) == []

    db.expire_all()
    assert db.get(MeetingAudio, meeting.meeting_id).deleted_at is None
