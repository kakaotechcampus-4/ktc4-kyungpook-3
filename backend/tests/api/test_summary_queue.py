"""요약 대기열. 표시된 회의만 시간순으로 돌고, 임대가 지나면 한 번 더 돌고, 먼저 끝난 쪽만 저장된다."""
import threading
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.models import Decision, Extraction, ExtractionItem, Meeting, Source, Topic, TopicMeeting, Workspace
from app.schemas.project_map import SummaryWriteRequest
from app.services import summary
from tests.api.conftest import SERVICE_TOKEN

H = {"X-Service-Token": SERVICE_TOKEN}
T0 = datetime(2026, 11, 5, 5, 0, tzinfo=timezone.utc)
BODY = {"model_name": "gpt-5.6-luna", "overview": "핵심", "key_points": ["하나"]}


@pytest.fixture
def client(mdb):
    return TestClient(app, base_url="https://testserver")


def _meeting(db, ws, *, started_at=T0, source="discord", status="done", spoken=True, extraction=True, requested=True):
    meeting = Meeting(workspace_id=ws, source=source, status=status, started_at=started_at, title="정기회의")
    db.add(meeting)
    db.flush()
    if spoken:
        db.add(Source(meeting_id=meeting.meeting_id, seq=0, start_ms=0, end_ms=900, text="안녕하세요"))
    row = None
    if extraction:
        row = Extraction(meeting_id=meeting.meeting_id, summary_requested_at=T0 if requested else None)
        db.add(row)
    db.commit()
    return meeting, row


def _extract(client, meeting):
    r = client.post("/api/v1/extractions", json={
        "meeting_id": meeting.meeting_id, "workspace_id": meeting.workspace_id, "items": [],
    }, headers=H)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _claim(client, **body):
    r = client.post("/api/v1/summaries/claim", json=body or None, headers=H)
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _put(client, extraction_id, body=None):
    r = client.put(f"/api/v1/extractions/{extraction_id}/summary", json=body or BODY, headers=H)
    assert r.status_code == 200, r.text
    return r.json()["data"]


@pytest.mark.parametrize("source", ["discord", "manual_upload"])
def test_handoff_marks_spoken_voice_and_upload_meetings(client, mdb, mseed, source):
    meeting, _ = _meeting(mdb, mseed["ws"], source=source, status="processing", extraction=False)

    data = _extract(client, meeting)

    assert set(data) == {"extraction_id", "meeting_id", "item_count"}
    assert mdb.get(Extraction, data["extraction_id"]).summary_requested_at is not None


def test_handoff_does_not_mark_chat_meeting(client, mdb, mseed):
    meeting, _ = _meeting(mdb, mseed["ws"], source="chat", status="processing", extraction=False)

    data = _extract(client, meeting)

    assert mdb.get(Extraction, data["extraction_id"]).summary_requested_at is None
    assert _claim(client) is None


def test_handoff_does_not_mark_meeting_without_sources(client, mdb, mseed):
    meeting, _ = _meeting(mdb, mseed["ws"], status="processing", spoken=False, extraction=False)

    data = _extract(client, meeting)

    assert mdb.get(Extraction, data["extraction_id"]).summary_requested_at is None
    assert _claim(client) is None


def test_repeated_handoff_does_not_queue_finished_meeting_again(client, mdb, mseed):
    meeting, _ = _meeting(mdb, mseed["ws"], status="processing", extraction=False)
    extraction_id = _extract(client, meeting)["extraction_id"]
    _claim(client)
    _put(client, extraction_id)

    assert _extract(client, meeting)["extraction_id"] == extraction_id

    assert _claim(client) is None


def test_old_meeting_is_never_picked_up_unless_marked(client, mdb, mseed):
    _meeting(mdb, mseed["ws"], requested=False)

    assert _claim(client) is None


def test_claim_returns_only_ids_and_attempt(client, mdb, mseed):
    meeting, extraction = _meeting(mdb, mseed["ws"])

    assert _claim(client) == {
        "extraction_id": extraction.extraction_id,
        "meeting_id": meeting.meeting_id,
        "workspace_id": mseed["ws"],
        "attempt": 1,
    }


