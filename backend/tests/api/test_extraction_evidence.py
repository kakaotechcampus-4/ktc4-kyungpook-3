"""추출 근거는 evidence_seqs로 발화(source)를 이어 evidence에 저장하고, 상세 응답의 evidence는 source에서 읽는지 확인."""
import json
import logging
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import (
    AliasResolutionLog,
    ApprovalRequest,
    Evidence,
    Extraction,
    ExtractionItem,
    Meeting,
    Member,
    MemberAlias,
    Session as SessionModel,
    Source,
    Task,
    User,
    Workspace,
)
from app.schemas.meeting import MAX_EVIDENCE_SEQS


# 추출 등록은 봇 경로라 서비스 토큰을 요구한다.
SERVICE_TOKEN = "test-service-token"
SERVICE_HEADERS = {"X-Service-Token": SERVICE_TOKEN}


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()

    def override_get_db():
        yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield session
    finally:
        app.dependency_overrides.pop(get_db, None)
        session.close()


@pytest.fixture
def seed(db):
    user = User(email="pm@example.com", name="pm")
    db.add(user)
    db.flush()
    db.add(SessionModel(
        user_id=user.user_id, session_token="pm-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    db.add(Member(workspace_id=ws.workspace_id, user_id=user.user_id, display_name="pm", role="pm"))
    meeting = Meeting(workspace_id=ws.workspace_id, status="processing")
    db.add(meeting)
    db.commit()
    return {"ws": ws.workspace_id, "meeting": meeting.meeting_id}


@pytest.fixture
def client(db, monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c


def _extract(client, seed):
    r = client.post("/api/v1/extractions", json={
        "meeting_id": seed["meeting"],
        "workspace_id": seed["ws"],
        "transcript_path": "s3://bucket/transcript.json",
        "items": [{
            "task_title": "결제 환불 기능 구현", "task_confidence": 0.6,
            "evidence_quote": "환불 기능은 제가 할게요.", "evidence_speaker": "discord_uid_a",
            "evidence_at_ms": 12_000,
        }],
    }, headers=SERVICE_HEADERS)
    assert r.status_code == 201
    return r.json()["data"]["extraction_id"]


def _detail_evidence(client, extraction_id):
    body = client.get(f"/api/v1/extractions/{extraction_id}").json()["data"]
    return body["items"][0]["evidence"]


def test_request_evidence_and_transcript_path_have_no_columns(client, db, seed):
    """요청에 근거와 transcript_path를 실어도 저장할 컬럼이 없어 요청은 그대로 받아진다."""
    _extract(client, seed)

    assert not hasattr(Extraction, "transcript_path")
    assert not any(hasattr(ExtractionItem, c) for c in ("evidence_quote", "evidence_speaker", "evidence_at_ms"))
    assert db.execute(select(ExtractionItem)).scalar_one().task_title == "결제 환불 기능 구현"


def test_detail_evidence_is_null_without_source(client, seed):
    extraction_id = _extract(client, seed)
    assert _detail_evidence(client, extraction_id) == {"quote": None, "speaker": None, "at_ms": None, "speaker_member_id": None}


def test_detail_evidence_uses_task_source_with_largest_seq(client, db, seed):
    extraction_id = _extract(client, seed)
    item = db.execute(select(ExtractionItem)).scalar_one()
    sources = [
        Source(meeting_id=seed["meeting"], seq=seq, speaker_discord_user_id=f"uid{seq}",
               start_ms=seq * 1000, end_ms=seq * 1000 + 900, text=f"발화 {seq}")
        for seq in (1, 2, 3)
    ]
    db.add_all(sources)
    db.flush()
    by_seq = {s.seq: s for s in sources}
    db.add_all([
        Evidence(item_id=item.item_id, source_id=by_seq[3].source_id, type="task"),
        Evidence(item_id=item.item_id, source_id=by_seq[2].source_id, type="task"),
        # 담당자·마감 근거는 대표 근거로 쓰지 않는다
        Evidence(item_id=item.item_id, source_id=by_seq[1].source_id, type="assignee"),
    ])
    db.commit()

    assert _detail_evidence(client, extraction_id) == {
        "quote": "발화 3", "speaker": "uid3", "at_ms": 3000, "speaker_member_id": None,
    }


def _add_sources(db, meeting_id, seqs):
    db.add_all([
        Source(meeting_id=meeting_id, seq=seq, speaker_discord_user_id=f"uid{seq}",
               start_ms=seq * 1000, end_ms=seq * 1000 + 900, text=f"발화 {seq}")
        for seq in seqs
    ])
    db.commit()


def _extract_with_seqs(client, seed, evidence_seqs):
    item = {"task_title": "결제 환불 기능 구현", "task_confidence": 0.6}
    if evidence_seqs is not None:
        item["evidence_seqs"] = evidence_seqs
    r = client.post("/api/v1/extractions", json={
        "meeting_id": seed["meeting"], "workspace_id": seed["ws"], "items": [item],
    }, headers=SERVICE_HEADERS)
    assert r.status_code == 201
    return r.json()["data"]["extraction_id"]


def _saved_evidence_seqs(db):
    rows = db.execute(
        select(Source.seq, Evidence.type).join(Evidence, Evidence.source_id == Source.source_id)
        .order_by(Source.seq)
    ).all()
    return [tuple(row) for row in rows]


def test_evidence_seqs_saved_as_task_evidence(client, db, seed):
    _add_sources(db, seed["meeting"], (12, 13, 14, 15))
    extraction_id = _extract_with_seqs(client, seed, [15, 12, 13])

    item_id = db.execute(select(ExtractionItem.item_id)).scalar_one()
    assert db.execute(select(Evidence.item_id)).scalars().all() == [item_id] * 3
    assert _saved_evidence_seqs(db) == [(12, "task"), (13, "task"), (15, "task")]
    # 대표 근거는 가장 큰 seq의 발화다
    assert _detail_evidence(client, extraction_id) == {
        "quote": "발화 15", "speaker": "uid15", "at_ms": 15000, "speaker_member_id": None,
    }


def test_evidence_seqs_skip_unknown_seq(client, db, seed):
    """이 회의에 없는 seq는 그 seq만 건너뛴다. 다른 회의의 같은 seq도 쓰지 않는다."""
    other = Meeting(workspace_id=seed["ws"], status="done")
    db.add(other)
    db.flush()
    _add_sources(db, other.meeting_id, (7,))
    _add_sources(db, seed["meeting"], (2,))

    extraction_id = _extract_with_seqs(client, seed, [2, 7, 99])

    assert _saved_evidence_seqs(db) == [(2, "task")]
    assert _detail_evidence(client, extraction_id)["quote"] == "발화 2"


def test_evidence_seqs_duplicate_saved_once(client, db, seed):
    _add_sources(db, seed["meeting"], (2,))
    _extract_with_seqs(client, seed, [2, 2])

    assert _saved_evidence_seqs(db) == [(2, "task")]


def test_evidence_seqs_skip_warns_once_per_item(client, db, seed, caplog):
    """없는 seq는 seq마다가 아니라 항목마다 한 줄로 경고한다."""
    _add_sources(db, seed["meeting"], (2,))
    with caplog.at_level(logging.WARNING, logger="app.api.extractions"):
        _extract_with_seqs(client, seed, [9, 2, 7])

    warnings = [r.getMessage() for r in caplog.records if "근거 발화가 없어" in r.getMessage()]
    assert len(warnings) == 1
    assert "seqs=[7, 9]" in warnings[0]


@pytest.mark.parametrize("bad_seq", [-1, 2**31, 2**63])
def test_evidence_seqs_out_of_range_rejected(client, db, seed, bad_seq):
    """발화 저장 API의 seq 범위(0 ~ int4 최대) 밖이면 DB 조회 전에 요청에서 막는다."""
    r = client.post("/api/v1/extractions", json={
        "meeting_id": seed["meeting"], "workspace_id": seed["ws"],
        "items": [{"task_title": "환불 구현", "task_confidence": 0.6, "evidence_seqs": [1, bad_seq]}],
    }, headers=SERVICE_HEADERS)

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    assert db.get(Meeting, seed["meeting"]).status == "processing"


def test_evidence_seqs_too_many_rejected(client, db, seed):
    """항목 하나의 seq가 상한을 넘으면 DB 조회 전에 요청에서 막는다. 상한까지는 받는다."""
    def post(seqs):
        return client.post("/api/v1/extractions", json={
            "meeting_id": seed["meeting"], "workspace_id": seed["ws"],
            "items": [{"task_title": "환불 구현", "task_confidence": 0.6, "evidence_seqs": seqs}],
        }, headers=SERVICE_HEADERS)

    r = post(list(range(MAX_EVIDENCE_SEQS + 1)))
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    assert db.get(Meeting, seed["meeting"]).status == "processing"

    assert post(list(range(MAX_EVIDENCE_SEQS))).status_code == 201


@pytest.mark.parametrize("evidence_seqs", [None, []])
def test_evidence_seqs_empty_or_omitted_saves_nothing(client, db, seed, evidence_seqs):
    _add_sources(db, seed["meeting"], (1,))
    extraction_id = _extract_with_seqs(client, seed, evidence_seqs)

    assert db.execute(select(Evidence)).scalars().all() == []
    assert _detail_evidence(client, extraction_id) == {"quote": None, "speaker": None, "at_ms": None, "speaker_member_id": None}


def test_progress_transcribed_follows_source(client, db, seed):
    def transcribed():
        return client.get(f"/api/v1/meetings/{seed['meeting']}").json()["data"]["progress"]["transcribed"]

    assert transcribed() is False
    # transcript_path를 보내도 저장하지 않으므로, 추출만으로는 전사된 것으로 보지 않는다
    _extract(client, seed)
    assert transcribed() is False

    db.add(Source(meeting_id=seed["meeting"], seq=0, start_ms=0, end_ms=900, text="발화 0"))
    db.commit()
    assert transcribed() is True


# ── 대표 근거 발화(가장 큰 seq)를 1인칭 매칭·승인 요청·별칭 로그에 쓴다 ──

REQUEST_EVIDENCE = {
    "evidence_quote": "요청 문장", "evidence_speaker": "uid_request", "evidence_at_ms": 99_000,
}


def _add_member(db, seed, name, discord_user_id):
    member = Member(workspace_id=seed["ws"], display_name=name, role="member", discord_user_id=discord_user_id)
    db.add(member)
    db.commit()
    return member.member_id


def _post_items(client, seed, items):
    r = client.post("/api/v1/extractions", json={
        "meeting_id": seed["meeting"], "workspace_id": seed["ws"], "items": items,
    }, headers=SERVICE_HEADERS)
    assert r.status_code == 201


def _approval_payload(db):
    return json.loads(db.execute(select(ApprovalRequest)).scalar_one().payload)


@pytest.mark.parametrize(("evidence_speaker", "evidence_seqs", "expected"), [
    # 요청의 evidence_speaker가 있으면 근거 발화를 찾았어도 그 값이 먼저다
    ("uid_request", [2, 3], "요청 화자"),
    ("uid_request", [99], "요청 화자"),
    # 없으면 찾은 발화 중 seq가 가장 큰 발화의 화자
    (None, [2, 3], "화자3"),
    # 가장 큰 seq(결론 발화)가 빠지면 더 앞 발화(2)의 화자를 쓰지 않고 화자가 없는 1인칭 항목이다
    (None, [2, 99], None),
    # 둘 다 없으면 화자가 없는 1인칭 항목이다
    (None, [99], None),
])
def test_first_person_assignee_prefers_evidence_speaker(
    client, db, seed, evidence_speaker, evidence_seqs, expected
):
    _add_sources(db, seed["meeting"], (2, 3))
    members = {
        "화자2": _add_member(db, seed, "화자2", "uid2"),
        "화자3": _add_member(db, seed, "화자3", "uid3"),
        "요청 화자": _add_member(db, seed, "요청 화자", "uid_request"),
        None: None,
    }

    _post_items(client, seed, [{
        "task_title": "환불 구현", "task_confidence": 0.6, "assignee_type": "first", "assignee_raw": "제가",
        "evidence_seqs": evidence_seqs, **REQUEST_EVIDENCE, "evidence_speaker": evidence_speaker,
    }])

    assert db.execute(select(ExtractionItem)).scalar_one().assignee_member_id == members[expected]


def test_first_person_source_without_speaker_uses_evidence_speaker(client, db, seed):
    """찾은 발화의 화자가 비어 있어도 요청의 evidence_speaker로 찾는다. 승인 요청의 근거는 그 발화 그대로다."""
    db.add(Source(meeting_id=seed["meeting"], seq=4, start_ms=4000, end_ms=4900, text="발화 4"))
    db.commit()
    member_id = _add_member(db, seed, "요청 화자", "uid_request")

    _post_items(client, seed, [{
        "task_title": "환불 구현", "task_confidence": 0.3, "assignee_type": "first",
        "evidence_seqs": [4], **REQUEST_EVIDENCE,
    }])

    assert db.execute(select(ExtractionItem)).scalar_one().assignee_member_id == member_id
    payload = _approval_payload(db)
    assert (payload["evidence_quote"], payload["evidence_speaker"]) == ("발화 4", None)


@pytest.mark.parametrize("evidence_seqs", [[2, 99], None])
def test_first_person_without_speaker_skips_alias_lookup(client, db, seed, evidence_seqs):
    """화자를 모르는 1인칭은 assignee_raw를 별칭으로 찾지 않는다. 등록된 별칭이어도 담당자 없이 hold이고 판정 로그도 없다."""
    _add_sources(db, seed["meeting"], (2,))
    member_id = _add_member(db, seed, "민수", "uid_minsu")
    db.add(MemberAlias(
        member_id=member_id, workspace_id=seed["ws"], alias_text="민수",
        alias_type="nickname", source="manual", confidence=1.0, verified=True,
    ))
    db.commit()

    item = {
        "task_title": "환불 구현", "task_confidence": 0.9, "assignee_type": "first", "assignee_raw": "민수",
        **REQUEST_EVIDENCE, "evidence_speaker": None,
    }
    if evidence_seqs is not None:
        item["evidence_seqs"] = evidence_seqs
    _post_items(client, seed, [item])

    saved = db.execute(select(ExtractionItem)).scalar_one()
    assert (saved.assignee_member_id, saved.gate) == (None, "hold")
    assert db.execute(select(AliasResolutionLog)).scalars().all() == []


@pytest.mark.parametrize(("evidence_seqs", "expected"), [
    ([2, 3], {"evidence_quote": "발화 3", "evidence_speaker": "uid3", "evidence_at_ms": 3000}),
    # 결론 발화(99)가 빠져도 보여 주는 근거는 찾은 것 중 가장 큰 발화다. 1인칭 화자에만 쓰지 않는다
    ([2, 99], {"evidence_quote": "발화 2", "evidence_speaker": "uid2", "evidence_at_ms": 2000}),
    ([99], REQUEST_EVIDENCE),
    (None, REQUEST_EVIDENCE),
])
def test_create_approval_evidence_uses_representative_source(client, db, seed, evidence_seqs, expected):
    _add_sources(db, seed["meeting"], (2, 3))
    item = {"task_title": "환불 구현", "task_confidence": 0.3, **REQUEST_EVIDENCE}
    if evidence_seqs is not None:
        item["evidence_seqs"] = evidence_seqs
    _post_items(client, seed, [item])

    payload = _approval_payload(db)
    assert {k: payload[k] for k in expected} == expected


def test_update_approval_evidence_uses_representative_source(client, db, seed):
    _add_sources(db, seed["meeting"], (2, 3))
    target = Task(workspace_id=seed["ws"], title="환불 구현", status="todo")
    db.add(target)
    db.commit()

    _post_items(client, seed, [{
        "action": "update", "target_task_id": target.task_id, "due_date": "2026-11-01",
        "evidence_seqs": [3, 2], **REQUEST_EVIDENCE,
    }])

    payload = _approval_payload(db)
    assert payload["evidence_quote"] == "발화 3"
    assert payload["evidence_speaker"] == "uid3"
    assert payload["evidence_at_ms"] == 3000


@pytest.mark.parametrize(("evidence_seqs", "expected_seq"), [([2, 3], 3), ([99], None)])
def test_alias_log_records_representative_source(client, db, seed, evidence_seqs, expected_seq):
    _add_sources(db, seed["meeting"], (2, 3))
    _post_items(client, seed, [{
        "task_title": "환불 구현", "task_confidence": 0.6, "assignee_type": "thirdname", "assignee_raw": "민수",
        "evidence_seqs": evidence_seqs,
    }])

    log = db.execute(select(AliasResolutionLog)).scalar_one()
    expected = None
    if expected_seq is not None:
        expected = db.execute(select(Source.source_id).where(Source.seq == expected_seq)).scalar_one()
    assert log.source_id == expected


# ── evidence_speaker_member_id: 1인칭 화자를 멤버 ID 로 받는다 ──


def _add_speaker_members(db, seed):
    """@A, @B, @C 는 활성 멤버이고 @gone 은 탈퇴한 멤버다."""
    members = {
        "@A": _add_member(db, seed, "A", "uid_a"),
        "@B": _add_member(db, seed, "B", "uid_b"),
        "@C": _add_member(db, seed, "C", "uid_c"),
    }
    gone = Member(
        workspace_id=seed["ws"], display_name="gone", role="member", discord_user_id="uid_gone", is_deleted=True
    )
    db.add(gone)
    db.commit()
    members["@gone"] = gone.member_id
    return members


def _add_source_with_member(db, seed, seq, *, uid=None, member_id=None):
    db.add(Source(
        meeting_id=seed["meeting"], seq=seq, speaker_discord_user_id=uid, member_id=member_id,
        start_ms=seq * 1000, end_ms=seq * 1000 + 900, text=f"발화 {seq}",
    ))
    db.commit()


def _resolve(members, value):
    return members.get(value, value) if isinstance(value, str) else value


@pytest.mark.parametrize(("item_fields", "source", "expected"), [
    pytest.param(
        {"evidence_speaker_member_id": "@A", "evidence_speaker": "uid_b"},
        {"uid": "uid_c", "member_id": "@C"}, "@A", id="1_member_id_before_uid_and_conclusion_source",
    ),
    pytest.param(
        {"evidence_speaker": "uid_b"}, {"uid": "uid_c", "member_id": "@C"}, "@B", id="2_uid_before_source_member_id",
    ),
    pytest.param({}, {"uid": None, "member_id": "@C"}, "@C", id="3a_conclusion_source_member_id"),
    pytest.param(
        {}, {"uid": "uid_b", "member_id": "@C"}, "@C", id="3_source_member_id_before_source_uid"
    ),
    pytest.param({}, {"uid": "uid_b", "member_id": None}, "@B", id="3b_uid_fallback_when_member_id_null"),
    pytest.param({}, {"uid": "uid_b", "member_id": "@gone"}, "@B", id="3c_deleted_source_member_uses_uid"),
    pytest.param(
        {"evidence_seqs": [3, 99]}, {"uid": "uid_b", "member_id": "@C"}, None, id="3d_missing_conclusion_ignores_source"
    ),
    pytest.param({}, {"uid": None, "member_id": None}, None, id="4_nothing_is_hold"),
])
def test_first_person_speaker_priority(client, db, seed, item_fields, source, expected):
    members = _add_speaker_members(db, seed)
    _add_source_with_member(
        db, seed, 3, uid=source["uid"], member_id=_resolve(members, source["member_id"])
    )

    item = {
        "task_title": "환불 구현", "task_confidence": 0.6, "assignee_type": "first", "assignee_raw": "제가",
        "evidence_seqs": [3], **item_fields,
    }
    item["evidence_speaker_member_id"] = _resolve(members, item.get("evidence_speaker_member_id"))
    _post_items(client, seed, [item])

    saved = db.execute(select(ExtractionItem)).scalar_one()
    assert saved.assignee_member_id == _resolve(members, expected)
    if expected is None:
        assert saved.gate == "hold"


@pytest.mark.parametrize("wrong", ["no-such-member", "@gone", "other_workspace"])
def test_wrong_evidence_speaker_member_id_holds_only_that_item(client, db, seed, wrong):
    """틀린 ID 는 유효한 evidence_speaker 가 있어도 uid 를 못 찾은 것과 같다. 같은 요청의 다른 항목은 정상이다."""
    members = _add_speaker_members(db, seed)
    other_ws = Workspace(name="B")
    db.add(other_ws)
    db.flush()
    outsider = Member(workspace_id=other_ws.workspace_id, display_name="outsider", role="member")
    db.add(outsider)
    db.commit()
    wrong_id = outsider.member_id if wrong == "other_workspace" else _resolve(members, wrong)

    _post_items(client, seed, [
        {
            "task_title": "틀린 화자", "task_confidence": 0.6, "assignee_type": "first", "assignee_raw": "제가",
            "evidence_speaker": "uid_a", "evidence_speaker_member_id": wrong_id,
        },
        {
            "task_title": "정상 화자", "task_confidence": 0.6, "assignee_type": "first", "assignee_raw": "제가",
            "evidence_speaker": "uid_b",
        },
    ])

    saved = {i.task_title: i for i in db.execute(select(ExtractionItem)).scalars()}
    assert (saved["틀린 화자"].assignee_member_id, saved["틀린 화자"].gate) == (None, "hold")
    assert (saved["정상 화자"].assignee_member_id, saved["정상 화자"].gate) == (members["@B"], "review")


@pytest.mark.parametrize("wrong", ["no-such-member", "@gone"])
def test_wrong_evidence_speaker_member_id_does_not_fall_through_to_conclusion_source(client, db, seed, wrong):
    """(1)이 실패하면 활성 멤버가 연결된 결론 발화가 있어도 (3)으로 넘어가지 않는다."""
    members = _add_speaker_members(db, seed)
    _add_source_with_member(db, seed, 3, uid="uid_c", member_id=members["@C"])

    _post_items(client, seed, [{
        "task_title": "환불 구현", "task_confidence": 0.6, "assignee_type": "first", "assignee_raw": "제가",
        "evidence_seqs": [3], "evidence_speaker_member_id": _resolve(members, wrong),
    }])

    saved = db.execute(select(ExtractionItem)).scalar_one()
    assert (saved.assignee_member_id, saved.gate) == (None, "hold")


@pytest.mark.parametrize(("sent", "expected"), [
    pytest.param("@A", "@A", id="valid_member_id"),
    pytest.param("no-such-member", None, id="wrong_member_id"),
    pytest.param("@gone", None, id="deleted_member_id"),
])
def test_first_person_member_id_without_evidence_seqs(client, db, seed, sent, expected):
    """evidence_seqs 없이 멤버 ID 만 보내는 경로."""
    members = _add_speaker_members(db, seed)

    _post_items(client, seed, [{
        "task_title": "환불 구현", "task_confidence": 0.6, "assignee_type": "first", "assignee_raw": "제가",
        "evidence_speaker_member_id": _resolve(members, sent),
    }])

    assert db.execute(select(ExtractionItem)).scalar_one().assignee_member_id == _resolve(members, expected)


def test_blank_evidence_speaker_member_id_is_null_and_uses_uid(client, db, seed):
    members = _add_speaker_members(db, seed)

    _post_items(client, seed, [{
        "task_title": "환불 구현", "task_confidence": 0.6, "assignee_type": "first", "assignee_raw": "제가",
        "evidence_speaker_member_id": "   ", "evidence_speaker": "uid_b",
    }])

    assert db.execute(select(ExtractionItem)).scalar_one().assignee_member_id == members["@B"]


@pytest.mark.parametrize("bad", ["x" * 37, 123])
def test_evidence_speaker_member_id_invalid_type_or_length_rejected(client, db, seed, bad):
    r = client.post("/api/v1/extractions", json={
        "meeting_id": seed["meeting"], "workspace_id": seed["ws"],
        "items": [{"task_title": "환불 구현", "task_confidence": 0.6, "evidence_speaker_member_id": bad}],
    }, headers=SERVICE_HEADERS)

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    assert db.get(Meeting, seed["meeting"]).status == "processing"


def test_member_lookup_runs_once_per_request(client, db, seed):
    """항목이 여러 개이고 같은 member_id 가 반복돼도 멤버 조회는 IN 쿼리 한 번이다."""
    members = _add_speaker_members(db, seed)
    _add_source_with_member(db, seed, 3, uid="uid_b", member_id=members["@B"])
    _add_source_with_member(db, seed, 4, uid="uid_c", member_id=members["@C"])
    items = [
        {"task_title": f"업무 {n}", "task_confidence": 0.6, "assignee_type": "first", "assignee_raw": "제가",
         "evidence_seqs": [seq], "evidence_speaker_member_id": member_id}
        for n, (seq, member_id) in enumerate([(3, members["@A"]), (4, members["@A"]), (3, None), (4, "none")])
    ]
    statements: list[str] = []

    def record(conn, cursor, statement, *args):
        statements.append(statement)

    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", record)
    try:
        _post_items(client, seed, items)
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert len([s for s in statements if "member.member_id IN" in s]) == 1


def _detail_evidence_of_only_extraction(client, db):
    extraction_id = db.execute(select(Extraction.extraction_id)).scalar_one()
    return _detail_evidence(client, extraction_id)


def test_detail_evidence_speaker_member_id_is_source_member_id(client, db, seed):
    members = _add_speaker_members(db, seed)
    _add_source_with_member(db, seed, 3, uid="uid_b", member_id=members["@B"])
    # 요청값이 있어도 발화를 찾았으면 발화에 저장된 값 그대로다
    _post_items(client, seed, [{
        "task_title": "환불 구현", "task_confidence": 0.6, "evidence_seqs": [3],
        "evidence_speaker_member_id": members["@A"],
    }])

    assert _detail_evidence_of_only_extraction(client, db)["speaker_member_id"] == members["@B"]


def test_detail_evidence_speaker_member_id_keeps_stored_value_of_left_member(client, db, seed):
    """저장된 값을 그대로 싣는다. 탈퇴한 멤버여도 지우지 않는다."""
    members = _add_speaker_members(db, seed)
    _add_source_with_member(db, seed, 3, uid="uid_gone", member_id=members["@gone"])
    _post_items(client, seed, [{"task_title": "환불 구현", "task_confidence": 0.6, "evidence_seqs": [3]}])

    assert _detail_evidence_of_only_extraction(client, db)["speaker_member_id"] == members["@gone"]


def test_detail_evidence_speaker_member_id_is_null_without_source(client, db, seed):
    members = _add_speaker_members(db, seed)
    # 요청에만 있는 값은 상세 조회가 읽는 곳(근거 발화)에 없다
    _post_items(client, seed, [{
        "task_title": "환불 구현", "task_confidence": 0.6, "evidence_speaker_member_id": members["@A"],
    }])

    assert _detail_evidence_of_only_extraction(client, db)["speaker_member_id"] is None


@pytest.mark.parametrize(("sent", "expected"), [
    pytest.param("@A", "@A", id="active_request_value"),
    pytest.param("no-such-member", None, id="wrong_request_value"),
    pytest.param("@gone", None, id="deleted_request_value"),
    pytest.param(None, None, id="no_request_value"),
])
def test_create_approval_payload_speaker_member_id_without_source(client, db, seed, sent, expected):
    members = _add_speaker_members(db, seed)
    _post_items(client, seed, [{
        "task_title": "환불 구현", "task_confidence": 0.3, "evidence_seqs": [99],
        "evidence_speaker_member_id": _resolve(members, sent),
    }])

    assert _approval_payload(db)["evidence_speaker_member_id"] == _resolve(members, expected)


def test_create_approval_payload_speaker_member_id_uses_source_not_request(client, db, seed):
    members = _add_speaker_members(db, seed)
    _add_source_with_member(db, seed, 3, uid="uid_b", member_id=members["@B"])
    _add_source_with_member(db, seed, 4, uid="uid_c", member_id=None)

    _post_items(client, seed, [
        {"task_title": "발화 값", "task_confidence": 0.3, "evidence_seqs": [3],
         "evidence_speaker_member_id": members["@A"]},
        # 발화를 찾았는데 member_id 가 비어 있으면 요청값으로 채우지 않는다
        {"task_title": "빈 발화 값", "task_confidence": 0.3, "evidence_seqs": [4],
         "evidence_speaker_member_id": members["@A"]},
    ])

    payloads = {
        json.loads(a.payload)["task_title"]: json.loads(a.payload)
        for a in db.execute(select(ApprovalRequest)).scalars()
    }
    assert payloads["발화 값"]["evidence_speaker_member_id"] == members["@B"]
    assert payloads["빈 발화 값"]["evidence_speaker_member_id"] is None


def test_update_approval_payload_speaker_member_id_uses_source(client, db, seed):
    members = _add_speaker_members(db, seed)
    _add_source_with_member(db, seed, 3, uid="uid_b", member_id=members["@B"])
    target = Task(workspace_id=seed["ws"], title="환불 구현", status="todo")
    db.add(target)
    db.commit()

    _post_items(client, seed, [{
        "action": "update", "target_task_id": target.task_id, "due_date": "2026-11-01",
        "evidence_seqs": [3], "evidence_speaker_member_id": members["@A"],
    }])

    assert _approval_payload(db)["evidence_speaker_member_id"] == members["@B"]


@pytest.mark.parametrize(("sent", "expected"), [("@A", "@A"), ("@gone", None)])
def test_update_approval_payload_speaker_member_id_from_request_without_source(client, db, seed, sent, expected):
    members = _add_speaker_members(db, seed)
    target = Task(workspace_id=seed["ws"], title="환불 구현", status="todo")
    db.add(target)
    db.commit()

    _post_items(client, seed, [{
        "action": "update", "target_task_id": target.task_id, "due_date": "2026-11-01",
        "evidence_speaker_member_id": _resolve(members, sent),
    }])

    assert _approval_payload(db)["evidence_speaker_member_id"] == _resolve(members, expected)
