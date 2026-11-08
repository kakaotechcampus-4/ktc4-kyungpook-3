"""범위 변경 답장 카드를 승인하면 남는 범위 이력이 답장의 scope 줄에 이어진다."""
from app.models import TaskHistory
# ruff: noqa: F401, F811
from tests.api.test_messages_api import P, client
from tests.api.test_reply_judgment import (
    AT,
    _cards,
    _change,
    _claim,
    _judge,
    _lines,
    _resolve,
    two,
)
from tests.api.test_replies import _reply


def _scope_history(db, task):
    db.expire_all()
    return db.query(TaskHistory).filter(TaskHistory.task_id == task.task_id, TaskHistory.changed_field == "scope").all()


def _scope_card(db, seed, a, *extra):
    _reply(db, seed, AT)
    item = _claim()
    _judge(item, *extra, _change(a, "scope", claimed=item))
    [card] = _cards(db)
    return item, card


def test_scope_reply_card_approval_links_history(mdb, mseed, two):
    a, _ = two
    item, card = _scope_card(mdb, mseed, a)
    _resolve(card)

    [entry] = _scope_history(mdb, a)
    line = _lines(mdb, item)[(a.task_id, "scope")]
    assert entry.change_source == "reminder_reply"
    assert entry.new_value == "AI 해석"
    assert entry.reply_change_id == line.change_id


def test_scope_reply_timeline_shows_sentence_once(mdb, mseed, two):
    a, _ = two
    _, card = _scope_card(mdb, mseed, a)
    _resolve(card)

    items = client("pm").get(f"{P}/tasks/{a.task_id}/timeline").json()["data"]["items"]
    [reply] = [i for i in items if i["kind"] == "reply"]
    [change] = [c for c in reply["changes"] if c["field"] == "scope"]
    assert (change["new_value"], change["result"]) == ("AI 해석", "approved")
    assert [i for i in items if i["kind"] == "history" and i["changed_field"] == "scope"] == []


def test_mixed_status_scope_reply_card_links_each(mdb, mseed, two):
    a, _ = two
    _reply(mdb, mseed, AT)
    item = _claim()
    _judge(item, _change(a, "status", "done", evidence="inferred", claimed=item), _change(a, "scope", claimed=item))
    [card] = _cards(mdb)
    _resolve(card)

    mdb.expire_all()
    lines = _lines(mdb, item)
    [status] = mdb.query(TaskHistory).filter(TaskHistory.task_id == a.task_id, TaskHistory.changed_field == "status").all()
    [scope] = _scope_history(mdb, a)
    assert status.reply_change_id == lines[(a.task_id, "status")].change_id
    assert scope.reply_change_id == lines[(a.task_id, "scope")].change_id
