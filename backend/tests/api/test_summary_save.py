"""요약 저장. 주제 재사용, 경계 밖 ID, 재실행, 번복, 황금 파일."""
import json
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.models import (
    Decision,
    Extraction,
    ExtractionItem,
    Meeting,
    Source,
    Topic,
    TopicItem,
    TopicMeeting,
    Workspace,
)
from app.schemas.project_map import SummaryWriteRequest
from app.services import summary
from tests.api.conftest import SERVICE_TOKEN

H = {"X-Service-Token": SERVICE_TOKEN}
T0 = datetime(2026, 11, 5, 5, 0, tzinfo=timezone.utc)
GOLDEN = Path(__file__).resolve().parents[3] / "ai/tests/capture/fixtures/summary_put.json"


def _meeting(db, ws, *, started_at=T0, title="정기회의", items=0):
    meeting = Meeting(workspace_id=ws, source="discord", status="done", started_at=started_at, title=title)
    db.add(meeting)
    db.flush()
    db.add(Source(meeting_id=meeting.meeting_id, seq=0, start_ms=0, end_ms=900, text="안녕하세요"))
    extraction = Extraction(meeting_id=meeting.meeting_id, summary_requested_at=T0)
    db.add(extraction)
    db.flush()
    rows = [ExtractionItem(extraction_id=extraction.extraction_id, task_title=f"항목{i}") for i in range(items)]
    db.add_all(rows)
    db.commit()
    return meeting, extraction, rows


def _save(db, extraction, topics=(), **fields):
    body = {"model_name": "m", "overview": "핵심", "key_points": ["하나"], "topics": list(topics), **fields}
    claim = summary.claim_next(db, only=[extraction.extraction_id])
    body["claim_token"] = claim.claim_token
    result = summary.save_summary(db, extraction.extraction_id, SummaryWriteRequest(**body))
    db.commit()
    return result


def _requeue(db, extraction):
    extraction.summary_requested_at = T0
    db.commit()


def _topics(db):
    return db.scalars(select(Topic).order_by(Topic.created_at)).all()


def _decision(db, text):
    return db.scalars(select(Decision).where(Decision.text == text).execution_options(populate_existing=True)).one()


def _document(db, extraction):
    db.refresh(extraction)
    return json.loads(extraction.summary)


def _topic_meetings(db, meeting):
    return set(db.scalars(select(TopicMeeting.topic_id).where(TopicMeeting.meeting_id == meeting.meeting_id)))


@pytest.mark.parametrize("name", ["로그인·계정", "로그인 계정", "로그인/계정", "  로그인 ， 계정 ", "로그인계정"])
def test_spelling_differences_share_a_key(name):
    assert summary.normalize_topic_name(name) == "로그인계정"


def test_key_folds_case_and_width():
    assert summary.normalize_topic_name("ＡＰＩ Design") == summary.normalize_topic_name("api-design") == "apidesign"


def test_key_never_exceeds_the_column():
    assert len(summary.normalize_topic_name("ﷺ" * 100)) == 100


def test_document_always_has_the_three_screen_keys_and_decisions_as_strings(mdb, mseed):
    _, extraction, _ = _meeting(mdb, mseed["ws"])

    _save(mdb, extraction)

    assert _document(mdb, extraction) == {
        "overview": "핵심", "key_points": ["하나"], "decisions": [], "schema_version": 2, "discussion": [],
        "decision_details": [], "facts": [], "task_changes": [], "schedule": [], "open_items": [], "topics": [],
        "topic_ids": [], "meta": {"model": "m", "truncated_input": False},
    }


