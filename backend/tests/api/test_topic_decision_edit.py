"""주제와 결정 고치기 경로(#605). 권한, 워크스페이스 경계, 고친 것이 재요약 뒤에도 화면이 읽는 길에 남는지를 본다."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import Decision, ExtractionItem, Task, Topic, Workspace
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


def _decision_id(db, text):
    return db.scalar(select(Decision.decision_id).where(Decision.text == text))


def test_edits_need_a_session_and_membership(mdb, mseed):
    decision = ("PATCH", f"{P}/{mseed['ws']}/decisions/dc", {"state": "invalid"})
    for method, url, body in [*_routes(mseed["ws"], "tp", "tk"), decision]:
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


@pytest.mark.parametrize("target_shows_it", [True, False])
def test_merge_keeps_a_task_the_target_showed_and_hides_one_detached_from_the_merged_topic(
    client, mdb, mseed, target_shows_it,
):
    ws = mseed["ws"]
    task = Task(workspace_id=ws, title="도커 이미지", status="todo")
    mdb.add(task)
    meeting = _meeting(mdb, ws)
    extraction = _extraction(mdb, meeting, summary_requested_at=T0)
    item = ExtractionItem(extraction_id=extraction.extraction_id, task_title=task.title, task_id=task.task_id)
    mdb.add(item)
    mdb.commit()
    _save(mdb, meeting, [
        {"name": "회의록", "item_ids": [item.item_id]},
        {"name": "배포", "item_ids": [item.item_id] if target_shows_it else []},
    ], extraction=extraction)
    ids = _topic_ids(mdb, ws)
    client.delete(f"{P}/{ws}/topics/{ids['회의록']}/tasks/{task.task_id}")

    r = client.post(f"{P}/{ws}/topics/{ids['회의록']}/merge", json={"into_topic_id": ids["배포"]})

    shown = [task.task_id] if target_shows_it else []
    assert [t["task_id"] for t in r.json()["data"]["tasks"]] == shown
    assert _edges(client, ws) == {(ids["배포"], task_id) for task_id in shown}


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


def _decided(db, ws, *texts, title="인증 설계"):
    meeting = _meeting(db, ws, title=title)
    _save(db, meeting, [{"name": "초대", "decisions": [{"text": text} for text in texts]}])
    return meeting


def test_decision_edit_returns_the_marked_decision(client, mdb, mseed):
    ws = mseed["ws"]
    meeting = _decided(mdb, ws, "이메일로만")
    decision_id = _decision_id(mdb, "이메일로만")

    r = client.patch(f"{P}/{ws}/decisions/{decision_id}", json={"text": "이메일 초대만", "state": "invalid"})

    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert {k: data[k] for k in ("decision_id", "text", "meeting_id", "meeting_title", "state", "edited")} == {
        "decision_id": decision_id, "text": "이메일 초대만", "meeting_id": meeting.meeting_id,
        "meeting_title": "인증 설계", "state": "invalid", "edited": True,
    }


def test_decision_of_another_workspace_unknown_or_of_a_deleted_meeting_is_404(client, mdb, mseed):
    ws = mseed["ws"]
    other = Workspace(name="B")
    mdb.add(other)
    mdb.flush()
    _decided(mdb, other.workspace_id, "남의 결정")
    deleted = _decided(mdb, ws, "지운 회의 결정")
    deleted.deleted_at = datetime.now(timezone.utc)
    mdb.commit()

    for decision_id in (_decision_id(mdb, "남의 결정"), _decision_id(mdb, "지운 회의 결정"), "nope"):
        r = client.patch(f"{P}/{ws}/decisions/{decision_id}", json={"state": "removed"})
        assert _error(r) == (404, "DECISION_NOT_FOUND"), decision_id


@pytest.mark.parametrize("body", [{}, {"state": "gone"}, {"text": ""}, {"text": "가" * 1001}])
def test_decision_edit_without_a_change_or_outside_the_limits_is_400(client, mdb, mseed, body):
    ws = mseed["ws"]
    _decided(mdb, ws, "이메일로만")

    r = client.patch(f"{P}/{ws}/decisions/{_decision_id(mdb, '이메일로만')}", json=body)

    assert _error(r) == (400, "INVALID_REQUEST")


def test_topic_detail_drops_removed_decisions_and_bundle_lists_only_valid_ones(client, mdb, mseed):
    ws = mseed["ws"]
    _decided(mdb, ws, "남는 결정", "틀린 결정", "지운 결정")
    client.patch(f"{P}/{ws}/decisions/{_decision_id(mdb, '틀린 결정')}", json={"state": "invalid"})
    client.patch(f"{P}/{ws}/decisions/{_decision_id(mdb, '지운 결정')}", json={"state": "removed"})

    detail = _detail(client, ws, _topic_ids(mdb, ws)["초대"])
    head = _bundle(client, ws).split("## 막힌 일")[0].split("## 지금 유효한 결정")[1]

    assert [(d["text"], d["state"], d["edited"]) for d in detail["decisions"]] == [
        ("남는 결정", "valid", False), ("틀린 결정", "invalid", True),
    ]
    assert "남는 결정" in head
    assert "틀린 결정" not in head and "지운 결정" not in head


def _replacing(client, mdb, ws):
    """앞 회의의 결정을 뒤집은 결정과 유효하지 않은 결정, 지운 결정이 있는 회의."""
    old = _meeting(mdb, ws, started_at=T0 - timedelta(days=9), title="범위 재조정")
    _save(mdb, old, [{"name": "초대", "decisions": [{"text": "코드로 합류"}]}])
    meeting = _meeting(mdb, ws, title="인증 설계")
    _save(mdb, meeting, [{"name": "초대", "decisions": [
        {"text": "이메일로만", "reason": "유출", "rejected": ["코드"], "replaces": [_decision_id(mdb, "코드로 합류")]},
        {"text": "틀린 결정"}, {"text": "지운 결정"},
    ]}])
    for text, body in (("이메일로만", {"text": "이메일 초대만"}), ("틀린 결정", {"state": "invalid"}),
                       ("지운 결정", {"state": "removed"})):
        assert client.patch(f"{P}/{ws}/decisions/{_decision_id(mdb, text)}", json=body).status_code == 200
    return old, meeting


def _shown(client, meeting):
    summary = client.get(f"/api/v1/meetings/{meeting.meeting_id}/minutes").json()["data"]["summary"]
    return summary, client.get(f"/api/v1/meetings/{meeting.meeting_id}/summary.md").text


def test_minutes_and_summary_show_edited_decisions_renamed_topic_and_live_titles(client, mdb, mseed):
    ws = mseed["ws"]
    old, meeting = _replacing(client, mdb, ws)
    client.patch(f"{P}/{ws}/topics/{_topic_ids(mdb, ws)['초대']}", json={"name": "합류 방식"})
    client.patch(f"/api/v1/meetings/{old.meeting_id}/title", json={"title": "범위 다시 잡기"})

    summary, markdown = _shown(client, meeting)

    assert summary["decisions"] == ["이메일 초대만"]
    assert [(d["text"], d["state"], d["edited"], d["topic"]) for d in summary["decision_details"]] == [
        ("이메일 초대만", "valid", True, "합류 방식"), ("틀린 결정", "invalid", True, "합류 방식"),
    ]
    first = summary["decision_details"][0]
    assert (first["reason"], first["rejected"]) == ("유출", ["코드"])
    assert [(c["text"], c["meeting_title"]) for c in first["replaces"]] == [("코드로 합류", "범위 다시 잡기")]
    assert summary["topics"] == ["합류 방식"]
    assert "- 이메일 초대만\n" in markdown and "- 틀린 결정 (유효하지 않음)\n" in markdown
    assert "지운 결정" not in markdown
    assert '주제: ["합류 방식"]' in markdown and "범위 다시 잡기" in markdown


def test_copy_of_a_removed_old_decision_is_hidden(client, mdb, mseed):
    ws = mseed["ws"]
    _, meeting = _replacing(client, mdb, ws)

    client.patch(f"{P}/{ws}/decisions/{_decision_id(mdb, '코드로 합류')}", json={"state": "removed"})

    summary, markdown = _shown(client, meeting)
    assert summary["decision_details"][0]["replaces"] == []
    assert "코드로 합류" not in markdown
