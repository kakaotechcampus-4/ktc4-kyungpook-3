"""회의 녹음 보관 기록 표 마이그레이션(#659)의 채우기와 되돌리기를 확인한다.

처리 중인 기존 업로드 회의에는 재생 기록을 채우고, 끝났거나 지워진 회의에는 채우지 않는다.
sqlite in-memory, TEST_DATABASE_URL 이 있으면 PostgreSQL 도 돈다.
"""
import importlib.util
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models import Meeting, MeetingUpload, Workspace

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
VERSIONS = Path(__file__).resolve().parents[1] / "migrations" / "versions"
WORKSPACE = "ws-1"
UPLOADED = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)


def _load_migration():
    paths = list(VERSIONS.glob("*_add_meeting_audio.py"))
    assert len(paths) == 1
    spec = importlib.util.spec_from_file_location("add_meeting_audio_migration", paths[0])
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
    with eng.begin() as conn:
        # 마이그레이션 전 스키마를 만들려고 녹음 보관 표를 뺀다.
        conn.execute(text("DROP TABLE IF EXISTS meeting_audio"))
        conn.execute(Workspace.__table__.insert().values(workspace_id=WORKSPACE, name=WORKSPACE))
    try:
        yield eng
    finally:
        with eng.begin() as conn:
            conn.execute(text("DROP TABLE IF EXISTS meeting_audio"))
        Base.metadata.drop_all(eng)
        eng.dispose()


def _run(engine, fn_name: str):
    module = _load_migration()
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, fn_name)()


def _upload_meeting(conn, meeting_id, *, status, stored_filename="audio.wav", size_bytes=10, deleted=False):
    conn.execute(
        Meeting.__table__.insert().values(
            meeting_id=meeting_id,
            workspace_id=WORKSPACE,
            status=status,
            source="manual_upload",
            deleted_at=UPLOADED if deleted else None,
        )
    )
    conn.execute(
        MeetingUpload.__table__.insert().values(
            meeting_id=meeting_id,
            stored_filename=stored_filename,
            size_bytes=size_bytes,
            attendees="[]",
            uploaded_at=UPLOADED,
        )
    )


def _as_utc(value) -> datetime:
    # sqlite 는 문자열·naive 로, PostgreSQL 은 aware datetime 으로 돌려준다.
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _rows(engine):
    with engine.connect() as conn:
        return {
            row[0]: row[1:]
            for row in conn.execute(
                text("SELECT meeting_id, filename, content_type, size_bytes, received_at, deleted_at FROM meeting_audio")
            )
        }


def test_upgrade_backfills_only_in_flight_upload_meetings(engine):
    with engine.begin() as conn:
        _upload_meeting(conn, "m-processing", status="processing", stored_filename="audio.m4a", size_bytes=111)
        _upload_meeting(conn, "m-awaiting", status="awaiting_speakers", stored_filename="audio.wav", size_bytes=222)
        _upload_meeting(conn, "m-done", status="done")
        _upload_meeting(conn, "m-failed", status="failed")
        _upload_meeting(conn, "m-deleted", status="processing", deleted=True)

    _run(engine, "upgrade")

    rows = _rows(engine)
    assert sorted(rows) == ["m-awaiting", "m-processing"]
    filename, content_type, size_bytes, received_at, deleted_at = rows["m-processing"]
    assert (filename, content_type, size_bytes) == ("audio.m4a", "audio/mp4", 111)
    assert _as_utc(received_at) == UPLOADED
    assert deleted_at is None
    assert rows["m-awaiting"][:3] == ("audio.wav", "audio/wav", 222)


@pytest.mark.parametrize(
    ("stored_filename", "content_type"),
    [
        ("audio.wav", "audio/wav"),
        ("audio.mp3", "audio/mpeg"),
        ("audio.m4a", "audio/mp4"),
        ("audio.ogg", "audio/ogg"),
        ("audio.webm", "audio/webm"),
        ("audio.WAV", "audio/wav"),
        ("audio.flac", "application/octet-stream"),
        ("audio", "application/octet-stream"),
    ],
)
def test_upgrade_picks_content_type_by_extension(engine, stored_filename, content_type):
    with engine.begin() as conn:
        _upload_meeting(conn, "m1", status="processing", stored_filename=stored_filename)

    _run(engine, "upgrade")

    assert _rows(engine)["m1"][1] == content_type


def test_downgrade_drops_table(engine):
    _run(engine, "upgrade")
    assert "meeting_audio" in inspect(engine).get_table_names()

    _run(engine, "downgrade")

    assert "meeting_audio" not in inspect(engine).get_table_names()
