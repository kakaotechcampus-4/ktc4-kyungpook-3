"""실제 HTTP claim과 sweep의 잠금 교차. PostgreSQL 두 세션의 대기를 직접 확인한다."""
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Event

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text, update
from sqlalchemy.orm import sessionmaker

from app.core.database import Base, get_db
from app.main import app
from app.models import Meeting, MeetingUpload, Workspace
from app.services import meeting_deletion, upload_storage, upload_sweeper

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="PostgreSQL 두 세션이 필요합니다.")
TOKEN = "test-sweeper-concurrency"
NOW = datetime.now(timezone.utc)


@pytest.fixture
def pg(monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", TOKEN)
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False)
    try:
        yield engine, factory
    finally:
        app.dependency_overrides.pop(get_db, None)
        Base.metadata.drop_all(engine)
        engine.dispose()


def _seed(factory, *, workspace_id=None, uploaded_at=None):
    with factory() as db:
        if workspace_id is None:
            workspace = Workspace(name="retention race")
            db.add(workspace)
            db.flush()
            workspace_id = workspace.workspace_id
        meeting = Meeting(workspace_id=workspace_id, source="manual_upload", status="processing")
        db.add(meeting)
        db.flush()
        meeting_id = meeting.meeting_id
        db.add(MeetingUpload(
            meeting_id=meeting_id, stored_filename="audio.ogg", size_bytes=4,
            attendees="[]", uploaded_at=uploaded_at or NOW - timedelta(hours=25),
        ))
        db.commit()
    folder = upload_storage.meeting_dir(meeting_id)
    folder.mkdir(parents=True)
    (folder / "audio.ogg").write_bytes(b"OggS")
    return workspace_id, meeting_id


def _identify(db, name, pids, started):
    db.execute(text("SET LOCAL lock_timeout = '15s'"))
    pids[name] = db.scalar(text("SELECT pg_backend_pid()"))
    started.set()


def _pause_commit(db, ready, release):
    def before_commit(_):
        ready.set()
        assert release.wait(12), "Test did not release the transaction"
    event.listen(db, "before_commit", before_commit, once=True)


def _request_db(factory, pids, started, *, ready=None, release=None):
    def dependency():
        with factory() as db:
            _identify(db, "claim", pids, started)
            if ready is not None:
                _pause_commit(db, ready, release)
            yield db
    return dependency


def _claim(meeting_id):
    return TestClient(app, base_url="https://testserver").patch(
        f"/api/v1/uploads/{meeting_id}/claim", headers={"X-Service-Token": TOKEN},
    )


def _sweep(factory, pids, started, *, ready=None, release=None):
    with factory() as db:
        _identify(db, "sweep", pids, started)
        if ready is not None:
            _pause_commit(db, ready, release)
        return upload_sweeper.sweep_stalled_uploads(db, now=NOW)


def _wait_blocked(engine, waiting_pid, blocking_pid):
    deadline = time.monotonic() + 8
    poll = Event()
    with engine.connect() as observer:
        while blocking_pid not in observer.scalar(
            text("SELECT pg_blocking_pids(:pid)"), {"pid": waiting_pid},
        ):
            assert time.monotonic() < deadline, "Expected PostgreSQL row-lock wait did not happen"
            poll.wait(0.01)


def _state(factory, meeting_id):
    with factory() as db:
        meeting = db.get(Meeting, meeting_id)
        return meeting.status, db.get(MeetingUpload, meeting_id).claimed_at


