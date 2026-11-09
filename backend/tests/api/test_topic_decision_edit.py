"""주제와 결정 고치기 경로(#605). 권한, 워크스페이스 경계, 고친 것이 재요약 뒤에도 화면이 읽는 길에 남는지를 본다."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import ExtractionItem, Task, Topic, Workspace
from app.services import embedding
from tests.api.test_project_map import T0, _extraction, _meeting, _save

P = "/api/v1/workspaces"


def _client(token: str | None = None) -> TestClient:
    client = TestClient(app, base_url="https://testserver")
    if token:
        client.cookies.set("session_token", token)
    return client


@pytest.fixture
def client(mdb, monkeypatch):
    """PM 이 아닌 팀원도 고친다."""
    if mdb.get_bind().dialect.name != "postgresql":
        monkeypatch.setattr(embedding, "related_task_pairs", lambda *a, **k: [])
    return _client("alice-token")


def _topic_ids(db, ws) -> dict[str, str]:
    return {name: topic_id for topic_id, name in db.execute(select(Topic.topic_id, Topic.name).where(Topic.workspace_id == ws))}


def _linked(db, ws, *, name="배포"):
    """반영된 태스크 하나가 주제 하나에 이어진 회의."""
    task = Task(workspace_id=ws, title="도커 이미지", status="todo")
    db.add(task)
    meeting = _meeting(db, ws)
    extraction = _extraction(db, meeting, summary_requested_at=T0)
    item = ExtractionItem(extraction_id=extraction.extraction_id, task_title=task.title, task_id=task.task_id)
    db.add(item)
    db.commit()
    _save(db, meeting, [{"name": name, "item_ids": [item.item_id]}], extraction=extraction)
    return meeting, extraction, item, task, _topic_ids(db, ws)[name]


def _other_workspace(db):
    other = Workspace(name="B")
    db.add(other)
    db.flush()
    _save(db, _meeting(db, other.workspace_id), [{"name": "남의 주제"}])
    task = Task(workspace_id=other.workspace_id, title="남의 일", status="todo")
    db.add(task)
    db.commit()
    return _topic_ids(db, other.workspace_id)["남의 주제"], task.task_id


def _error(r):
    return r.status_code, r.json()["error"]["code"]


def _edges(client, ws):
    return {(e["source"], e["target"]) for e in client.get(f"{P}/{ws}/project-map").json()["data"]["edges"]}


def _detail(client, ws, topic_id):
    r = client.get(f"{P}/{ws}/topics/{topic_id}")
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _bundle(client, ws):
    return client.get(f"{P}/{ws}/project-bundle.md").text


def _routes(ws, topic_id, task_id):
    return [
        ("PATCH", f"{P}/{ws}/topics/{topic_id}", {"name": "새 이름"}),
        ("POST", f"{P}/{ws}/topics/{topic_id}/merge", {"into_topic_id": "other"}),
        ("DELETE", f"{P}/{ws}/topics/{topic_id}/tasks/{task_id}", None),
    ]


def test_edits_need_a_session_and_membership(mdb, mseed):
    for method, url, body in _routes(mseed["ws"], "tp", "tk"):
        assert _client().request(method, url, json=body).status_code == 401, url
        assert _client("outsider-token").request(method, url, json=body).status_code == 403, url


def test_topic_of_another_workspace_is_404_for_every_edit(client, mdb, mseed):
    foreign_topic, _ = _other_workspace(mdb)
    task_id = mseed["tasks"][0].task_id

    for method, url, body in _routes(mseed["ws"], foreign_topic, task_id):
        assert _error(client.request(method, url, json=body)) == (404, "TOPIC_NOT_FOUND"), url


def test_rename_returns_the_marked_detail(client, mdb, mseed):
    ws = mseed["ws"]
    _, _, _, task, topic_id = _linked(mdb, ws)

    r = client.patch(f"{P}/{ws}/topics/{topic_id}", json={"name": " 인프라 배포 ", "description": "도커와 배포"})

    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert (data["topic_id"], data["name"], data["description"], data["edited"]) == (
        topic_id, "인프라 배포", "도커와 배포", True,
    )
    assert [t["task_id"] for t in data["tasks"]] == [task.task_id]


def test_rename_to_the_name_of_another_topic_is_409_with_its_id(client, mdb, mseed):
    ws = mseed["ws"]
    _save(mdb, _meeting(mdb, ws), [{"name": "배포"}, {"name": "인프라"}])
    ids = _topic_ids(mdb, ws)

    r = client.patch(f"{P}/{ws}/topics/{ids['배포']}", json={"name": "인 프 라"})

    assert _error(r) == (409, "TOPIC_NAME_TAKEN")
    assert r.json()["error"]["details"] == {"topic_id": ids["인프라"]}


@pytest.mark.parametrize("body", [{"name": "···"}, {}, {"name": "가" * 101}, {"description": "가" * 1001}])
def test_rename_without_letters_fields_or_within_limits_is_400(client, mdb, mseed, body):
    ws = mseed["ws"]
    _, _, _, _, topic_id = _linked(mdb, ws)

    assert _error(client.patch(f"{P}/{ws}/topics/{topic_id}", json=body)) == (400, "INVALID_REQUEST")


def test_merge_into_itself_is_400(client, mdb, mseed):
    ws = mseed["ws"]
    _, _, _, _, topic_id = _linked(mdb, ws)

    r = client.post(f"{P}/{ws}/topics/{topic_id}/merge", json={"into_topic_id": topic_id})

    assert _error(r) == (400, "INVALID_REQUEST")


def test_merge_into_a_topic_of_another_workspace_is_404(client, mdb, mseed):
    ws = mseed["ws"]
    _, _, _, _, topic_id = _linked(mdb, ws)
    foreign_topic, _ = _other_workspace(mdb)

    r = client.post(f"{P}/{ws}/topics/{topic_id}/merge", json={"into_topic_id": foreign_topic})

    assert _error(r) == (404, "TOPIC_NOT_FOUND")


def test_merge_moves_meetings_tasks_and_decisions_into_the_target(client, mdb, mseed):
    ws = mseed["ws"]
    task = mseed["tasks"][0]
    meeting = _meeting(mdb, ws)
    extraction = _extraction(mdb, meeting, summary_requested_at=T0)
    item = ExtractionItem(extraction_id=extraction.extraction_id, task_title="t", task_id=task.task_id)
    mdb.add(item)
    mdb.commit()
    # 두 주제가 같은 회의와 같은 항목에 걸려 있어 옮길 때 겹친다
    _save(mdb, meeting, [
        {"name": "배포", "item_ids": [item.item_id], "decisions": [{"text": "도커로 간다"}]},
        {"name": "인프라", "item_ids": [item.item_id]},
    ], extraction=extraction)
    ids = _topic_ids(mdb, ws)

    r = client.post(f"{P}/{ws}/topics/{ids['배포']}/merge", json={"into_topic_id": ids["인프라"]})

    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert (data["topic_id"], data["name"], data["edited"]) == (ids["인프라"], "인프라", True)
    assert [d["text"] for d in data["decisions"]] == ["도커로 간다"]
    assert [t["task_id"] for t in data["tasks"]] == [task.task_id]
    assert [m["meeting_id"] for m in data["meetings"]] == [meeting.meeting_id]
    assert set(_topic_ids(mdb, ws)) == {"인프라"}
    assert _edges(client, ws) == {(ids["인프라"], task.task_id)}


def test_detach_hides_the_task_from_graph_detail_and_bundle_and_is_idempotent(client, mdb, mseed):
    ws = mseed["ws"]
    _, _, _, task, topic_id = _linked(mdb, ws)
    assert _edges(client, ws) == {(topic_id, task.task_id)}

    first = client.delete(f"{P}/{ws}/topics/{topic_id}/tasks/{task.task_id}")
    again = client.delete(f"{P}/{ws}/topics/{topic_id}/tasks/{task.task_id}")

    assert first.status_code == again.status_code == 200
    assert first.json()["data"] == again.json()["data"] == {
        "topic_id": topic_id, "task_id": task.task_id, "detached": True,
    }
    _assert_hidden(client, ws, topic_id, task)


def _assert_hidden(client, ws, topic_id, task):
    assert (topic_id, task.task_id) not in _edges(client, ws)
    assert _detail(client, ws, topic_id)["tasks"] == []
    bundle = _bundle(client, ws)
    assert "### 배포\n- 도커 이미지" not in bundle
    assert "- 도커 이미지 (todo)" in bundle.split("### 주제 없음\n")[1].split("\n\n")[0]


def test_detach_of_a_task_of_another_workspace_is_404(client, mdb, mseed):
    ws = mseed["ws"]
    _, _, _, _, topic_id = _linked(mdb, ws)
    _, foreign_task = _other_workspace(mdb)

    assert _error(client.delete(f"{P}/{ws}/topics/{topic_id}/tasks/{foreign_task}")) == (404, "TASK_NOT_FOUND")


def test_detached_task_stays_hidden_after_resummaries(client, mdb, mseed):
    ws = mseed["ws"]
    meeting, extraction, item, task, topic_id = _linked(mdb, ws)
    client.delete(f"{P}/{ws}/topics/{topic_id}/tasks/{task.task_id}")

    _save(mdb, meeting, [{"name": "배포", "item_ids": [item.item_id]}], extraction=extraction)
    _assert_hidden(client, ws, topic_id, task)
    # 주제를 뺀 재요약 뒤 다시 낸 재요약도 같은 주제에 붙고 뗀 표시가 남는다
    _save(mdb, meeting, [{"name": "다른 주제"}], extraction=extraction)
    _save(mdb, meeting, [{"name": "배포", "item_ids": [item.item_id]}], extraction=extraction)

    assert _topic_ids(mdb, ws)["배포"] == topic_id
    _assert_hidden(client, ws, topic_id, task)
