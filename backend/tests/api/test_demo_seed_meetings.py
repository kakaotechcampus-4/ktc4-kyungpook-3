"""심사용 시드의 지난 회의 재생(#606). AI 봇과 같은 서비스 토큰 API 로 회의를 만들고 끝까지 처리한다."""
import json
from dataclasses import replace
from datetime import datetime, timezone

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import sessionmaker

from app.cli.demo_seed import DEFAULT_DATA_PATH, SeedDataError, load_seed_data
from app.cli.seed_demo import SeedError, poll_embeddings, replay_meetings, seed_accounts
from app.main import app
from app.models import EMBEDDING_DIMENSIONS, ApprovalRequest, Extraction, ExtractionItem, Meeting, Member, Source, Task
from tests.api.conftest import SERVICE_TOKEN

PM_PW = "demo-pm-1234"
M2_PW = "demo-m2-1234"
EMAILS = [f"demo+{n}@example.com" for n in range(1, 7)]
NAME = "심사용 테스트 팀"
SERVICE = {"X-Service-Token": SERVICE_TOKEN}


def _fill_embeddings(db):
    """임베딩 워커 대신 task·승인 대기 카드의 빈 임베딩을 채운다."""

    def fill(workspace_id: str) -> None:
        zero = [0.0] * EMBEDDING_DIMENSIONS
        db.execute(
            update(Task).where(Task.workspace_id == workspace_id, Task.embedding.is_(None)).values(embedding=zero)
        )
        db.execute(
            update(ApprovalRequest)
            .where(ApprovalRequest.workspace_id == workspace_id, ApprovalRequest.embedding.is_(None))
            .values(embedding=zero)
        )
        db.commit()

    return fill


def _client():
    return TestClient(app, base_url="https://testserver")


def _setup(db):
    data = load_seed_data()
    seeded = seed_accounts(db, data, emails=EMAILS, workspace_name=NAME, pm_password=PM_PW, member2_password=M2_PW)
    return data, seeded


def _replay(db, data, seeded, http=None, wait=None):
    return replay_meetings(
        http or _client(), db, seeded, data,
        service_token=SERVICE_TOKEN, pm_password=PM_PW, wait_for_embeddings=wait or _fill_embeddings(db),
    )


def _meetings(db, workspace_id):
    return db.scalars(select(Meeting).where(Meeting.workspace_id == workspace_id)).all()


def _count(db, model):
    return db.scalar(select(func.count()).select_from(model))


def test_replay_makes_done_meetings_with_all_gates(mdb):
    data, seeded = _setup(mdb)
    report = _replay(mdb, data, seeded)

    assert report.done == len(data.meetings)
    assert report.processing == 0
    assert report.unembedded == 0
    for gate in ("auto", "review", "hold"):
        assert report.gates.get(gate, 0) >= 1, report.gates
    assert sum(report.gates.values()) == sum(len(m.items) for m in data.meetings)
    mdb.expire_all()
    meetings = _meetings(mdb, seeded.workspace_id)
    assert sorted(m.title for m in meetings) == sorted(m.title for m in data.meetings)
    now = datetime.now(timezone.utc)
    for meeting in meetings:
        assert meeting.status == "done"
        assert meeting.source == "discord"
        assert meeting.started_at.replace(tzinfo=meeting.started_at.tzinfo or timezone.utc) < now
        assert meeting.duration_ms > 0
    autos = mdb.scalars(select(ExtractionItem).where(ExtractionItem.gate == "auto")).all()
    assert autos and all(item.task_id for item in autos)


def test_sources_carry_speaker_member_ids(mdb):
    data, seeded = _setup(mdb)
    _replay(mdb, data, seeded)

    first = data.meetings[0]
    meeting = mdb.scalars(select(Meeting).where(Meeting.title == first.title)).one()
    rows = mdb.scalars(select(Source).where(Source.meeting_id == meeting.meeting_id).order_by(Source.seq)).all()
    assert [r.seq for r in rows] == list(range(len(first.turns)))
    assert [r.member_id for r in rows] == [seeded.member_ids[t.speaker] for t in first.turns]
    assert all(r.end_ms > r.start_ms for r in rows)
    assert all(b.start_ms > a.end_ms for a, b in zip(rows, rows[1:]))


