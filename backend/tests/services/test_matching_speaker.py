import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models import Member, ResolutionResult, Workspace
from app.services.matching import (
    MatchResult,
    active_members_by_id,
    resolve_speaker,
    speaker_match,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    session.info["engine"] = engine
    try:
        yield session
    finally:
        session.close()


def _workspace(db, name: str) -> Workspace:
    ws = Workspace(name=name)
    db.add(ws)
    db.flush()
    return ws


def _member(db, ws: Workspace, name: str, **fields) -> Member:
    member = Member(workspace_id=ws.workspace_id, display_name=name, **fields)
    db.add(member)
    db.flush()
    return member


def test_active_members_by_id_keeps_only_active_members_of_the_workspace(db):
    ws = _workspace(db, "A")
    other_ws = _workspace(db, "B")
    active = _member(db, ws, "활성")
    deleted = _member(db, ws, "탈퇴", is_deleted=True)
    foreign = _member(db, other_ws, "타팀")

    found = active_members_by_id(
        db, ws.workspace_id, [active.member_id, deleted.member_id, foreign.member_id, "missing"]
    )

    assert set(found) == {active.member_id}
    assert found[active.member_id].display_name == "활성"


def test_active_members_by_id_with_no_ids_returns_empty_without_query(db):
    ws = _workspace(db, "A")
    statements: list[str] = []
    event.listen(
        db.info["engine"], "before_cursor_execute", lambda *a: statements.append(a[2])
    )

    assert active_members_by_id(db, ws.workspace_id, []) == {}
    assert statements == []


def test_active_members_by_id_uses_a_single_query(db):
    ws = _workspace(db, "A")
    first = _member(db, ws, "하나")
    second = _member(db, ws, "둘")
    db.commit()
    # commit 이 속성을 만료시키므로 ID 는 쿼리 수를 세기 전에 읽어 둔다.
    workspace_id, ids = ws.workspace_id, [first.member_id, second.member_id]
    statements: list[str] = []
    event.listen(
        db.info["engine"], "before_cursor_execute", lambda *a: statements.append(a[2])
    )

    found = active_members_by_id(db, workspace_id, ids)

    assert len(found) == 2
    assert len(statements) == 1


def test_speaker_match_equals_resolve_speaker_matched_result(db):
    ws = _workspace(db, "A")
    member = _member(db, ws, "화자", discord_user_id="u-1")

    match = speaker_match(member)

    assert match == MatchResult(
        member_id=member.member_id,
        display_name="화자",
        confidence=1.0,
        result=ResolutionResult.MATCHED,
        needs_check=False,
        candidate_count=1,
    )
    assert match == resolve_speaker(db, ws.workspace_id, "u-1")
