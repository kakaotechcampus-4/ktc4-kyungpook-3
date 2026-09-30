"""유사 task 검색. AI가 Terra 2단계에 넘길 기존 task 후보를 찾을 때 부른다.

디스코드 봇이 사용자 세션 없이 부르는 경로라 세션 대신 서비스 토큰(X-Service-Token)으로 막는다.
task 제목과 담당자를 돌려주므로 POST /extractions처럼 열어 두지 않는다.
"""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_service_token
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Workspace
from app.schemas.task import SimilarTaskCandidate, SimilarTaskListResponse, SimilarTaskSearchRequest
from app.services import embedding

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/workspaces", tags=["tasks"], dependencies=[Depends(require_service_token)]
)


@router.post(
    "/{workspace_id}/tasks/similar", response_model=Envelope[SimilarTaskListResponse]
)
def search_similar_tasks(
    workspace_id: str,
    payload: SimilarTaskSearchRequest,
    db: Session = Depends(get_db),
) -> dict:
    """문장과 비슷한 task를 유사도 순으로 돌려준다(임베딩 없는 task 제외).

    임베딩 서버 호출이 실패하면 빈 목록 대신 EMBEDDING_UNAVAILABLE을 돌려준다. 빈 목록이면
    호출한 쪽이 "비슷한 task 없음"으로 판단해 중복 task를 만들 수 있기 때문이다.
    """
    if db.get(Workspace, workspace_id) is None:
        raise AppError(ErrorCode.WORKSPACE_NOT_FOUND, details={"workspace_id": workspace_id})

    try:
        [query_vector] = embedding.embed_texts([payload.text])
    except embedding.EmbeddingError as exc:
        # 호출자 잘못이 아니라 키·URL 설정이나 임베딩 서버 쪽 실패라 BE 로그에도 남긴다.
        # 요청 본문(text)은 회의 발화라 남기지 않는다.
        logger.warning("유사 task 검색 중 임베딩 실패 workspace_id=%s: %s", workspace_id, exc)
        raise AppError(ErrorCode.EMBEDDING_UNAVAILABLE, details={"reason": str(exc)}) from exc

    results = embedding.search_similar_tasks(
        db, workspace_id, query_vector, k=payload.k, min_similarity=payload.min_similarity
    )
    items = [
        SimilarTaskCandidate(
            task_id=task.task_id,
            notion_page_id=task.notion_page_id,
            title=task.title,
            assignee_member_id=task.assignee_member_id,
            due_date=task.due_date,
            status=task.status,
            similarity=round(similarity, 4),
            updated_at=task.updated_at,
        )
        for task, similarity in results
    ]
    return success(SimilarTaskListResponse(items=items).model_dump(mode="json"))
