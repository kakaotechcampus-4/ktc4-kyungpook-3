"""전사 제목과 발화 줄 고치기(#605). 고친 값이 보이고, 원문이 남고, 근거 인용은 원문이고, 별칭은 생기지 않는다."""
import json
from datetime import datetime, timezone
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import AliasResolutionLog, ApprovalRequest, Extraction, ExtractionItem, Meeting, MemberAlias, Source
from tests.api.conftest import SERVICE_TOKEN

H = {"X-Service-Token": SERVICE_TOKEN}
T0 = datetime(2026, 11, 5, 5, 0, tzinfo=timezone.utc)
DOC = json.dumps({"overview": "핵심", "key_points": [], "decisions": []})


def _client(token: str | None = None) -> TestClient:
    client = TestClient(app, base_url="https://testserver")
    if token:
        client.cookies.set("session_token", token)
    return client


@pytest.fixture
def alice(mdb, mseed):
    """PM 이 아닌 팀원도 고친다."""
    return _client("alice-token")


def _meeting(db, ws, *, title="정기회의", source="discord", status="done", summary=None):
    meeting = Meeting(workspace_id=ws, source=source, status=status, started_at=T0, title=title, duration_ms=2000)
    db.add(meeting)
    db.flush()
    db.add_all([
        Source(meeting_id=meeting.meeting_id, seq=seq, start_ms=seq * 1000, end_ms=seq * 1000 + 900, text=f"원문 {seq}")
        for seq in (0, 1)
    ])
    if summary is not None:
        db.add(Extraction(meeting_id=meeting.meeting_id, summary=summary))
    db.commit()
    return meeting


def _title(client, meeting, title):
    return client.patch(f"/api/v1/meetings/{meeting.meeting_id}/title", json={"title": title})


def _line(client, meeting, seq, text):
    return client.patch(f"/api/v1/meetings/{meeting.meeting_id}/transcript/{seq}", json={"text": text})


def _minutes(client, meeting):
    r = client.get(f"/api/v1/meetings/{meeting.meeting_id}/minutes")
    assert r.status_code == 200, r.text
    return r.json()["data"]


EDITS = [("title", {"title": "새 제목"}), ("transcript/0", {"text": "고친 문장"})]


@pytest.mark.parametrize(("path", "body"), EDITS)
def test_edits_need_a_session_and_membership_and_a_known_meeting(mdb, mseed, path, body):
    meeting = _meeting(mdb, mseed["ws"])
    url = f"/api/v1/meetings/{meeting.meeting_id}/{path}"

    assert _client().patch(url, json=body).status_code == 401
    assert _client("outsider-token").patch(url, json=body).status_code == 403
    missing = _client("alice-token").patch(f"/api/v1/meetings/nope/{path}", json=body)
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "MEETING_NOT_FOUND")


@pytest.mark.parametrize(("path", "body"), EDITS)
def test_edits_on_a_deleted_meeting_are_410(mdb, mseed, alice, path, body):
    meeting = _meeting(mdb, mseed["ws"])
    meeting.deleted_at = datetime.now(timezone.utc)
    mdb.commit()

    r = alice.patch(f"/api/v1/meetings/{meeting.meeting_id}/{path}", json=body)

    assert (r.status_code, r.json()["error"]["code"]) == (410, "MEETING_DELETED")


@pytest.mark.parametrize("seq", [7, -1, 2**31, 2**64])
def test_unknown_line_is_404(mdb, mseed, alice, seq):
    r = _line(alice, _meeting(mdb, mseed["ws"]), seq, "고친 문장")

    assert (r.status_code, r.json()["error"]["code"]) == (404, "TRANSCRIPT_LINE_NOT_FOUND")


@pytest.mark.parametrize(("path", "body"), [
    ("title", {"title": "a\x00b"}),
    ("title", {"title": "   "}),
    ("title", {"title": "가" * 201}),
    ("title", {}),
    ("transcript/0", {"text": "a\ud800b"}),
    ("transcript/0", {"text": ""}),
    ("transcript/0", {"text": "   "}),
    ("transcript/0", {"text": "\u3000\n"}),
    ("transcript/0", {"text": "가" * 10001}),
])
def test_unstorable_empty_or_too_long_text_is_400(mdb, mseed, alice, path, body):
    meeting = _meeting(mdb, mseed["ws"])

    # json.dumps 가 서로게이트를 \ud800 이스케이프로 써서 그대로 보낸다
    r = alice.patch(f"/api/v1/meetings/{meeting.meeting_id}/{path}", content=json.dumps(body),
                    headers={"content-type": "application/json"})

    assert (r.status_code, r.json()["error"]["code"]) == (400, "INVALID_REQUEST")


