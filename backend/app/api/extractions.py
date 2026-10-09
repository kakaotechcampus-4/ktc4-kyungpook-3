import json
import logging
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_member, require_service_token
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import (
    ApprovalRequest,
    ApprovalType,
    ChangeSource,
    Evidence,
    EvidenceType,
    Extraction,
    ExtractionAction,
    ExtractionItem,
    Gate,
    Meeting,
    MeetingStatus,
    Member,
    Source,
    Task,
    TaskStatus,
    User,
)
from app.schemas.meeting import (
    AssigneeInfo,
    DueDateInfo,
    EvidenceInfo,
    ExtractionCreateRequest,
    ExtractionCreateResponse,
    ExtractionItemCreate,
    ExtractionDetailResponse,
    ExtractionItemResponse,
    TaskInfo,
)
from app.services.matching import (
    MatchResult,
    decide_gate,
    item_confidence,
    log_resolution,
    resolve_assignee,
    resolve_speaker,
)
from app.services.tasks import create_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/extractions", tags=["extractions"])


def _find_existing_extraction(db: Session, meeting_id: str) -> Extraction | None:
    """이미 생성된 Extraction이 있으면 반환한다 (멱등성 보장)."""
    stmt = (
        select(Extraction)
        .where(Extraction.meeting_id == meeting_id)
        .order_by(Extraction.created_at.desc())
        .limit(1)
    )
    return db.execute(stmt).scalar_one_or_none()


