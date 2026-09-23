import json

from fastapi import APIRouter, Depends
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import (
    ApprovalRequest,
    ApprovalType,
    ChangeSource,
    Extraction,
    ExtractionItem,
    Gate,
    Meeting,
    MeetingStatus,
    Member,
)
from app.schemas.meeting import (
    AssigneeInfo,
    DueDateInfo,
    EvidenceInfo,
    ExtractionCreateRequest,
    ExtractionCreateResponse,
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


@router.post("", status_code=201, response_model=Envelope[ExtractionCreateResponse])
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
        transcript_path=payload.transcript_path,
        model_name=payload.model_name,
    )
    db.add(extraction)
    db.flush()

    resolved_cache: dict[tuple[str, str | None], MatchResult] = {}

    for raw_item in payload.items:
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
                evidence_quote=raw_item.evidence_quote,
                meeting_id=payload.meeting_id,
            )

        conf = item_confidence(
            task_confidence=raw_item.task_confidence,
            assignee_raw=assignee_hint,
            assignee_confidence=match.confidence,
            due_raw=raw_item.due_raw,
            due_confidence=raw_item.due_confidence,
        )
        gate = decide_gate(conf, needs_check=match.needs_check)

        item = ExtractionItem(
            extraction_id=extraction.extraction_id,
            task_title=raw_item.task_title,
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
            evidence_quote=raw_item.evidence_quote,
            evidence_speaker=raw_item.evidence_speaker,
            evidence_at_ms=raw_item.evidence_at_ms,
        )
        db.add(item)
        db.flush()  # item_id 확보 (approval/task 연결에 필요)

        if gate == Gate.AUTO:
            # 신뢰도가 충분하므로 승인 없이 바로 태스크로 반영한다.
            task = create_task(
                db,
                workspace_id=meeting.workspace_id,
                title=raw_item.task_title,
                meeting_id=meeting.meeting_id,
                assignee_member_id=match.member_id,
                due_date=raw_item.due_date,
                change_source=str(ChangeSource.MEETING),
                changed_by=None,
                is_auto=True,
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
            }
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
            item_count=len(payload.items),
        ).model_dump(mode="json")
    )


@router.get("/{extraction_id}", response_model=Envelope[ExtractionDetailResponse])
def get_extraction(extraction_id: str, db: Session = Depends(get_db)) -> dict:
    extraction = db.get(Extraction, extraction_id)
    if extraction is None:
        raise AppError(
            ErrorCode.EXTRACTION_NOT_FOUND, details={"extraction_id": extraction_id}
        )

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
            evidence=EvidenceInfo(
                quote=i.evidence_quote,
                speaker=i.evidence_speaker,
                at_ms=i.evidence_at_ms,
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