def test_document_derives_decisions_and_topics(mdb, mseed):
    _, extraction, _ = _meeting(mdb, mseed["ws"])

    result = _save(mdb, extraction, [
        {"name": "초대", "decisions": [{"text": "이메일만", "reason": "유출", "rejected": ["코드"]}]},
        {"name": "로그인", "decisions": [{"text": "카카오 먼저"}]},
    ], truncated_input=True)

    document = _document(mdb, extraction)
    assert document["decisions"] == ["이메일만", "카카오 먼저"]
    assert document["topics"] == ["초대", "로그인"]
    assert document["meta"]["truncated_input"] is True
    rows = mdb.scalars(select(Decision).order_by(Decision.position)).all()
    assert document["decision_details"][0] == {
        "decision_id": rows[0].decision_id, "text": "이메일만", "reason": "유출", "rejected": ["코드"], "topic": "초대",
        "replaces": [],
    }
    assert [d["decision_id"] for d in document["decision_details"]] == [d.decision_id for d in rows]
    topic_ids = {t.name: t.topic_id for t in _topics(mdb)}
    assert document["topic_ids"] == [topic_ids["초대"], topic_ids["로그인"]]
    assert (result.topic_count, result.decision_count) == (2, 2)
    assert [d.position for d in rows] == [0, 1]


def test_document_keeps_the_item_key_of_each_task_change(mdb, mseed):
    _, extraction, [item] = _meeting(mdb, mseed["ws"], items=1)

    _save(mdb, extraction, task_changes=[{"task": "배포", "item_id": item.item_id}, {"task": "키 없음"}])

    assert [(c["task"], c["item_id"]) for c in _document(mdb, extraction)["task_changes"]] == [
        ("배포", item.item_id), ("키 없음", None),
    ]


def test_korean_is_stored_unescaped(mdb, mseed):
    _, extraction, _ = _meeting(mdb, mseed["ws"])

    _save(mdb, extraction)

    mdb.refresh(extraction)
    assert "핵심" in extraction.summary


def test_topic_with_no_items_or_decisions_still_links_the_meeting(mdb, mseed):
    meeting, extraction, _ = _meeting(mdb, mseed["ws"])

    _save(mdb, extraction, [{"name": "논의만 한 주제"}])

    assert _topic_meetings(mdb, meeting) == {_topics(mdb)[0].topic_id}


def test_existing_topic_is_reused_by_id(mdb, mseed):
    _, first, _ = _meeting(mdb, mseed["ws"], started_at=T0 - timedelta(days=1))
    second_meeting, second, _ = _meeting(mdb, mseed["ws"])
    _save(mdb, first, [{"name": "로그인"}])
    topic_id = _topics(mdb)[0].topic_id

    _save(mdb, second, [{"topic_id": topic_id}])

    assert len(_topics(mdb)) == 1
    assert _topic_meetings(mdb, second_meeting) == {topic_id}


def test_new_name_with_known_key_reuses_the_row_and_keeps_first_spelling(mdb, mseed):
    _, first, _ = _meeting(mdb, mseed["ws"], started_at=T0 - timedelta(days=1))
    _, second, _ = _meeting(mdb, mseed["ws"])
    _save(mdb, first, [{"name": "로그인·계정", "description": "처음 설명"}])

    _save(mdb, second, [{"name": "로그인 계정", "description": "다른 설명"}])

    topic = _topics(mdb)[0]
    assert len(_topics(mdb)) == 1
    assert (topic.name, topic.description, topic.name_key) == ("로그인·계정", "처음 설명", "로그인계정")


def test_same_name_in_two_workspaces_is_two_topics(mdb, mseed):
    other = Workspace(name="B")
    mdb.add(other)
    mdb.flush()
    _, mine, _ = _meeting(mdb, mseed["ws"])
    _, theirs, _ = _meeting(mdb, other.workspace_id)

    _save(mdb, mine, [{"name": "로그인"}])
    _save(mdb, theirs, [{"name": "로그인"}])

    assert {t.workspace_id for t in _topics(mdb)} == {mseed["ws"], other.workspace_id}


