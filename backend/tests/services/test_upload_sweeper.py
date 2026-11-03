"""멈춘 업로드 회의를 failed 로 정리하는 sweeper(#266). now 를 주입해 시각 경계를 본다.

TEST_DATABASE_URL 이 있으면 PostgreSQL 에서도 돈다.
"""
import json
import os
import threading
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models import Meeting, MeetingUpload, Source, Workspace
from app.services import meeting_failure, upload_storage, upload_sweeper

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)
HOUR = timedelta(hours=1)
DAY = timedelta(days=1)


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
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture
def ws(db):
    ws = Workspace(name="A")
    db.add(ws)
    db.commit()
    return ws


def _upload(db, ws, *, status="processing", source="manual_upload", row=True, **times) -> Meeting:
    """업로드 회의. times 는 meeting_upload 의 시각 컬럼(claimed_at, speakers_reported_at ...)이다."""
    meeting = Meeting(workspace_id=ws.workspace_id, title="회의", source=source, status=status)
    db.add(meeting)
    db.flush()
    if row:
        db.add(MeetingUpload(
            meeting_id=meeting.meeting_id,
            stored_filename="audio.ogg",
            size_bytes=4,
            attendees=json.dumps([]),
            **times,
        ))
    db.commit()
    folder = upload_storage.meeting_dir(meeting.meeting_id)
    folder.mkdir(parents=True)
    (folder / "audio.ogg").write_bytes(b"OggS")
    return meeting


def _state(db, meeting):
    db.expire_all()
    m = db.get(Meeting, meeting.meeting_id)
    return m.status, m.failed_stage


def _folder(meeting):
    return upload_storage.meeting_dir(meeting.meeting_id)


def test_stalled_claim_is_failed_with_diarize_and_folder_removed(db, ws):
    meeting = _upload(db, ws, claimed_at=NOW - 3 * HOUR - timedelta(seconds=1))

    result = upload_sweeper.sweep_stalled_uploads(db, now=NOW)

    assert result == [(meeting.meeting_id, "diarize")]
    assert _state(db, meeting) == ("failed", "diarize")
    assert db.get(Meeting, meeting.meeting_id).ended_at is not None
    assert not _folder(meeting).exists()


def test_recent_claim_is_left_alone(db, ws):
    meeting = _upload(db, ws, claimed_at=NOW - 3 * HOUR + timedelta(minutes=1))

    assert upload_sweeper.sweep_stalled_uploads(db, now=NOW) == []

    assert _state(db, meeting) == ("processing", None)
    assert _folder(meeting).exists()


def test_unclaimed_upload_is_never_swept(db, ws):
    meeting = _upload(db, ws, claimed_at=None)
    db.execute(update(MeetingUpload).values(uploaded_at=NOW - 10 * DAY))
    db.commit()

    assert upload_sweeper.sweep_stalled_uploads(db, now=NOW) == []

    assert _state(db, meeting) == ("processing", None)
    assert _folder(meeting).exists()


def test_awaiting_speakers_expires_after_seven_days(db, ws):
    expired = _upload(
        db, ws, status="awaiting_speakers", claimed_at=NOW - 8 * DAY,
        speakers_reported_at=NOW - 7 * DAY - timedelta(seconds=1),
    )
    waiting = _upload(
        db, ws, status="awaiting_speakers", claimed_at=NOW - 8 * DAY,
        speakers_reported_at=NOW - 6 * DAY - 23 * HOUR,
    )

    result = upload_sweeper.sweep_stalled_uploads(db, now=NOW)

    assert result == [(expired.meeting_id, "speaker_assignment_expired")]
    assert _state(db, expired) == ("failed", "speaker_assignment_expired")
    assert not _folder(expired).exists()
    assert _state(db, waiting) == ("awaiting_speakers", None)
    assert _folder(waiting).exists()


def test_awaiting_speakers_ignores_the_three_hour_rule(db, ws):
    meeting = _upload(
        db, ws, status="awaiting_speakers",
        claimed_at=NOW - 10 * HOUR, speakers_reported_at=NOW - HOUR,
    )

    assert upload_sweeper.sweep_stalled_uploads(db, now=NOW) == []

    assert _state(db, meeting) == ("awaiting_speakers", None)


@pytest.mark.parametrize(
    ("assigned_ago", "failed"),
    [(2 * HOUR, False), (3 * HOUR + timedelta(seconds=1), True)],
    ids=["assigned-2h", "assigned-3h+"],
)
def test_assigned_but_not_resumed_counts_from_assignment(db, ws, assigned_ago, failed):
    meeting = _upload(
        db, ws, claimed_at=NOW - 2 * DAY, speakers_reported_at=NOW - 2 * DAY,
        speakers_assigned_at=NOW - assigned_ago,
    )

    result = upload_sweeper.sweep_stalled_uploads(db, now=NOW)

    assert result == ([(meeting.meeting_id, "diarize")] if failed else [])
    assert _state(db, meeting) == (("failed", "diarize") if failed else ("processing", None))
    assert _folder(meeting).exists() is not failed


@pytest.mark.parametrize(
    ("resumed_ago", "failed"),
    [(2 * HOUR, False), (3 * HOUR + timedelta(seconds=1), True)],
    ids=["resumed-2h", "resumed-3h+"],
)
def test_resumed_counts_from_resume(db, ws, resumed_ago, failed):
    meeting = _upload(
        db, ws, claimed_at=NOW - 2 * DAY, speakers_reported_at=NOW - 2 * DAY,
        speakers_assigned_at=NOW - DAY, resumed_at=NOW - resumed_ago,
    )

    result = upload_sweeper.sweep_stalled_uploads(db, now=NOW)

    assert result == ([(meeting.meeting_id, "diarize")] if failed else [])
    assert _state(db, meeting) == (("failed", "diarize") if failed else ("processing", None))


