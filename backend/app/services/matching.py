from dataclasses import dataclass

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import (
    AliasResolutionLog,
    EvidenceStatus,
    ExtractionPath,
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


# 특정 개인을 가리키지 않는 담당자 종류. AI의 ASSIGNEE_TYPES(ai/shared/schemas.py) 중 group·none이다
_NO_PERSON_ASSIGNEE_TYPES = frozenset({"group", "none"})


def mentions_assignee(assignee_type: str | None, assignee_hint: str | None) -> bool:
    """담당자를 언급했는지. 확신도를 측정하지 않은 새 항목의 게이트(decide_create_gate)에 쓴다.

    조회할 값(1인칭은 화자 uid, 그 밖에는 별칭 원문)이 있으면 언급한 것이다. 조회할 값이 없어도
    assignee_type이 사람을 지목하는 종류면 언급한 것으로 본다. AI는 "그분이"·"너가"처럼 이름으로 풀지
    못한 지칭을 assignee_raw 없이 종류만 보내므로, 이를 언급 없음으로 보면 PM이 채워야 할 항목이 빠진다.
    group·none이거나 종류를 보내지 않았으면 언급 없음이다.
    """
    if assignee_hint is not None:
        return True
    return assignee_type is not None and assignee_type not in _NO_PERSON_ASSIGNEE_TYPES


# AI가 대명사·역할("그분", "너", "디자이너분")을 문맥으로 풀어 이름을 보낸 담당자 종류. 이름이 한 명으로 찾아져도
# LLM의 추측이라 auto로 보내지 않는다. legacy도 이 종류는 inferred로 본다(ai/extract/llm.py _assignee_status)
_INFERRED_ASSIGNEE_TYPES = frozenset({"second", "thirdpronoun", "thirdrole"})


@dataclass(frozen=True)
class AutoSignals:
    """judge 새 항목의 auto 판단 근거. AI가 보낸 값이고, 보내지 않은 값은 None이다."""

    task_status: EvidenceStatus | None
    due_status: EvidenceStatus | None
    similar_count: int | None
    # BE가 등록 시점에 본 값. 임베딩이 없는 task(기다리는 중이거나 임베딩 API가 거절한)는 AI의 유사 검색에 잡히지 않았다
    unsearched_tasks_exist: bool = False


def auto_blockers(
    signals: AutoSignals,
    *,
    assignee_type: str | None,
    assignee: MatchResult | None,
    has_due_date: bool,
) -> list[str]:
    """judge 새 항목을 auto로 보내지 못하는 이유. 빈 리스트면 auto로 보낼 수 있다.

    숫자 점수 하나로 정하지 않고 조건을 모두 만족할 때만 auto다(#232). 할 일 근거 상태는 LLM의 자기 표시라
    거의 certain으로 나오므로, 중복 생성은 임베딩으로 계산한 유사 검색 결과(similar_count)로 따로 막는다.
    assignee는 담당자를 언급했을 때(mentions_assignee)의 매칭 결과이고, 언급이 없으면 None이다.
    """
    reasons = []
    if signals.task_status is None or signals.due_status is None or signals.similar_count is None:
        # 이 값을 보내기 전의 AI다. 판단할 근거가 없다
        return ["missing_signals"]
    if signals.task_status != EvidenceStatus.CERTAIN:
        reasons.append("task_not_certain")
    if assignee is not None and (
        assignee.member_id is None
        or assignee.needs_check
        or assignee.confidence < GATE_AUTO_THRESHOLD
    ):
        reasons.append("assignee_not_confirmed")
    if assignee_type in _INFERRED_ASSIGNEE_TYPES:
        reasons.append("assignee_inferred")
    if signals.due_status == EvidenceStatus.INFERRED:
        reasons.append("due_not_certain")
    elif (signals.due_status == EvidenceStatus.MISSING) == has_due_date:
        # 마감이 없다면서 날짜를 보냈거나, 있다면서 날짜를 안 보냈다. 어느 쪽이 맞는지 모른다
        reasons.append("due_mismatch")
    if signals.similar_count > 0:
        reasons.append("similar_task_found")
    elif signals.unsearched_tasks_exist:
        # 검색이 못 본 task가 있어 similar_count=0을 믿을 수 없다. 같은 회의에서 앞서 auto로 만든 task도 여기 걸린다
        reasons.append("unsearched_task_exists")
    return reasons


def decide_create_gate(
    path: ExtractionPath | None,
    confidence: float | None,
    *,
    needs_check: bool = False,
    assignee_confidence: float | None = None,
    blockers: list[str] | None = None,
) -> Gate:
    """새 task 항목(action=create)의 게이트. 기존 task 수정은 이 함수를 거치지 않고 항상 REVIEW다.

    judge 경로는 할 일 확신도를 측정하지 않는다. 대신 auto 조건(auto_blockers)을 모두 만족하면(blockers가
    빈 리스트) AUTO다. 경로를 가릴 수 없는 항목은 확신도를 측정하지 않았으면(None) AUTO로 보내지 않는다.
    측정하지 않은 값을 0.0으로 보면 무조건 HOLD가 되고, 1.0으로 보면 근거 없이 AUTO가 된다.

    AUTO가 아니면 BE가 직접 계산한 담당자 확신도만 본다. assignee_confidence는 담당자를 언급했을 때
    (mentions_assignee)만 값이고 언급이 없으면 None이다. 언급했는데 한 명으로 찾지 못했으면(중의적·없음·
    이름으로 풀리지 않은 지칭) PM이 채워야 하므로 HOLD, 찾았거나 언급이 없으면 REVIEW다.
    legacy는 신뢰도로 정한다(decide_gate).
    """
    if path == ExtractionPath.JUDGE or confidence is None:
        if assignee_confidence is not None and assignee_confidence < GATE_REVIEW_THRESHOLD:
            return Gate.HOLD
        if path == ExtractionPath.JUDGE and blockers is not None and not blockers:
            return Gate.AUTO
        return Gate.REVIEW
    return decide_gate(confidence, needs_check=needs_check)


def item_confidence(
    task_confidence: float | None,
    assignee_raw: str | None,
    assignee_confidence: float,
    due_raw: str | None,
    due_confidence: float | None,
) -> float | None:
    """항목 전체 신뢰도 산출.
    
    피드백 반영: 마감일이나 담당자가 미언급(None)인 경우, 이를 '파싱 실패(0.0)'가 아닌 
    '정상적인 미언급'으로 취급하여 min() 계산에서 제외한다. 
    (제외하지 않으면 기본값 0.0 때문에 무조건 HOLD 게이트로 빠짐)

    할 일 확신도를 측정하지 않았으면(None) 최솟값을 알 수 없으므로 None이다. 마감 확신도를 측정하지
    않았으면 마감은 계산에서 뺀다.
    """
    if task_confidence is None:
        return None

    confidences = [task_confidence]
    
    if assignee_raw is not None:
        confidences.append(assignee_confidence)
        
    if due_raw is not None and due_confidence is not None:
        confidences.append(due_confidence)
        
    return min(confidences)