def test_one_body_naming_a_topic_twice_writes_one_set_of_links(mdb, mseed):
    meeting, first, items = _meeting(mdb, mseed["ws"], started_at=T0 - timedelta(days=1), items=1)
    _save(mdb, first, [{"name": "로그인"}])
    topic_id = _topics(mdb)[0].topic_id
    _requeue(mdb, first)
    item_id = items[0].item_id

    result = _save(mdb, first, [
        {"topic_id": topic_id, "item_ids": [item_id, item_id], "decisions": [{"text": "하나"}]},
        {"name": "로그인", "item_ids": [item_id], "decisions": [{"text": "둘"}]},
        {"name": "로 그 인", "decisions": []},
    ])

    assert (result.topic_count, result.decision_count) == (1, 2)
    assert len(mdb.scalars(select(TopicMeeting)).all()) == 1
    assert len(mdb.scalars(select(TopicItem)).all()) == 1
    assert _document(mdb, first)["topics"] == ["로그인"]


def test_name_without_letters_is_skipped(mdb, mseed):
    meeting, extraction, _ = _meeting(mdb, mseed["ws"])

    result = _save(mdb, extraction, [{"name": "···", "decisions": [{"text": "버려짐"}]}, {"name": "로그인"}])

    assert (result.topic_count, result.decision_count) == (1, 0)
    assert [t.name for t in _topics(mdb)] == ["로그인"]


@pytest.mark.parametrize("foreign", [True, False])
def test_unknown_or_foreign_topic_id_is_skipped_with_its_decisions(mdb, mseed, foreign):
    other = Workspace(name="B")
    mdb.add(other)
    mdb.flush()
    _, theirs, _ = _meeting(mdb, other.workspace_id, started_at=T0 - timedelta(days=1))
    _save(mdb, theirs, [{"name": "남의 주제"}])
    topic_id = _topics(mdb)[0].topic_id if foreign else "nope"
    _, extraction, _ = _meeting(mdb, mseed["ws"])

    result = _save(mdb, extraction, [
        {"topic_id": topic_id, "decisions": [{"text": "버려짐"}]},
        {"name": "내 주제", "decisions": [{"text": "남음"}]},
    ])

    assert (result.topic_count, result.decision_count) == (1, 1)
    assert _document(mdb, extraction)["decisions"] == ["남음"]
    assert mdb.scalars(select(Decision.text)).all() == ["남음"]


def test_item_of_another_extraction_or_unknown_is_skipped(mdb, mseed):
    _, other, other_items = _meeting(mdb, mseed["ws"], items=1)
    _, extraction, items = _meeting(mdb, mseed["ws"], items=1)

    _save(mdb, extraction, [{"name": "주제", "item_ids": [items[0].item_id, other_items[0].item_id, "nope"]}])

    assert mdb.scalars(select(TopicItem.item_id)).all() == [items[0].item_id]


def test_decision_replaced_links_old_row_and_copies_it_into_the_document(mdb, mseed):
    ws = mseed["ws"]
    _, old, _ = _meeting(mdb, ws, started_at=T0 - timedelta(days=9), title="범위 재조정")
    _, new, _ = _meeting(mdb, ws)
    _save(mdb, old, [{"name": "초대", "decisions": [{"text": "코드로 합류"}]}])
    old_id = _decision(mdb, "코드로 합류").decision_id

    _save(mdb, new, [{"name": "초대", "decisions": [{"text": "이메일로만", "replaces": [old_id]}]}])

    assert _decision(mdb, "코드로 합류").replaced_by == _decision(mdb, "이메일로만").decision_id
    assert _document(mdb, new)["decision_details"][0]["replaces"] == [{
        "decision_id": old_id, "text": "코드로 합류", "meeting_id": old.meeting_id, "meeting_title": "범위 재조정",
        "decided_on": "2026-10-27",
    }]


def test_unknown_foreign_and_later_decisions_are_not_replaced(mdb, mseed):
    ws = mseed["ws"]
    other = Workspace(name="B")
    mdb.add(other)
    mdb.flush()
    _, foreign, _ = _meeting(mdb, other.workspace_id, started_at=T0 - timedelta(days=9))
    _, later, _ = _meeting(mdb, ws, started_at=T0 + timedelta(days=1))
    _, extraction, _ = _meeting(mdb, ws)
    _save(mdb, foreign, [{"name": "남의 주제", "decisions": [{"text": "남의 결정"}]}])
    _save(mdb, later, [{"name": "주제", "decisions": [{"text": "늦은 결정"}]}])
    ids = [_decision(mdb, "남의 결정").decision_id, _decision(mdb, "늦은 결정").decision_id, "nope"]

    _save(mdb, extraction, [{"name": "주제", "decisions": [{"text": "새 결정", "replaces": ids}]}])

    assert _decision(mdb, "남의 결정").replaced_by is None
    assert _decision(mdb, "늦은 결정").replaced_by is None
    assert _document(mdb, extraction)["decision_details"][0]["replaces"] == []


