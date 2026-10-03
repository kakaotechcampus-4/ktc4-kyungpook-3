"""source(전사 발화)와 evidence(근거) 모델의 제약과 삭제 전파."""
import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models import (
    Evidence,
    EvidenceType,
    Extraction,
    ExtractionItem,
    Meeting,
    Source,
    Task,
    Workspace,
)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def _enable_fk(dbapi_connection, _):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def seed(db):
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()
    meeting = Meeting(workspace_id=ws.workspace_id)
    task = Task(workspace_id=ws.workspace_id, title="설계")
    db.add_all([meeting, task])
    db.flush()
    extraction = Extraction(meeting_id=meeting.meeting_id)
    db.add(extraction)
    db.flush()
    item = ExtractionItem(extraction_id=extraction.extraction_id, task_title="설계")
    source = Source(meeting_id=meeting.meeting_id, seq=1, start_ms=0, end_ms=1000, text="설계 끝내요")
    db.add_all([item, source])
    db.commit()
    return {"meeting": meeting, "task": task, "item": item, "source": source}


def test_meeting_duration_is_null_until_transcribed(db, seed):
    assert seed["meeting"].duration_ms is None


def test_source_seq_is_unique_per_meeting(db, seed):
    db.add(Source(meeting_id=seed["meeting"].meeting_id, seq=1, start_ms=1000, end_ms=2000, text="중복"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_evidence_requires_item_or_task(db, seed):
    db.add(Evidence(source_id=seed["source"].source_id, type=str(EvidenceType.TASK)))
    with pytest.raises(IntegrityError):
        db.commit()


def test_evidence_can_point_to_item_or_task_or_both(db, seed):
    source_id = seed["source"].source_id
    db.add_all([
        Evidence(item_id=seed["item"].item_id, source_id=source_id, type=str(EvidenceType.TASK)),
        Evidence(task_id=seed["task"].task_id, source_id=source_id, type=str(EvidenceType.DUE)),
        Evidence(
            item_id=seed["item"].item_id, task_id=seed["task"].task_id,
            source_id=source_id, type=str(EvidenceType.ASSIGNEE),
        ),
    ])
    db.commit()

    assert db.query(Evidence).count() == 3


def test_evidence_is_unique_per_item_source_type(db, seed):
    for _ in range(2):
        db.add(Evidence(
            item_id=seed["item"].item_id, source_id=seed["source"].source_id, type=str(EvidenceType.TASK)
        ))
    with pytest.raises(IntegrityError):
        db.commit()


def test_task_only_evidence_is_unique_per_task_source_type(db, seed):
    for _ in range(2):
        db.add(Evidence(
            task_id=seed["task"].task_id, source_id=seed["source"].source_id, type=str(EvidenceType.TASK)
        ))
    with pytest.raises(IntegrityError):
        db.commit()


def test_items_sharing_a_task_can_cite_the_same_source(db, seed):
    other = ExtractionItem(extraction_id=seed["item"].extraction_id, task_title="설계 보완")
    db.add(other)
    db.flush()
    for item in (seed["item"], other):
        db.add(Evidence(
            item_id=item.item_id, task_id=seed["task"].task_id,
            source_id=seed["source"].source_id, type=str(EvidenceType.TASK),
        ))
    db.commit()

    assert db.query(Evidence).count() == 2


@pytest.mark.parametrize("owner", ["item", "task", "source"])
def test_deleting_owner_deletes_evidence(db, seed, owner):
    db.add(Evidence(
        item_id=seed["item"].item_id, task_id=seed["task"].task_id,
        source_id=seed["source"].source_id, type=str(EvidenceType.TASK),
    ))
    db.commit()

    db.delete(seed[owner])
    db.commit()

    assert db.execute(select(Evidence)).first() is None


def test_deleting_meeting_deletes_sources(db, seed):
    db.delete(seed["meeting"])
    db.commit()

    assert db.execute(select(Source)).first() is None