def test_claim_goes_by_meeting_time_not_queue_time(client, mdb, mseed):
    _, later = _meeting(mdb, mseed["ws"], started_at=T0)
    _, earlier = _meeting(mdb, mseed["ws"], started_at=T0 - timedelta(days=7))

    first = _claim(client)["extraction_id"]
    _put(client, first)
    assert [first, _claim(client)["extraction_id"]] == [earlier.extraction_id, later.extraction_id]


def test_claim_skips_row_under_live_lease(client, mdb, mseed):
    _meeting(mdb, mseed["ws"])
    assert _claim(client)["attempt"] == 1

    assert _claim(client) is None


def test_expired_lease_is_claimed_again_until_attempts_run_out(mdb, mseed):
    _, extraction = _meeting(mdb, mseed["ws"])
    now = datetime.now(timezone.utc)

    first = summary.claim_next(mdb, now=now)
    assert first.attempt == 1
    assert summary.claim_next(mdb, now=now + summary.SUMMARY_LEASE - timedelta(seconds=1)) is None
    second = summary.claim_next(mdb, now=now + summary.SUMMARY_LEASE + timedelta(seconds=1))
    assert (second.extraction_id, second.attempt) == (extraction.extraction_id, 2)
    assert summary.claim_next(mdb, now=now + summary.SUMMARY_LEASE * 5) is None


def test_a_live_lease_on_an_earlier_meeting_holds_later_meetings_of_that_workspace(mdb, mseed):
    """앞 회의가 저장 없이 끝난 동안 뒤 회의를 주면 뒤 회의가 앞 회의의 주제와 결정 없이 요약된다."""
    _, earlier = _meeting(mdb, mseed["ws"], started_at=T0)
    _, later = _meeting(mdb, mseed["ws"], started_at=T0 + timedelta(days=1))
    other_ws = Workspace(name="B")
    mdb.add(other_ws)
    mdb.commit()
    _, other = _meeting(mdb, other_ws.workspace_id, started_at=T0 + timedelta(days=2))
    now = datetime.now(timezone.utc)

    assert summary.claim_next(mdb, now=now).extraction_id == earlier.extraction_id
    assert summary.claim_next(mdb, now=now).extraction_id == other.extraction_id
    assert summary.claim_next(mdb, now=now) is None
    retry = summary.claim_next(mdb, now=now + summary.SUMMARY_LEASE + timedelta(seconds=1))
    assert (retry.extraction_id, retry.attempt) == (earlier.extraction_id, 2)


def test_an_earlier_meeting_that_gave_up_does_not_hold_later_meetings(mdb, mseed):
    _, earlier = _meeting(mdb, mseed["ws"], started_at=T0)
    _, later = _meeting(mdb, mseed["ws"], started_at=T0 + timedelta(days=1))
    now = datetime.now(timezone.utc)
    earlier.summary_attempts, earlier.summary_claimed_at = summary.SUMMARY_MAX_ATTEMPTS, now - summary.SUMMARY_LEASE * 2
    mdb.commit()

    assert summary.claim_next(mdb, now=now).extraction_id == later.extraction_id


def test_extraction_ids_limit_the_claim(client, mdb, mseed):
    _, first = _meeting(mdb, mseed["ws"], started_at=T0 - timedelta(days=1))
    _, wanted = _meeting(mdb, mseed["ws"], started_at=T0)

    assert _claim(client, extraction_ids=[wanted.extraction_id])["extraction_id"] == wanted.extraction_id
    assert _claim(client, extraction_ids=[wanted.extraction_id]) is None
    assert _claim(client)["extraction_id"] == first.extraction_id


def test_empty_extraction_ids_claims_nothing(client, mdb, mseed):
    _meeting(mdb, mseed["ws"])

    assert _claim(client, extraction_ids=[]) is None