def test_rerun_replaces_this_meetings_rows_and_restores_what_it_had_replaced(mdb, mseed):
    ws = mseed["ws"]
    _, old, _ = _meeting(mdb, ws, started_at=T0 - timedelta(days=9))
    meeting, extraction, items = _meeting(mdb, ws, items=2)
    _save(mdb, old, [{"name": "초대", "decisions": [{"text": "코드로 합류"}]}])
    old_id = _decision(mdb, "코드로 합류").decision_id
    _save(mdb, extraction, [
        {"name": "초대", "item_ids": [items[0].item_id], "decisions": [{"text": "이메일로만", "replaces": [old_id]}]},
    ])
    _requeue(mdb, extraction)

    _save(mdb, extraction, [{"name": "초대", "item_ids": [items[1].item_id], "decisions": [{"text": "그대로 둔다"}]}])

    assert sorted(mdb.scalars(select(Decision.text))) == ["그대로 둔다", "코드로 합류"]
    assert _decision(mdb, "코드로 합류").replaced_by is None
    assert mdb.scalars(select(TopicItem.item_id)).all() == [items[1].item_id]


def test_rerun_that_replaces_again_links_again(mdb, mseed):
    ws = mseed["ws"]
    _, old, _ = _meeting(mdb, ws, started_at=T0 - timedelta(days=9))
    _, extraction, _ = _meeting(mdb, ws)
    _save(mdb, old, [{"name": "초대", "decisions": [{"text": "코드로 합류"}]}])
    old_id = _decision(mdb, "코드로 합류").decision_id
    body = [{"name": "초대", "decisions": [{"text": "이메일로만", "replaces": [old_id]}]}]
    _save(mdb, extraction, body)
    _requeue(mdb, extraction)

    _save(mdb, extraction, body)

    assert _decision(mdb, "코드로 합류").replaced_by == _decision(mdb, "이메일로만").decision_id


def test_rerun_of_a_meeting_whose_decision_was_replaced_later(mdb, mseed):
    ws = mseed["ws"]
    _, old, _ = _meeting(mdb, ws, started_at=T0 - timedelta(days=9))
    _, new, _ = _meeting(mdb, ws)
    _save(mdb, old, [{"name": "초대", "decisions": [{"text": "코드로 합류"}]}])
    _save(mdb, new, [{"name": "초대", "decisions": [
        {"text": "이메일로만", "replaces": [_decision(mdb, "코드로 합류").decision_id]},
    ]}])
    _requeue(mdb, old)

    _save(mdb, old, [{"name": "초대", "decisions": [{"text": "코드로 합류"}]}])

    # 설계상 받아들인 손실이다. 단건 재실행은 늦은 회의가 건 번복을 잃고, 시간순 전체 재처리가 맞춘다
    assert _decision(mdb, "코드로 합류").replaced_by is None
    assert _document(mdb, new)["decision_details"][0]["replaces"][0]["text"] == "코드로 합류"


def test_rerun_deletes_topic_no_meeting_uses_anymore(mdb, mseed):
    _, extraction, items = _meeting(mdb, mseed["ws"], items=1)
    _save(mdb, extraction, [
        {"name": "버릴 주제", "item_ids": [items[0].item_id], "decisions": [{"text": "결정"}]},
        {"name": "남을 주제"},
    ])
    _requeue(mdb, extraction)

    _save(mdb, extraction, [{"name": "남을 주제"}])

    assert [t.name for t in _topics(mdb)] == ["남을 주제"]


