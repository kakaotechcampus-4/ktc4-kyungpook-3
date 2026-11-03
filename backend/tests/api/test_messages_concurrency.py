"""봇과 PM 요청이 겹칠 때. 행 잠금은 PostgreSQL 에서만 의미가 있어 sqlite 에서는 건너뛴다."""
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import sessionmaker

from app.core.errors import AppError, ErrorCode
from app.models import ReminderBundle, ThreadMessage
from app.services import messages as svc


def _postgres_only(mdb):
    if mdb.get_bind().dialect.name != "postgresql":
        pytest.skip("행 잠금은 PostgreSQL 에서만 확인한다")


def _run_threads(*targets):
    threads = [threading.Thread(target=fn, name=name) for name, fn in targets]
    for t in threads:
        t.start()
    for t in threads:
        t.join(20)
    assert not any(t.is_alive() for t in threads), "threads did not finish"


def _outcome(fn, session_factory):
    db = session_factory()
    try:
        result = fn(db)
        db.commit()
        return result
    except AppError as e:
        db.rollback()
        return e.code
    except Exception as e:  # noqa: BLE001
        db.rollback()
        return f"{type(e).__name__}: {str(e).splitlines()[0]}"
    finally:
        db.close()


@pytest.mark.parametrize("pm_action", ["cancel_reminder", "cancel_bundle", "edit_bundle_body"])
def test_pm_action_on_due_bundle_while_bot_claims_it_is_rejected_not_deadlocked(mdb, mseed, pm_action):
    _postgres_only(mdb)
    engine = mdb.get_bind()
    now = datetime.now(timezone.utc)
    r = svc.create_reminder(
        mdb, workspace_id=mseed["ws"], task_id=mseed["tasks"][0].task_id, member_id=mseed["alice"].member_id,
        scheduled_at=now + timedelta(days=1), note=None, created_by=mseed["pm"].member_id, now=now,
    )
    bundle = svc.get_bundle(mdb, mseed["ws"], r.bundle_id)
    svc.approve_bundle(mdb, bundle, draft_version=bundle.draft_version, approved_by=None, now=now)
    rid, bid = r.reminder_id, r.bundle_id
    mdb.get(ReminderBundle, bid).scheduled_at = now - timedelta(minutes=1)
    mdb.commit()

    Session = sessionmaker(bind=engine, autoflush=False)
    bot_holds_bundle, pm_waits_for_bundle = threading.Event(), threading.Event()

    # 봇이 묶음을 잠근 채 메시지를 넣기 직전에 PM 이 대화를 잠그고 묶음을 기다리게 순서를 고정한다.
    def listener(conn, cursor, statement, params, context, executemany):
        name = threading.current_thread().name
        if name == "bot" and statement.startswith("INSERT INTO thread_message"):
            bot_holds_bundle.set()
            pm_waits_for_bundle.wait(5)
            time.sleep(0.3)
        if name == "pm" and "FROM reminder_bundle" in statement and "FOR UPDATE" in statement:
            pm_waits_for_bundle.set()

    def pm_act(db):
        bot_holds_bundle.wait(5)
        at = datetime.now(timezone.utc)
        if pm_action == "cancel_reminder":
            svc.cancel_reminder(db, svc.get_reminder(db, mseed["ws"], rid), now=at)
        elif pm_action == "cancel_bundle":
            svc.cancel_bundle(db, svc.get_bundle(db, mseed["ws"], bid), now=at)
        else:
            svc.edit_bundle(db, svc.get_bundle(db, mseed["ws"], bid), body="고친 문구", scheduled_at=None, now=at)
        return "ok"

    results = {}
    event.listen(engine, "before_cursor_execute", listener)
    try:
        _run_threads(
            ("bot", lambda: results.update(
                bot=_outcome(lambda db: len(svc.claim_for_bot(db, datetime.now(timezone.utc))), Session))),
            ("pm", lambda: results.update(pm=_outcome(pm_act, Session))),
        )
    finally:
        event.remove(engine, "before_cursor_execute", listener)

    assert results == {"bot": 1, "pm": ErrorCode.REMINDER_NOT_EDITABLE}
    mdb.expire_all()
    sent = mdb.scalars(select(ThreadMessage)).all()
    assert [m.body for m in sent] == [mdb.get(ReminderBundle, bid).body]
