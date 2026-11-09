"""프로젝트 맵 읽기. 주제와 태스크의 연결, 그래프, 주제 상세, 요약본과 합본 내려받기, 회의록의 summary_status."""
import json
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import (
    Decision,
    Extraction,
    ExtractionItem,
    Meeting,
    Member,
    MemberAlias,
    Source,
    Task,
    Topic,
    Workspace,
)
from app.schemas.project_map import SummaryWriteRequest
from app.services import embedding, project_map, summary
from tests.api.conftest import SERVICE_TOKEN

H = {"X-Service-Token": SERVICE_TOKEN}
T0 = datetime(2026, 11, 5, 5, 0, tzinfo=timezone.utc)


@pytest.fixture
def client(mdb, monkeypatch):
    if mdb.get_bind().dialect.name != "postgresql":
        monkeypatch.setattr(embedding, "related_task_pairs", lambda *a, **k: [])
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c


@pytest.fixture
def stranger(mdb):
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "outsider-token")
    return c


def _meeting(db, ws, *, started_at=T0, title="정기회의", status="done", source="discord"):
    meeting = Meeting(workspace_id=ws, source=source, status=status, started_at=started_at, title=title)
    db.add(meeting)
    db.flush()
    db.add(Source(meeting_id=meeting.meeting_id, seq=0, start_ms=0, end_ms=900, text="안녕하세요"))
    db.commit()
    return meeting


def _extraction(db, meeting, **fields):
    row = Extraction(meeting_id=meeting.meeting_id, **fields)
    db.add(row)
    db.commit()
    return row


def _save(db, meeting, topics=(), *, extraction=None, **fields):
    row = extraction or _extraction(db, meeting, summary_requested_at=T0)
    body = {"model_name": "m", "overview": "핵심", "key_points": ["하나"], "topics": list(topics), **fields}
    claim = summary.claim_next(db, only=[row.extraction_id])
    body["claim_token"] = claim.claim_token
    summary.save_summary(db, row.extraction_id, SummaryWriteRequest(**body))
    db.commit()
    return row


def _extract(client, meeting, items):
    r = client.post("/api/v1/extractions", json={
        "meeting_id": meeting.meeting_id, "workspace_id": meeting.workspace_id, "items": items,
    }, headers=H)
    assert r.status_code == 201, r.text
    return r.json()["data"]["extraction_id"]


def _resolve(client, approval_id, status):
    r = client.patch(f"/api/v1/approvals/{approval_id}", json={"status": status})
    assert r.status_code == 200, r.text


def _links(db, ws):
    return db.execute(project_map._visible_links(ws)).all()


class LinkCase:
    """회의 하나의 추출 항목 하나에 주제를 달고, 승인 코드가 실제로 쓴 값으로 연결을 읽는다."""

    def __init__(self, client, db, seed, raw_item):
        self.client, self.db, self.ws = client, db, seed["ws"]
        self.meeting = _meeting(db, self.ws, status="processing")
        self.extraction_id = _extract(client, self.meeting, [raw_item])
        db.expire_all()
        self.item = db.scalars(select(ExtractionItem).where(ExtractionItem.extraction_id == self.extraction_id)).one()
        _save(db, self.meeting, [{"name": "주제", "item_ids": [self.item.item_id]}],
              extraction=db.get(Extraction, self.extraction_id))

    def refresh(self):
        self.db.expire_all()
        return self.db.get(ExtractionItem, self.item.item_id)

    def resolve(self, status):
        _resolve(self.client, self.refresh().approval_id, status)

    def revert(self):
        r = self.client.post(f"/api/v1/extractions/{self.extraction_id}/items/{self.item.item_id}/revert")
        assert r.status_code == 200, r.text

    def linked_task_ids(self):
        self.db.expire_all()
        return [row.task_id for row in _links(self.db, self.ws)]