# 디스코드 봇(ai/capture/handoff.py)이 사용자 세션 없이 부르는 경로라 세션 대신 서비스 토큰으로 막는다.
@router.post(
    "",
    status_code=201,
    response_model=Envelope[ExtractionCreateResponse],
    dependencies=[Depends(require_service_token)],
)
def create_extraction(
    payload: ExtractionCreateRequest,
    db: Session = Depends(get_db),
) -> dict:
    """AI 분석 결과를 저장한다. 담당자 매칭·게이트 판정이 함께 수행된다."""
    meeting = db.get(Meeting, payload.meeting_id)
    if meeting is None:
        raise AppError(
            ErrorCode.MEETING_NOT_FOUND, details={"meeting_id": payload.meeting_id}
        )
    if meeting.workspace_id != payload.workspace_id:
        raise AppError(
            ErrorCode.WORKSPACE_MISMATCH,
            details={
                "meeting_id": payload.meeting_id,
                "requested_workspace_id": payload.workspace_id,
                "meeting_workspace_id": meeting.workspace_id,
            },
        )

    # ── 원자적 선점: processing → done 조건부 UPDATE (CAS) ──
    # 두 세션이 동시에 진입해도 rowcount=1인 쪽만 처리를 계속한다.
    claim_stmt = (
        update(Meeting)
        .where(
            Meeting.meeting_id == payload.meeting_id,
            Meeting.status == str(MeetingStatus.PROCESSING),
        )
        .values(status=str(MeetingStatus.DONE))
    )
    result = db.execute(claim_stmt)

    if result.rowcount == 0:
        # 선점 실패 — 이미 다른 요청이 처리했거나, processing 상태가 아님
        db.rollback()
        meeting = db.get(Meeting, payload.meeting_id)
        if meeting.status == str(MeetingStatus.DONE):
            # 멱등성: 이미 만들어진 Extraction을 돌려준다
            existing = _find_existing_extraction(db, payload.meeting_id)
            if existing is not None:
                item_count = db.execute(
                    select(ExtractionItem)
                    .where(ExtractionItem.extraction_id == existing.extraction_id)
                ).scalars().all()
                return success(
                    ExtractionCreateResponse(
                        extraction_id=existing.extraction_id,
                        meeting_id=existing.meeting_id,
                        item_count=len(item_count),
                    ).model_dump(mode="json")
                )
        raise AppError(
            ErrorCode.MEETING_NOT_PROCESSING,
            details={"meeting_id": payload.meeting_id, "status": meeting.status},
        )

    # ── 선점 성공: Extraction + Items 생성 ──
    # meeting 객체를 갱신하여 이후 참조 시 done 상태를 반영한다
    db.refresh(meeting)

    extraction = Extraction(
        meeting_id=payload.meeting_id,
        model_name=payload.model_name,
    )
    db.add(extraction)
    db.flush()

    resolved_cache: dict[tuple[str, str | None], MatchResult] = {}
    saved_count = 0

    for raw_item in payload.items:
        # 잘못된 항목 하나로 요청 전체를 실패시키면 봇이 같은 요청을 재시도하다 회의 전체가
        # 반영되지 않는다. 그런 항목은 건너뛰고 나머지를 처리한다.
        target: Task | None = None
        if raw_item.action == ExtractionAction.UPDATE:
            target = db.get(Task, raw_item.target_task_id) if raw_item.target_task_id else None
            if target is None or target.workspace_id != meeting.workspace_id:
                # 검색 이후 task가 지워졌거나, 잘못된 ID
                logger.warning(
                    "수정 대상 task가 없거나 다른 워크스페이스라 추출 항목을 건너뜁니다. "
                    "meeting_id=%s target_task_id=%s",
                    meeting.meeting_id, raw_item.target_task_id,
                )
                continue
        elif not (raw_item.task_title and raw_item.task_title.strip()):
            logger.warning(
                "제목이 비어 있는 새 task 항목을 건너뜁니다. meeting_id=%s evidence_quote=%s",
                meeting.meeting_id, raw_item.evidence_quote,
            )
            continue

        if raw_item.assignee_type == "first" and raw_item.evidence_speaker:
            # 1인칭: evidence_speaker는 화자의 Discord uid다. 별칭이 아니라 Member.discord_user_id로 찾는다.
            assignee_hint = raw_item.evidence_speaker
            cache_key = ("speaker", assignee_hint)
            if cache_key not in resolved_cache:
                resolved_cache[cache_key] = resolve_speaker(db, meeting.workspace_id, assignee_hint)
            match = resolved_cache[cache_key]
        else:
            # 그 외: assignee_raw를 별칭 텍스트로 찾는다. raw가 없으면(group/none 등) 담당자 미지정이다.
            assignee_hint = raw_item.assignee_raw
            cache_key = ("alias", assignee_hint)
            if cache_key not in resolved_cache:
                resolved_cache[cache_key] = resolve_assignee(db, meeting.workspace_id, assignee_hint)
            match = resolved_cache[cache_key]

            # 별칭 판정 로그는 해결 대기 별칭 목록의 원천이므로 별칭 경로만 남긴다.
            log_resolution(
                db,
                workspace_id=meeting.workspace_id,
                alias_text=assignee_hint,
                match=match,
                meeting_id=payload.meeting_id,
            )

        conf = item_confidence(
            task_confidence=raw_item.task_confidence,
            assignee_raw=assignee_hint,
            assignee_confidence=match.confidence,
            due_raw=raw_item.due_raw,
            due_confidence=raw_item.due_confidence,
        )
        if target is not None:
            # 기존 task 수정은 유사도·LLM 판단이 틀릴 수 있어 신뢰도와 무관하게 항상 PM 승인을 거친다.
            gate = Gate.REVIEW
        else:
            gate = decide_gate(conf, needs_check=match.needs_check)

        item = ExtractionItem(
            extraction_id=extraction.extraction_id,
            action=str(raw_item.action),
            task_title=target.title if target is not None else raw_item.task_title,
            task_confidence=raw_item.task_confidence,
            assignee_raw=raw_item.assignee_raw,
            assignee_member_id=match.member_id,
            assignee_confidence=match.confidence,
            assignee_needs_check=match.needs_check,
            due_date=raw_item.due_date,
            due_raw=raw_item.due_raw,
            due_confidence=raw_item.due_confidence,
            confidence=conf,
            gate=str(gate),
            category=raw_item.category,
            status=str(raw_item.status) if raw_item.status else None,
            doc_text=raw_item.doc_text,
        )
        db.add(item)
        db.flush()  # item_id 확보 (approval/task 연결에 필요)
        saved_count += 1

        if target is not None:
            _request_task_update(
                db, meeting, item, raw_item, match, target, has_assignee=assignee_hint is not None
            )
        elif gate == Gate.AUTO:
            # 신뢰도가 충분하므로 승인 없이 바로 태스크로 반영한다.
            task = create_task(
                db,
                workspace_id=meeting.workspace_id,
                title=raw_item.task_title,
                meeting_id=meeting.meeting_id,
                assignee_member_id=match.member_id,
                due_date=raw_item.due_date,
                status=str(raw_item.status or TaskStatus.TODO),
                change_source=str(ChangeSource.MEETING),
                changed_by=None,
            )
            item.task_id = task.task_id
        else:
            # review/hold — PM 승인을 거쳐야 태스크가 생긴다.
            approval_payload = {
                "task_title": raw_item.task_title,
                "assignee_member_id": match.member_id,
                "assignee_raw": raw_item.assignee_raw,
                "due_date": raw_item.due_date.isoformat() if raw_item.due_date else None,
                "due_raw": raw_item.due_raw,
                "evidence_quote": raw_item.evidence_quote,
                "evidence_speaker": raw_item.evidence_speaker,
                "evidence_at_ms": raw_item.evidence_at_ms,
                "extraction_item_id": item.item_id,
                "meeting_id": meeting.meeting_id,
                "gate": str(gate),
                "doc_text": raw_item.doc_text,
                "category": raw_item.category,
            }
            if raw_item.status:
                approval_payload["status"] = str(raw_item.status)
            approval = ApprovalRequest(
                workspace_id=meeting.workspace_id,
                type=str(ApprovalType.TASK_CREATE),
                payload=json.dumps(approval_payload, ensure_ascii=False),
                related_task_id=None,
                requested_by=None,
            )
            db.add(approval)
            db.flush()
            item.approval_id = approval.approval_id

    db.commit()
    db.refresh(extraction)

    return success(
        ExtractionCreateResponse(
            extraction_id=extraction.extraction_id,
            meeting_id=extraction.meeting_id,
            item_count=saved_count,
        ).model_dump(mode="json")
    )


