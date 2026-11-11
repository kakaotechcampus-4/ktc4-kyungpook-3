"""프로젝트 맵 읽기. 주제와 태스크의 연결은 저장하지 않고 _visible_links 한 쿼리로 푼다.

승인 코드에 훅이 없다. 회의 시점에는 대부분 Task 가 없어 주제를 추출 항목에 달아 두고, 읽을 때 item_fate 가 반영됐다고
보는 항목만 잇는다.
"""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import Select, exists, select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import (
    Decision,
    DecisionState,
    Extraction,
    Meeting,
    MeetingSource,
    Member,
    MemberAlias,
    MemberRole,
    Source,
    Task,
    TaskStatus,
    Topic,
    TopicItem,
    TopicMeeting,
    TopicTaskDetach,
    Workspace,
)
from app.schemas.project_map import (
    GraphEdge,
    GraphResponse,
    MeetingRef,
    TaskNode,
    TopicDecision,
    TopicDetailResponse,
    TopicNode,
    TopicTask,
)
from app.services import embedding, item_fate, mailer, summary
from app.services.messages import utc
from app.services.scheduler import WORKSPACE_TZ
from app.services.summary_markdown import (
    BlockedTask,
    BundleData,
    BundleDecision,
    BundleMember,
    BundleTask,
    BundleTopic,
    SummaryHead,
    render_bundle,
    render_summary,
)

# 자리값이다. 운영 벡터의 유사도 분포를 재서 정한다. 중복 후보용 기준(0.4)은 "관련" 으로 쓰지 않는다
EDGE_TOP_K = 2
EDGE_MIN_SIMILARITY = 0.55


@dataclass(frozen=True)
class MarkdownFile:
    filename: str
    ascii_filename: str
    body: str


def _visible_links(workspace_id: str) -> Select:
    """주제와 태스크 연결의 유일한 정의. (topic_id, task_id, meeting_id). 대기 중인 수정 항목은 승인 뒤에 잇고, 팀원이 뗀 짝은 잇지 않는다."""
    final = item_fate.final_items().subquery()
    return (
        select(TopicItem.topic_id, Task.task_id, Extraction.meeting_id)
        .distinct()
        .join(Topic, Topic.topic_id == TopicItem.topic_id)
        .join(final, final.c.item_id == TopicItem.item_id)
        .join(Extraction, Extraction.extraction_id == final.c.extraction_id)
        .join(Meeting, Meeting.meeting_id == Extraction.meeting_id)
        .join(Task, Task.task_id == final.c.task_id)
        .where(
            Topic.workspace_id == workspace_id,
            Task.workspace_id == workspace_id,
            Meeting.deleted_at.is_(None),
            ~exists().where(TopicTaskDetach.topic_id == TopicItem.topic_id, TopicTaskDetach.task_id == Task.task_id),
        )
    )


def _tasks(db: Session, workspace_id: str) -> list[tuple[Task, str | None]]:
    return db.execute(
        select(Task, Member.display_name)
        .outerjoin(Member, Member.member_id == Task.assignee_member_id)
        .where(Task.workspace_id == workspace_id, Task.is_deleted.is_(False))
        .order_by(Task.created_at, Task.task_id)
    ).all()


