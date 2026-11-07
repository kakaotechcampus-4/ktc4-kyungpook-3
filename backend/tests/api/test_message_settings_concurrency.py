"""두 PM 요청이 같은 워크스페이스의 첫 설정 행을 동시에 만들 때. 두 커넥션이 필요해 PostgreSQL 에서만 돈다."""
import threading
from datetime import datetime, timezone

import pytest
from sqlalchemy import event
from sqlalchemy.orm import sessionmaker

from app.models import WorkspaceMessageSettings
from app.services import message_settings as svc

NOW = datetime(2026, 11, 4, 0, 0, tzinfo=timezone.utc)


def _postgres_only(mdb):
    if mdb.get_bind().dialect.name != "postgresql":
        pytest.skip("두 커넥션의 첫 행 경합은 PostgreSQL 에서만 확인한다")


def test_first_patch_race_applies_both_changes(mdb, mseed):
    _postgres_only(mdb)
    engine = mdb.get_bind()
    Session = sessionmaker(bind=engine, autoflush=False)
    wid, pm = mseed["ws"], mseed["pm"].member_id
    both_saw_no_row = threading.Barrier(2, timeout=5)
    unique_violations = []
    seen = []

    def on_error(ctx):
        if "duplicate key" in str(ctx.original_exception):
            unique_violations.append(threading.current_thread().name)

    def patch(changes):
        def run():
            db = Session()
            real_get = db.get

            def get_then_wait(entity, ident, *a, **kw):
                found = real_get(entity, ident, *a, **kw)
                if entity is WorkspaceMessageSettings:
                    seen.append(found)
                    # 두 요청이 모두 "행 없음"을 본 뒤에 만들게 한다.
                    both_saw_no_row.wait()
                return found

            db.get = get_then_wait
            try:
                svc.update_settings(db, wid, changes, updated_by=pm, now=NOW)
                db.commit()
                results[threading.current_thread().name] = "ok"
            except Exception as e:  # noqa: BLE001
                db.rollback()
                results[threading.current_thread().name] = f"{type(e).__name__}: {str(e).splitlines()[0]}"
            finally:
                db.close()
        return run

    results = {}
    event.listen(engine, "handle_error", on_error)
    try:
        threads = [
            threading.Thread(target=patch({"due_reminder": False}), name="a"),
            threading.Thread(target=patch({"silence_alert": False}), name="b"),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(20)
        assert not any(t.is_alive() for t in threads), "threads did not finish"
    finally:
        event.remove(engine, "handle_error", on_error)

    assert seen == [None, None]
    assert results == {"a": "ok", "b": "ok"}
    assert len(unique_violations) == 1
    mdb.expire_all()
    row = mdb.get(WorkspaceMessageSettings, wid)
    assert row.due_reminder is False
    assert row.silence_alert is False
    assert row.minutes_summary is True
    assert row.updated_by == pm