def _create_auto(db, seed):
    db.add(MemberAlias(member_id=seed["alice"].member_id, workspace_id=seed["ws"], alias_text="앨리스님",
                       alias_type="nickname", source="manual", confidence=1.0, verified=True))
    db.commit()
    return {"task_title": "자동 태스크", "task_confidence": 0.99, "assignee_raw": "앨리스님", "assignee_type": "thirdname"}


def _create_review():
    return {"task_title": "검토 태스크", "task_confidence": 0.6, "due_confidence": 0.0}


def _update_value(seed):
    return {"action": "update", "target_task_id": seed["tasks"][0].task_id, "due_date": "2026-12-01"}


def _update_same(seed):
    return {"action": "update", "target_task_id": seed["tasks"][0].task_id}


def test_row_1_auto_created_item_is_visible(client, mdb, mseed):
    case = LinkCase(client, mdb, mseed, _create_auto(mdb, mseed))

    item = case.refresh()
    assert (item.gate, item.approval_id) == ("auto", None)
    assert case.linked_task_ids() == [item.task_id]


def test_row_2_pending_create_has_no_task_yet(client, mdb, mseed):
    case = LinkCase(client, mdb, mseed, _create_review())

    item = case.refresh()
    assert item.task_id is None and item.approval_id is not None
    assert case.linked_task_ids() == []


def test_row_3_approved_create_links_the_new_task(client, mdb, mseed):
    case = LinkCase(client, mdb, mseed, _create_review())

    case.resolve("approved")

    assert case.linked_task_ids() == [case.refresh().task_id]
    assert case.refresh().task_id is not None


def test_row_4_rejected_create_stays_unlinked(client, mdb, mseed):
    case = LinkCase(client, mdb, mseed, _create_review())

    case.resolve("rejected")

    assert case.refresh().task_id is None
    assert case.linked_task_ids() == []


def test_row_5_pending_update_links_at_once(client, mdb, mseed):
    case = LinkCase(client, mdb, mseed, _update_value(mseed))

    assert case.refresh().approval_id is not None
    assert case.linked_task_ids() == [mseed["tasks"][0].task_id]


def test_row_6_approved_update_stays_linked(client, mdb, mseed):
    case = LinkCase(client, mdb, mseed, _update_value(mseed))

    case.resolve("approved")

    assert case.linked_task_ids() == [mseed["tasks"][0].task_id]


def test_row_7_rejected_update_is_hidden_though_task_id_remains(client, mdb, mseed):
    case = LinkCase(client, mdb, mseed, _update_value(mseed))

    case.resolve("rejected")

    assert case.refresh().task_id == mseed["tasks"][0].task_id
    assert case.linked_task_ids() == []


def test_row_8_update_without_change_links_without_approval(client, mdb, mseed):
    case = LinkCase(client, mdb, mseed, _update_same(mseed))

    assert case.refresh().approval_id is None
    assert case.linked_task_ids() == [mseed["tasks"][0].task_id]


def test_row_9_reverted_auto_item_is_unlinked_while_waiting(client, mdb, mseed):
    case = LinkCase(client, mdb, mseed, _create_auto(mdb, mseed))

    case.revert()

    item = case.refresh()
    assert item.task_id is None and item.reverted_at is not None
    assert case.linked_task_ids() == []


def test_row_10_reverted_then_approved_links_the_new_task(client, mdb, mseed):
    case = LinkCase(client, mdb, mseed, _create_auto(mdb, mseed))
    first_task = case.refresh().task_id
    case.revert()

    case.resolve("approved")

    item = case.refresh()
    assert item.task_id not in (None, first_task)
    assert case.linked_task_ids() == [item.task_id]


def test_row_11_reverted_then_rejected_stays_unlinked(client, mdb, mseed):
    case = LinkCase(client, mdb, mseed, _create_auto(mdb, mseed))
    case.revert()

    case.resolve("rejected")

    assert case.linked_task_ids() == []