def test_deeply_nested_unknown_key_is_ignored_like_any_other(mdb, mseed, alice):
    junk = "[" * 600 + "]" * 600
    headers = {"content-type": "application/json"}

    title = _client("outsider-token").patch(
        "/api/v1/meetings/nope/title", content='{"title": "x", "junk": ' + junk + "}", headers=headers,
    )
    decision = alice.patch(
        f"/api/v1/workspaces/{mseed['ws']}/decisions/nope", content='{"state": "invalid", "junk": ' + junk + "}",
        headers=headers,
    )

    assert (title.status_code, title.json()["error"]["code"]) == (404, "MEETING_NOT_FOUND")
    assert (decision.status_code, decision.json()["error"]["code"]) == (404, "DECISION_NOT_FOUND")


def test_edited_line_shows_in_minutes_and_summary_input_and_the_original_stays(mdb, mseed, alice):
    meeting = _meeting(mdb, mseed["ws"], summary=DOC)

    r = _line(alice, meeting, 1, "고친 문장")

    assert r.status_code == 200, r.text
    assert r.json()["data"] == {"seq": 1, "text": "고친 문장", "original_text": "원문 1", "edited": True}
    transcript = _minutes(alice, meeting)["transcript"]
    assert [(line["seq"], line["text"], line["edited"], line["original_text"]) for line in transcript] == [
        (0, "원문 0", False, None), (1, "고친 문장", True, "원문 1"),
    ]
    extraction_id = mdb.scalar(select(Extraction.extraction_id).where(Extraction.meeting_id == meeting.meeting_id))
    lines = _client().get(f"/api/v1/extractions/{extraction_id}/summary-input", headers=H).json()["data"]["lines"]
    assert [line["text"] for line in lines] == ["원문 0", "고친 문장"]


def test_edited_line_keeps_surrounding_spaces(mdb, mseed, alice):
    meeting = _meeting(mdb, mseed["ws"])

    r = _line(alice, meeting, 1, " 고친 문장 ")

    assert (r.status_code, r.json()["data"]["text"]) == (200, " 고친 문장 ")


@pytest.mark.parametrize("restore", [None, "원문 1"])
def test_null_or_the_original_text_restores_the_line(mdb, mseed, alice, restore):
    meeting = _meeting(mdb, mseed["ws"])
    _line(alice, meeting, 1, "고친 문장")

    r = _line(alice, meeting, 1, restore)

    assert r.json()["data"] == {"seq": 1, "text": "원문 1", "original_text": None, "edited": False}
    assert _minutes(alice, meeting)["transcript"][1]["edited"] is False


def test_edited_title_shows_in_minutes_list_summary_and_bundle(mdb, mseed, alice):
    meeting = _meeting(mdb, mseed["ws"], summary=DOC)

    r = _title(alice, meeting, "  3주차 회의  ")

    assert r.status_code == 200, r.text
    assert r.json()["data"] == {
        "meeting_id": meeting.meeting_id, "title": "3주차 회의", "title_original": "정기회의", "title_edited": True,
    }
    minutes = _minutes(alice, meeting)
    assert (minutes["title"], minutes["title_edited"], minutes["title_original"]) == ("3주차 회의", True, "정기회의")
    listed = alice.get(f"/api/v1/workspaces/{mseed['ws']}/meetings").json()["data"]["items"]
    assert [item["title"] for item in listed] == ["3주차 회의"]
    markdown = alice.get(f"/api/v1/meetings/{meeting.meeting_id}/summary.md")
    assert quote("2026-11-05 3주차 회의.md", safe="") in markdown.headers["content-disposition"]
    assert "# 3주차 회의\n" in markdown.text
    assert "### 3주차 회의\n" in alice.get(f"/api/v1/workspaces/{mseed['ws']}/project-bundle.md").text


