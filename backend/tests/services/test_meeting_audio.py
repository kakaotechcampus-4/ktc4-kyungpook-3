"""회의 녹음 보관 기록과 재생 가능 판단(#659). now 를 주입해 보관 기간 경계를 본다."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.core.errors import AppError, ErrorCode
from app.models import Meeting, MeetingAudio, Workspace
from app.services import meeting_audio

RECEIVED = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)
DAY = timedelta(days=1)
SECOND = timedelta(seconds=1)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
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