def build_graph(db: Session, workspace_id: str) -> GraphResponse:
    """지워지지 않은 태스크 전부와 주제 전부. 주제 없는 태스크에 주제를 추정해 붙이지 않는다."""
    links = db.execute(_visible_links(workspace_id)).all()
    tasks = _tasks(db, workspace_id)
    topics = db.scalars(select(Topic).where(Topic.workspace_id == workspace_id).order_by(Topic.created_at)).all()
    meetings = {
        meeting_id: MeetingRef(meeting_id=meeting_id, title=title, started_at=started_at)
        for meeting_id, title, started_at in db.execute(
            select(Meeting.meeting_id, Meeting.title, Meeting.started_at)
            .where(Meeting.workspace_id == workspace_id, Meeting.deleted_at.is_(None))
            .order_by(Meeting.started_at, Meeting.meeting_id)
        )
    }
    links = [link for link in links if link.meeting_id in meetings]
    topic_meetings = db.execute(
        select(TopicMeeting.topic_id, TopicMeeting.meeting_id)
        .join(Topic, Topic.topic_id == TopicMeeting.topic_id)
        .join(Meeting, Meeting.meeting_id == TopicMeeting.meeting_id)
        .where(Topic.workspace_id == workspace_id, Meeting.deleted_at.is_(None),
               TopicMeeting.meeting_id.in_(meetings))
    ).all()

    task_meetings: dict[str, set[str]] = {task.task_id: set() for task, _ in tasks}
    for task, _ in tasks:
        if task.meeting_id in meetings:
            task_meetings[task.task_id].add(task.meeting_id)
    for _, task_id, meeting_id in links:
        if task_id in task_meetings:
            task_meetings[task_id].add(meeting_id)
    topic_first_seen: dict[str, datetime] = {}
    for topic_id, meeting_id in topic_meetings:
        started_at = meetings[meeting_id].started_at
        topic_first_seen[topic_id] = min(topic_first_seen.get(topic_id, started_at), started_at)

    def time_order(meeting_id: str) -> tuple[datetime, str]:
        return meetings[meeting_id].started_at, meeting_id

    nodes: list[TopicNode | TaskNode] = [
        TopicNode(id=topic.topic_id, label=topic.name, appeared_at=topic_first_seen.get(topic.topic_id, topic.created_at))
        for topic in topics
    ]
    for task, assignee_name in tasks:
        meeting_ids = sorted(task_meetings[task.task_id], key=time_order)
        nodes.append(TaskNode(
            id=task.task_id,
            label=task.title,
            status=task.status,
            due_date=task.due_date,
            assignee_name=assignee_name,
            blocker=task.blocker,
            meeting_ids=meeting_ids,
            appeared_at=min([task.created_at, *(meetings[m].started_at for m in meeting_ids)]),
        ))

    pairs = {(topic_id, task_id) for topic_id, task_id, _ in links}
    pairs.update(embedding.related_task_pairs(db, workspace_id, k=EDGE_TOP_K, min_similarity=EDGE_MIN_SIMILARITY))
    shown = {meeting_id for ids in task_meetings.values() for meeting_id in ids}
    shown.update(meeting_id for _, meeting_id in topic_meetings)
    # 쿼리 사이에 태스크가 지워지거나 생겨도 없는 노드를 가리키는 선을 내지 않는다
    node_ids = {node.id for node in nodes}
    return GraphResponse(
        meetings=[ref for meeting_id, ref in meetings.items() if meeting_id in shown],
        nodes=nodes,
        edges=[
            GraphEdge(source=source, target=target)
            for source, target in sorted(pairs)
            if source in node_ids and target in node_ids
        ],
    )


def topic_decision(decision: Decision, meeting: Meeting) -> TopicDecision:
    return TopicDecision(
        decision_id=decision.decision_id,
        text=decision.text,
        reason=decision.reason,
        meeting_id=meeting.meeting_id,
        meeting_title=meeting.title,
        decided_at=meeting.started_at,
        replaced_by=decision.replaced_by,
        state=decision.state,
        edited=decision.edited_at is not None,
    )


def topic_detail(db: Session, workspace_id: str, topic_id: str) -> TopicDetailResponse:
    """바뀐 결정도 replaced_by 와 함께 준다. 팀원이 지운 결정은 빼고 유효하지 않다고 한 결정은 state 로 알린다."""
    topic = db.get(Topic, topic_id)
    if topic is None or topic.workspace_id != workspace_id:
        raise AppError(ErrorCode.TOPIC_NOT_FOUND, details={"topic_id": topic_id})
    decisions = db.execute(
        select(Decision, Meeting)
        .join(Meeting, Meeting.meeting_id == Decision.meeting_id)
        .where(Decision.topic_id == topic_id, Meeting.deleted_at.is_(None), Decision.state != DecisionState.REMOVED)
        .order_by(Meeting.started_at, Meeting.meeting_id, Decision.position)
    ).all()
    task_ids = select(_visible_links(workspace_id).where(TopicItem.topic_id == topic_id).subquery().c.task_id)
    tasks = db.execute(
        select(Task, Member.display_name)
        .outerjoin(Member, Member.member_id == Task.assignee_member_id)
        .where(Task.task_id.in_(task_ids))
        .order_by(Task.created_at, Task.task_id)
    ).all()
    meetings = db.scalars(
        select(Meeting)
        .join(TopicMeeting, TopicMeeting.meeting_id == Meeting.meeting_id)
        .where(TopicMeeting.topic_id == topic_id, Meeting.deleted_at.is_(None))
        .order_by(Meeting.started_at, Meeting.meeting_id)
    ).all()
    return TopicDetailResponse(
        topic_id=topic.topic_id,
        name=topic.name,
        description=topic.description,
        edited=topic.edited_at is not None,
        decisions=[topic_decision(decision, meeting) for decision, meeting in decisions],
        tasks=[
            TopicTask(
                task_id=task.task_id,
                title=task.title,
                status=task.status,
                due_date=task.due_date,
                assignee_name=assignee_name,
            )
            for task, assignee_name in tasks
        ],
        meetings=[
            MeetingRef(meeting_id=meeting.meeting_id, title=meeting.title, started_at=meeting.started_at)
            for meeting in meetings
        ],
    )


