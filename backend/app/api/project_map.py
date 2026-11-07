"""웹의 프로젝트 맵과 요약본 내려받기. 요약에 팀원 발언이 들어가므로 볼 권한은 회의록과 같이 워크스페이스 멤버다."""
from datetime import date
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_member, get_current_user, require_member
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Meeting, Member, User
from app.schemas.project_map import GraphResponse, TopicDetailResponse
from app.services import project_map
from app.services.project_map import MarkdownFile

router = APIRouter(tags=["project-map"])


@router.get("/workspaces/{workspace_id}/project-map", response_model=Envelope[GraphResponse])
def get_project_map(
    workspace_id: str, member: Member = Depends(get_current_member), db: Session = Depends(get_db)
) -> dict:
    """주제와 태스크 그래프. 선에 종류가 없다."""
    return success(project_map.build_graph(db, workspace_id).model_dump(mode="json"))


@router.get("/workspaces/{workspace_id}/topics/{topic_id}", response_model=Envelope[TopicDetailResponse])
def get_topic(
    workspace_id: str,
    topic_id: str,
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> dict:
    return success(project_map.topic_detail(db, workspace_id, topic_id).model_dump(mode="json"))


@router.get("/meetings/{meeting_id}/summary.md", response_class=Response)
def get_summary_markdown(
    meeting_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    meeting = db.get(Meeting, meeting_id)
    if meeting is None:
        raise AppError(ErrorCode.MEETING_NOT_FOUND, details={"meeting_id": meeting_id})
    require_member(db, user, meeting.workspace_id)
    return _markdown_response(project_map.summary_markdown(db, meeting))


@router.get("/workspaces/{workspace_id}/project-bundle.md", response_class=Response)
def get_project_bundle(
    workspace_id: str,
    start: date | None = Query(None, alias="from"),
    end: date | None = Query(None, alias="to"),
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> Response:
    """AI 에 첨부할 프로젝트 합본. 기간을 주지 않으면 전체다."""
    return _markdown_response(project_map.bundle_markdown(db, workspace_id, start, end))


def _markdown_response(file: MarkdownFile) -> Response:
    # 헤더는 latin-1 로만 나간다. 한글 이름은 filename* 에 percent 인코딩으로 싣는다
    disposition = f"attachment; filename=\"{file.ascii_filename}\"; filename*=UTF-8''{quote(file.filename, safe='')}"
    return Response(
        content=file.body,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": disposition,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )
