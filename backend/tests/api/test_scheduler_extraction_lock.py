"""틱의 시계 판정과 추출 저장이 태스크 잠금으로 교착하지 않는지."""
import threading
import time
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from app.core.database import get_db
from app.main import app
from app.models import Meeting, ReminderWatch
from app.services import scheduler
from tests.api.conftest import SERVICE_TOKEN
from tests.api.test_scheduler import DUE, PROPOSE, SLOT, _approve_all, _assign, _send, tick


def _setup(mdb, mseed, *, against_id_order):
    a, b = sorted(mseed["tasks"][:2], key=lambda t: t.task_id)
    first, second = (b, a) if against_id_order else (a, b)
    first_i, second_i = mseed["tasks"].index(first), mseed["tasks"].index(second)
    _assign(mdb, mseed, first_i, due=DUE)
    _assign(mdb, mseed, second_i, due=DUE + timedelta(days=1))
    now = PROPOSE + timedelta(days=1, hours=1)
    tick(mdb, now)
    _approve_all(mdb, now)
    _send(mdb, SLOT)
    _send(mdb, SLOT + timedelta(days=1))
    later = SLOT + timedelta(days=1, hours=2)
    tick(mdb, later)
    assert mdb.query(ReminderWatch).filter(ReminderWatch.state == "watching").count() == 2
    meeting = Meeting(workspace_id=mseed["ws"], status="processing")
    mdb.add(meeting)
    mdb.commit()
    return later, meeting.meeting_id, a.task_id, b.task_id


def _race(mdb, mseed, monkeypatch, round_, *, against_id_order, widen, stagger=0.0):
    if mdb.get_bind().dialect.name != "postgresql":
        pytest.skip("row locks")
    later, meeting_id, a, b = _setup(mdb, mseed, against_id_order=against_id_order)
    ws = mseed["ws"]
    Session = sessionmaker(bind=mdb.get_bind(), autoflush=False)

    def per_request_db():
        db = Session()
        db.execute(text("SET lock_timeout = '15s'"))
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = per_request_db
    if widen:
        real = scheduler._replied_after
        once = []

        def pause_after_first_task_lock(db, thread_id, after):
            if not once:
                once.append(1)
                time.sleep(0.4)
            return real(db, thread_id, after)

        monkeypatch.setattr(scheduler, "_replied_after", pause_after_first_task_lock)
    results = {}

    def run_tick():
        db = Session()
        db.execute(text("SET lock_timeout = '15s'"))
        try:
            scheduler.run_tick(db, now=later, send=None)
            results["tick"] = "ok"
        except Exception as e:  # noqa: BLE001
            results["tick"] = f"{type(e).__name__}: {str(e).splitlines()[0]}"
            db.rollback()
        finally:
            db.close()

    def extraction():
        time.sleep(0.15 if widen else stagger)
        c = TestClient(app, base_url="https://testserver", raise_server_exceptions=True)
        try:
            results["extraction"] = c.post("/api/v1/extractions", headers={"X-Service-Token": SERVICE_TOKEN}, json={
                "meeting_id": meeting_id, "workspace_id": ws,
                "items": [{"action": "update", "target_task_id": a}, {"action": "update", "target_task_id": b}],
            }).status_code
        except Exception as e:  # noqa: BLE001
            results["extraction"] = f"500 {type(getattr(e, 'orig', None) or e).__name__}"

    threads = [threading.Thread(target=run_tick), threading.Thread(target=extraction)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(40)
    print(f"\nround {round_}: {results}")
    assert results == {"tick": "ok", "extraction": 201}


@pytest.mark.parametrize("round_", range(2))
def test_tick_and_extraction_must_not_deadlock(mdb, mseed, monkeypatch, round_):
    _race(mdb, mseed, monkeypatch, round_, against_id_order=True, widen=True)


@pytest.mark.parametrize("round_", range(2))
def test_control_watch_order_equals_id_order(mdb, mseed, monkeypatch, round_):
    _race(mdb, mseed, monkeypatch, round_, against_id_order=False, widen=True)


@pytest.mark.parametrize("round_", range(10))
def test_no_instrumentation(mdb, mseed, monkeypatch, round_):
    _race(mdb, mseed, monkeypatch, round_, against_id_order=True, widen=False, stagger=(round_ % 10) * 0.002)