def test_empty_body_object_claims_without_limit(client, mdb, mseed):
    _, extraction = _meeting(mdb, mseed["ws"])

    r = client.post("/api/v1/summaries/claim", json={}, headers=H)

    assert r.json()["data"]["extraction_id"] == extraction.extraction_id


def test_put_saves_and_empties_the_queue(client, mdb, mseed):
    _, extraction = _meeting(mdb, mseed["ws"])
    _claim(client)

    data = _put(client, extraction.extraction_id)

    assert data == {
        "extraction_id": extraction.extraction_id, "meeting_id": extraction.meeting_id,
        "applied": True, "topic_count": 0, "decision_count": 0,
    }
    mdb.refresh(extraction)
    assert extraction.summary is not None
    assert (extraction.summary_requested_at, extraction.summary_attempts, extraction.summary_claimed_at) == (None, 0, None)
    assert _claim(client) is None


def test_put_for_unmarked_extraction_is_not_applied(client, mdb, mseed):
    _, extraction = _meeting(mdb, mseed["ws"], requested=False)

    assert _put(client, extraction.extraction_id)["applied"] is False

    mdb.refresh(extraction)
    assert extraction.summary is None


def test_late_put_after_another_finished_is_not_applied(client, mdb, mseed):
    _, extraction = _meeting(mdb, mseed["ws"])
    _claim(client)
    _put(client, extraction.extraction_id)
    mdb.refresh(extraction)
    saved = extraction.summary

    late = _put(client, extraction.extraction_id, {**BODY, "overview": "늦게 온 다른 내용"})

    assert late["applied"] is False
    assert (late["topic_count"], late["decision_count"]) == (0, 0)
    mdb.refresh(extraction)
    assert extraction.summary == saved


def test_repeated_put_keeps_one_set_of_rows(client, mdb, mseed):
    _, extraction = _meeting(mdb, mseed["ws"])
    body = {**BODY, "topics": [{"name": "로그인", "decisions": [{"text": "카카오만 쓴다"}]}]}
    _claim(client)

    assert _put(client, extraction.extraction_id, body)["applied"] is True
    assert _put(client, extraction.extraction_id, body)["applied"] is False

    assert len(mdb.scalars(select(Topic)).all()) == 1
    assert len(mdb.scalars(select(TopicMeeting)).all()) == 1
    assert len(mdb.scalars(select(Decision)).all()) == 1


def test_put_after_attempts_ran_out_still_saves(client, mdb, mseed):
    _, extraction = _meeting(mdb, mseed["ws"])
    now = datetime.now(timezone.utc)
    summary.claim_next(mdb, now=now - summary.SUMMARY_LEASE * 3)
    summary.claim_next(mdb, now=now - summary.SUMMARY_LEASE * 2)
    mdb.commit()

    assert _put(client, extraction.extraction_id)["applied"] is True


def test_put_unknown_extraction_is_404(client, mdb, mseed):
    r = client.put("/api/v1/extractions/nope/summary", json=BODY, headers=H)

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "EXTRACTION_NOT_FOUND"


@pytest.mark.parametrize("body", [
    {**BODY, "overview": ""},
    {"model_name": "m", "overview": "핵심"},
    {**BODY, "topics": [{"item_ids": []}]},
])
def test_put_rejects_malformed_body(client, mdb, mseed, body):
    _, extraction = _meeting(mdb, mseed["ws"])

    r = client.put(f"/api/v1/extractions/{extraction.extraction_id}/summary", json=body, headers=H)

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


@pytest.mark.parametrize("method,path,body", [
    ("post", "/api/v1/summaries/claim", None),
    ("get", "/api/v1/extractions/x/summary-input", None),
    ("put", "/api/v1/extractions/x/summary", BODY),
    ("post", "/api/v1/workspaces/x/summary-requests", {"include_all": True}),
])
def test_service_routes_require_token(client, mdb, method, path, body):
    r = client.request(method, path, json=body)

    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHENTICATED"