def test_topic_deleted_after_the_input_was_read_is_found_again_by_name(mdb, mseed):
    """A 를 다시 요약하며 지운 주제를 B 의 재료가 이미 넘겨받았다. B 의 결정이 조용히 사라지면 안 된다."""
    _, first, _ = _meeting(mdb, mseed["ws"], started_at=T0 - timedelta(days=1))
    _save(mdb, first, [{"name": "배포"}])
    stale = _topics(mdb)[0]
    stale_id, stale_name = stale.topic_id, stale.name
    _requeue(mdb, first)
    _save(mdb, first, [{"name": "인프라"}])
    _, later, _ = _meeting(mdb, mseed["ws"])

    result = _save(mdb, later, [{"topic_id": stale_id, "name": stale_name, "decisions": [{"text": "도커로 간다"}]}])

    assert (result.topic_count, result.decision_count) == (1, 1)
    assert sorted(t.name for t in _topics(mdb)) == ["배포", "인프라"]
    assert mdb.scalars(select(Decision.text)).all() == ["도커로 간다"]


def test_known_topic_id_wins_over_the_name_sent_with_it(mdb, mseed):
    _, first, _ = _meeting(mdb, mseed["ws"], started_at=T0 - timedelta(days=1))
    _save(mdb, first, [{"name": "배포"}])
    topic_id = _topics(mdb)[0].topic_id
    _, later, _ = _meeting(mdb, mseed["ws"])

    _save(mdb, later, [{"topic_id": topic_id, "name": "다른 이름"}])

    assert [(t.topic_id, t.name) for t in _topics(mdb)] == [(topic_id, "배포")]


def test_rerun_keeps_topic_another_meeting_still_uses(mdb, mseed):
    ws = mseed["ws"]
    other_meeting, other, _ = _meeting(mdb, ws, started_at=T0 - timedelta(days=1))
    _, extraction, _ = _meeting(mdb, ws)
    _save(mdb, other, [{"name": "공유 주제", "decisions": [{"text": "앞 회의 결정"}]}])
    topic_id = _topics(mdb)[0].topic_id
    _save(mdb, extraction, [{"topic_id": topic_id}])
    _requeue(mdb, extraction)

    _save(mdb, extraction, [{"name": "새 주제"}])

    assert {t.name for t in _topics(mdb)} == {"공유 주제", "새 주제"}
    assert _decision(mdb, "앞 회의 결정").topic_id == topic_id
    assert _topic_meetings(mdb, other_meeting) == {topic_id}


def test_rerun_reusing_a_topic_by_id_keeps_it(mdb, mseed):
    _, extraction, _ = _meeting(mdb, mseed["ws"])
    _save(mdb, extraction, [{"name": "주제"}])
    topic_id = _topics(mdb)[0].topic_id
    _requeue(mdb, extraction)

    _save(mdb, extraction, [{"topic_id": topic_id}])

    assert [t.topic_id for t in _topics(mdb)] == [topic_id]


def test_two_meetings_creating_one_new_topic_at_once_share_it(mdb, mseed):
    if mdb.get_bind().dialect.name != "postgresql":
        pytest.skip("유니크 경합은 PostgreSQL 에서만 확인한다")
    ws = mseed["ws"]
    first_meeting, first, _ = _meeting(mdb, ws, started_at=T0 - timedelta(days=1))
    second_meeting, second, _ = _meeting(mdb, ws)
    first_id, second_id = first.extraction_id, second.extraction_id
    Session = sessionmaker(bind=mdb.get_bind(), autoflush=False)
    second_claim = summary.claim_next(mdb, only=[second_id])
    first_claim = summary.claim_next(mdb, only=[first_id])
    mdb.commit()
    payload = SummaryWriteRequest(claim_token=first_claim.claim_token, model_name="m", overview="핵심",
                                  key_points=[], topics=[{"name": "새 주제"}])
    other_payload = payload.model_copy(update={"claim_token": second_claim.claim_token})
    holder, other = Session(), Session()
    outcome = []

    summary.save_summary(holder, first_id, payload)

    def blocked_on_workspace():
        outcome.append(summary.save_summary(other, second_id, other_payload))
        other.commit()

    thread = threading.Thread(target=blocked_on_workspace)
    thread.start()
    time.sleep(0.5)
    holder.commit()
    thread.join(10)
    holder.close()
    other.close()

    assert not thread.is_alive()
    assert outcome[0].applied is True
    assert len(_topics(mdb)) == 1
    assert _topic_meetings(mdb, first_meeting) == _topic_meetings(mdb, second_meeting)