def test_second_edit_keeps_the_recorded_title_and_null_restores_it(mdb, mseed, alice):
    meeting = _meeting(mdb, mseed["ws"])
    _title(alice, meeting, "3주차 회의")
    _title(alice, meeting, "4주차 회의")

    r = _title(alice, meeting, None)

    assert r.json()["data"] == {
        "meeting_id": meeting.meeting_id, "title": "정기회의", "title_original": None, "title_edited": False,
    }
    minutes = _minutes(alice, meeting)
    assert (minutes["title"], minutes["title_edited"], minutes["title_original"]) == ("정기회의", False, None)


def test_null_on_a_title_never_edited_changes_nothing(mdb, mseed, alice):
    meeting = _meeting(mdb, mseed["ws"])

    r = _title(alice, meeting, None)

    assert r.json()["data"] == {
        "meeting_id": meeting.meeting_id, "title": "정기회의", "title_original": None, "title_edited": False,
    }


def test_title_given_to_an_untitled_meeting_is_marked_and_restores_to_none(mdb, mseed, alice):
    meeting = _meeting(mdb, mseed["ws"], title=None)

    named = _title(alice, meeting, "이름 붙임").json()["data"]
    restored = _title(alice, meeting, None).json()["data"]

    assert (named["title"], named["title_original"], named["title_edited"]) == ("이름 붙임", None, True)
    assert (restored["title"], restored["title_edited"]) == (None, False)


def test_daily_summary_head_uses_the_edited_title(mdb, mseed, alice):
    meeting = _meeting(mdb, mseed["ws"], source="chat", title="채팅 2026-11-05", summary=DOC)
    url = f"/api/v1/meetings/{meeting.meeting_id}/summary.md"
    assert quote("2026-11-05 일일 요약.md", safe="") in alice.get(url).headers["content-disposition"]

    _title(alice, meeting, "출시 준비 채팅")

    markdown = alice.get(url)
    assert quote("2026-11-05 출시 준비 채팅.md", safe="") in markdown.headers["content-disposition"]
    assert "# 출시 준비 채팅\n" in markdown.text and '종류: "일일 요약"' in markdown.text


def test_evidence_and_revert_quote_the_original_and_no_alias_is_written(mdb, mseed, alice):
    pm = _client("pm-token")
    meeting = _meeting(mdb, mseed["ws"], status="processing")
    mdb.add(MemberAlias(member_id=mseed["alice"].member_id, workspace_id=mseed["ws"], alias_text="앨리스님",
                        alias_type="nickname", source="manual", confidence=1.0, verified=True))
    mdb.commit()
    r = pm.post("/api/v1/extractions", json={"meeting_id": meeting.meeting_id, "workspace_id": mseed["ws"], "items": [{
        "task_title": "자동 태스크", "task_confidence": 0.99, "assignee_raw": "앨리스님", "assignee_type": "thirdname",
        "evidence_seqs": [1],
    }]}, headers=H)
    assert r.status_code == 201, r.text
    extraction_id = r.json()["data"]["extraction_id"]
    item_id = mdb.scalar(select(ExtractionItem.item_id).where(ExtractionItem.extraction_id == extraction_id))
    counts = (mdb.scalar(select(func.count()).select_from(MemberAlias)),
              mdb.scalar(select(func.count()).select_from(AliasResolutionLog)))

    _line(alice, meeting, 1, "앨리스님이 맡기로")
    _title(alice, meeting, "앨리스님 회의")

    assert (mdb.scalar(select(func.count()).select_from(MemberAlias)),
            mdb.scalar(select(func.count()).select_from(AliasResolutionLog))) == counts
    detail = pm.get(f"/api/v1/extractions/{extraction_id}").json()["data"]["items"][0]
    assert detail["evidence"]["quote"] == "원문 1"
    assert pm.post(f"/api/v1/extractions/{extraction_id}/items/{item_id}/revert").status_code == 200
    mdb.expire_all()
    card = mdb.scalar(select(ApprovalRequest).join(ExtractionItem, ExtractionItem.approval_id == ApprovalRequest.approval_id)
                      .where(ExtractionItem.item_id == item_id))
    assert json.loads(card.payload)["evidence_quote"] == "원문 1"