@pytest.mark.parametrize("progress", ["claim", "resume", "sources"])
def test_http_progress_commits_before_waiting_sweep_and_keeps_audio(pg, progress):
    engine, factory = pg
    _, meeting_id = _seed(factory)
    if progress != "claim":
        with factory() as db:
            db.execute(update(MeetingUpload).where(MeetingUpload.meeting_id == meeting_id).values(
                claimed_at=NOW - timedelta(hours=25),
                speakers_assigned_at=NOW - timedelta(hours=24),
                speaker_mapping='{"SPEAKER_00": null}',
            ))
            db.commit()

    def report_progress():
        if progress == "claim":
            return _claim(meeting_id)
        client = TestClient(app, base_url="https://testserver")
        if progress == "resume":
            return client.patch(f"/api/v1/uploads/{meeting_id}/resume", headers={"X-Service-Token": TOKEN})
        return client.post(
            f"/api/v1/meetings/{meeting_id}/sources", headers={"X-Service-Token": TOKEN},
            json={"segments": [{"seq": 0, "speaker": None, "start": 0, "end": 1, "text": "진행 중"}]},
        )

    pids = {}
    claim_started, claim_ready, sweep_started, release = Event(), Event(), Event(), Event()
    app.dependency_overrides[get_db] = _request_db(
        factory, pids, claim_started, ready=claim_ready, release=release,
    )
    with ThreadPoolExecutor(2) as pool:
        try:
            claim = pool.submit(report_progress)
            assert claim_ready.wait(8)
            sweep = pool.submit(_sweep, factory, pids, sweep_started)
            assert sweep_started.wait(5)
            _wait_blocked(engine, pids["sweep"], pids["claim"])
        finally:
            release.set()
        response, swept = claim.result(timeout=12), sweep.result(timeout=12)

    assert response.status_code == (201 if progress == "sources" else 200), response.text
    assert swept == []
    status, claimed_at = _state(factory, meeting_id)
    assert status == "processing" and claimed_at is not None
    assert (upload_storage.meeting_dir(meeting_id) / "audio.ogg").read_bytes() == b"OggS"


def test_sweep_commits_before_waiting_http_claim_and_claim_is_rejected(pg):
    engine, factory = pg
    _, meeting_id = _seed(factory)
    pids = {}
    sweep_started, sweep_ready, claim_started, release = Event(), Event(), Event(), Event()
    app.dependency_overrides[get_db] = _request_db(factory, pids, claim_started)
    with ThreadPoolExecutor(2) as pool:
        try:
            sweep = pool.submit(_sweep, factory, pids, sweep_started, ready=sweep_ready, release=release)
            assert sweep_ready.wait(8)
            claim = pool.submit(_claim, meeting_id)
            assert claim_started.wait(5)
            _wait_blocked(engine, pids["claim"], pids["sweep"])
        finally:
            release.set()
        swept, response = sweep.result(timeout=12), claim.result(timeout=12)

    assert swept == [(meeting_id, "upload_unclaimed")]
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "MEETING_ALREADY_ENDED"
    assert _state(factory, meeting_id) == ("failed", None)
    assert not upload_storage.meeting_dir(meeting_id).exists()


@pytest.mark.parametrize("change", ["done", "deleted"])
def test_committed_meeting_change_wins_over_waiting_sweep(pg, change):
    engine, factory = pg
    _, meeting_id = _seed(factory)
    pids, started = {}, Event()
    with factory() as leader, ThreadPoolExecutor(1) as pool:
        meeting_deletion.require_live_meeting(leader, meeting_id, lock=True)
        leader_pid = leader.scalar(text("SELECT pg_backend_pid()"))
        values = {"status": "done"} if change == "done" else {"deleted_at": NOW}
        leader.execute(update(Meeting).where(Meeting.meeting_id == meeting_id).values(**values))
        try:
            sweep = pool.submit(_sweep, factory, pids, started)
            assert started.wait(5)
            _wait_blocked(engine, pids["sweep"], leader_pid)
        finally:
            leader.commit()
        assert sweep.result(timeout=12) == []
    assert upload_storage.meeting_dir(meeting_id).exists()


def test_other_workspace_sweep_does_not_wait_for_unrelated_meeting_lock(pg):
    _, factory = pg
    _, held_id = _seed(factory, uploaded_at=NOW)
    _, expired_id = _seed(factory)
    with factory() as leader, ThreadPoolExecutor(1) as pool:
        meeting_deletion.require_live_meeting(leader, held_id, lock=True)
        try:
            sweep = pool.submit(_sweep, factory, {}, Event())
            assert sweep.result(timeout=5) == [(expired_id, "upload_unclaimed")]
        finally:
            leader.rollback()
    assert _state(factory, held_id)[0] == "processing"
    assert upload_storage.meeting_dir(held_id).exists()
    assert not upload_storage.meeting_dir(expired_id).exists()