def _attendees(db: Session, meeting_ids: list[str]) -> dict[str, list[str]]:
    """회의마다 말한 팀원 이름. 처음 말한 순서다."""
    attendees: dict[str, dict[str, str]] = {meeting_id: {} for meeting_id in meeting_ids}
    rows = db.execute(
        select(Source.meeting_id, Member.member_id, Member.display_name)
        .join(Member, Member.member_id == Source.member_id)
        .where(Source.meeting_id.in_(meeting_ids))
        .order_by(Source.meeting_id, Source.seq)
    )
    for meeting_id, member_id, display_name in rows:
        attendees[meeting_id].setdefault(member_id, display_name)
    return {meeting_id: list(names.values()) for meeting_id, names in attendees.items()}


def _head(meeting: Meeting, document: dict, attendees: list[str]) -> SummaryHead:
    chat = meeting.source == MeetingSource.CHAT
    start = utc(meeting.started_at).astimezone(WORKSPACE_TZ)
    # 채팅 회의는 수집이 붙인 "채팅 <날짜>" 대신 일일 요약이라 부르고, 팀원이 고친 제목이 있으면 그것을 쓴다
    title = (meeting.title if meeting.title_edited_at is not None else "일일 요약") if chat else meeting.title or "회의"
    return SummaryHead(
        title=title,
        date=summary.meeting_date(meeting.started_at),
        attendees=attendees,
        source_url=f"{mailer.app_base_url()}/workspaces/{meeting.workspace_id}/meetings/{meeting.meeting_id}",
        topics=document.get("topics", []),
        kind="일일 요약" if chat else "회의",
        # ended_at 은 인계 시각이라 기간의 끝은 마지막 메시지 위치(duration_ms)로 잡는다
        period=(start, start + timedelta(milliseconds=meeting.duration_ms or 0)) if chat else None,
    )


def summary_markdown(db: Session, meeting: Meeting) -> MarkdownFile:
    extraction = db.scalars(
        select(Extraction)
        .where(Extraction.meeting_id == meeting.meeting_id)
        .order_by(Extraction.created_at.desc())
        .limit(1)
    ).first()
    document = summary.documents(db, [(meeting, extraction)]).get(meeting.meeting_id)
    if document is None:
        raise AppError(ErrorCode.SUMMARY_NOT_FOUND, details={"meeting_id": meeting.meeting_id})
    head = _head(meeting, document, _attendees(db, [meeting.meeting_id])[meeting.meeting_id])
    return MarkdownFile(
        filename=f"{head.date.isoformat()} {head.title}.md",
        ascii_filename="summary.md",
        body=render_summary(document, head),
    )


def _members(db: Session, workspace_id: str) -> list[BundleMember]:
    members = db.scalars(
        select(Member)
        .where(Member.workspace_id == workspace_id, Member.is_deleted.is_(False))
        .order_by(Member.created_at, Member.member_id)
    ).all()
    aliases: dict[str, list[str]] = {member.member_id: [] for member in members}
    # 호칭은 맥락 설명이라 확인 여부와 무관하게 다 넣는다
    for member_id, alias_text in db.execute(
        select(MemberAlias.member_id, MemberAlias.alias_text)
        .where(MemberAlias.workspace_id == workspace_id)
        .order_by(MemberAlias.verified.desc(), MemberAlias.created_at, MemberAlias.alias_id)
    ):
        if member_id in aliases:
            aliases[member_id].append(alias_text)
    return [
        BundleMember(
            name=member.display_name,
            role="PM" if member.role == MemberRole.PM else "팀원",
            aliases=aliases[member.member_id],
        )
        for member in members
    ]


def _bundle_topics(db: Session, workspace_id: str) -> tuple[list[BundleTopic], list[BundleTask]]:
    """주제마다 태스크, 그리고 어느 주제에도 없는 태스크."""
    tasks = {
        task.task_id: BundleTask(title=task.title, status=task.status, assignee=assignee_name, due_date=task.due_date)
        for task, assignee_name in _tasks(db, workspace_id)
    }
    by_topic: dict[str, dict[str, BundleTask]] = {}
    for topic_id, task_id, _ in db.execute(_visible_links(workspace_id)):
        if task_id in tasks:
            by_topic.setdefault(topic_id, {})[task_id] = tasks[task_id]
    linked = {task_id for topic_tasks in by_topic.values() for task_id in topic_tasks}
    topics = db.scalars(select(Topic).where(Topic.workspace_id == workspace_id).order_by(Topic.created_at)).all()
    return (
        [
            BundleTopic(
                name=topic.name,
                description=topic.description,
                tasks=list(by_topic.get(topic.topic_id, {}).values()),
            )
            for topic in topics
        ],
        [task for task_id, task in tasks.items() if task_id not in linked],
    )


def _valid_decisions(db: Session, workspace_id: str) -> list[BundleDecision]:
    rows = db.execute(
        select(Topic.name, Decision.text, Meeting.started_at)
        .join(Topic, Topic.topic_id == Decision.topic_id)
        .join(Meeting, Meeting.meeting_id == Decision.meeting_id)
        .where(Decision.workspace_id == workspace_id, Decision.replaced_by.is_(None), Meeting.deleted_at.is_(None),
               Decision.state == DecisionState.VALID)
        .order_by(Topic.name, Meeting.started_at, Decision.position)
    ).all()
    return [
        BundleDecision(topic=topic, text=text, decided_on=summary.meeting_date(started_at))
        for topic, text, started_at in rows
    ]


def _blocked_tasks(db: Session, workspace_id: str) -> list[BlockedTask]:
    return [
        BlockedTask(title=task.title, assignee=assignee_name, blocker=task.blocker)
        for task, assignee_name in _tasks(db, workspace_id)
        if task.status == TaskStatus.BLOCKED
    ]


def _day_start(day: date) -> datetime:
    return datetime.combine(day, time.min, WORKSPACE_TZ).astimezone(timezone.utc)


def _period_summaries(
    db: Session, workspace_id: str, start: date | None, end: date | None
) -> list[tuple[dict, SummaryHead]]:
    stmt = (
        select(Meeting, Extraction)
        .join(Extraction, Extraction.meeting_id == Meeting.meeting_id)
        .where(Meeting.workspace_id == workspace_id, Meeting.deleted_at.is_(None), Extraction.summary.is_not(None))
        .order_by(Meeting.started_at, Meeting.meeting_id, Extraction.created_at)
    )
    if start is not None:
        stmt = stmt.where(Meeting.started_at >= _day_start(start))
    if end is not None:
        stmt = stmt.where(Meeting.started_at < _day_start(end + timedelta(days=1)))
    # 시각 오름차순으로 덮어 회의마다 최신 추출만 남긴다
    latest = {meeting.meeting_id: (meeting, extraction) for meeting, extraction in db.execute(stmt)}
    shown = summary.documents(db, list(latest.values()))
    documents = [(meeting, shown[meeting.meeting_id]) for meeting, _ in latest.values() if meeting.meeting_id in shown]
    attendees = _attendees(db, [meeting.meeting_id for meeting, _ in documents])
    return [(document, _head(meeting, document, attendees[meeting.meeting_id])) for meeting, document in documents]


def bundle_markdown(db: Session, workspace_id: str, start: date | None, end: date | None) -> MarkdownFile:
    """AI 첨부용 합본. start, end 는 워크스페이스 시간대 날짜이고 둘 다 포함한다. 없으면 그쪽 끝이 없다.

    머리말은 기간과 무관하게 지금 값이고 기간은 본문의 회의만 자른다.
    """
    if start is not None and end is not None and start > end:
        raise AppError(ErrorCode.INVALID_REQUEST, message="from 이 to 보다 늦습니다.")
    workspace = db.get(Workspace, workspace_id)
    today = datetime.now(WORKSPACE_TZ).date()
    topics, loose_tasks = _bundle_topics(db, workspace_id)
    body = render_bundle(BundleData(
        workspace_name=workspace.name,
        generated_on=today,
        start=start,
        end=end,
        members=_members(db, workspace_id),
        topics=topics,
        loose_tasks=loose_tasks,
        decisions=_valid_decisions(db, workspace_id),
        blocked=_blocked_tasks(db, workspace_id),
        summaries=_period_summaries(db, workspace_id, start, end),
    ))
    return MarkdownFile(
        filename=f"{workspace.name} 프로젝트 맥락 {today.isoformat()}.md",
        ascii_filename="project-bundle.md",
        body=body,
    )
