"""화자 지정(#266)에 쓰는 업로드 컬럼과 에러 코드."""
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.core.errors import ERROR_MESSAGE, ERROR_STATUS, ErrorCode
from app.models import Meeting, MeetingUpload, Workspace

NEW_CODES = [
    "UPLOAD_NOT_CLAIMED",
    "SPEAKERS_ALREADY_REPORTED",
    "MEETING_NOT_AWAITING_SPEAKERS",
    "SPEAKERS_NOT_ASSIGNED",
]


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def _upload(db, **kwargs) -> MeetingUpload:
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    meeting = Meeting(workspace_id=ws.workspace_id)
    db.add(meeting)
    db.flush()
    upload = MeetingUpload(
        meeting_id=meeting.meeting_id,
        stored_filename="audio.ogg",
        size_bytes=1,
        attendees="[]",
        **kwargs,
    )
    db.add(upload)
    db.commit()
    db.refresh(upload)
    return upload


@pytest.mark.parametrize("name", NEW_CODES)
def test_new_error_code_is_registered_as_409_with_message(name):
    code = ErrorCode[name]
    assert code.value == name
    assert ERROR_STATUS[code] == 409
    assert ERROR_MESSAGE[code]


def test_speaker_columns_default_to_none(db):
    upload = _upload(db)
    assert upload.speakers is None
    assert upload.speaker_mapping is None
    assert upload.speakers_reported_at is None
    assert upload.speakers_assigned_at is None
    assert upload.resumed_at is None


def test_speaker_columns_round_trip(db):
    reported = datetime(2026, 11, 2, 9, 0, tzinfo=timezone.utc)
    assigned = datetime(2026, 11, 2, 10, 30, tzinfo=timezone.utc)
    resumed = datetime(2026, 11, 2, 11, 45, tzinfo=timezone.utc)
    upload = _upload(
        db,
        speakers='["SPEAKER_00"]',
        speaker_mapping='{"SPEAKER_00": "m1"}',
        speakers_reported_at=reported,
        speakers_assigned_at=assigned,
        resumed_at=resumed,
    )
    db.expire_all()
    got = db.get(MeetingUpload, upload.meeting_id)
    assert got.speakers == '["SPEAKER_00"]'
    assert got.speaker_mapping == '{"SPEAKER_00": "m1"}'
    # sqlite 는 tz 를 버리므로 벽시계 값으로 비교한다. 컬럼마다 시각이 서로 달라 뒤바뀜을 잡는다
    assert got.speakers_reported_at.replace(tzinfo=None) == reported.replace(tzinfo=None)
    assert got.speakers_assigned_at.replace(tzinfo=None) == assigned.replace(tzinfo=None)
    assert got.resumed_at.replace(tzinfo=None) == resumed.replace(tzinfo=None)