def _same_instant(a: datetime, b: datetime) -> bool:
    """두 시각이 같은가. 시간대가 없는 값(SQLite)은 UTC로 본다."""
    def utc(d: datetime) -> datetime:
        return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d

    return utc(a) == utc(b)


def _request_task_update(
    db: Session,
    meeting: Meeting,
    item: ExtractionItem,
    raw_item: ExtractionItemCreate,
    match: MatchResult,
    target: Task,
    *,
    has_assignee: bool,
) -> None:
    """기존 task 수정 항목을 task_update 승인 요청으로 만든다.

    들어온 값 중 지금 task와 다른 것만 변경안에 담는다. 제목은 바꾸지 않는다. 추출된 제목이
    기존 제목과 글자까지 같을 리 없어서, 마감만 바꾸려던 승인이 제목까지 바꾸게 된다.

    담당자는 지금 task와 다를 때만 변경안에 담는다. 같으면 뺀다. 다만 하나로 못 찾았으면
    (중의적이거나 없음) 그 자체가 PM이 봐야 할 사안이라 다른 변경이 없어도 승인 요청을 만든다.

    category가 scope("이번엔 소셜 로그인은 빼기로" 같은 범위 결정)이면 다른 변경이 없어도
    승인 요청을 만든다. scope는 due_date·status·assignee_member_id 어디에도 대응하는 필드가
    없어서, 다른 category처럼 "값이 같아서 안 만든다"가 아니라 애초에 비교할 필드 자체가 없기
    때문이다 — 승인 요청을 만들지 않으면 이 결정은 doc_text만 남고 PM이 볼 방법이 없어진다.

    그 외에는 담당자까지 같고(또는 언급이 없고) 다른 변경도 없으면 승인 요청을 만들지 않는다.
    이 경우에도 doc_text·근거는 ExtractionItem에 그대로 남는다.

    변경안마다 기준값을 base_values로 함께 남긴다. 제안 뒤에 PM이 같은 필드를 직접 고쳤으면
    승인할 때 충돌로 알려, 나중의 승인이 PM의 변경을 말없이 덮지 않게 한다.

    기준값은 AI가 유사 검색에서 본 값(target_snapshot)이다. 등록 시점의 DB 값을 쓰면 AI가 검색한 뒤
    판단하는 사이에 PM이 고친 값이 기준값이 되어, 승인할 때 충돌 없이 그 값을 덮는다(#157).
    target_snapshot이 없거나 그 필드를 보내지 않았으면 등록 시점의 DB 값을 쓴다.
    변경안에 넣을지는 지금 DB 값과 비교해 정한다. PM이 이미 같은 값으로 고쳤으면 바꿀 것이 없다.
    """
    snapshot = raw_item.target_snapshot
    seen = snapshot.model_fields_set if snapshot is not None else set()
    if snapshot is None:
        logger.warning(
            "수정 항목에 target_snapshot이 없어 등록 시점의 값을 충돌 기준으로 씁니다. task_id=%s",
            target.task_id,
        )
    elif snapshot.updated_at is not None and not _same_instant(snapshot.updated_at, target.updated_at):
        logger.info(
            "AI가 검색한 뒤 task가 바뀌었습니다. 승인할 때 충돌로 확인합니다. task_id=%s",
            target.task_id,
        )

    def base(field: str, current: object) -> object:
        value = getattr(snapshot, field) if field in seen else current
        return value.isoformat() if isinstance(value, date) else value

    changes: dict[str, object] = {}
    # 변경안마다 비교한 기준값. 승인할 때 task가 그 뒤로 바뀌었는지 확인하는 기준이다.
    base_values: dict[str, object] = {}
    if raw_item.due_date is not None and raw_item.due_date != target.due_date:
        changes["due_date"] = raw_item.due_date.isoformat()
        base_values["due_date"] = base("due_date", target.due_date)
    if raw_item.status is not None and str(raw_item.status) != target.status:
        changes["status"] = str(raw_item.status)
        base_values["status"] = base("status", target.status)
    # 담당자는 한 명으로 찾았을 때만 바꾼다. 못 찾았거나 여러 명이면 원문만 보여 주고 PM이 고른다.
    # 원문을 그대로 넣으면 팀원 ID가 아니라서 승인할 때 무시된다.
    if match.member_id is not None and match.member_id != target.assignee_member_id:
        changes["assignee_member_id"] = match.member_id
        base_values["assignee_member_id"] = base("assignee_member_id", target.assignee_member_id)

    item.task_id = target.task_id
    assignee_unresolved = has_assignee and match.member_id is None
    is_scope_decision = raw_item.category == "scope"
    if not changes and not assignee_unresolved and not is_scope_decision:
        return

    payload = {
        **changes,
        # 승인 시 충돌 확인용(approvals._find_conflicts). 반영되는 키가 아니다.
        # version은 어느 필드가 바뀌어도 오르므로 비교에 쓰지 않고 참고로만 남긴다.
        "base_values": base_values,
        "base_task_version": target.version,
        # 아래는 표시용이다. 승인 시 반영되는 키(approvals._TASK_UPDATE_FIELDS)와 겹치지 않게 둔다.
        # 특히 "title"은 반영 대상이라 대상 task 이름은 "task_title"로 싣는다.
        "task_title": target.title,
        "doc_text": raw_item.doc_text,
        "category": raw_item.category,
        "assignee_raw": raw_item.assignee_raw,
        "assignee_needs_check": match.needs_check if has_assignee else False,
        "due_raw": raw_item.due_raw,
        "evidence_quote": raw_item.evidence_quote,
        "evidence_speaker": raw_item.evidence_speaker,
        "evidence_at_ms": raw_item.evidence_at_ms,
        "extraction_item_id": item.item_id,
        "meeting_id": meeting.meeting_id,
        "gate": str(Gate.REVIEW),
    }
    approval = ApprovalRequest(
        workspace_id=meeting.workspace_id,
        type=str(ApprovalType.TASK_UPDATE),
        payload=json.dumps(payload, ensure_ascii=False),
        related_task_id=target.task_id,
        requested_by=None,
    )
    db.add(approval)
    db.flush()
    item.approval_id = approval.approval_id


