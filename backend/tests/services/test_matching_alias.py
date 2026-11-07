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


def _alias(db, member, text, *, verified=True, confidence=1.0, source="manual") -> MemberAlias:
    alias = MemberAlias(
        member_id=member.member_id,
        workspace_id=member.workspace_id,
        alias_text=text,
        alias_type="realname",
        source=source,
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
        ("환은", ["환은", "환"]),
        ("  동우 ", ["동우"]),
        ("", []),
        (None, []),
        ("님", ["님"]),
        # 띄어 쓴 님: 떼고 남은 공백을 지운다(#463 리뷰). "환 님이"는 AI 프롬프트 예시다
        ("환 님이", ["환 님이", "환 님", "환"]),
        ("지민 님", ["지민 님", "지민"]),
        ("  하은  님 ", ["하은 님", "하은"]),
        ("BE  리더가", ["BE 리더가", "BE 리더"]),
        # 조사를 떼고 "이"로 끝나면 "이"를 한 번 더 뗀 것도 후보다(#463 리뷰). "이가"만 한 덩어리 조사라 되던 것을 넓힌다
        ("하은이는", ["하은이는", "하은이", "하은"]),
        ("하은이를", ["하은이를", "하은이", "하은"]),
        ("하은이한테", ["하은이한테", "하은이", "하은"]),
        ("하은이에게", ["하은이에게", "하은이", "하은"]),
        ("하은이께서", ["하은이께서", "하은이", "하은"]),
        ("세이가", ["세이가", "세이", "세"]),
        ("지민이", ["지민이", "지민"]),
        # "씨"도 "님"과 같은 호칭이다(#463 리뷰). 띄어 쓰든 붙이든, 조사가 붙든 떼든 이름까지 닿는다
        ("민수 씨", ["민수 씨", "민수"]),
        ("민수씨", ["민수씨", "민수"]),
        ("민수씨가", ["민수씨가", "민수씨", "민수"]),
        ("민수 씨는", ["민수 씨는", "민수 씨", "민수"]),
        ("김씨", ["김씨", "김"]),
        ("씨", ["씨"]),
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


def test_one_letter_alias_match_needs_check(db, ws):
    # 한 글자 별칭은 확정 근거로 쓰지 않는다. 팀에 없는 "하은"이 김하의 "하"로 자동 배정되면 안 된다.
    kim_ha = _member(db, ws, "김하")
    _alias(db, kim_ha, "하")

    for said in ("하은", "하가", "하"):
        r = resolve_assignee(db, ws, said)
        assert (r.result, r.member_id, r.needs_check, r.confidence) == (
            ResolutionResult.MATCHED, kim_ha.member_id, True, 1.0
        ), said


def test_two_letter_alias_match_stays_confirmed(db, ws):
    lee = _member(db, ws, "이하은")
    _alias(db, lee, "하은")

    r = resolve_assignee(db, ws, "하은이가")
    assert (r.result, r.member_id, r.needs_check) == (ResolutionResult.MATCHED, lee.member_id, False)


def test_resolved_texts_auto_one_letter_alias_stays_unresolved(db, ws):
    # 이름에서 자동으로 만든 한 글자 별칭("김환" → "환")은 해결로 보지 않는다. PM 이 직접 연결한 것이 아니다
    _alias(db, _member(db, ws, "김환"), "환", source="display_name")
    _alias(db, _member(db, ws, "박닉"), "닉", source="discord_profile")
    _alias(db, _member(db, ws, "김동우"), "동우")

    assert resolved_texts(db, ws, ["환이가", "환", "닉", "동우가"]) == {"동우가"}


@pytest.mark.parametrize("source", ["manual", "learned"])
def test_resolved_texts_human_one_letter_alias_is_resolved(db, ws, source):
    # PM 이 직접 등록한 한 글자 별칭은 "팀원과 연결된 이름"이라 미매칭 목록에서 뺀다(#463 리뷰).
    # 담당자 찾기는 한 글자면 계속 확인 필요다(resolve_assignee). 둘의 질문이 다르다: 연결됐나 / 자동 반영해도 되나
    lee = _member(db, ws, "이준")
    _alias(db, lee, "준", source=source)

    assert resolved_texts(db, ws, ["준이가", "준"]) == {"준이가", "준"}
    r = resolve_assignee(db, ws, "준")
    assert (r.member_id, r.needs_check) == (lee.member_id, True)


def test_resolved_texts_unverified_or_shared_one_letter_alias_stays_unresolved(db, ws):
    _alias(db, _member(db, ws, "이준"), "준", verified=False)
    _alias(db, _member(db, ws, "김환"), "환")
    _alias(db, _member(db, ws, "박환"), "환")

    assert resolved_texts(db, ws, ["준", "환"]) == set()


def test_spaced_honorific_finds_alias(db, ws):
    kim = _member(db, ws, "김지민")
    _alias(db, kim, "지민")

    for said in ("지민 님", "지민 님이", "지민 님께서"):
        r = resolve_assignee(db, ws, said)
        assert (r.result, r.member_id) == (ResolutionResult.MATCHED, kim.member_id), said
    assert resolved_texts(db, ws, ["지민 님이"]) == {"지민 님이"}


def test_particle_after_i_still_reaches_the_name(db, ws):
    haeun = _member(db, ws, "이하은")
    _alias(db, haeun, "하은")

    for said in ("하은이는", "하은이를", "하은이한테", "하은이에게"):
        r = resolve_assignee(db, ws, said)
        assert (r.result, r.member_id, r.needs_check) == (ResolutionResult.MATCHED, haeun.member_id, False), said
    assert resolved_texts(db, ws, ["하은이는", "하은이한테"]) == {"하은이는", "하은이한테"}


def test_name_ending_in_i_is_kept_by_longest_first(db, ws):
    # "세이" 는 "이"로 끝나는 이름이다. 긴 후보부터 보므로 "세이는" 은 "세"가 아니라 "세이"로 간다
    sei = _member(db, ws, "세이")
    se = _member(db, ws, "한세")
    _alias(db, sei, "세이")
    _alias(db, se, "세")

    assert resolve_assignee(db, ws, "세이는").member_id == sei.member_id


def test_ssi_honorific_finds_alias(db, ws):
    kim = _member(db, ws, "김민수")
    _alias(db, kim, "민수")

    for said in ("민수 씨", "민수씨", "민수씨가", "민수 씨는", "민수 씨께서"):
        r = resolve_assignee(db, ws, said)
        assert (r.result, r.member_id, r.needs_check) == (ResolutionResult.MATCHED, kim.member_id, False), said


def test_ssi_name_is_kept_by_longest_first(db, ws):
    # "…씨"로 끝나는 이름도 긴 후보부터 찾아 지켜진다. 떼어서 한 글자가 되면 확인 필요로만 걸린다
    exact = _member(db, ws, "이영씨")
    other = _member(db, ws, "이영")
    _alias(db, exact, "이영씨")
    _alias(db, other, "이영")

    assert resolve_assignee(db, ws, "이영씨가").member_id == exact.member_id

    only = _member(db, ws, "김하")
    _alias(db, only, "김")
    r = resolve_assignee(db, ws, "김씨")
    assert (r.member_id, r.needs_check) == (only.member_id, True)