def test_replay_does_not_change_seed_data(mdb):
    data, seeded = _setup(mdb)
    before = [dict(item) for item in data.meetings[0].items]
    _replay(mdb, data, seeded)
    assert data.meetings[0].items == before
    assert "speaker_key" in data.meetings[0].items[0]


@pytest.mark.parametrize("scheme", ["http", "https"])
def test_ready_history_and_pending_demo_cards_coexist(mdb, scheme):
    data, seeded = _setup(mdb)
    report = _replay(mdb, data, seeded, http=TestClient(app, base_url=f"{scheme}://testserver"))
    assert report.summaries_written == 5
    assert report.summaries_skipped == []

    pm = _client()
    assert pm.post("/api/v1/auth/login", json={"email": EMAILS[0], "password": PM_PW}).status_code == 200
    expected = {meeting.title: meeting.approval_state for meeting in data.meetings}
    for meeting in _meetings(mdb, seeded.workspace_id):
        res = pm.get(f"/api/v1/meetings/{meeting.meeting_id}/minutes")
        assert res.status_code == 200, res.text
        minutes = res.json()["data"]
        if expected[meeting.title] == "approved":
            assert minutes["summary_status"] == "ready"
        else:
            assert minutes["summary_status"] == "awaiting_approval"
            assert minutes["summary_waiting_count"] == 2
            extraction_id = mdb.scalar(select(Extraction.extraction_id).where(Extraction.meeting_id == meeting.meeting_id))
            assert _client().post(
                "/api/v1/summaries/claim", json={"extraction_ids": [extraction_id]}, headers=SERVICE,
            ).json()["data"] is None
    cards = mdb.scalars(select(ApprovalRequest).where(ApprovalRequest.status == "pending")).all()
    assert len(cards) == 2
    pending_ids = {card.approval_id for card in cards}
    assert {item.gate for item in mdb.scalars(select(ExtractionItem).where(
        ExtractionItem.approval_id.in_(pending_ids),
    ))} == {"review", "hold"}


def test_asr_terms_seeded(mdb):
    data, seeded = _setup(mdb)
    _replay(mdb, data, seeded)

    res = _client().get(f"/api/v1/workspaces/{seeded.workspace_id}/asr-terms", headers=SERVICE)
    assert res.status_code == 200, res.text
    assert set(data.asr_terms) <= set(res.json()["data"]["words"])


def test_replay_is_idempotent(mdb):
    data, seeded = _setup(mdb)
    _replay(mdb, data, seeded)
    pm = _client()
    assert pm.post("/api/v1/auth/login", json={"email": EMAILS[0], "password": PM_PW}).status_code == 200
    meeting = mdb.scalars(select(Meeting).where(Meeting.title == data.meetings[0].title)).one()
    extraction_id = mdb.scalar(select(Extraction.extraction_id).where(Extraction.meeting_id == meeting.meeting_id))
    task_id = mdb.scalar(select(ExtractionItem.task_id).where(
        ExtractionItem.extraction_id == extraction_id, ExtractionItem.gate == "auto",
    ))
    edited = pm.patch(f"/api/v1/tasks/{task_id}", json={"title": "PM이 직접 고친 태스크"})
    assert edited.status_code == 200, edited.text
    requested = _client().post(f"/api/v1/workspaces/{seeded.workspace_id}/summary-requests", json={
        "meeting_ids": [meeting.meeting_id], "force": True, "dry_run": False,
    }, headers=SERVICE)
    assert requested.status_code == 200, requested.text
    claimed = _client().post("/api/v1/summaries/claim", json={"extraction_ids": [extraction_id]}, headers=SERVICE)
    saved = _client().put(f"/api/v1/extractions/{extraction_id}/summary", json={
        "claim_token": claimed.json()["data"]["claim_token"], "model_name": "actual-worker",
        "overview": "PM 처리 후 워커가 갱신한 요약", "key_points": [],
    }, headers=SERVICE)
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["applied"] is True
    summary_before = pm.get(f"/api/v1/meetings/{meeting.meeting_id}/minutes").json()["data"]["summary"]
    counts = [_count(mdb, model) for model in (Meeting, Source, ExtractionItem, Task, Extraction)]

    report = _replay(mdb, data, seeded)

    assert [_count(mdb, model) for model in (Meeting, Source, ExtractionItem, Task, Extraction)] == counts
    assert report.done == len(data.meetings)
    assert report.summaries_skipped == []
    assert report.summaries_written == 0
    assert pm.get(f"/api/v1/tasks/{task_id}").json()["data"]["title"] == "PM이 직접 고친 태스크"
    assert pm.get(f"/api/v1/meetings/{meeting.meeting_id}/minutes").json()["data"]["summary"] == summary_before


