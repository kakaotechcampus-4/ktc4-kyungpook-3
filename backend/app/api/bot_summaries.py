"""봇이 회의 요약을 만들 때 쓰는 경로. 사용자 세션 없이 부르므로 서비스 토큰(X-Service-Token)으로 막는다.

재료(summary-input)에 회의 전문과 팀원 이름이 들어간다. 회의 내용을 돌려주지 않는 bot_lookups 와 라우터를 나눈 이유다.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_service_token
from app.core.database import get_db
from app.core.errors import Envelope, success
from app.schemas.project_map import (
    SummaryClaimBody,
    SummaryClaimResponse,
    SummaryInputResponse,
    SummaryRequestBody,
    SummaryRequestResponse,
    SummarySaveResponse,
    SummaryWriteRequest,
)
from app.services import summary

router = APIRouter(tags=["summaries"], dependencies=[Depends(require_service_token)])


@router.post("/summaries/claim", response_model=Envelope[SummaryClaimResponse | None])
def claim_summary(payload: SummaryClaimBody | None = None, db: Session = Depends(get_db)) -> dict:
    """요약할 회의 하나를 맡긴다. 없으면 data 가 null 이다. 15분 안에 저장되지 않으면 다시 맡긴다(회의당 두 번까지)."""
    claim = summary.claim_next(db, only=payload.extraction_ids if payload else None)
    db.commit()
    return success(claim.model_dump(mode="json") if claim else None)


@router.get("/extractions/{extraction_id}/summary-input", response_model=Envelope[SummaryInputResponse])
def get_summary_input(extraction_id: str, db: Session = Depends(get_db)) -> dict:
    """요약 재료를 읽는다. 상태를 바꾸지 않는다."""
    return success(summary.summary_input(db, extraction_id).model_dump(mode="json"))


@router.put("/extractions/{extraction_id}/summary", response_model=Envelope[SummarySaveResponse])
def put_summary(extraction_id: str, payload: SummaryWriteRequest, db: Session = Depends(get_db)) -> dict:
    """요약을 저장한다. 이미 끝난 회의면 applied=false 이고 아무것도 쓰지 않는다."""
    result = summary.save_summary(db, extraction_id, payload)
    db.commit()
    return success(result.model_dump(mode="json"))


@router.post("/workspaces/{workspace_id}/summary-requests", response_model=Envelope[SummaryRequestResponse])
def post_summary_requests(
    workspace_id: str, payload: SummaryRequestBody, db: Session = Depends(get_db)
) -> dict:
    """옛 회의를 줄 세운다. dry_run 기본값이 true 라 생략하면 쓰지 않고 대상만 돌려준다."""
    result = summary.request_summaries(
        db,
        workspace_id,
        meeting_ids=payload.meeting_ids,
        include_all=payload.include_all,
        force=payload.force,
        dry_run=payload.dry_run,
    )
    db.commit()
    return success(result.model_dump(mode="json"))
