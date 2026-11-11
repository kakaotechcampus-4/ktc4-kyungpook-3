"""Grafana KPI view 마이그레이션(#675)이 만드는 kpi 스키마의 view 와 표를 확인한다.

view 는 PostgreSQL 에만 만든다. TEST_DATABASE_URL 이 없으면 PostgreSQL 테스트는 건너뛰고 sqlite 에서는
upgrade/downgrade 가 아무것도 하지 않는지만 본다.
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
from sqlalchemy.exc import DBAPIError
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models import (
    ApprovalRequest,
    Extraction,
    ExtractionItem,
    Meeting,
    MeetingUpload,
    Member,
    Workspace,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
VERSIONS = Path(__file__).resolve().parents[1] / "migrations" / "versions"
WS_A = "ws-a"
WS_B = "ws-b"
T = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)

MEETING_FACT_COLUMNS = [
    "ended_at",
    "extracted_at",
    "source",
    "status",
    "failed_stage",
    "replaced",
    "meeting_minutes",
    "processing_seconds",
    "speaker_wait_seconds",
]
EXTRACTION_ITEM_FACT_COLUMNS = [
    "created_at",
    "meeting_source",
    "extraction_path",
    "action",
    "gate",
    "reverted",
    "revert_after_seconds",
]
APPROVAL_FACT_COLUMNS = [
    "created_at",
    "resolved_at",
    "type",
    "origin",
    "meeting_source",
    "card_gate",
    "outcome",
    "response_seconds",
    "asr_flag",
    "title_edited",
]
VIEWS = {
    "meeting_fact": MEETING_FACT_COLUMNS,
    "extraction_item_fact": EXTRACTION_ITEM_FACT_COLUMNS,
    "approval_fact": APPROVAL_FACT_COLUMNS,
}

pg_only = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없습니다.")


ADD_KPI_VIEWS = "add_kpi_views"
CAP_PROCESSING_END = "cap_kpi_processing_end"


def _load_migration(name: str = ADD_KPI_VIEWS):
    paths = list(VERSIONS.glob(f"*_{name}.py"))
    assert len(paths) == 1
    spec = importlib.util.spec_from_file_location(f"{name}_migration", paths[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, fn_name: str, name: str = ADD_KPI_VIEWS):
    module = _load_migration(name)
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, fn_name)()


def _drop_kpi(eng):
    with eng.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS kpi CASCADE"))


@pytest.fixture
def pg_engine():
    """upgrade 가 끝난 PostgreSQL. 끝나면 kpi 스키마부터 지워 다른 테스트의 drop_all 을 막지 않는다."""
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL(PostgreSQL)이 없습니다.")
    eng = create_engine(TEST_DATABASE_URL)
    with eng.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    _drop_kpi(eng)
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    try:
        with eng.begin() as conn:
            for workspace_id in (WS_A, WS_B):
                conn.execute(Workspace.__table__.insert().values(workspace_id=workspace_id, name=workspace_id))
        _run(eng, "upgrade")
        _run(eng, "upgrade", CAP_PROCESSING_END)
        yield eng
    finally:
        _drop_kpi(eng)
        Base.metadata.drop_all(eng)
        eng.dispose()


def _at(n: int) -> datetime:
    """행마다 다른 시각. view 에 ID 가 없어서 시각으로 행을 찾는다."""
    return T + timedelta(days=n)


def _meeting(conn, meeting_id, *, workspace_id=WS_A, source="discord", status="done", **values):
    values.setdefault("ended_at", T)
    conn.execute(
        Meeting.__table__.insert().values(
            meeting_id=meeting_id, workspace_id=workspace_id, source=source, status=status, **values
        )
    )


def _extraction(conn, extraction_id, meeting_id, created_at, *, extraction_path=None):
    conn.execute(
        Extraction.__table__.insert().values(
            extraction_id=extraction_id, meeting_id=meeting_id, created_at=created_at, extraction_path=extraction_path
        )
    )


def _item(conn, item_id, extraction_id, created_at, *, action="create", gate="review", reverted_at=None):
    conn.execute(
        ExtractionItem.__table__.insert().values(
            item_id=item_id,
            extraction_id=extraction_id,
            created_at=created_at,
            action=action,
            gate=gate,
            reverted_at=reverted_at,
            task_title="제목",
        )
    )


def _approval(conn, approval_id, created_at, payload, *, type="task_create", status="pending", workspace_id=WS_A, **values):
    conn.execute(
        ApprovalRequest.__table__.insert().values(
            approval_id=approval_id,
            workspace_id=workspace_id,
            type=type,
            payload=payload if isinstance(payload, str) else json.dumps(payload),
            status=status,
            created_at=created_at,
            **values,
        )
    )


def _rows(conn, view: str, order_by: str):
    return conn.execute(text(f"SELECT * FROM kpi.{view} ORDER BY {order_by}")).mappings().all()


def _by(rows, key: str):
    return {row[key]: row for row in rows}


@pg_only
def test_view_columns_exact(pg_engine):
    with pg_engine.connect() as conn:
        for view, expected in VIEWS.items():
            columns = [
                row[0]
                for row in conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema = 'kpi' AND table_name = :view ORDER BY ordinal_position"
                    ),
                    {"view": view},
                )
            ]
            assert columns == expected
        tables = {
            row[0]
            for row in conn.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'kpi'"))
        }
        every_column = [column for columns in VIEWS.values() for column in columns]
    assert tables == {*VIEWS, "excluded_workspace"}
    # ID·제목·본문·payload·이름·이메일은 view 로 내보내지 않는다. title_edited 는 불리언이라 괜찮다.
    for column in every_column:
        assert not column.endswith("_id"), column
        assert column not in {"title", "text", "payload", "email", "name"}, column
        assert not column.endswith(("_title", "_text", "_name", "_email")), column


@pg_only
def test_meeting_fact_processing_and_filters(pg_engine):
    t1 = T + timedelta(hours=1)
    with pg_engine.begin() as conn:
        # 디스코드 회의의 ended_at 은 워커가 처리를 시작한 시각이다. 녹음은 그 10분 전(started_at + duration_ms)에
        # 끝났으므로 처리 시간은 큐에서 기다린 10분을 포함한 900초다.
        _meeting(
            conn, "m-discord", ended_at=_at(1), started_at=_at(1) - timedelta(minutes=20), duration_ms=600_000
        )
        _extraction(conn, "x-discord", "m-discord", _at(1) + timedelta(seconds=300))
        # 같은 회의에 추출이 둘이어도 첫 추출 시각을 쓴다.
        _extraction(conn, "x-discord-2", "m-discord", _at(1) + timedelta(seconds=900))

        # 업로드 회의는 started_at·duration_ms 와 관계없이 ended_at(업로드 시각)부터 잰다.
        _meeting(
            conn, "m-upload", source="manual_upload", ended_at=_at(2),
            started_at=_at(2) - timedelta(hours=3), duration_ms=600_000,
        )
        conn.execute(
            MeetingUpload.__table__.insert().values(
                meeting_id="m-upload",
                stored_filename="a.mp3",
                size_bytes=1,
                attendees="[]",
                speakers_reported_at=t1,
                speakers_assigned_at=t1 + timedelta(seconds=120),
            )
        )
        _extraction(conn, "x-upload", "m-upload", _at(2) + timedelta(seconds=900))

        _meeting(conn, "m-weird", status="failed", failed_stage="weird", ended_at=_at(3))
        _meeting(conn, "m-stt", status="failed", failed_stage="stt", ended_at=_at(4))
        _meeting(conn, "m-retry", ended_at=_at(5), replaces_meeting_id="m-stt")
        _meeting(conn, "m-stale-stage", status="done", failed_stage="stt", ended_at=_at(6))
        _meeting(conn, "m-nostage", status="failed", ended_at=_at(7))
        _meeting(conn, "m-deleted", status="failed", failed_stage="stt", ended_at=_at(8), deleted_at=_at(9))
        _meeting(conn, "m-not-ended", status="recording", ended_at=None)
        _meeting(conn, "m-sweeper", status="failed", failed_stage="upload_unclaimed", ended_at=_at(10))
        # duration_ms 가 없는 디스코드 회의는 ended_at 부터 잰다.
        _meeting(conn, "m-no-duration", ended_at=_at(11), started_at=_at(11) - timedelta(hours=1), duration_ms=None)
        _extraction(conn, "x-no-duration", "m-no-duration", _at(11) + timedelta(seconds=60))

    with pg_engine.connect() as conn:
        rows = _by(_rows(conn, "meeting_fact", "ended_at"), "ended_at")

    # 삭제 회의와 ended_at 이 없는 회의는 행이 없다.
    assert set(rows) == {_at(n) for n in (1, 2, 3, 4, 5, 6, 7, 10, 11)}

    discord = rows[_at(1)]
    assert discord["processing_seconds"] == 900
    assert discord["extracted_at"] == _at(1) + timedelta(seconds=300)
    assert discord["speaker_wait_seconds"] is None
    assert float(discord["meeting_minutes"]) == 10.0
    assert discord["failed_stage"] is None
    assert discord["replaced"] is False

    upload = rows[_at(2)]
    assert upload["speaker_wait_seconds"] == 120
    assert upload["processing_seconds"] == 900
    assert upload["source"] == "manual_upload"

    assert rows[_at(3)]["failed_stage"] == "other"
    assert rows[_at(4)]["failed_stage"] == "stt"
    assert rows[_at(4)]["replaced"] is True
    assert rows[_at(5)]["replaced"] is False
    # 실패가 아닌 회의의 failed_stage 는 값이 남아 있어도 NULL 이다.
    assert rows[_at(6)]["failed_stage"] is None
    assert rows[_at(7)]["failed_stage"] == "other"
    assert rows[_at(10)]["failed_stage"] == "upload_unclaimed"
    assert rows[_at(3)]["extracted_at"] is None
    assert rows[_at(3)]["processing_seconds"] is None
    assert rows[_at(11)]["processing_seconds"] == 60


def _replacement_meeting(conn):
    """교체로 다시 만든 디스코드 회의. AI 가 started_at 을 보내지 않아 started_at 이 행을 만든 시각(추출 직전)이고,
    duration_ms 는 원래 녹음 전체(30분)다. 녹음 끝(started_at + duration_ms)이 ended_at·extracted_at 보다 늦다."""
    _meeting(
        conn, "m-replacement", ended_at=_at(1) + timedelta(seconds=10), started_at=_at(1), duration_ms=1_800_000,
    )
    _extraction(conn, "x-replacement", "m-replacement", _at(1) + timedelta(seconds=70))


@pg_only
def test_meeting_fact_caps_recording_end_at_ended_at(pg_engine):
    # 녹음 끝은 /end 시각보다 늦을 수 없으므로 ended_at 으로 상한을 둔다. 음수가 아니라 ended_at 부터 잰 60초다.
    with pg_engine.begin() as conn:
        _replacement_meeting(conn)

    with pg_engine.connect() as conn:
        row = conn.execute(text("SELECT processing_seconds FROM kpi.meeting_fact")).mappings().one()

    assert row["processing_seconds"] == 60


@pg_only
def test_cap_downgrade_restores_previous_view_and_keeps_grants(pg_engine):
    with pg_engine.begin() as conn:
        _replacement_meeting(conn)
        conn.execute(text("GRANT SELECT ON kpi.meeting_fact TO PUBLIC"))

    _run(pg_engine, "downgrade", CAP_PROCESSING_END)
    with pg_engine.connect() as conn:
        # 이전 식은 녹음 끝(T + 30분)부터 재서 음수가 나온다.
        assert conn.execute(text("SELECT processing_seconds FROM kpi.meeting_fact")).scalar_one() == 70 - 1800
        acl = conn.execute(text("SELECT relacl::text FROM pg_class WHERE oid = 'kpi.meeting_fact'::regclass")).scalar_one()
    assert "=r/" in acl

    _run(pg_engine, "upgrade", CAP_PROCESSING_END)
    with pg_engine.connect() as conn:
        assert conn.execute(text("SELECT processing_seconds FROM kpi.meeting_fact")).scalar_one() == 60
        acl = conn.execute(text("SELECT relacl::text FROM pg_class WHERE oid = 'kpi.meeting_fact'::regclass")).scalar_one()
        columns = [
            row[0]
            for row in conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'kpi' AND table_name = 'meeting_fact' ORDER BY ordinal_position"
                )
            )
        ]
    # CREATE OR REPLACE VIEW 라 GRANT 를 다시 돌리지 않아도 권한과 컬럼이 그대로다.
    assert "=r/" in acl
    assert columns == MEETING_FACT_COLUMNS


@pg_only
def test_extraction_item_fact(pg_engine):
    with pg_engine.begin() as conn:
        _meeting(conn, "m-1", source="manual_upload")
        _extraction(conn, "x-1", "m-1", T, extraction_path="judge")
        _item(conn, "i-reverted", "x-1", _at(1), action="create", gate="auto", reverted_at=_at(1) + timedelta(seconds=3600))
        _item(conn, "i-kept", "x-1", _at(2), action="update", gate="review")
        _item(conn, "i-hold", "x-1", _at(3), action="merge", gate="hold")

        _meeting(conn, "m-2")
        _extraction(conn, "x-2", "m-2", T, extraction_path="legacy")
        _item(conn, "i-legacy", "x-2", _at(4), gate="auto")

        _meeting(conn, "m-deleted", status="failed", deleted_at=T)
        _extraction(conn, "x-deleted", "m-deleted", T)
        _item(conn, "i-deleted", "x-deleted", _at(5), gate="auto")

    with pg_engine.connect() as conn:
        rows = _by(_rows(conn, "extraction_item_fact", "created_at"), "created_at")

    assert set(rows) == {_at(1), _at(2), _at(3), _at(4)}
    reverted = rows[_at(1)]
    assert reverted["reverted"] is True
    assert reverted["revert_after_seconds"] == 3600
    assert (reverted["meeting_source"], reverted["extraction_path"]) == ("manual_upload", "judge")
    assert (reverted["action"], reverted["gate"]) == ("create", "auto")
    kept = rows[_at(2)]
    assert kept["reverted"] is False
    assert kept["revert_after_seconds"] is None
    assert (kept["action"], kept["gate"]) == ("update", "review")
    assert (rows[_at(3)]["action"], rows[_at(3)]["gate"]) == ("merge", "hold")
    assert (rows[_at(4)]["meeting_source"], rows[_at(4)]["extraction_path"]) == ("discord", "legacy")


@pg_only
def test_approval_fact_origin_outcome(pg_engine):
    with pg_engine.begin() as conn:
        conn.execute(Member.__table__.insert().values(member_id="pm", workspace_id=WS_A, display_name="pm", role="pm"))
        _meeting(conn, "m-up", source="manual_upload")
        meeting_payload = {"extraction_item_id": "i-1", "meeting_id": "m-up", "gate": "hold"}

        _approval(conn, "a1", _at(1), {**meeting_payload, "reverted_task_id": "t-1"})
        # 직접 만든 요청은 추출 항목 ID 가 있어도 manual 이다.
        _approval(conn, "a2", _at(2), meeting_payload, requested_by="pm")
        _approval(conn, "a3", _at(3), {"change_source": "reminder_reply", "meeting_id": None})
        _approval(conn, "a4", _at(4), meeting_payload, status="approved", resolved_at=_at(4) + timedelta(seconds=90))
        _approval(
            conn,
            "a5",
            _at(5),
            {**meeting_payload, "gate": "auto", "task_overrides": {"task_due": "2026-11-30"}},
            status="approved",
            resolved_at=_at(5) + timedelta(seconds=30),
        )
        _approval(conn, "a6", _at(6), {"meeting_id": "m-up", "gate": "review"}, status="rejected", resolved_at=_at(6) + timedelta(seconds=10))
        _approval(conn, "a7", _at(7), {"foo": "bar"})
        _approval(conn, "a8", _at(8), {"meeting_id": "m-up", "source_deleted": True}, status="rejected", resolved_at=_at(8))
        _approval(conn, "a9", _at(9), "not json")
        _approval(conn, "a10", _at(10), "null")
        _approval(conn, "a11", _at(11), {"x": 1}, status="cancelled")
        # 본문에 NUL 이 든 payload 는 JSON 문법은 맞지만 jsonb 로 바꿀 수 없다. 이 행도 조회를 깨지 않아야 한다.
        _approval(conn, "a12", _at(12), '{"meeting_id": "m-up", "note": "\\u0000"}')

    with pg_engine.connect() as conn:
        # 깨진 payload 한 행이 있어도 조회는 통째로 성공한다.
        rows = _by(conn.execute(text("SELECT * FROM kpi.approval_fact")).mappings().all(), "created_at")

    assert set(rows) == {_at(n) for n in (1, 2, 3, 4, 5, 6, 7, 11)}
    assert rows[_at(1)]["origin"] == "auto_revert"
    assert rows[_at(2)]["origin"] == "manual"
    assert rows[_at(3)]["origin"] == "reply"
    assert rows[_at(4)]["origin"] == "meeting"
    assert rows[_at(7)]["origin"] == "other"
    assert rows[_at(1)]["outcome"] == "pending"
    assert rows[_at(4)]["outcome"] == "approved"
    assert rows[_at(5)]["outcome"] == "approved_edited"
    assert rows[_at(6)]["outcome"] == "rejected"
    assert rows[_at(11)]["outcome"] == "other"
    assert rows[_at(4)]["response_seconds"] == 90
    assert rows[_at(5)]["response_seconds"] == 30
    assert rows[_at(1)]["response_seconds"] is None
    # 회의 카드는 회의 출처와 카드 게이트를 갖는다. auto 는 카드 게이트가 아니다.
    assert (rows[_at(4)]["meeting_source"], rows[_at(4)]["card_gate"]) == ("manual_upload", "hold")
    assert (rows[_at(6)]["meeting_source"], rows[_at(6)]["card_gate"]) == ("manual_upload", "review")
    assert rows[_at(5)]["card_gate"] is None
    assert rows[_at(3)]["meeting_source"] is None
    assert rows[_at(3)]["card_gate"] is None


@pg_only
def test_approval_fact_asr_flag(pg_engine):
    suspect = {"word": "깃허브", "source": "title", "candidates": []}
    failed = {"word": "?", "source": "check_failed", "candidates": []}
    with pg_engine.begin() as conn:
        _approval(conn, "a1", _at(1), {"meeting_id": "m"})
        _approval(conn, "a2", _at(2), {"asr_suspects": None})
        _approval(conn, "a3", _at(3), {"asr_suspects": []})
        _approval(conn, "a4", _at(4), {"asr_suspects": [suspect]})
        _approval(conn, "a5", _at(5), {"asr_suspects": [suspect, failed]})
        _approval(conn, "a6", _at(6), {"asr_suspects": [failed]})
        _approval(conn, "a7", _at(7), {"asr_suspects": [suspect]}, type="task_update")
        _approval(conn, "a8", _at(8), {"asr_suspects": "nope"})
        _approval(conn, "a9", _at(9), {"task_overrides": {"task_title": "새 제목"}}, status="approved", resolved_at=_at(9))
        _approval(conn, "a10", _at(10), {"task_overrides": {"task_due": "2026-11-30"}}, status="approved", resolved_at=_at(10))
        _approval(conn, "a11", _at(11), {}, status="approved", resolved_at=_at(11))

    with pg_engine.connect() as conn:
        rows = _by(_rows(conn, "approval_fact", "created_at"), "created_at")

    assert [rows[_at(n)]["asr_flag"] for n in range(1, 9)] == [None, None, "none", "suspect", "check_failed", "check_failed", None, None]
    assert rows[_at(9)]["title_edited"] is True
    assert rows[_at(10)]["title_edited"] is False
    assert rows[_at(11)]["title_edited"] is False
    assert rows[_at(1)]["title_edited"] is False
    assert rows[_at(9)]["outcome"] == "approved_edited"


@pg_only
def test_excluded_workspace_filters_all_views(pg_engine):
    with pg_engine.begin() as conn:
        for n, workspace_id in enumerate((WS_A, WS_B), start=1):
            meeting_id = f"m-{workspace_id}"
            _meeting(conn, meeting_id, workspace_id=workspace_id, ended_at=_at(n))
            _extraction(conn, f"x-{workspace_id}", meeting_id, _at(n))
            _item(conn, f"i-{workspace_id}", f"x-{workspace_id}", _at(n))
            _approval(conn, f"a-{workspace_id}", _at(n), {"meeting_id": meeting_id}, workspace_id=workspace_id)

    def count(view):
        with pg_engine.connect() as conn:
            return conn.execute(text(f"SELECT count(*) FROM kpi.{view}")).scalar_one()

    assert [count(view) for view in VIEWS] == [2, 2, 2]

    with pg_engine.begin() as conn:
        conn.execute(text("INSERT INTO kpi.excluded_workspace (workspace_id) VALUES (:ws)"), {"ws": WS_B})

    assert [count(view) for view in VIEWS] == [1, 1, 1]
    with pg_engine.connect() as conn:
        assert conn.execute(text("SELECT ended_at FROM kpi.meeting_fact")).scalar_one() == _at(1)
        assert conn.execute(text("SELECT created_at FROM kpi.approval_fact")).scalar_one() == _at(1)


@pg_only
def test_downgrade_drops_schema(pg_engine):
    _run(pg_engine, "downgrade")

    with pg_engine.connect() as conn:
        schemata = [row[0] for row in conn.execute(text("SELECT schema_name FROM information_schema.schemata"))]
    assert "kpi" not in schemata
    Base.metadata.drop_all(pg_engine)


@pg_only
def test_view_blocks_dropping_used_column(pg_engine):
    with pytest.raises(DBAPIError, match="depend"):
        with pg_engine.begin() as conn:
            conn.execute(text("ALTER TABLE meeting DROP COLUMN ended_at"))


@pg_only
def test_view_allows_dropping_unused_column(pg_engine):
    # approval_request 의 다른 컬럼(resolved_by 등)은 view 가 쓰지 않으므로 지울 수 있어야 한다.
    with pg_engine.begin() as conn:
        conn.execute(text("ALTER TABLE approval_request DROP COLUMN resolved_by"))
        conn.execute(text("ALTER TABLE meeting DROP COLUMN title"))
        assert conn.execute(text("SELECT count(*) FROM kpi.approval_fact")).scalar_one() == 0


@pg_only
def test_views_depend_only_on_listed_columns(pg_engine):
    # backend/README.md 의 "KPI view" 원천 컬럼 표와 같아야 한다.
    expected = {
        "meeting": {
            "meeting_id", "workspace_id", "deleted_at", "source", "status", "failed_stage", "started_at", "ended_at",
            "duration_ms", "replaces_meeting_id",
        },
        "extraction": {"extraction_id", "meeting_id", "created_at", "extraction_path"},
        "extraction_item": {"extraction_id", "created_at", "action", "gate", "reverted_at"},
        "meeting_upload": {"meeting_id", "speakers_reported_at", "speakers_assigned_at"},
        "approval_request": {
            "workspace_id", "type", "payload", "requested_by", "status", "created_at", "resolved_at",
        },
    }
    with pg_engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT DISTINCT c.relname, a.attname FROM pg_depend d "
                "JOIN pg_rewrite rw ON rw.oid = d.objid "
                "JOIN pg_class v ON v.oid = rw.ev_class "
                "JOIN pg_namespace vn ON vn.oid = v.relnamespace "
                "JOIN pg_class c ON c.oid = d.refobjid "
                "JOIN pg_namespace cn ON cn.oid = c.relnamespace "
                "JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.refobjsubid "
                "WHERE vn.nspname = 'kpi' AND cn.nspname <> 'kpi' "
                "AND d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass AND d.refobjsubid > 0"
            )
        ).all()
    actual: dict[str, set[str]] = {}
    for table, column in rows:
        actual.setdefault(table, set()).add(column)
    assert actual == expected


def test_sqlite_noop():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    before = sorted(inspect(eng).get_table_names())

    for name in (ADD_KPI_VIEWS, CAP_PROCESSING_END):
        _run(eng, "upgrade", name)
        assert sorted(inspect(eng).get_table_names()) == before

    for name in (CAP_PROCESSING_END, ADD_KPI_VIEWS):
        _run(eng, "downgrade", name)
        assert sorted(inspect(eng).get_table_names()) == before
    eng.dispose()