def test_rerun_that_emits_the_old_name_lands_on_the_renamed_topic(mdb, mseed):
    meeting, extraction, _ = _meeting(mdb, mseed["ws"])
    _save(mdb, extraction, [{"name": "배포"}])
    topic_id = _topics(mdb)[0].topic_id
    summary.rename_topic(mdb, mseed["ws"], topic_id, name="인프라 배포", description=None)
    mdb.commit()
    _requeue(mdb, extraction)

    _save(mdb, extraction, [{"name": "배포", "decisions": [{"text": "도커로 간다"}]}])

    assert [(t.topic_id, t.name) for t in _topics(mdb)] == [(topic_id, "인프라 배포")]
    assert _decision(mdb, "도커로 간다").topic_id == topic_id
    assert _topic_meetings(mdb, meeting) == {topic_id}


@pytest.mark.parametrize("entry", [
    {"topic_id": "merged", "name": "배포"},
    {"name": "배포"},
    {"topic_id": "merged"},
])
def test_merged_away_topic_does_not_come_back(mdb, mseed, entry):
    meeting, extraction, _ = _meeting(mdb, mseed["ws"])
    _save(mdb, extraction, [{"name": "배포"}, {"name": "인프라"}])
    merged, into = (t.topic_id for t in _topics(mdb))
    summary.merge_topics(mdb, mseed["ws"], merged, into)
    mdb.commit()
    _requeue(mdb, extraction)

    _save(mdb, extraction, [{**entry, "topic_id": merged} if "topic_id" in entry else entry])

    assert [t.topic_id for t in _topics(mdb)] == [into]
    assert _topic_meetings(mdb, meeting) == {into}


def test_edited_topic_the_rerun_drops_is_kept_on_its_meeting(mdb, mseed):
    meeting, extraction, _ = _meeting(mdb, mseed["ws"])
    _save(mdb, extraction, [{"name": "배포"}, {"name": "인프라"}])
    edited = next(t for t in _topics(mdb) if t.name == "배포")
    summary.rename_topic(mdb, mseed["ws"], edited.topic_id, name=None, description="사람이 쓴 설명")
    mdb.commit()
    _requeue(mdb, extraction)

    _save(mdb, extraction, [{"name": "인프라"}])

    assert sorted(t.name for t in _topics(mdb)) == ["배포", "인프라"]
    assert edited.topic_id in _topic_meetings(mdb, meeting)


def _edit_decision(db, ws, current, **change):
    edited = summary.edit_decision(db, ws, _decision(db, current).decision_id, text=change.get("text"),
                                   state=change.get("state"))
    db.commit()
    return edited.decision_id


def test_edited_decision_freezes_the_meetings_decisions_on_a_rerun(mdb, mseed):
    ws = mseed["ws"]
    _, extraction, _ = _meeting(mdb, ws)
    _save(mdb, extraction, [{"name": "초대", "decisions": [{"text": "이메일로만", "rejected": ["코드"]}, {"text": "코드 없이"}]}])
    before = [d.decision_id for d in mdb.scalars(select(Decision).order_by(Decision.position))]
    _edit_decision(mdb, ws, "이메일로만", text="이메일 초대만")
    _requeue(mdb, extraction)

    result = _save(mdb, extraction, [{"name": "초대", "decisions": [{"text": "이메일로만"}, {"text": "새 결정"}]}])

    rows = mdb.scalars(select(Decision).order_by(Decision.position).execution_options(populate_existing=True)).all()
    assert [(d.decision_id, d.text) for d in rows] == list(zip(before, ["이메일 초대만", "코드 없이"]))
    document = _document(mdb, extraction)
    assert [d["decision_id"] for d in document["decision_details"]] == before
    assert document["decision_details"][0]["rejected"] == ["코드"]
    assert result.decision_count == 2


