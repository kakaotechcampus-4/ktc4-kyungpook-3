"""TaskResponse.auto_blocked. 태스크를 돌려주는 모든 경로에 실리고, 목록도 리마인드 감시를 한 번만 읽는다."""
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.main import app
from app.models import Integration, NotionSyncJob
from tests.api.test_scheduler import (
    H,
    SLOT,
    PROPOSE,
    _approve_all,
    _assign,
    _send,
    _undo,
    tick,
)


def _client(who):
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", f"{who}-token")
    return c


def _silence_blocked_all(db, seed, count):
    tasks = [_assign(db, seed, i) for i in range(count)]
    tick(db, PROPOSE)
    _approve_all(db, PROPOSE)
    _send(db, SLOT)
    tick(db, SLOT + 72 * H)
    assert all(t.status == "blocked" for t in tasks)
    return tasks


def _notion_failed(db, seed, task):
    db.add(Integration(
        workspace_id=seed["ws"], provider="notion", access_token="secret", provider_channel_id="db_1",
    ))
    db.add(NotionSyncJob(task_id=task.task_id, task_version=task.version, status="failed", attempts=5))
    db.commit()


def test_every_task_response_path_has_auto_blocked(mdb, mseed):
    pm = _client("pm")
    wid = mseed["ws"]

    created = pm.post("/api/v1/tasks", json={"workspace_id": wid, "title": "새 일"})
    assert created.status_code == 201, created.text
    task_id = created.json()["data"]["task_id"]
    paths = {"create": created.json()["data"]}

    listed = pm.get("/api/v1/tasks", params={"workspace_id": wid})
    assert listed.status_code == 200, listed.text
    assert listed.json()["data"]["items"]
    for item in listed.json()["data"]["items"]:
        assert item["auto_blocked"] is False

    paths["get"] = pm.get(f"/api/v1/tasks/{task_id}").json()["data"]
    patched = pm.patch(f"/api/v1/tasks/{task_id}", json={"title": "바뀐 일"})
    assert patched.status_code == 200, patched.text
    paths["patch"] = patched.json()["data"]

    history = pm.get(f"/api/v1/tasks/{task_id}/history").json()["data"]["items"]
    title_change = next(h for h in history if h["changed_field"] == "title")
    rolled = pm.post(f"/api/v1/tasks/{task_id}/history/{title_change['history_id']}/rollback")
    assert rolled.status_code == 200, rolled.text
    paths["rollback"] = rolled.json()["data"]

    task = mseed["tasks"][0]
    _notion_failed(mdb, mseed, task)
    retried = pm.post(f"/api/v1/tasks/{task.task_id}/notion-sync/retry")
    assert retried.status_code == 200, retried.text
    paths["notion_retry"] = retried.json()["data"]

    for name, data in paths.items():
        assert data["auto_blocked"] is False, name


def test_auto_blocked_true_on_detail_and_list_then_false_after_undo(mdb, mseed):
    task = _silence_blocked_all(mdb, mseed, 1)[0]
    other = mseed["tasks"][1]

    for who in ("pm", "alice"):
        c = _client(who)
        detail = c.get(f"/api/v1/tasks/{task.task_id}").json()["data"]
        assert detail["auto_blocked"] is True, who
        items = c.get("/api/v1/tasks", params={"workspace_id": mseed["ws"]}).json()["data"]["items"]
        flags = {i["task_id"]: i["auto_blocked"] for i in items}
        assert flags[task.task_id] is True, who
        assert flags[other.task_id] is False, who

    undone = _undo("pm", task.task_id)
    assert undone.status_code == 200, undone.text
    assert undone.json()["data"]["auto_blocked"] is False
    assert _client("alice").get(f"/api/v1/tasks/{task.task_id}").json()["data"]["auto_blocked"] is False


def test_list_reads_reminder_watch_at_most_once(mdb, mseed):
    _silence_blocked_all(mdb, mseed, 2)
    url, params = "/api/v1/tasks", {"workspace_id": mseed["ws"]}
    queries = []
    engine = mdb.get_bind()

    def count(conn, cursor, statement, *args):
        if "reminder_watch" in statement:
            queries.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        r = _client("pm").get(url, params=params)
        assert [i["auto_blocked"] for i in r.json()["data"]["items"]].count(True) == 2
        assert len(queries) == 1

        for t in mseed["tasks"]:
            t.status = "todo"
        mdb.commit()
        queries.clear()
        r = _client("pm").get(url, params=params)
        assert r.status_code == 200
        assert queries == []
    finally:
        event.remove(engine, "before_cursor_execute", count)
