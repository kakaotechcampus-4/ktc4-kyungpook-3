"""BE 프로세스가 여럿이라 틱과 봇 가져가기가 겹칠 때. 행 잠금은 PostgreSQL 에서만 의미가 있어 sqlite 에서는 건너뛴다."""
import threading
from datetime import timedelta

import pytest
from sqlalchemy.orm import sessionmaker

from app.models import Notification, Reminder, ReminderWatch, TaskHistory, ThreadMessage
from app.services import messages, scheduler
from tests.api.test_scheduler import PROPOSE, SLOT, _approve_all, _assign


def _postgres_only(mdb):
    if mdb.get_bind().dialect.name != "postgresql":
        pytest.skip("행 잠금은 PostgreSQL 에서만 확인한다")


def _together(mdb, *jobs):
    Session = sessionmaker(bind=mdb.get_bind(), autoflush=False)
    errors = []

    def run(job):
        db = Session()
        try:
            job(db)
            db.commit()
        except Exception as e:  # noqa: BLE001
            errors.append(e)
            db.rollback()
        finally:
            db.close()

    threads = [threading.Thread(target=run, args=(job,)) for job in jobs]
    for t in threads:
        t.start()
    for t in threads:
        t.join(20)
    assert not any(t.is_alive() for t in threads), "threads did not finish"
    assert errors == []
    mdb.expire_all()


def _tick(now):
    return lambda db: scheduler.run_tick(db, now=now, send=lambda sub, payload: None)


def test_two_ticks_at_once_suggest_once(mdb, mseed):
    _postgres_only(mdb)
    _assign(mdb, mseed, 0)
    _assign(mdb, mseed, 1, who="bob")
    _together(mdb, _tick(PROPOSE), _tick(PROPOSE), _tick(PROPOSE))
    assert mdb.query(Reminder).count() == 2
    assert mdb.query(Notification).filter(Notification.kind == "nudge_suggested").count() == 2


def test_tick_and_bot_claim_at_send_time_send_once_and_block_once(mdb, mseed):
    _postgres_only(mdb)
    task = _assign(mdb, mseed, 0)
    scheduler.run_tick(mdb, now=PROPOSE, send=None)
    _approve_all(mdb, PROPOSE)
    _together(mdb, _tick(SLOT), lambda db: messages.claim_for_bot(db, SLOT), _tick(SLOT))
    assert mdb.query(ThreadMessage).filter(ThreadMessage.sender == "bot").count() == 1

    message = mdb.query(ThreadMessage).filter(ThreadMessage.sender == "bot").one()
    message.dm_status = "delivered"
    mdb.commit()
    later = SLOT + timedelta(hours=72)
    _together(mdb, _tick(later), _tick(later), _tick(later))
    assert mdb.query(ReminderWatch).count() == 1
    assert mdb.query(TaskHistory).filter(TaskHistory.task_id == task.task_id).count() == 2
    assert mdb.query(Notification).filter(Notification.kind == "silence_blocked").count() == 1