@router.get("/{extraction_id}", response_model=Envelope[ExtractionDetailResponse])
def get_extraction(
    extraction_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    extraction = db.get(Extraction, extraction_id)
    if extraction is None:
        raise AppError(
            ErrorCode.EXTRACTION_NOT_FOUND, details={"extraction_id": extraction_id}
        )
    require_member(db, user, extraction.meeting.workspace_id)

    stmt = (
        select(ExtractionItem)
        .where(ExtractionItem.extraction_id == extraction_id)
        .order_by(ExtractionItem.created_at)
    )
    items = db.execute(stmt).scalars().all()

    member_ids = {i.assignee_member_id for i in items if i.assignee_member_id}
    names: dict[str, str] = {}
    if member_ids:
        rows = db.execute(
            select(Member.member_id, Member.display_name).where(
                Member.member_id.in_(member_ids)
            )
        ).all()
        names = {mid: name for mid, name in rows}

    # 항목마다 근거가 여러 개일 수 있지만 응답 계약은 하나뿐이라, 제목 근거 중 seq가 가장 작은 발화를 대표로 쓴다.
    evidence_by_item: dict[str, EvidenceInfo] = {}
    if items:
        rows = db.execute(
            select(Evidence.item_id, Source)
            .join(Source, Evidence.source_id == Source.source_id)
            .where(
                Evidence.item_id.in_([i.item_id for i in items]),
                Evidence.type == str(EvidenceType.TASK),
            )
            .order_by(Source.seq)
        ).all()
        for item_id, src in rows:
            evidence_by_item.setdefault(
                item_id,
                EvidenceInfo(
                    quote=src.text, speaker=src.speaker_discord_user_id, at_ms=src.start_ms
                ),
            )

    item_responses = [
        ExtractionItemResponse(
            item_id=i.item_id,
            task=TaskInfo(title=i.task_title, confidence=i.task_confidence),
            assignee=AssigneeInfo(
                raw=i.assignee_raw,
                member_id=i.assignee_member_id,
                display_name=names.get(i.assignee_member_id) if i.assignee_member_id else None,
                confidence=i.assignee_confidence,
                needs_check=i.assignee_needs_check,
            ),
            due_date=DueDateInfo(
                value=i.due_date, raw=i.due_raw, confidence=i.due_confidence
            ),
            confidence=i.confidence,
            gate=i.gate,
            evidence=evidence_by_item.get(
                i.item_id, EvidenceInfo(quote=None, speaker=None, at_ms=None)
            ),
            task_id=i.task_id,
            approval_id=i.approval_id,
        )
        for i in items
    ]

    detail = ExtractionDetailResponse(
        extraction_id=extraction.extraction_id,
        meeting_id=extraction.meeting_id,
        items=item_responses,
    )
    return success(detail.model_dump(mode="json"))