def test_links_stay_inside_the_workspace_and_skip_deleted_tasks(client, mdb, mseed):
    case = LinkCase(client, mdb, mseed, _create_auto(mdb, mseed))
    other = Workspace(name="B")
    mdb.add(other)
    mdb.commit()

    assert _links(mdb, other.workspace_id) == []
    task = mdb.get(Task, case.refresh().task_id)
    task.is_deleted = True
    mdb.commit()
    assert _links(mdb, mseed["ws"]) == []


def _graph(client, ws):
    r = client.get(f"/api/v1/workspaces/{ws}/project-map")
    assert r.status_code == 200, r.text
    return r.json()["data"]


def test_graph_has_topic_and_task_nodes_and_plain_edges(client, mdb, mseed, monkeypatch):
    ws = mseed["ws"]
    task_a, task_b, loose = mseed["tasks"]
    task_a.assignee_member_id = mseed["alice"].member_id
    task_a.due_date = date(2026, 11, 14)
    task_a.status, task_a.blocker = "blocked", "키가 없다"
    meeting = _meeting(mdb, ws, title="인증 설계")
    extraction = _extraction(mdb, meeting, summary_requested_at=T0)
    item = ExtractionItem(extraction_id=extraction.extraction_id, task_title="t", task_id=task_a.task_id)
    mdb.add(item)
    mdb.commit()
    _save(mdb, meeting, [{"name": "로그인", "item_ids": [item.item_id]}], extraction=extraction)
    monkeypatch.setattr(embedding, "related_task_pairs", lambda db, wid, *, k, min_similarity: [
        (min(task_a.task_id, task_b.task_id), max(task_a.task_id, task_b.task_id)),
    ])

    data = _graph(client, ws)

    topic = next(n for n in data["nodes"] if n["kind"] == "topic")
    assert topic["label"] == "로그인"
    assert topic["appeared_at"].startswith("2026-11-05T05:00:00")
    assert set(topic) == {"id", "kind", "label", "appeared_at"}
    node = next(n for n in data["nodes"] if n["id"] == task_a.task_id)
    assert (node["kind"], node["label"], node["status"], node["due_date"], node["assignee_name"], node["blocker"]) == (
        "task", task_a.title, "blocked", "2026-11-14", "앨리스", "키가 없다",
    )
    assert node["meeting_ids"] == [meeting.meeting_id]
    assert [m["meeting_id"] for m in data["meetings"]] == [meeting.meeting_id]
    assert data["meetings"][0]["title"] == "인증 설계"
    assert {tuple(sorted(e)) for e in data["edges"]} == {("source", "target")}
    assert {(e["source"], e["target"]) for e in data["edges"]} == {
        (topic["id"], task_a.task_id),
        (min(task_a.task_id, task_b.task_id), max(task_a.task_id, task_b.task_id)),
    }


def test_graph_includes_tasks_without_topic_and_infers_nothing(client, mdb, mseed):
    data = _graph(client, mseed["ws"])

    assert {n["id"] for n in data["nodes"]} == {t.task_id for t in mseed["tasks"]}
    assert data["edges"] == []
    assert all(n["meeting_ids"] == [] for n in data["nodes"])


def test_graph_leaves_out_deleted_tasks_and_other_workspaces(client, mdb, mseed):
    other = Workspace(name="B")
    mdb.add(other)
    mdb.flush()
    mdb.add(Task(workspace_id=other.workspace_id, title="남의 일", status="todo"))
    mseed["tasks"][0].is_deleted = True
    mdb.commit()

    labels = {n["label"] for n in _graph(client, mseed["ws"])["nodes"]}

    assert labels == {mseed["tasks"][1].title, mseed["tasks"][2].title}


