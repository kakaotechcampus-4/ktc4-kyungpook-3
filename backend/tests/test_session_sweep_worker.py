"""만료 세션 정리 워커의 기동 조건과 반복 동작(#437)."""
import threading

import pytest
from fastapi.testclient import TestClient

from app import main
from app.main import app
from app.services import sessions


@pytest.fixture(autouse=True)
def _other_workers_off(monkeypatch):
    for name in (
        "REMINDER_SCHEDULER_INTERVAL_SECONDS",
        "NOTION_SYNC_INTERVAL_SECONDS",
        "EMBEDDING_SYNC_INTERVAL_SECONDS",
        "UPLOAD_SWEEP_INTERVAL_SECONDS",
    ):
        monkeypatch.setattr(main, name, 0)


def test_lifespan_skips_session_worker_when_interval_not_positive(monkeypatch):
    calls = []
    monkeypatch.setattr(main, "SESSION_SWEEP_INTERVAL_SECONDS", 0)
    monkeypatch.setattr(sessions, "start_worker", lambda interval: calls.append(interval))

    with TestClient(app):
        pass

    assert calls == []


def test_lifespan_starts_session_worker_when_positive(monkeypatch):
    calls = []

    def stub(interval):
        calls.append(interval)
        thread = threading.Thread(target=lambda: None)
        thread.start()
        return thread, threading.Event()

    monkeypatch.setattr(main, "SESSION_SWEEP_INTERVAL_SECONDS", 3600)
    monkeypatch.setattr(sessions, "start_worker", stub)

    with TestClient(app):
        pass

    assert calls == [3600]


def test_run_worker_sweeps_once_then_stops(monkeypatch):
    stop_event = threading.Event()
    calls = []

    class FakeDb:
        closed = False

        def close(self):
            self.closed = True

    fake = FakeDb()

    def fake_sweep(db):
        calls.append(db)
        stop_event.set()
        return 0

    monkeypatch.setattr(sessions, "SessionLocal", lambda: fake)
    monkeypatch.setattr(sessions, "sweep_expired_sessions", fake_sweep)

    sessions.run_worker(stop_event, 3600)

    assert calls == [fake]
    assert fake.closed