def test_removed_decision_stays_gone_after_reruns_that_drop_its_topic(mdb, mseed):
    if mdb.get_bind().dialect.name == "sqlite":
        # 주제가 지워지면 결정이 FK 로 따라 지워지는 것을 운영 DB 처럼 본다
        mdb.connection().exec_driver_sql("PRAGMA foreign_keys=ON")
    ws = mseed["ws"]
    meeting, extraction, _ = _meeting(mdb, ws)
    _save(mdb, extraction, [{"name": "초대", "decisions": [{"text": "코드로 합류"}]}])
    topic_id = _topics(mdb)[0].topic_id
    removed = _edit_decision(mdb, ws, "코드로 합류", state="removed")

    for _ in range(2):
        _requeue(mdb, extraction)
        _save(mdb, extraction, [{"name": "다른 주제"}])
        assert topic_id in _topic_meetings(mdb, meeting)
    _requeue(mdb, extraction)
    _save(mdb, extraction, [{"name": "초대", "decisions": [{"text": "코드로 합류"}]}])

    assert [(d.decision_id, d.topic_id, d.state)
            for d in mdb.scalars(select(Decision).execution_options(populate_existing=True))] == [
        (removed, topic_id, "removed"),
    ]


def _replaced_pair(db, ws):
    _, old, _ = _meeting(db, ws, started_at=T0 - timedelta(days=9))
    _, new, _ = _meeting(db, ws)
    _save(db, old, [{"name": "초대", "decisions": [{"text": "코드로 합류"}]}])
    _save(db, new, [{"name": "초대", "decisions": [
        {"text": "이메일로만", "replaces": [_decision(db, "코드로 합류").decision_id]},
    ]}])
    return new


def test_removing_a_replacing_decision_makes_the_old_one_valid_and_valid_undoes_it(mdb, mseed):
    ws = mseed["ws"]
    _replaced_pair(mdb, ws)

    _edit_decision(mdb, ws, "이메일로만", state="removed")
    assert _decision(mdb, "코드로 합류").replaced_by is None

    _edit_decision(mdb, ws, "이메일로만", state="valid")
    assert _decision(mdb, "코드로 합류").replaced_by == _decision(mdb, "이메일로만").decision_id
    assert _decision(mdb, "이메일로만").state == "valid"


def test_invalid_decision_keeps_its_link_and_leaves_the_summary_input(mdb, mseed):
    ws = mseed["ws"]
    _replaced_pair(mdb, ws)
    _, later, _ = _meeting(mdb, ws, started_at=T0 + timedelta(days=1))
    _edit_decision(mdb, ws, "이메일로만", state="invalid")

    assert _decision(mdb, "코드로 합류").replaced_by == _decision(mdb, "이메일로만").decision_id
    assert summary.summary_input(mdb, later.extraction_id).decisions == []


def test_golden_put_body_round_trips_through_the_schema():
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))

    parsed = SummaryWriteRequest.model_validate(golden)

    # 스키마가 모르는 키나 AI 가 안 보내는 키가 생기면 왕복이 달라진다
    assert parsed.model_dump(mode="json") == golden


def test_golden_put_body_is_accepted_over_http(mdb, mseed):
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    _, extraction, _ = _meeting(mdb, mseed["ws"])

    golden["claim_token"] = summary.claim_next(mdb, only=[extraction.extraction_id]).claim_token
    mdb.commit()
    r = TestClient(app, base_url="https://testserver").put(
        f"/api/v1/extractions/{extraction.extraction_id}/summary", json=golden, headers=H,
    )

    assert r.status_code == 200, r.text
    # 황금 파일의 기존 주제 ID 는 이 워크스페이스에 없으므로 함께 온 이름으로 주제를 찾거나 만든다
    assert (r.json()["data"]["topic_count"], r.json()["data"]["decision_count"]) == (2, 2)
