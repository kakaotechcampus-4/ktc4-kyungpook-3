"""웹의 프로젝트 맵과 요약본 내려받기, 주제·결정 고치기. 요약에 팀원 발언이 들어가므로 볼 권한과 고칠 권한은 회의록과 같이 워크스페이스 멤버다."""
from datetime import date
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_member, get_current_user, require_member
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Meeting, Member, User
from app.schemas.project_map import GraphResponse, TopicDecision, TopicDetailResponse
from app.schemas.record_edit import DecisionEditRequest, TaskDetachResponse, TopicEditRequest, TopicMergeRequest
from app.services import lifecycle, project_map, summary
from app.services import meeting_deletion
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


def _member_behind_gate(
    workspace_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Member:
    """save_summary 와 같은 순서(관문, 그다음 공간 행)로 잠근다. get_current_member 는 공간 행을 먼저 잠가 순서가 거꾸로 된다."""
    lifecycle.worker_gate(db)
    return require_member(db, user, workspace_id)


@router.patch("/workspaces/{workspace_id}/topics/{topic_id}", response_model=Envelope[TopicDetailResponse])
def edit_topic(
    workspace_id: str,
    topic_id: str,
    payload: TopicEditRequest,
    member: Member = Depends(_member_behind_gate),
    db: Session = Depends(get_db),
) -> dict:
    """이름·설명 고치기. 같은 이름의 다른 주제가 있으면 409 이고 details.topic_id 로 그 주제를 알려 준다."""
    summary.rename_topic(db, workspace_id, topic_id, name=payload.name, description=payload.description)
    data = project_map.topic_detail(db, workspace_id, topic_id).model_dump(mode="json")
    db.commit()
    return success(data)


@router.post("/workspaces/{workspace_id}/topics/{topic_id}/merge", response_model=Envelope[TopicDetailResponse])
def merge_topic(
    workspace_id: str,
    topic_id: str,
    payload: TopicMergeRequest,
    member: Member = Depends(_member_behind_gate),
    db: Session = Depends(get_db),
) -> dict:
    """topic_id 를 into_topic_id 에 합치고 합친 주제를 돌려준다. topic_id 는 사라진다."""
    into = summary.merge_topics(db, workspace_id, topic_id, payload.into_topic_id)
    data = project_map.topic_detail(db, workspace_id, into.topic_id).model_dump(mode="json")
    db.commit()
    return success(data)


@router.delete("/workspaces/{workspace_id}/topics/{topic_id}/tasks/{task_id}", response_model=Envelope[TaskDetachResponse])
def detach_topic_task(
    workspace_id: str,
    topic_id: str,
    task_id: str,
    member: Member = Depends(_member_behind_gate),
    db: Session = Depends(get_db),
) -> dict:
    """잘못 붙은 태스크를 주제에서 뗀다. 다시 불러도 같은 응답이다."""
    summary.detach_task(db, workspace_id, topic_id, task_id)
    db.commit()
    return success(TaskDetachResponse(topic_id=topic_id, task_id=task_id).model_dump(mode="json"))


@router.patch("/workspaces/{workspace_id}/decisions/{decision_id}", response_model=Envelope[TopicDecision])
def edit_decision(
    workspace_id: str,
    decision_id: str,
    payload: DecisionEditRequest,
    member: Member = Depends(_member_behind_gate),
    db: Session = Depends(get_db),
) -> dict:
    """결정 문장을 고치거나 유효하지 않음·지움으로 바꾼다. valid 로 되돌릴 수 있다."""
    decision = summary.edit_decision(db, workspace_id, decision_id, text=payload.text, state=payload.state)
    data = project_map.topic_decision(decision, db.get(Meeting, decision.meeting_id)).model_dump(mode="json")
    db.commit()
    return success(data)


@router.get("/meetings/{meeting_id}/summary.md", response_class=Response)
def get_summary_markdown(
    meeting_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    meeting = db.get(Meeting, meeting_id)
    if meeting is None:
        raise AppError(ErrorCode.MEETING_NOT_FOUND, details={"meeting_id": meeting_id})
    require_member(db, user, meeting.workspace_id)
    meeting_deletion.assert_live(meeting)
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