def test_pending_policy_never_logs_in_or_approves_cards(mdb):
    data, seeded = _setup(mdb)
    data = replace(data, meetings=[replace(meeting, approval_state="pending") for meeting in data.meetings])
    http = _client()

    report = replay_meetings(
        http, mdb, seeded, data, service_token=SERVICE_TOKEN, pm_password="unused-password",
        wait_for_embeddings=_fill_embeddings(mdb),
    )

    assert report.summaries_written == 0
    assert report.summaries_skipped == []
    assert http.cookies.get("session_token") is None
    assert mdb.scalar(select(func.count()).select_from(ApprovalRequest).where(
        ApprovalRequest.status == "approved",
    )) == 0
    assert all(extraction.summary is None for extraction in mdb.scalars(select(Extraction)))


def test_approved_input_cannot_resolve_a_card_from_an_existing_pending_meeting(mdb, tmp_path):
    data, seeded = _setup(mdb)
    pending = replace(data, meetings=[replace(data.meetings[0], approval_state="pending")])
    _replay(mdb, pending, seeded)
    approval_id = mdb.scalars(select(ApprovalRequest.approval_id)).first()
    pm = _client()
    assert pm.post("/api/v1/auth/login", json={"email": EMAILS[0], "password": PM_PW}).status_code == 200
    before = pm.get(f"/api/v1/approvals/{approval_id}").json()["data"]
    assert before["status"] == "pending"
    raw = json.loads(DEFAULT_DATA_PATH.read_text(encoding="utf-8"))
    raw["meetings"][0]["approval_state"] = "pending"
    raw["meetings"][1]["items"][1].update(action="merge", target_approval_id=approval_id)
    path = tmp_path / "reuse-pending-card.json"
    path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")

    with pytest.raises(SeedDataError, match="approved.*create"):
        _replay(mdb, load_seed_data(path), seeded)

    assert pm.get(f"/api/v1/approvals/{approval_id}").json()["data"] == before
    assert _count(mdb, Meeting) == 1


def test_authenticated_requests_do_not_follow_external_redirects():
    from app.cli.seed_demo import _call

    destinations = []

    def redirect(request):
        destinations.append(request.url.host)
        return httpx.Response(302, headers={"Location": "https://another-origin.example/collect"})

    with httpx.Client(base_url="https://seed-api.example", follow_redirects=True,
                      transport=httpx.MockTransport(redirect)) as http:
        with pytest.raises(SeedError, match="302"):
            _call(http, "PATCH", "/approvals/card", service_token=SERVICE_TOKEN,
                  headers={"Cookie": "session_token=test-session"}, json={"status": "approved"})

    assert destinations == ["seed-api.example"]


def test_rerun_after_replay_is_not_stopped_as_existing_data(mdb):
    """회의를 재생한 뒤 --allow-existing 없이 다시 돌려도 시드가 만든 회의·자리를 시드 밖으로 보고 멈추지 않는다(#606).

    README 의 "다시 실행하면 이어 간다"를 지키는 경로다. 기존 데이터 검사의 판정이 바뀌면 여기서 잡힌다."""
    data, seeded = _setup(mdb)
    _replay(mdb, data, seeded)
    models = (Meeting, Source, ExtractionItem, Task, Extraction, Member)
    counts = [_count(mdb, model) for model in models]

    again = seed_accounts(mdb, data, emails=EMAILS, workspace_name=NAME, pm_password=PM_PW, member2_password=M2_PW)

    assert again.workspace_id == seeded.workspace_id
    assert [_count(mdb, model) for model in models] == counts
    report = _replay(mdb, data, again)
    assert report.done == len(data.meetings)
    assert [_count(mdb, model) for model in models] == counts


def test_resume_from_partial_meeting(mdb):
    data, seeded = _setup(mdb)
    first = data.meetings[0]
    created = _client().post(
        "/api/v1/meetings",
        json={"workspace_id": seeded.workspace_id, "title": first.title, "source": "discord"},
        headers={**SERVICE, "X-Meeting-Lineage-Version": "1"},
    )
    assert created.status_code == 201, created.text

    report = _replay(mdb, data, seeded)

    assert report.done == len(data.meetings)
    assert _count(mdb, Meeting) == len(data.meetings)
    mdb.expire_all()
    assert mdb.get(Meeting, created.json()["data"]["meeting_id"]).status == "done"