def test_concurrent_claims_never_share_a_row(mdb, mseed):
    if mdb.get_bind().dialect.name != "postgresql":
        pytest.skip("행 잠금은 PostgreSQL 에서만 확인한다")
    # 같은 워크스페이스는 앞 회의가 끝나야 뒤 회의를 주므로 워크스페이스 둘로 동시 claim 을 본다
    other_ws = Workspace(name="B")
    mdb.add(other_ws)
    mdb.commit()
    for offset, ws in enumerate((mseed["ws"], other_ws.workspace_id)):
        _meeting(mdb, ws, started_at=T0 + timedelta(minutes=offset))
    Session = sessionmaker(bind=mdb.get_bind(), autoflush=False)
    barrier = threading.Barrier(4)
    claimed = []

    def worker():
        db = Session()
        barrier.wait(5)
        job = summary.claim_next(db)
        db.commit()
        db.close()
        claimed.append(job)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(20)

    assert not any(t.is_alive() for t in threads)
    taken = [job.extraction_id for job in claimed if job is not None]
    assert len(taken) == len(set(taken)) == 2


def test_summary_input_changes_nothing_and_carries_stored_rows(client, mdb, mseed):
    meeting, extraction = _meeting(mdb, mseed["ws"], spoken=False)
    alice = mseed["alice"]
    mdb.add_all([
        Source(meeting_id=meeting.meeting_id, seq=0, start_ms=0, end_ms=1, text="팀원", member_id=alice.member_id,
               speaker_name="디스코드 이름"),
        Source(meeting_id=meeting.meeting_id, seq=1, start_ms=1, end_ms=2, text="표시", speaker_name="손님",
               speaker_discord_user_id="u1"),
        Source(meeting_id=meeting.meeting_id, seq=2, start_ms=2, end_ms=3, text="uid", speaker_discord_user_id="u2"),
        Source(meeting_id=meeting.meeting_id, seq=3, start_ms=3, end_ms=4, text="없음"),
        ExtractionItem(extraction_id=extraction.extraction_id, action="create", task_title="배포",
                       assignee_member_id=alice.member_id, assignee_raw="앨리스님", due_date=T0.date()),
        ExtractionItem(extraction_id=extraction.extraction_id, action="update", task_title="문서", assignee_raw="누군가"),
    ])
    mdb.commit()

    r = client.get(f"/api/v1/extractions/{extraction.extraction_id}/summary-input", headers=H)

    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert (data["extraction_id"], data["meeting_id"], data["workspace_id"], data["title"]) == (
        extraction.extraction_id, meeting.meeting_id, mseed["ws"], "정기회의",
    )
    assert "attempt" not in data
    assert data["started_at"].startswith("2026-11-05T05:00:00")
    assert [(ln["seq"], ln["at_ms"], ln["speaker"], ln["text"]) for ln in data["lines"]] == [
        (0, 0, "앨리스", "팀원"), (1, 1, "손님", "표시"), (2, 2, "u2", "uid"), (3, 3, "Unknown", "없음"),
    ]
    items = sorted(data["items"], key=lambda item: item["title"])
    assert [(i["action"], i["title"], i["assignee"], i["due_date"]) for i in items] == [
        ("update", "문서", "누군가", None), ("create", "배포", "앨리스", "2026-11-05"),
    ]
    assert all(i["item_id"] for i in items)
    mdb.refresh(extraction)
    assert (extraction.summary_attempts, extraction.summary_claimed_at) == (0, None)


def test_summary_input_unknown_extraction_is_404(client, mdb, mseed):
    r = client.get("/api/v1/extractions/nope/summary-input", headers=H)

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "EXTRACTION_NOT_FOUND"


def _saved(db, ws, started_at, topics):
    meeting, extraction = _meeting(db, ws, started_at=started_at)
    summary.save_summary(db, extraction.extraction_id, SummaryWriteRequest(**BODY, topics=topics))
    db.commit()
    return meeting, extraction