def test_graph_meeting_ids_include_the_meeting_that_created_the_task(client, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"], started_at=T0 - timedelta(days=3))
    task = mseed["tasks"][0]
    task.meeting_id = meeting.meeting_id
    mdb.commit()

    data = _graph(client, mseed["ws"])

    node = next(n for n in data["nodes"] if n["id"] == task.task_id)
    assert node["meeting_ids"] == [meeting.meeting_id]
    assert node["appeared_at"].startswith("2026-11-02T05:00:00")


def test_graph_appeared_at_is_creation_when_the_task_predates_its_meetings(client, mdb, mseed):
    task = mseed["tasks"][0]
    task.created_at = T0 - timedelta(days=30)
    meeting = _meeting(mdb, mseed["ws"])
    extraction = _extraction(mdb, meeting, summary_requested_at=T0)
    item = ExtractionItem(extraction_id=extraction.extraction_id, task_title="t", task_id=task.task_id)
    mdb.add(item)
    mdb.commit()
    _save(mdb, meeting, [{"name": "주제", "item_ids": [item.item_id]}], extraction=extraction)

    node = next(n for n in _graph(client, mseed["ws"])["nodes"] if n["id"] == task.task_id)

    assert node["appeared_at"].startswith("2026-10-06T05:00:00")


def test_graph_topic_shows_first_meeting_time(client, mdb, mseed):
    _save(mdb, _meeting(mdb, mseed["ws"], started_at=T0), [{"name": "주제"}])
    _save(mdb, _meeting(mdb, mseed["ws"], started_at=T0 - timedelta(days=7)), [{"name": "주제"}])

    topic = next(n for n in _graph(client, mseed["ws"])["nodes"] if n["kind"] == "topic")

    assert topic["appeared_at"].startswith("2026-10-29T05:00:00")


def test_graph_edge_is_listed_once_when_two_meetings_link_the_same_pair(client, mdb, mseed):
    task = mseed["tasks"][0]
    for offset in range(2):
        meeting = _meeting(mdb, mseed["ws"], started_at=T0 + timedelta(days=offset))
        extraction = _extraction(mdb, meeting, summary_requested_at=T0)
        item = ExtractionItem(extraction_id=extraction.extraction_id, task_title="t", task_id=task.task_id)
        mdb.add(item)
        mdb.commit()
        _save(mdb, meeting, [{"name": "주제", "item_ids": [item.item_id]}], extraction=extraction)

    assert len(_graph(client, mseed["ws"])["edges"]) == 1


def test_graph_never_points_at_a_missing_node(client, mdb, mseed, monkeypatch):
    monkeypatch.setattr(embedding, "related_task_pairs", lambda *a, **k: [("gone", mseed["tasks"][0].task_id)])

    assert _graph(client, mseed["ws"])["edges"] == []


def test_graph_requires_membership(client, stranger, mseed):
    assert stranger.get(f"/api/v1/workspaces/{mseed['ws']}/project-map").status_code == 403


def test_graph_requires_login(mdb, mseed):
    r = TestClient(app, base_url="https://testserver").get(f"/api/v1/workspaces/{mseed['ws']}/project-map")

    assert r.status_code == 401


def _topic_id(client, ws):
    return next(n["id"] for n in _graph(client, ws)["nodes"] if n["kind"] == "topic")


def test_topic_detail_has_decisions_tasks_and_meetings(client, mdb, mseed):
    ws = mseed["ws"]
    task = mseed["tasks"][0]
    task.assignee_member_id = mseed["alice"].member_id
    old_meeting = _meeting(mdb, ws, started_at=T0 - timedelta(days=9), title="범위 재조정")
    _save(mdb, old_meeting, [{"name": "초대", "description": "합류 방식", "decisions": [{"text": "코드로", "reason": "빠르다"}]}])
    meeting = _meeting(mdb, ws, title="인증 설계")
    extraction = _extraction(mdb, meeting, summary_requested_at=T0)
    item = ExtractionItem(extraction_id=extraction.extraction_id, task_title="t", task_id=task.task_id)
    mdb.add(item)
    mdb.commit()
    old_id = mdb.scalars(select(Decision.decision_id)).one()
    _save(mdb, meeting, [{"name": "초대", "item_ids": [item.item_id], "decisions": [{"text": "이메일로", "replaces": [old_id]}]}],
          extraction=extraction)

    r = client.get(f"/api/v1/workspaces/{ws}/topics/{_topic_id(client, ws)}")

    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert (data["name"], data["description"]) == ("초대", "합류 방식")
    assert [d["text"] for d in data["decisions"]] == ["코드로", "이메일로"]
    first, second = data["decisions"]
    assert (first["replaced_by"], first["reason"], first["meeting_title"]) == (second["decision_id"], "빠르다", "범위 재조정")
    assert first["decided_at"].startswith("2026-10-27T05:00:00")
    assert second["replaced_by"] is None
    assert data["tasks"] == [{
        "task_id": task.task_id, "title": task.title, "status": "todo", "due_date": None, "assignee_name": "앨리스",
    }]
    assert [m["title"] for m in data["meetings"]] == ["범위 재조정", "인증 설계"]


def test_topic_of_another_workspace_is_404(client, mdb, mseed):
    other = Workspace(name="B")
    mdb.add(other)
    mdb.flush()
    _save(mdb, _meeting(mdb, other.workspace_id), [{"name": "남의 주제"}])
    topic_id = mdb.scalars(select(Topic.topic_id)).one()

    r = client.get(f"/api/v1/workspaces/{mseed['ws']}/topics/{topic_id}")

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "TOPIC_NOT_FOUND"


def test_unknown_topic_is_404(client, mseed):
    assert client.get(f"/api/v1/workspaces/{mseed['ws']}/topics/nope").status_code == 404


def test_topic_requires_membership(stranger, mseed):
    assert stranger.get(f"/api/v1/workspaces/{mseed['ws']}/topics/nope").status_code == 403


def test_summary_markdown_download(client, mdb, mseed, monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", "https://app.example/")
    alice = mseed["alice"]
    meeting = _meeting(mdb, mseed["ws"], title="3주차: 정기회의")
    mdb.add(Source(meeting_id=meeting.meeting_id, seq=1, start_ms=1, end_ms=2, text="네", member_id=alice.member_id))
    mdb.commit()
    _save(mdb, meeting, [{"name": "리마인드"}], truncated_input=True)

    r = client.get(f"/api/v1/meetings/{meeting.meeting_id}/summary.md")

    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "text/markdown; charset=utf-8"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "private, no-store"
    name = quote("2026-11-05 3주차: 정기회의.md", safe="")
    assert r.headers["content-disposition"] == f"attachment; filename=\"summary.md\"; filename*=UTF-8''{name}"
    text = r.text
    assert '날짜: "2026-11-05"' in text
    assert '참석자: ["앨리스"]' in text
    assert f'원문: "https://app.example/workspaces/{mseed["ws"]}/meetings/{meeting.meeting_id}"' in text
    assert '주제: ["리마인드"]' in text
    assert "일부 생략" in text
    assert "## 핵심 요약" in text


def test_summary_markdown_date_is_the_workspace_date(client, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"], started_at=datetime(2026, 10, 31, 15, 30, tzinfo=timezone.utc))
    _save(mdb, meeting)

    r = client.get(f"/api/v1/meetings/{meeting.meeting_id}/summary.md")

    assert '날짜: "2026-11-01"' in r.text


def test_summary_markdown_with_no_title(client, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"], title=None)
    _save(mdb, meeting)

    r = client.get(f"/api/v1/meetings/{meeting.meeting_id}/summary.md")

    assert r.status_code == 200
    assert quote("2026-11-05 회의.md", safe="") in r.headers["content-disposition"]


def test_summary_markdown_filename_cannot_break_the_header(client, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"], title='a"b\r\nX-Evil: 1')
    _save(mdb, meeting)

    r = client.get(f"/api/v1/meetings/{meeting.meeting_id}/summary.md")

    assert r.status_code == 200
    assert "x-evil" not in r.headers


def test_summary_markdown_without_summary_is_404(client, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"])
    _extraction(mdb, meeting)

    r = client.get(f"/api/v1/meetings/{meeting.meeting_id}/summary.md")

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "SUMMARY_NOT_FOUND"


def test_summary_markdown_broken_document_is_404(client, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"])
    _extraction(mdb, meeting, summary="[1, 2]")

    assert client.get(f"/api/v1/meetings/{meeting.meeting_id}/summary.md").status_code == 404


def test_summary_markdown_unknown_meeting_is_404(client, mdb, mseed):
    r = client.get("/api/v1/meetings/nope/summary.md")

    assert r.json()["error"]["code"] == "MEETING_NOT_FOUND"


def test_summary_markdown_requires_membership(stranger, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"])
    _save(mdb, meeting)

    assert stranger.get(f"/api/v1/meetings/{meeting.meeting_id}/summary.md").status_code == 403


def _bundle(client, ws, **params):
    r = client.get(f"/api/v1/workspaces/{ws}/project-bundle.md", params=params)
    assert r.status_code == 200, r.text
    return r


def test_bundle_header_comes_from_the_database(client, mdb, mseed):
    ws = mseed["ws"]
    alice = mseed["alice"]
    mdb.add(MemberAlias(member_id=alice.member_id, workspace_id=ws, alias_text="앨리스님", alias_type="nickname",
                        source="manual", confidence=1.0, verified=False))
    gone = Member(workspace_id=ws, display_name="떠난 사람", role="member", is_deleted=True)
    mdb.add(gone)
    task, stuck, loose = mseed["tasks"]
    stuck.created_at, loose.created_at = T0, T0 + timedelta(seconds=1)
    stuck.status, stuck.blocker, stuck.assignee_member_id = "blocked", "키가 없다", alice.member_id
    deleted_stuck = Task(workspace_id=ws, title="지운 막힌 일", status="blocked", is_deleted=True)
    mdb.add(deleted_stuck)
    meeting = _meeting(mdb, ws)
    extraction = _extraction(mdb, meeting, summary_requested_at=T0)
    item = ExtractionItem(extraction_id=extraction.extraction_id, task_title="t", task_id=task.task_id)
    mdb.add(item)
    mdb.commit()
    _save(mdb, meeting, [{"name": "로그인", "description": "가입", "item_ids": [item.item_id],
                          "decisions": [{"text": "카카오 먼저"}]}], extraction=extraction)

    text = _bundle(client, ws).text

    assert "A 프로젝트 맥락" in text
    assert "기간: 전체" in text
    assert "- 앨리스 (팀원), 호칭: 앨리스님" in text
    assert "- PM (PM)" in text
    assert "떠난 사람" not in text
    assert f"### 로그인\n가입\n- {task.title} (todo)" in text
    assert f"### 주제 없음\n- {stuck.title} (blocked, 담당: 앨리스)\n- {loose.title} (todo)" in text
    assert "- 로그인: 카카오 먼저 (2026-11-05)" in text
    assert f"- {stuck.title} (담당: 앨리스): 키가 없다" in text
    assert "지운 막힌 일" not in text


def test_bundle_excludes_replaced_decisions_from_the_valid_list(client, mdb, mseed):
    ws = mseed["ws"]
    _save(mdb, _meeting(mdb, ws, started_at=T0 - timedelta(days=9)), [{"name": "초대", "decisions": [{"text": "코드로"}]}])
    old_id = mdb.scalars(select(Decision.decision_id)).one()
    _save(mdb, _meeting(mdb, ws), [{"name": "초대", "decisions": [{"text": "이메일로", "replaces": [old_id]}]}])

    head = _bundle(client, ws).text.split("## 막힌 일")[0].split("## 지금 유효한 결정")[1]

    assert "이메일로" in head
    assert "코드로" not in head


def test_bundle_without_period_covers_every_summary_in_time_order(client, mdb, mseed):
    ws = mseed["ws"]
    _save(mdb, _meeting(mdb, ws, title="나중 회의", started_at=T0))
    _save(mdb, _meeting(mdb, ws, title="처음 회의", started_at=T0 - timedelta(days=60)))
    _extraction(mdb, _meeting(mdb, ws, title="요약 없는 회의"))

    text = _bundle(client, ws).text

    assert text.index("### 처음 회의") < text.index("### 나중 회의")
    assert "요약 없는 회의" not in text


def test_bundle_period_cuts_only_the_body_and_uses_workspace_dates(client, mdb, mseed):
    ws = mseed["ws"]
    # 한국 시간으로 11월 1일 00:30 과 11월 2일 23:30 이다
    _save(mdb, _meeting(mdb, ws, title="첫날 회의", started_at=datetime(2026, 10, 31, 15, 30, tzinfo=timezone.utc)),
          [{"name": "주제", "decisions": [{"text": "첫날 결정"}]}])
    _save(mdb, _meeting(mdb, ws, title="끝날 회의", started_at=datetime(2026, 11, 2, 14, 30, tzinfo=timezone.utc)))
    _save(mdb, _meeting(mdb, ws, title="이른 회의", started_at=datetime(2026, 10, 31, 14, 30, tzinfo=timezone.utc)),
          [{"name": "이른 주제", "decisions": [{"text": "이른 결정"}]}])
    _save(mdb, _meeting(mdb, ws, title="늦은 회의", started_at=datetime(2026, 11, 2, 15, 30, tzinfo=timezone.utc)))

    text = _bundle(client, ws, **{"from": "2026-11-01", "to": "2026-11-02"}).text

    assert "기간: 2026-11-01 ~ 2026-11-02" in text
    assert "### 첫날 회의" in text and "### 끝날 회의" in text
    assert "### 이른 회의" not in text and "### 늦은 회의" not in text
    assert "이른 결정" in text.split("## 회의 요약본")[0]


def test_bundle_with_one_bound_is_open_on_the_other_side(client, mdb, mseed):
    ws = mseed["ws"]
    _save(mdb, _meeting(mdb, ws, title="이전", started_at=T0 - timedelta(days=9)))
    _save(mdb, _meeting(mdb, ws, title="이후", started_at=T0))

    assert "### 이전" not in _bundle(client, ws, **{"from": "2026-11-01"}).text
    assert "### 이후" not in _bundle(client, ws, to="2026-11-01").text


def test_bundle_from_after_to_is_400(client, mseed):
    r = client.get(f"/api/v1/workspaces/{mseed['ws']}/project-bundle.md", params={"from": "2026-11-02", "to": "2026-11-01"})

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


def test_bundle_headers_carry_the_korean_workspace_name(client, mdb, mseed):
    mdb.get(Workspace, mseed["ws"]).name = "우리 팀"
    mdb.commit()

    r = _bundle(client, mseed["ws"])

    assert r.headers["content-type"] == "text/markdown; charset=utf-8"
    assert r.headers["cache-control"] == "private, no-store"
    disposition = r.headers["content-disposition"]
    assert disposition.startswith('attachment; filename="project-bundle.md"; filename*=UTF-8\'\'')
    assert quote("우리 팀 프로젝트 맥락", safe="") in disposition


def test_bundle_requires_membership(stranger, mseed):
    assert stranger.get(f"/api/v1/workspaces/{mseed['ws']}/project-bundle.md").status_code == 403


def _status(client, meeting):
    r = client.get(f"/api/v1/meetings/{meeting.meeting_id}/minutes")
    assert r.status_code == 200, r.text
    return r.json()["data"]


def test_minutes_ready_when_a_valid_document_exists(client, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"])
    _save(mdb, meeting)

    data = _status(client, meeting)

    assert data["summary_status"] == "ready"
    assert data["summary"]["overview"] == "핵심"
    assert {"meeting_id", "title", "started_at", "duration_ms", "source", "attendees", "summary", "transcript",
            "permissions"} <= set(data)


def test_minutes_ready_while_a_forced_rerun_is_queued(client, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"])
    _extraction(mdb, meeting, summary=json.dumps({"overview": "옛 요약"}), summary_requested_at=T0)

    assert _status(client, meeting)["summary_status"] == "ready"


def test_minutes_pending_while_queued(client, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"])
    _extraction(mdb, meeting, summary_requested_at=datetime.now(timezone.utc))

    data = _status(client, meeting)

    assert (data["summary_status"], data["summary"]) == ("pending", None)


def test_minutes_pending_after_a_failed_first_try(client, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"])
    now = datetime.now(timezone.utc)
    _extraction(mdb, meeting, summary_requested_at=now, summary_attempts=1,
                summary_claimed_at=now - summary.SUMMARY_LEASE - timedelta(seconds=1))

    assert _status(client, meeting)["summary_status"] == "pending"


def test_minutes_pending_during_the_last_try(client, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"])
    now = datetime.now(timezone.utc)
    _extraction(mdb, meeting, summary_requested_at=now, summary_attempts=2, summary_claimed_at=now)

    assert _status(client, meeting)["summary_status"] == "pending"


def test_minutes_none_when_nothing_picked_the_summary_up_in_time(client, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"])
    late = datetime.now(timezone.utc) - summary.SUMMARY_PENDING_WINDOW - timedelta(seconds=1)
    _extraction(mdb, meeting, summary_requested_at=late)

    assert _status(client, meeting)["summary_status"] == "none"


def test_minutes_stale_summary_stays_claimable(client, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"])
    late = datetime.now(timezone.utc) - summary.SUMMARY_PENDING_WINDOW - timedelta(seconds=1)
    extraction = _extraction(mdb, meeting, summary_requested_at=late)

    claimed = summary.claim_next(mdb)

    assert claimed.extraction_id == extraction.extraction_id


def test_minutes_none_once_attempts_ran_out(client, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"])
    _extraction(mdb, meeting, summary_requested_at=T0, summary_attempts=2,
                summary_claimed_at=datetime.now(timezone.utc) - summary.SUMMARY_LEASE - timedelta(seconds=1))

    assert _status(client, meeting)["summary_status"] == "none"


def test_minutes_none_for_old_meeting_chat_and_no_extraction(client, mdb, mseed):
    old = _meeting(mdb, mseed["ws"])
    _extraction(mdb, old)
    chat = _meeting(mdb, mseed["ws"], source="chat")
    _extraction(mdb, chat)
    bare = _meeting(mdb, mseed["ws"])

    assert [_status(client, m)["summary_status"] for m in (old, chat, bare)] == ["none", "none", "none"]


def test_minutes_none_for_broken_document(client, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"])
    _extraction(mdb, meeting, summary="{broken")

    data = _status(client, meeting)

    assert (data["summary_status"], data["summary"]) == ("none", None)


def test_handoff_then_save_walks_through_the_statuses(client, mdb, mseed):
    meeting = _meeting(mdb, mseed["ws"], status="processing")
    extraction_id = _extract(client, meeting, [])
    assert _status(client, meeting)["summary_status"] == "pending"

    claim = client.post("/api/v1/summaries/claim", headers=H).json()["data"]
    r = client.put(f"/api/v1/extractions/{extraction_id}/summary", json={
        "claim_token": claim["claim_token"], "model_name": "m", "overview": "핵심", "key_points": [],
    }, headers=H)

    assert r.json()["data"]["applied"] is True
    assert _status(client, meeting)["summary_status"] == "ready"