class _ClaimStealer:
    """첫 요약 claim 직전에 다른 워커가 먼저 가져가게 끼워 넣는다."""

    def __init__(self, inner):
        self.inner = inner
        self.stolen = False

    @property
    def cookies(self):
        return self.inner.cookies

    def request(self, method, url, **kwargs):
        if url.endswith("/summaries/claim") and not self.stolen:
            self.stolen = True
            res = self.inner.request(method, url, **kwargs)
            assert res.json()["data"] is not None
        return self.inner.request(method, url, **kwargs)


def test_summary_claimed_by_other_is_skipped(mdb):
    data, seeded = _setup(mdb)
    http = _ClaimStealer(_client())

    report = _replay(mdb, data, seeded, http=http)

    assert http.stolen
    assert data.meetings[0].title in report.summaries_skipped
    assert report.done == len(data.meetings)


def test_embedding_timeout_stops_before_next_meeting(mdb):
    data, seeded = _setup(mdb)
    factory = sessionmaker(bind=mdb.get_bind())

    with pytest.raises(SeedError) as error:
        _replay(mdb, data, seeded, wait=poll_embeddings(factory, timeout_s=0.1, interval_s=0.05))

    assert "EMBEDDING_API_KEY" in str(error.value)
    assert _count(mdb, Meeting) == 1


def test_poll_embeddings_returns_when_filled(mdb):
    data, seeded = _setup(mdb)
    factory = sessionmaker(bind=mdb.get_bind())
    # 임베딩이 필요한 것이 없으면 바로 돌아온다
    poll_embeddings(factory, timeout_s=0.1, interval_s=0.05)(seeded.workspace_id)


def test_http_error_raises_seed_error(mdb):
    data, seeded = _setup(mdb)
    with pytest.raises(SeedError) as error:
        replay_meetings(
            _client(), mdb, seeded, data,
            service_token="wrong-token", pm_password=PM_PW, wait_for_embeddings=_fill_embeddings(mdb),
        )
    assert "/meetings" in str(error.value)
    assert "401" in str(error.value) or "403" in str(error.value)


def test_upload_precheck_passes_after_seed(mdb):
    data, seeded = _setup(mdb)
    _replay(mdb, data, seeded)

    stuck = mdb.scalar(
        select(func.count()).select_from(Meeting).where(
            Meeting.workspace_id == seeded.workspace_id,
            Meeting.status == "processing",
            Meeting.source != "chat",
        )
    )
    assert stuck == 0


def _bot_start(data, seeded, index=0):
    """봇이 회의를 만들고 끝낸 데까지 해 둔다."""
    from app.cli.seed_demo import _segments

    client = _client()
    meeting = data.meetings[index]
    created = client.post(
        "/api/v1/meetings",
        json={"workspace_id": seeded.workspace_id, "title": meeting.title, "source": "discord"},
        headers={**SERVICE, "X-Meeting-Lineage-Version": "1"},
    )
    assert created.status_code == 201, created.text
    meeting_id = created.json()["data"]["meeting_id"]
    assert client.patch(f"/api/v1/meetings/{meeting_id}/end", headers=SERVICE).status_code == 202
    return client, meeting_id, _segments(meeting, seeded.member_ids)


def test_resume_from_partial_sources(mdb):
    data, seeded = _setup(mdb)
    client, meeting_id, segments = _bot_start(data, seeded)
    sent = client.post(
        f"/api/v1/meetings/{meeting_id}/sources", json={"segments": segments[:3]}, headers=SERVICE
    )
    assert sent.status_code == 201, sent.text

    report = _replay(mdb, data, seeded)

    assert report.done == len(data.meetings)
    assert _count(mdb, Meeting) == len(data.meetings)
    mdb.expire_all()
    assert mdb.get(Meeting, meeting_id).status == "done"
    stored = mdb.scalar(select(func.count()).select_from(Source).where(Source.meeting_id == meeting_id))
    assert stored == len(data.meetings[0].turns)


