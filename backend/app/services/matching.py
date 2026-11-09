from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.errors import AppError, ErrorCode

from app.models import (
    AliasResolutionLog,
    AliasSource,
    EvidenceStatus,
    ExtractionPath,
    Gate,
    Member,
    MemberAlias,
    ResolutionResult,
    Source,
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


# 담당자 이름 뒤에 붙는 조사. AI 의 _PARTICLES(ai/extract/eval_golden_set.py)와 순서까지 같게 둔다
_PARTICLES = ("께서", "한테", "에게", "이가", "이", "가", "은", "는", "을", "를", "께")
# 이름 뒤에 붙는 호칭. "님"은 AI 규칙에도 있고 "씨"는 BE 에서 더했다(#463 리뷰, AI 쪽도 같이 맞춘다)
_HONORIFICS = ("님", "씨")


def normalize_alias_text(text: str) -> str:
    """별칭 표기의 공백을 한 칸으로 줄이고 앞뒤를 지운다. 후보를 만들 때와 별칭을 저장할 때 같이 쓴다.

    저장하는 쪽도 같은 규칙이어야 공백이 든 별칭(" 환", "환  님")이 어떤 입력으로도 못 찾히는 일이 없다.
    """
    return " ".join(text.split())


def name_candidates(text: str | None) -> list[str]:
    """담당자 표기에서 님·조사를 뗀 후보들을 긴 것부터 돌려준다. 빈 표기는 빈 리스트다.

    AI 의 _name_candidates(ai/extract/eval_golden_set.py)와 같은 규칙이다. 바꾸면 둘 다 바꾼다.
    조사가 붙었는지 겉보기로 알 수 없다("하은"의 "은"은 이름, "환은"의 "은"은 조사). 그래서 조사를 뗀 것까지
    후보를 모두 만들고, 긴 후보(원문에 가까운 것)부터 찾는다. 예: "하은이가" → 하은이가, 하은이, 하은.
    AI 규칙과 다른 점(AI 쪽도 같이 맞춘다, #463 리뷰): ① 공백을 한 칸으로 줄이고 후보마다 앞뒤 공백을 지운다.
    그래야 띄어 쓴 님("환 님이" → "환")도 찾는다. ② 조사를 떼고 "이"로 끝나면 "이"를 한 번 더 뗀 것도 후보다.
    "하은이는" → 하은이는, 하은이, 하은. ③ "님"처럼 "씨"도 뗀다. "민수 씨", "민수씨가" → 민수. 호칭을 뗀 뒤에도
    ②의 "이" 떼기를 적용한다. "하은이님이", "하은이 씨는" → 하은.
    """
    if not text:
        return []
    base = normalize_alias_text(text)
    out = {base}

    def add_remainder(form: str) -> None:
        # 호칭이나 조사를 떼고 남은 꼴을 후보로 둔다. 띄어 쓴 호칭("하은이 님")은 뗀 뒤 끝 공백을 지운다. "이"로
        # 끝나면 "이"를 한 번 더 뗀 것도 둔다. "하은이는"·"하은이 님"은 "하은이"에서 멈췄다. "세이"처럼 이름이
        # "이"로 끝나도 긴 후보부터 찾아 지킨다.
        form = form.strip()
        if not form:
            return
        out.add(form)
        if form.endswith("이") and len(form) > 1:
            out.add(form[:-1].strip())

    def without_honorific(form: str) -> str:
        # 호칭(님·씨)으로 끝나면 뗀 꼴(앞뒤 공백 정리), 아니면 빈 문자열
        return form[:-1].strip() if form.endswith(_HONORIFICS) else ""

    # 조사를 떼는 대상은 원문과 원문에서 호칭을 뗀 꼴뿐이다. 떼고 남은 꼴("이"를 더 뗀 것 포함)에서 다시 떼지 않는다
    sources = [base]
    bare = without_honorific(base)
    if bare:
        sources.append(bare)
        add_remainder(bare)
    for form in sources:
        for particle in _PARTICLES:
            if form.endswith(particle) and len(form) > len(particle):
                stripped = form[: -len(particle)].strip()
                add_remainder(stripped)
                bare = without_honorific(stripped)
                if bare:
                    add_remainder(bare)
    return sorted((x for x in out if x), key=lambda s: (-len(s), s))


def _is_one_letter(text: str) -> bool:
    """한 글자 별칭인가. 한 글자 별칭은 확정 근거로 쓰지 않는다(resolve_assignee 참고)."""
    return len(text) == 1


def resolve_assignee(
    db: Session,
    workspace_id: str,
    alias_text: str | None,
) -> MatchResult:
    """추출된 이름 문자열로 실제 팀원을 찾는다.

    님·조사를 뗀 후보(name_candidates)를 긴 것부터 보고, 별칭이 처음 걸린 후보의 행만으로 판정한다.
    1건 매칭 → 확정 / 2건 이상 → ambiguous / 걸린 후보 없음 → not_found. 탈퇴한 팀원의 별칭은 보지 않는다.
    한 글자 별칭으로 찾으면 담당자는 채우되 확인 필요로 둔다. 조사를 떼면 "하은" → "하"처럼 한 글자 후보가
    생겨, 팀에 없는 사람이 한 글자 별칭을 가진 팀원에게 자동 배정될 수 있어서다(#463 리뷰).
    """
    candidates = name_candidates(alias_text)
    if not candidates:
        return MatchResult(None, None, 0.0, ResolutionResult.NOT_FOUND, True, 0)

    stmt = (
        select(MemberAlias, Member)
        .join(Member, Member.member_id == MemberAlias.member_id)
        .where(
            MemberAlias.workspace_id == workspace_id,
            MemberAlias.alias_text.in_(candidates),
            Member.is_deleted.is_(False),
        )
        .order_by(MemberAlias.verified.desc(), MemberAlias.confidence.desc())
    )
    hits = db.execute(stmt).all()
    # 후보는 긴 순서다. 처음 걸린 후보의 행만 남긴다
    rows = next(
        (matched for c in candidates if (matched := [h for h in hits if h[0].alias_text == c])),
        [],
    )

    if len(rows) == 1:
        alias, member = rows[0]
        return MatchResult(
            member_id=member.member_id,
            display_name=member.display_name,
            confidence=alias.confidence,
            result=ResolutionResult.MATCHED,
            needs_check=not alias.verified or _is_one_letter(alias.alias_text),
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
    return speaker_match(member)


def speaker_match(member: Member) -> MatchResult:
    """화자 멤버를 찾았을 때의 확정 매칭 결과."""
    return MatchResult(
        member_id=member.member_id,
        display_name=member.display_name,
        confidence=1.0,
        result=ResolutionResult.MATCHED,
        needs_check=False,
        candidate_count=1,
    )


def active_members_by_id(
    db: Session,
    workspace_id: str,
    member_ids: Iterable[str],
) -> dict[str, Member]:
    """멤버 ID 로 같은 워크스페이스의 탈퇴하지 않은 팀원을 한 번에 찾는다. 없는 ID 는 결과에 없다."""
    ids = set(member_ids)
    if not ids:
        return {}
    members = db.execute(
        select(Member).where(
            Member.workspace_id == workspace_id,
            Member.member_id.in_(ids),
            Member.is_deleted.is_(False),
        )
    ).scalars()
    return {m.member_id: m for m in members}


def resolved_texts(db: Session, workspace_id: str, texts: Iterable[str]) -> set[str]:
    """texts 중 resolve_assignee 가 확정 매칭(MATCHED, needs_check=False)으로 판정할 것.

    각 text 의 첫 히트 후보(name_candidates 순서)에 걸린 별칭이 정확히 1개이고 그 별칭이 검증된 경우만
    해결된 것으로 본다. 검증 1명 + 미검증 1명처럼 여럿이면 ambiguous 이므로 해결 대기로 남는다.
    탈퇴한 팀원의 별칭은 세지 않는다.

    한 글자 별칭은 PM 이 직접 등록한(manual·learned) 것만 해결로 본다. 이름에서 자동으로 만든 한 글자
    별칭("김환" → "환")은 PM 이 연결한 것이 아니라 계속 남긴다. 이 목록은 "팀원과 연결됐나"를 묻고
    resolve_assignee 는 "자동 반영해도 되나"를 묻는다. 그래서 한 글자는 여기서 해결이어도 찾으면 확인 필요다(#463 리뷰).
    """
    rows = db.execute(
        select(MemberAlias.alias_text, MemberAlias.verified, MemberAlias.source)
        .join(Member, Member.member_id == MemberAlias.member_id)
        .where(MemberAlias.workspace_id == workspace_id, Member.is_deleted.is_(False))
    ).all()
    aliases_by_text: dict[str, list[tuple[bool, str]]] = {}
    for alias_text, verified, source in rows:
        aliases_by_text.setdefault(alias_text, []).append((verified, source))

    human_sources = (str(AliasSource.MANUAL), str(AliasSource.LEARNED))
    resolved: set[str] = set()
    for text in texts:
        for candidate in name_candidates(text):
            hit = aliases_by_text.get(candidate)
            if hit:
                if len(hit) == 1 and hit[0][0] and (not _is_one_letter(candidate) or hit[0][1] in human_sources):
                    resolved.add(text)
                break
    return resolved


def log_resolution(
    db: Session,
    workspace_id: str,
    alias_text: str | None,
    match: MatchResult,
    meeting_id: str | None = None,
    source_id: str | None = None,
) -> AliasResolutionLog | None:
    """판정 시도를 로그에 기록한다 (APPEND-ONLY). source_id는 별칭이 나온 발화이고 모르면 None이다."""
    if not alias_text:
        return None

    from app.services.meeting_deletion import require_live_meeting
    if meeting_id:
        require_live_meeting(db, meeting_id, lock=True)
    if source_id:
        source = db.get(Source, source_id)
        if source is None:
            raise AppError(ErrorCode.MEETING_NOT_FOUND)
        require_live_meeting(db, source.meeting_id, lock=True)
    log = AliasResolutionLog(
        workspace_id=workspace_id,
        alias_text=alias_text,
        resolved_member_id=match.member_id,
        result=str(match.result),
        candidate_count=match.candidate_count,
        meeting_id=meeting_id,
        source_id=source_id,
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
    # 승인 대기 중인 task_create 요청 가운데 임베딩이 없어 유사 검색(include_pending)에 잡히지 않은 것이 있는지
    unsearched_pending_exist: bool = False
    # AI가 찾은 전사 오인식 의심 단어 수. 근거 문장 자체가 잘못 전사됐을 수 있어 auto로 보내지 않는다
    asr_suspect_count: int = 0
    # AI가 전사 오인식 검사를 하지 못했다(분석기 장애 등). 보수적으로 막고, 오탐 증가와 구별되게 사유를 따로 둔다
    asr_check_failed: bool = False


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
    else:
        # 검색이 못 본 후보가 있어 similar_count=0을 믿을 수 없다. 두 사유는 서로 독립이다
        if signals.unsearched_tasks_exist:
            # 같은 회의에서 앞서 auto로 만든 task도 여기 걸린다
            reasons.append("unsearched_task_exists")
        if signals.unsearched_pending_exist:
            reasons.append("unsearched_pending_exists")
    if signals.asr_suspect_count:
        # Jev 의 certain 은 근거에 충실한지만 본다. "애포문서 정리"처럼 근거가 잘못 전사됐으면 그대로 certain 이다
        reasons.append("asr_suspect")
    if signals.asr_check_failed:
        reasons.append("asr_check_failed")
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
