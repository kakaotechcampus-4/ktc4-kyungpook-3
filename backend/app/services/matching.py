from dataclasses import dataclass

from sqlalchemy import select
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
        resolved_member=match.member_id,
        result=str(match.result),
        candidate_count=match.candidate_count,
        evidence_quote=evidence_quote,
        meeting_id=meeting_id,
    )
    db.add(log)
    return log


def decide_gate(confidence: float) -> Gate:
    """신뢰도 → 게이트 판정. 규칙 기반이어야 감사·재현이 가능하다."""
    if confidence >= GATE_AUTO_THRESHOLD:
        return Gate.AUTO
    if confidence >= GATE_REVIEW_THRESHOLD:
        return Gate.REVIEW
    return Gate.HOLD


def item_confidence(
    task_confidence: float,
    assignee_confidence: float,
    due_confidence: float,
) -> float:
    """항목 신뢰도 = min(태스크, 담당자, 마감)."""
    return min(task_confidence, assignee_confidence, due_confidence)