@pytest.mark.parametrize("resolution", ["pending", "rejected", "approved", "overridden"])
def test_resume_preserves_existing_extraction_without_injecting_summary(mdb, resolution):
    from app.cli.seed_demo import _items

    data, seeded = _setup(mdb)
    client, meeting_id, segments = _bot_start(data, seeded)
    assert client.post(
        f"/api/v1/meetings/{meeting_id}/sources", json={"segments": segments}, headers=SERVICE
    ).status_code == 201
    extracted = client.post("/api/v1/extractions", json={
        "meeting_id": meeting_id, "workspace_id": seeded.workspace_id,
        "items": _items(data.meetings[0], seeded.member_ids, datetime.now(timezone.utc).date()),
    }, headers=SERVICE)
    assert extracted.status_code == 201, extracted.text
    pm = _client()
    assert pm.post("/api/v1/auth/login", json={"email": EMAILS[0], "password": PM_PW}).status_code == 200
    extraction_id = extracted.json()["data"]["extraction_id"]
    approval_ids = mdb.scalars(select(ExtractionItem.approval_id).where(
        ExtractionItem.extraction_id == extraction_id, ExtractionItem.approval_id.is_not(None),
    )).all()
    if resolution != "pending":
        for approval_id in approval_ids:
            card = pm.get(f"/api/v1/approvals/{approval_id}").json()["data"]
            body = {"status": "rejected" if resolution == "rejected" else "approved",
                    "payload_version": card["payload_version"]}
            if resolution == "overridden":
                body["task_overrides"] = {"task_title": "PM이 고친 " + approval_id}
            resolved = pm.patch(f"/api/v1/approvals/{approval_id}", json=body)
            assert resolved.status_code == 200, resolved.text
    before = {approval_id: pm.get(f"/api/v1/approvals/{approval_id}").json()["data"]
              for approval_id in approval_ids}
    _fill_embeddings(mdb)(seeded.workspace_id)

    report = _replay(mdb, data, seeded)

    assert report.summaries_written == 4
    assert report.summaries_skipped == [data.meetings[0].title]
    assert _count(mdb, Extraction) == len(data.meetings)
    assert {approval_id: pm.get(f"/api/v1/approvals/{approval_id}").json()["data"]
            for approval_id in approval_ids} == before
    minutes = pm.get(f"/api/v1/meetings/{meeting_id}/minutes")
    assert minutes.json()["data"]["summary"] is None
    if resolution == "pending":
        assert minutes.json()["data"]["summary_status"] == "awaiting_approval"


def test_same_title_upload_meeting_is_left_alone(mdb):
    data, seeded = _setup(mdb)
    upload = Meeting(
        workspace_id=seeded.workspace_id, title=data.meetings[0].title, source="manual_upload", status="processing"
    )
    mdb.add(upload)
    mdb.commit()
    upload_id = upload.meeting_id

    report = _replay(mdb, data, seeded)

    assert report.done == len(data.meetings)
    assert report.processing == 0
    assert _count(mdb, Meeting) == len(data.meetings) + 1
    mdb.expire_all()
    assert mdb.get(Meeting, upload_id).status == "processing"
    assert mdb.scalar(select(func.count()).select_from(Source).where(Source.meeting_id == upload_id)) == 0


class _Refusing:
    def request(self, method, url, **kwargs):
        raise httpx.ConnectError("connection refused")


class _NotJson:
    def request(self, method, url, **kwargs):
        return httpx.Response(200, text="<html>proxy</html>")


@pytest.mark.parametrize("http", [_Refusing(), _NotJson()], ids=["transport", "not-json"])
def test_transport_and_body_errors_become_seed_error(mdb, http):
    data, seeded = _setup(mdb)
    with pytest.raises(SeedError) as error:
        _replay(mdb, data, seeded, http=http)
    assert "/meetings" in str(error.value)


def test_embedding_timeout_mentions_rejected_titles(mdb):
    data, seeded = _setup(mdb)
    mdb.add(Task(workspace_id=seeded.workspace_id, title="임베딩 대기", status="todo"))
    mdb.commit()
    factory = sessionmaker(bind=mdb.get_bind())
    with pytest.raises(SeedError) as error:
        poll_embeddings(factory, timeout_s=0.05, interval_s=0.01)(seeded.workspace_id)
    assert "EMBEDDING_API_KEY" in str(error.value)
    assert "embedding_rejected_title" in str(error.value)