def test_recent_utterance_keeps_a_long_resumed_upload_alive(db, ws):
    meeting = _upload(
        db, ws, claimed_at=NOW - 2 * DAY, speakers_assigned_at=NOW - DAY, resumed_at=NOW - 4 * HOUR,
    )
    db.add(Source(
        meeting_id=meeting.meeting_id, seq=0, start_ms=0, end_ms=1, text="안녕",
        created_at=NOW - HOUR,
    ))
    db.commit()

    assert upload_sweeper.sweep_stalled_uploads(db, now=NOW) == []

    assert _state(db, meeting) == ("processing", None)
    assert _folder(meeting).exists()


def test_discord_and_ended_meetings_are_untouched(db, ws):
    old = NOW - 20 * DAY
    discord = _upload(db, ws, source="discord", row=False)
    discord_with_row = _upload(db, ws, source="discord", claimed_at=old)
    rowless = _upload(db, ws, row=False)
    done = _upload(db, ws, status="done", claimed_at=old)
    failed = _upload(db, ws, status="failed", claimed_at=old)
    db.execute(update(Meeting).where(Meeting.meeting_id == failed.meeting_id).values(failed_stage="STT"))
    db.commit()

    assert upload_sweeper.sweep_stalled_uploads(db, now=NOW) == []

    assert _state(db, discord) == ("processing", None)
    assert _state(db, discord_with_row) == ("processing", None)
    assert _state(db, rowless) == ("processing", None)
    assert _state(db, done) == ("done", None)
    assert _state(db, failed) == ("failed", "STT")
    assert _folder(failed).exists() and _folder(done).exists()


def test_second_sweep_returns_nothing_and_changes_nothing(db, ws):
    meeting = _upload(db, ws, claimed_at=NOW - 4 * HOUR)

    assert upload_sweeper.sweep_stalled_uploads(db, now=NOW) == [(meeting.meeting_id, "diarize")]
    assert upload_sweeper.sweep_stalled_uploads(db, now=NOW + HOUR) == []

    assert _state(db, meeting) == ("failed", "diarize")


def test_meeting_changed_after_candidate_selection_is_skipped(db, ws, monkeypatch):
    """후보를 고른 뒤 다른 쪽이 먼저 끝냈다면, 조건부 UPDATE 가 지고 기존 값이 남는다."""
    meeting = _upload(db, ws, claimed_at=NOW - 4 * HOUR)
    real = meeting_failure.fail_meeting_if

    def other_side_wins_first(db_, meeting_id, failed_stage, *extra_where, now=None):
        db_.execute(update(Meeting).where(Meeting.meeting_id == meeting_id).values(status="done"))
        db_.commit()
        return real(db_, meeting_id, failed_stage, *extra_where, now=now)

    monkeypatch.setattr(meeting_failure, "fail_meeting_if", other_side_wins_first)

    assert upload_sweeper.sweep_stalled_uploads(db, now=NOW) == []

    assert _state(db, meeting) == ("done", None)
    assert _folder(meeting).exists()


def test_fresh_progress_after_candidate_selection_is_not_overridden(db, ws, monkeypatch):
    """후보를 고른 뒤 발화가 새로 저장되면, 시각 조건을 다시 건 UPDATE 가 지고 회의는 그대로다."""
    meeting = _upload(db, ws, claimed_at=NOW - 4 * HOUR)
    real = meeting_failure.fail_meeting_if

    def progress_first(db_, meeting_id, failed_stage, *extra_where, now=None):
        db_.add(Source(meeting_id=meeting_id, seq=0, start_ms=0, end_ms=1, text="안녕", created_at=NOW))
        db_.commit()
        return real(db_, meeting_id, failed_stage, *extra_where, now=now)

    monkeypatch.setattr(meeting_failure, "fail_meeting_if", progress_first)

    assert upload_sweeper.sweep_stalled_uploads(db, now=NOW) == []

    assert _state(db, meeting) == ("processing", None)


def test_one_failing_meeting_does_not_stop_the_rest(db, ws, monkeypatch):
    first = _upload(db, ws, claimed_at=NOW - 5 * HOUR)
    second = _upload(db, ws, claimed_at=NOW - 6 * HOUR)
    real = meeting_failure.fail_meeting_if

    def flaky(db_, meeting_id, failed_stage, *extra_where, now=None):
        if meeting_id == first.meeting_id:
            raise RuntimeError("boom")
        return real(db_, meeting_id, failed_stage, *extra_where, now=now)

    monkeypatch.setattr(meeting_failure, "fail_meeting_if", flaky)

    result = upload_sweeper.sweep_stalled_uploads(db, now=NOW)

    assert result == [(second.meeting_id, "diarize")]
    assert _state(db, first) == ("processing", None)
    assert _state(db, second) == ("failed", "diarize")


def test_worker_keeps_running_after_a_sweep_raises(monkeypatch):
    stop = threading.Event()
    calls = []

    class FakeSession:
        def rollback(self):
            calls.append("rollback")

        def close(self):
            calls.append("close")

    def sweep(db):
        calls.append("sweep")
        if calls.count("sweep") == 1:
            raise RuntimeError("boom")
        stop.set()
        return []

    monkeypatch.setattr(upload_sweeper, "SessionLocal", FakeSession)
    monkeypatch.setattr(upload_sweeper, "sweep_stalled_uploads", sweep)

    upload_sweeper.run_worker(stop, 0)

    assert calls.count("sweep") == 2
    assert "rollback" in calls
