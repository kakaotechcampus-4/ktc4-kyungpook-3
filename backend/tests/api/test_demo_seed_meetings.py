"""심사용 시드의 지난 회의 재생(#606). AI 봇과 같은 서비스 토큰 API 로 회의를 만들고 끝까지 처리한다."""
from datetime import datetime, timezone

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import sessionmaker

from app.cli.demo_seed import load_seed_data
from app.cli.seed_demo import SeedError, poll_embeddings, replay_meetings, seed_accounts
from app.main import app
from app.models import EMBEDDING_DIMENSIONS, ApprovalRequest, Extraction, ExtractionItem, Meeting, Source, Task
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
        service_token=SERVICE_TOKEN, wait_for_embeddings=wait or _fill_embeddings(db),
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


def test_each_meeting_has_ready_summary(mdb):
    data, seeded = _setup(mdb)
    report = _replay(mdb, data, seeded)
    assert report.summaries_written == len(data.meetings)
    assert report.summaries_skipped == []

    pm = _client()
    assert pm.post("/api/v1/auth/login", json={"email": EMAILS[0], "password": PM_PW}).status_code == 200
    for meeting in _meetings(mdb, seeded.workspace_id):
        res = pm.get(f"/api/v1/meetings/{meeting.meeting_id}/minutes")
        assert res.status_code == 200, res.text
        assert res.json()["data"]["summary_status"] == "ready"


def test_asr_terms_seeded(mdb):
    data, seeded = _setup(mdb)
    _replay(mdb, data, seeded)

    res = _client().get(f"/api/v1/workspaces/{seeded.workspace_id}/asr-terms", headers=SERVICE)
    assert res.status_code == 200, res.text
    assert set(data.asr_terms) <= set(res.json()["data"]["words"])


def test_replay_is_idempotent(mdb):
    data, seeded = _setup(mdb)
    _replay(mdb, data, seeded)
    counts = [_count(mdb, model) for model in (Meeting, Source, ExtractionItem, Task, Extraction)]

    report = _replay(mdb, data, seeded)

    assert [_count(mdb, model) for model in (Meeting, Source, ExtractionItem, Task, Extraction)] == counts
    assert report.done == len(data.meetings)
    assert report.summaries_skipped == []


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
            service_token="wrong-token", wait_for_embeddings=_fill_embeddings(mdb),
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


def test_resume_writes_missing_summary(mdb):
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
    _fill_embeddings(mdb)(seeded.workspace_id)

    report = _replay(mdb, data, seeded)

    assert report.summaries_written == len(data.meetings)
    assert _count(mdb, Extraction) == len(data.meetings)
    pm = _client()
    assert pm.post("/api/v1/auth/login", json={"email": EMAILS[0], "password": PM_PW}).status_code == 200
    minutes = pm.get(f"/api/v1/meetings/{meeting_id}/minutes")
    assert minutes.json()["data"]["summary_status"] == "ready"


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
