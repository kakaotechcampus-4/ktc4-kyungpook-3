"""담당자 별칭 검색: 님·조사를 뗀 후보로 찾고, 긴 후보가 먼저 이긴다 (#459).

name_candidates 는 ai/extract/eval_golden_set.py 의 _name_candidates 와 같은 규칙이다.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models import Member, MemberAlias, ResolutionResult, Workspace
from app.services.matching import name_candidates, resolve_assignee, resolved_texts


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def ws(db):
    workspace = Workspace(name="A")
    db.add(workspace)
    db.flush()
    return workspace.workspace_id


def _member(db, ws, name, **fields) -> Member:
    member = Member(workspace_id=ws, display_name=name, **fields)
    db.add(member)
    db.flush()
    return member


def _alias(db, member, text, *, verified=True, confidence=1.0) -> MemberAlias:
    alias = MemberAlias(
        member_id=member.member_id,
        workspace_id=member.workspace_id,
        alias_text=text,
        alias_type="realname",
        source="manual",
        confidence=confidence,
        verified=verified,
    )
    db.add(alias)
    db.flush()
    return alias


@pytest.mark.parametrize(
    "text, expected",
    [
        ("하은이가", ["하은이가", "하은이", "하은"]),
        ("지민님이", ["지민님이", "지민님", "지민"]),
        ("하은님", ["하은님", "하은", "하"]),
        ("  동우 ", ["동우"]),
        ("", []),
        (None, []),
        ("님", ["님"]),
    ],
)
def test_name_candidates(text, expected):
    assert name_candidates(text) == expected


def test_longer_candidate_wins(db, ws):
    a = _member(db, ws, "하")
    b = _member(db, ws, "하은")
    _alias(db, a, "하")
    _alias(db, b, "하은")

    assert resolve_assignee(db, ws, "하은").member_id == b.member_id
    assert resolve_assignee(db, ws, "하은이가").member_id == b.member_id


def test_particle_and_honorific_match(db, ws):
    m = _member(db, ws, "하은")
    _alias(db, m, "하은", verified=True, confidence=1.0)

    r = resolve_assignee(db, ws, "하은이가")
    assert r.result == ResolutionResult.MATCHED
    assert r.member_id == m.member_id
    assert r.needs_check is False
    assert r.confidence == 1.0
    assert resolve_assignee(db, ws, "하은님").result == ResolutionResult.MATCHED


def test_first_hit_decides_ambiguous(db, ws):
    _alias(db, _member(db, ws, "민수1"), "민수")
    _alias(db, _member(db, ws, "민수2"), "민수")

    r = resolve_assignee(db, ws, "민수가")
    assert r.result == ResolutionResult.AMBIGUOUS
    assert r.candidate_count == 2


def test_first_hit_beats_shorter_unique(db, ws):
    a = _member(db, ws, "김민수")
    _alias(db, a, "김민수")
    _alias(db, _member(db, ws, "민수1"), "민수")
    _alias(db, _member(db, ws, "민수2"), "민수")

    r = resolve_assignee(db, ws, "김민수가")
    assert r.result == ResolutionResult.MATCHED
    assert r.member_id == a.member_id


def test_unverified_alias_needs_check_with_its_confidence(db, ws):
    m = _member(db, ws, "하은")
    _alias(db, m, "하은", verified=False, confidence=0.8)

    r = resolve_assignee(db, ws, "하은이가")
    assert r.result == ResolutionResult.MATCHED
    assert r.needs_check is True
    assert r.confidence == 0.8


def test_no_candidate_hit_is_not_found(db, ws):
    _alias(db, _member(db, ws, "하은"), "하은")

    r = resolve_assignee(db, ws, "철수")
    assert r.result == ResolutionResult.NOT_FOUND
    assert r.candidate_count == 0


def test_deleted_member_excluded(db, ws):
    current = _member(db, ws, "민수")
    left = _member(db, ws, "민수", is_deleted=True)
    _alias(db, current, "민수")
    _alias(db, left, "민수")

    r = resolve_assignee(db, ws, "민수")
    assert r.result == ResolutionResult.MATCHED
    assert r.member_id == current.member_id


def test_only_deleted_member_is_not_found(db, ws):
    _alias(db, _member(db, ws, "민수", is_deleted=True), "민수")

    assert resolve_assignee(db, ws, "민수").result == ResolutionResult.NOT_FOUND


def test_other_workspace_alias_is_ignored(db, ws):
    other = Workspace(name="B")
    db.add(other)
    db.flush()
    _alias(db, _member(db, other.workspace_id, "하은"), "하은")

    assert resolve_assignee(db, ws, "하은").result == ResolutionResult.NOT_FOUND


def test_resolved_texts_uses_candidates(db, ws):
    alias = _alias(db, _member(db, ws, "하은"), "하은", verified=True)

    assert resolved_texts(db, ws, ["하은이가", "철수"]) == {"하은이가"}

    alias.verified = False
    db.flush()
    assert resolved_texts(db, ws, ["하은이가", "철수"]) == set()


def test_resolved_texts_ignores_deleted(db, ws):
    _alias(db, _member(db, ws, "민수"), "민수", verified=True)
    _alias(db, _member(db, ws, "민수", is_deleted=True), "민수", verified=True)

    assert resolved_texts(db, ws, ["민수가"]) == {"민수가"}


def test_resolved_texts_ambiguous_stays_unresolved(db, ws):
    _alias(db, _member(db, ws, "민수1"), "민수", verified=True)
    _alias(db, _member(db, ws, "민수2"), "민수", verified=False)

    assert resolved_texts(db, ws, ["민수가"]) == set()


def test_resolved_texts_first_hit_decides(db, ws):
    # "김민수가"의 첫 히트는 "김민수"(1명, 미검증). 더 짧은 "민수"가 검증 1명이어도 해결이 아니다
    _alias(db, _member(db, ws, "김민수"), "김민수", verified=False)
    _alias(db, _member(db, ws, "민수"), "민수", verified=True)

    assert resolved_texts(db, ws, ["김민수가"]) == set()


def test_resolved_texts_with_no_texts(db, ws):
    assert resolved_texts(db, ws, []) == set()