def _input(client, extraction):
    return client.get(f"/api/v1/extractions/{extraction.extraction_id}/summary-input", headers=H).json()["data"]


def test_summary_input_lists_topics_most_recently_used_first(client, mdb, mseed):
    _saved(mdb, mseed["ws"], T0 - timedelta(days=9), [{"name": "오래된 주제"}])
    _saved(mdb, mseed["ws"], T0 - timedelta(days=1), [{"name": "최근 주제", "description": "설명"}])
    _, extraction = _meeting(mdb, mseed["ws"])

    topics = _input(client, extraction)["topics"]

    assert [(t["name"], t["description"]) for t in topics] == [("최근 주제", "설명"), ("오래된 주제", "")]
    assert all(t["topic_id"] for t in topics)


def test_summary_input_gives_decisions_valid_at_this_meeting(client, mdb, mseed):
    ws = mseed["ws"]
    _saved(mdb, ws, T0 - timedelta(days=9), [{"name": "초대", "decisions": [{"text": "코드로 합류"}, {"text": "유지"}]}])
    replaced = mdb.scalars(select(Decision).where(Decision.text == "코드로 합류")).one().decision_id
    _, earlier = _meeting(mdb, ws, started_at=T0 - timedelta(days=5))
    _saved(mdb, ws, T0 - timedelta(days=3), [
        {"name": "초대", "decisions": [{"text": "이메일로만", "replaces": [replaced]}]},
    ])
    _, later = _meeting(mdb, ws, started_at=T0)

    before = _input(client, earlier)["decisions"]
    after = _input(client, later)["decisions"]

    assert sorted(d["text"] for d in before) == ["유지", "코드로 합류"]
    assert sorted(d["text"] for d in after) == ["유지", "이메일로만"]
    kept = next(d for d in after if d["text"] == "유지")
    assert (kept["topic"], kept["decided_on"]) == ("초대", "2026-10-27")


def test_decided_on_is_the_workspace_date(client, mdb, mseed):
    # 2026-10-31 15:30 UTC 는 한국 시간으로 11월 1일이다
    _saved(mdb, mseed["ws"], datetime(2026, 10, 31, 15, 30, tzinfo=timezone.utc),
           [{"name": "주제", "decisions": [{"text": "결정"}]}])
    _, extraction = _meeting(mdb, mseed["ws"])

    assert _input(client, extraction)["decisions"][0]["decided_on"] == "2026-11-01"


def _request(client, ws, **body):
    r = client.post(f"/api/v1/workspaces/{ws}/summary-requests", json=body, headers=H)
    assert r.status_code == 200, r.text
    return {row["meeting_id"]: row for row in r.json()["data"]["items"]}


def test_summary_request_dry_run_is_default_and_writes_nothing(client, mdb, mseed):
    meeting, extraction = _meeting(mdb, mseed["ws"], requested=False)

    rows = _request(client, mseed["ws"], include_all=True)

    row = rows[meeting.meeting_id]
    assert (row["state"], row["extraction_id"], row["chars"], row["title"]) == (
        "requested", extraction.extraction_id, len("안녕하세요"), "정기회의",
    )
    mdb.refresh(extraction)
    assert extraction.summary_requested_at is None


def test_summary_request_marks_old_meeting_for_the_claim(client, mdb, mseed):
    _, extraction = _meeting(mdb, mseed["ws"], requested=False)

    _request(client, mseed["ws"], include_all=True, dry_run=False)

    assert _claim(client)["extraction_id"] == extraction.extraction_id


