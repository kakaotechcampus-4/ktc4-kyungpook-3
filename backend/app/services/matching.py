from dataclasses import dataclass

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import (
    AliasResolutionLog,
    Gate,
    Member,
    MemberAlias,
    ResolutionResult,
)

AMBIGUOUS_CONFIDENCE = 0.3
NOT_FOUND_CONFIDENCE = 0.0
GATE_AUTO_THRESHOLD = 0.8
GATE_REVIEW_THRESHOLD = 0.5


@dataclass
class MatchResult:
    member_id: str | None
    display_name: str | None
    confidence: float
    result: ResolutionResult
    needs_check: bool
    candidate_count: int


def resolve_assignee(
    db: Session,
    workspace_id: str,
    alias_text: str | None,
) -> MatchResult:
    """추출된 이름 문자열로 실제 팀원을 찾는다.

    1건 매칭 → 확정 / 2건 이상 → ambiguous / 0건 → not_found
    """
    if not alias_text:
        return MatchResult(None, None, 0.0, ResolutionResult.NOT_FOUND, True, 0)

    stmt = (
        select(MemberAlias, Member)
        .join(Member, Member.member_id == MemberAlias.member_id)
        .where(
            MemberAlias.workspace_id == workspace_id,
            MemberAlias.alias_text == alias_text,
        )
        .order_by(MemberAlias.verified.desc(), MemberAlias.confidence.desc())
    )
    rows = db.execute(stmt).all()

    if len(rows) == 1:
        alias, member = rows[0]
        return MatchResult(
            member_id=member.member_id,
            display_name=member.display_name,
            confidence=alias.confidence,
            result=ResolutionResult.MATCHED,
            needs_check=not alias.verified,
            candidate_count=1,
        )

    if len(rows) > 1:
        return MatchResult(
            member_id=None,
            display_name=None,
            confidence=AMBIGUOUS_CONFIDENCE,
            result=ResolutionResult.AMBIGUOUS,
            needs_check=True,
            candidate_count=len(rows),
        )

    return MatchResult(
        member_id=None,
        display_name=None,
        confidence=NOT_FOUND_CONFIDENCE,
        result=ResolutionResult.NOT_FOUND,
        needs_check=True,
        candidate_count=0,
    )


def resolve_speaker(
    db: Session,
    workspace_id: str,
    discord_user_id: str | None,
) -> MatchResult:
    """1인칭 발화의 화자(Discord uid)로 팀원을 찾는다.

    봇은 evidence_speaker에 별칭 텍스트가 아니라 발화 트랙의 Discord uid를 넣는다.
    (workspace_id, discord_user_id)는 유일하므로 찾으면 확정, 못 찾으면 not_found다.
    """
    if not discord_user_id:
        return MatchResult(None, None, 0.0, ResolutionResult.NOT_FOUND, True, 0)

    member = db.execute(
        select(Member).where(
            Member.workspace_id == workspace_id,
            Member.discord_user_id == discord_user_id,
            Member.is_deleted.is_(False),
        )
    ).scalar_one_or_none()

    if member is None:
        return MatchResult(
            member_id=None,
            display_name=None,
            confidence=NOT_FOUND_CONFIDENCE,
            result=ResolutionResult.NOT_FOUND,
            needs_check=True,
            candidate_count=0,
        )
    return MatchResult(
        member_id=member.member_id,
        display_name=member.display_name,
        confidence=1.0,
        result=ResolutionResult.MATCHED,
        needs_check=False,
        candidate_count=1,
    )


def resolved_alias_texts(db: Session, workspace_id: str) -> set[str]:
    """resolve_assignee가 확정 매칭(MATCHED, needs_check=False)으로 판정할 별칭 목록.

    검증 여부와 상관없이 전체 후보가 정확히 1명이고, 그 1명이 검증된 경우만 해결된 것으로 본다.
    검증 1명 + 미검증 1명처럼 후보가 여럿이면 매칭은 ambiguous이므로 해결 대기로 남는다.
    """
    stmt = (
        select(MemberAlias.alias_text)
        .join(Member, Member.member_id == MemberAlias.member_id)
        .where(MemberAlias.workspace_id == workspace_id)
        .group_by(MemberAlias.alias_text)
        .having(
            func.count() == 1,
            func.sum(case((MemberAlias.verified.is_(True), 1), else_=0)) == 1,
        )
    )
    return set(db.execute(stmt).scalars())


def log_resolution(
    db: Session,
    workspace_id: str,
    alias_text: str | None,
    match: MatchResult,
    evidence_quote: str | None = None,
    meeting_id: str | None = None,
) -> AliasResolutionLog | None:
    """판정 시도를 로그에 기록한다 (APPEND-ONLY)."""
    if not alias_text:
        return None

    log = AliasResolutionLog(
        workspace_id=workspace_id,
        alias_text=alias_text,
        resolved_member_id=match.member_id,
        result=str(match.result),
        candidate_count=match.candidate_count,
        evidence_quote=evidence_quote,
        meeting_id=meeting_id,
    )
    db.add(log)
    return log


def decide_gate(confidence: float, *, needs_check: bool = False) -> Gate:
    """신뢰도 → 게이트 판정. 규칙 기반이어야 감사·재현이 가능하다.

    needs_check가 True이면 (미검증 별칭, 중의성 등) 점수가 높아도
    AUTO 대신 REVIEW로 하향하여 PM 확인을 강제한다.
    """
    if confidence >= GATE_AUTO_THRESHOLD:
        if needs_check:
            return Gate.REVIEW
        return Gate.AUTO
    if confidence >= GATE_REVIEW_THRESHOLD:
        return Gate.REVIEW
    return Gate.HOLD


def item_confidence(
    task_confidence: float,
    assignee_raw: str | None,
    assignee_confidence: float,
    due_raw: str | None,
    due_confidence: float,
) -> float:
    """항목 전체 신뢰도 산출.
    
    피드백 반영: 마감일이나 담당자가 미언급(None)인 경우, 이를 '파싱 실패(0.0)'가 아닌 
    '정상적인 미언급'으로 취급하여 min() 계산에서 제외한다. 
    (제외하지 않으면 기본값 0.0 때문에 무조건 HOLD 게이트로 빠짐)
    """
    confidences = [task_confidence]
    
    if assignee_raw is not None:
        confidences.append(assignee_confidence)
        
    if due_raw is not None:
        confidences.append(due_confidence)
        
    return min(confidences)