"""추출 항목이 반영됐는가, 승인을 기다리는가. 승인 상태로 무엇을 보일지 정하는 곳은 모두 이 정의만 쓴다.

| 항목 | final | waiting |
|---|---|---|
| 자동 생성, 되돌리지 않음 | 예 | 아니오 |
| 승인된 생성(합쳐진 항목 포함) | 예 | 아니오 |
| 승인된 수정, 카드 없는 바뀐 것 없는 수정 | 예 | 아니오 |
| 대기·보류 카드(보류도 pending 카드다) | 아니오 | 예 |
| 반려된 생성, task_id 가 남는 반려된 수정 | 아니오 | 아니오 |
| 되돌린 자동 항목(새 pending 카드) | 아니오 | 예 |
| 지운 Task | 아니오 | 아니오 |

task_id 만으로는 반영을 알 수 없다. 수정 항목은 등록 때부터, 반려된 뒤에도 대상 task 를 가리킨다.
"""
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import ColumnElement, Exists, Select, and_, case, exists, func, literal, or_, select
from sqlalchemy.orm import Session, aliased

from app.models import ApprovalRequest, ApprovalStatus, Extraction, ExtractionItem, MeetingSource, Task

PENDING = str(ApprovalStatus.PENDING)
APPROVED = str(ApprovalStatus.APPROVED)


def final_items() -> Select:
    """(item_id, extraction_id, task_id, created_at). Task 가 살아 있고 카드가 없거나 승인됐다. 서브쿼리로 붙여 쓴다."""
    return (
        select(ExtractionItem.item_id, ExtractionItem.extraction_id, ExtractionItem.task_id, ExtractionItem.created_at)
        .join(Task, Task.task_id == ExtractionItem.task_id)
        .outerjoin(ApprovalRequest, ApprovalRequest.approval_id == ExtractionItem.approval_id)
        .where(
            Task.is_deleted.is_(False),
            or_(ApprovalRequest.approval_id.is_(None), ApprovalRequest.status == APPROVED),
        )
    )


def waiting(extraction_id: ColumnElement[str]) -> Exists:
    """E 의 항목이 pending 카드에 걸려 있다. 보류도 pending 카드다. 합친 카드는 걸린 회의를 모두 기다리게 한다."""
    item, card = aliased(ExtractionItem), aliased(ApprovalRequest)
    return exists().where(item.extraction_id == extraction_id, card.approval_id == item.approval_id,
                          card.status == PENDING)


def approved(extraction_id: ColumnElement[str]) -> Exists:
    """E 의 항목이 승인된 카드에 걸려 있고 그 Task 가 살아 있다. 카드 없는 수정은 세지 않는다(채팅 요약의 조건)."""
    item, card, task = aliased(ExtractionItem), aliased(ApprovalRequest), aliased(Task)
    return exists().where(item.extraction_id == extraction_id, card.approval_id == item.approval_id,
                          card.status == APPROVED, task.task_id == item.task_id, task.is_deleted.is_(False))


def ready(extraction_id: ColumnElement[str], source: ColumnElement[str]) -> ColumnElement[bool]:
    """claim_next 와 summary_state 가 같이 쓰는 유일한 요약 가능 조건."""
    return and_(~waiting(extraction_id), or_(source != str(MeetingSource.CHAT), approved(extraction_id)))


@dataclass(frozen=True)
class Readiness:
    ready: bool
    waiting_cards: int                 # DISTINCT pending 카드. 합친 카드는 한 장
    last_resolved_at: datetime | None  # E 의 항목에 걸린 카드의 마지막 resolved_at


def readiness(db: Session, extraction: Extraction, source: str) -> Readiness:
    is_ready = db.scalar(select(ready(literal(extraction.extraction_id), literal(source))))
    waiting_cards, last_resolved_at = db.execute(
        select(
            func.count(func.distinct(case((ApprovalRequest.status == PENDING, ApprovalRequest.approval_id)))),
            func.max(ApprovalRequest.resolved_at),
        )
        .select_from(ExtractionItem)
        .join(ApprovalRequest, ApprovalRequest.approval_id == ExtractionItem.approval_id)
        .where(ExtractionItem.extraction_id == extraction.extraction_id)
    ).one()
    return Readiness(ready=bool(is_ready), waiting_cards=waiting_cards, last_resolved_at=last_resolved_at)