def test_summary_request_reports_each_state(client, mdb, mseed):
    ws = mseed["ws"]
    now = datetime.now(timezone.utc)
    chat, _ = _meeting(mdb, ws, source="chat", requested=False)
    silent, _ = _meeting(mdb, ws, spoken=False, requested=False)
    processing, _ = _meeting(mdb, ws, status="processing", extraction=False)
    queued, _ = _meeting(mdb, ws)
    leased, leased_row = _meeting(mdb, ws)
    leased_row.summary_attempts, leased_row.summary_claimed_at = 2, now
    gave_up, gave_up_row = _meeting(mdb, ws)
    gave_up_row.summary_attempts, gave_up_row.summary_claimed_at = 2, now - summary.SUMMARY_LEASE * 2
    done, done_row = _meeting(mdb, ws, requested=False)
    done_row.summary = '{"overview": "핵심"}'
    mdb.commit()

    rows = _request(client, ws, include_all=True, dry_run=False)

    assert {m: rows[m.meeting_id]["state"] for m in (chat, silent, processing, queued, leased, gave_up, done)} == {
        chat: "not_summarized_source", silent: "no_sources", processing: "not_done", queued: "queued",
        leased: "queued", gave_up: "gave_up", done: "done",
    }
    assert rows[processing.meeting_id]["extraction_id"] is None


def test_force_requeues_given_up_and_done_and_keeps_old_summary(client, mdb, mseed):
    ws = mseed["ws"]
    gave_up, gave_up_row = _meeting(mdb, ws)
    gave_up_row.summary_attempts = 2
    done, done_row = _meeting(mdb, ws, requested=False)
    done_row.summary = '{"overview": "옛 요약"}'
    mdb.commit()

    rows = _request(client, ws, meeting_ids=[gave_up.meeting_id, done.meeting_id], force=True, dry_run=False)

    assert {row["state"] for row in rows.values()} == {"requested"}
    mdb.refresh(gave_up_row)
    mdb.refresh(done_row)
    assert (gave_up_row.summary_attempts, gave_up_row.summary_claimed_at) == (0, None)
    assert done_row.summary_requested_at is not None
    assert done_row.summary == '{"overview": "옛 요약"}'


def test_force_leaves_a_row_under_a_live_lease_alone(client, mdb, mseed):
    """돌고 있는 회의를 다시 줄 세우면 같은 회의에 호출이 두 번 나가고 늦은 PUT 이 버려진다."""
    ws = mseed["ws"]
    meeting, row = _meeting(mdb, ws)
    first = _claim(client)

    rows = _request(client, ws, meeting_ids=[meeting.meeting_id], force=True, dry_run=False)

    assert rows[meeting.meeting_id]["state"] == "queued"
    mdb.refresh(row)
    assert row.summary_attempts == first["attempt"] == 1
    assert row.summary_claimed_at is not None
    assert _claim(client) is None


def test_summary_request_limits_to_given_meetings_in_time_order(client, mdb, mseed):
    ws = mseed["ws"]
    later, _ = _meeting(mdb, ws, started_at=T0, requested=False)
    earlier, _ = _meeting(mdb, ws, started_at=T0 - timedelta(days=1), requested=False)
    other, _ = _meeting(mdb, ws, requested=False)

    r = client.post(f"/api/v1/workspaces/{ws}/summary-requests",
                    json={"meeting_ids": [later.meeting_id, earlier.meeting_id]}, headers=H)

    assert [row["meeting_id"] for row in r.json()["data"]["items"]] == [earlier.meeting_id, later.meeting_id]
    assert other.meeting_id not in [row["meeting_id"] for row in r.json()["data"]["items"]]


def test_summary_request_unknown_or_foreign_meeting_is_404(client, mdb, mseed):
    r = client.post(f"/api/v1/workspaces/{mseed['ws']}/summary-requests", json={"meeting_ids": ["nope"]}, headers=H)

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "MEETING_NOT_FOUND"


def test_summary_request_unknown_workspace_is_404(client, mdb, mseed):
    r = client.post("/api/v1/workspaces/nope/summary-requests", json={"include_all": True}, headers=H)

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "WORKSPACE_NOT_FOUND"


@pytest.mark.parametrize("body", [{}, {"include_all": True, "meeting_ids": ["m"]}])
def test_summary_request_needs_exactly_one_scope(client, mdb, mseed, body):
    r = client.post(f"/api/v1/workspaces/{mseed['ws']}/summary-requests", json=body, headers=H)

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
