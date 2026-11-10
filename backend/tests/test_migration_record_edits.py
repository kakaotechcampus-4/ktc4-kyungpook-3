"""기록 고치기 마이그레이션(#605)이 옛 요약에 결정·주제 ID 를 채우고, 되돌려도 행을 잃지 않는지 확인한다.

sqlite in-memory, TEST_DATABASE_URL 이 있으면 PostgreSQL 도 돈다.
"""
import importlib.util
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models import Decision, Extraction, Meeting, Topic, TopicMeeting, Workspace

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
VERSIONS = Path(__file__).resolve().parents[1] / "migrations" / "versions"
T0 = datetime(2026, 11, 5, 5, 0, tzinfo=timezone.utc)


def _load_migration():
    paths = list(VERSIONS.glob("*_add_record_edits.py"))
    assert len(paths) == 1
    spec = importlib.util.spec_from_file_location("add_record_edits_migration", paths[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(
    params=[
        "sqlite",
        pytest.param(
            "postgresql",
            marks=pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없습니다."),
        ),
    ]
)
def engine(request):
    if request.param == "postgresql":
        eng = create_engine(TEST_DATABASE_URL)
        with eng.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        Base.metadata.drop_all(eng)
    else:
        eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    try:
        yield eng
    finally:
        Base.metadata.drop_all(eng)
        eng.dispose()


def _run(engine, fn_name: str):
    module = _load_migration()
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, fn_name)()


def _v1(decisions: list[str], topics: list[str]) -> str:
    return json.dumps({
        "overview": "핵심", "key_points": [], "decisions": decisions, "schema_version": 1,
        "decision_details": [{"text": text, "reason": None, "rejected": [], "topic": topics[0], "replaces": []}
                             for text in decisions],
        "topics": topics,
    }, ensure_ascii=False)


def _seed(conn):
    conn.execute(Workspace.__table__.insert().values(workspace_id="ws", name="A"))
    for meeting_id in ("m1", "m2", "m3"):
        conn.execute(Meeting.__table__.insert().values(
            meeting_id=meeting_id, workspace_id="ws", source="discord", status="done", started_at=T0,
        ))
    for topic_id, name in (("tp-login", "로그인"), ("tp-invite", "초대")):
        conn.execute(Topic.__table__.insert().values(
            topic_id=topic_id, workspace_id="ws", name=name, name_key=name, description="", created_at=T0,
        ))
        conn.execute(TopicMeeting.__table__.insert().values(topic_id=topic_id, meeting_id="m1"))
    for position, decision_id in enumerate(("d0", "d1")):
        conn.execute(Decision.__table__.insert().values(
            decision_id=decision_id, workspace_id="ws", meeting_id="m1", topic_id="tp-login", position=position,
            text=f"결정 {position}", created_at=T0,
        ))
    rows = [
        # 같은 회의의 옛 추출은 화면이 읽지 않아 건드리지 않는다
        ("e1-old", "m1", T0, _v1(["옛 결정"], ["로그인"])),
        # 이름이 바뀐 주제는 짝을 찾지 못해 자리를 비운다
        ("e1", "m1", T0 + timedelta(minutes=1), _v1(["결정 0", "결정 1"], ["로그인", "사라진 주제", "초대"])),
        ("e2", "m2", T0, json.dumps({"overview": "v2", "schema_version": 2, "topic_ids": ["keep"]})),
        ("e3", "m3", T0, "{깨진 JSON"),
    ]
    for extraction_id, meeting_id, created_at, summary in rows:
        conn.execute(Extraction.__table__.insert().values(
            extraction_id=extraction_id, meeting_id=meeting_id, created_at=created_at, summary=summary,
        ))


def _summaries(engine) -> dict[str, str]:
    with engine.connect() as conn:
        return dict(conn.execute(text("SELECT extraction_id, summary FROM extraction")).all())


def test_upgrade_backfills_ids_into_the_latest_summary_of_each_meeting(engine):
    with engine.begin() as conn:
        _seed(conn)
    _run(engine, "downgrade")
    before = _summaries(engine)

    _run(engine, "upgrade")

    after = _summaries(engine)
    document = json.loads(after["e1"])
    assert document["schema_version"] == 2
    assert [d["decision_id"] for d in document["decision_details"]] == ["d0", "d1"]
    assert document["topic_ids"] == ["tp-login", None, "tp-invite"]
    assert {key: after[key] for key in ("e1-old", "e2", "e3")} == {key: before[key] for key in ("e1-old", "e2", "e3")}
    with engine.connect() as conn:
        assert conn.execute(text("SELECT decision_id, state FROM decision ORDER BY position")).all() == [
            ("d0", "valid"), ("d1", "valid"),
        ]


def test_downgrade_drops_the_edit_columns_and_tables_and_keeps_the_rows(engine):
    with engine.begin() as conn:
        _seed(conn)

    _run(engine, "downgrade")

    tables = inspect(engine).get_table_names()
    assert "topic_alias" not in tables and "topic_task_detach" not in tables
    columns = {table: {c["name"] for c in inspect(engine).get_columns(table)}
               for table in ("meeting", "source", "topic", "decision")}
    assert not columns["meeting"] & {"title_original", "title_edited_at"}
    assert "text_edit" not in columns["source"]
    assert "edited_at" not in columns["topic"]
    assert not columns["decision"] & {"state", "edited_at"}
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM decision")).scalar() == 2
        assert conn.execute(text("SELECT count(*) FROM topic_meeting")).scalar() == 2
