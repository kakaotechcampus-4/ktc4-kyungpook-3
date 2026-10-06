import uuid
from datetime import date, datetime, timezone
from enum import StrEnum

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

# text-embedding-3-small의 차원. 모델을 바꾸면 컬럼과 저장된 벡터를 모두 다시 만들어야 한다.
EMBEDDING_DIMENSIONS = 1536


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class MemberRole(StrEnum):
    PM = "pm"
    MEMBER = "member"


class AliasType(StrEnum):
    REALNAME = "realname"
    NICKNAME = "nickname"
    MENTION = "mention"
    INFERRED = "inferred"


class AliasSource(StrEnum):
    MANUAL = "manual"
    DISCORD_PROFILE = "discord_profile"
    LEARNED = "learned"


class ResolutionResult(StrEnum):
    MATCHED = "matched"
    AMBIGUOUS = "ambiguous"
    NOT_FOUND = "not_found"


class ReviewDecision(StrEnum):
    APPROVED = "approved"
    REJECTED = "rejected"
    EDITED = "edited"


class OnboardingStep(StrEnum):
    """워크스페이스 온보딩 단계. 정의 순서가 화면 순서다(FE onboardingSteps.ts와 같다)."""

    CREATE_WORKSPACE = "create_workspace"
    CONNECT_DISCORD = "connect_discord"
    CONNECT_NOTION = "connect_notion"
    CONNECT_MEMBERS = "connect_members"


class OnboardingStepStatus(StrEnum):
    PENDING = "pending"
    COMPLETED = "completed"
    SKIPPED = "skipped"


class MeetingStatus(StrEnum):
    CREATED = "created"
    RECORDING = "recording"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class MeetingSource(StrEnum):
    DISCORD = "discord"
    MANUAL_UPLOAD = "manual_upload"


class EvidenceType(StrEnum):
    """근거가 뒷받침하는 값. 추출 항목의 제목, 담당자, 마감 중 무엇인지."""

    TASK = "task"
    ASSIGNEE = "assignee"
    DUE = "due"


class TaskStatus(StrEnum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    DONE = "done"


class ChangedField(StrEnum):
    ASSIGNEE = "assignee"
    START_DATE = "start_date"
    DUE_DATE = "due_date"
    STATUS = "status"
    TITLE = "title"
    PROGRESS = "progress"
    BLOCKER = "blocker"


class ChangeSource(StrEnum):
    MEETING = "meeting"
    CHAT = "chat"
    CHECKIN = "checkin"
    NOTION = "notion"
    REMINDER_REPLY = "reminder_reply"
    MANUAL = "manual"


class ApprovalType(StrEnum):
    TASK_CREATE = "task_create"
    TASK_UPDATE = "task_update"
    REMINDER_DM = "reminder_dm"


class ApprovalStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class NotionSyncStatus(StrEnum):
    """Task 단위로 본 Notion 반영 상태. Notion 미연동 Task는 None."""

    PENDING = "pending"
    SYNCED = "synced"
    FAILED = "failed"


class NotionSyncJobStatus(StrEnum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"  # 더 최신 버전이 이미 반영됐거나 연동이 해제돼 보낼 필요가 없음


class Gate(StrEnum):
    AUTO = "auto"
    REVIEW = "review"
    HOLD = "hold"


class User(Base):
    __tablename__ = "user"

    user_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(100))
    provider: Mapped[str] = mapped_column(String(20), default="local")
    provider_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    profile_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    sessions: Mapped[list["Session"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Session(Base):
    __tablename__ = "session"

    session_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("user.user_id", ondelete="CASCADE"), index=True
    )
    session_token: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped["User"] = relationship(back_populates="sessions")


class Workspace(Base):
    __tablename__ = "workspace"

    workspace_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(100))
    # 모든 단계가 pending이 아니면 true. 단계 상태(onboarding_steps)를 바꿀 때 함께 맞춘다.
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    integrations: Mapped[list["Integration"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )
    onboarding_steps: Mapped[list["WorkspaceOnboardingStepState"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )


class WorkspaceOnboardingStepState(Base):
    """워크스페이스의 온보딩 단계 하나의 상태.

    행이 없는 단계는 기본값으로 본다. create_workspace는 워크스페이스가 있으니 completed, 나머지는 pending이다.
    """

    __tablename__ = "workspace_onboarding_step"

    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace.workspace_id", ondelete="CASCADE"), primary_key=True
    )
    step: Mapped[str] = mapped_column(String(32), primary_key=True)
    status: Mapped[str] = mapped_column(String(16))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    workspace: Mapped["Workspace"] = relationship(back_populates="onboarding_steps")


class Integration(Base):
    __tablename__ = "integration"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "provider", name="uq_workspace_provider"
        ),
    )

    integration_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace.workspace_id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(20))
    access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider_channel_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    workspace: Mapped["Workspace"] = relationship(back_populates="integrations")


class Member(Base):
    __tablename__ = "member"
    __table_args__ = (
        # 탈퇴(is_deleted)한 팀원은 과거 이력 때문에 행과 discord_user_id를 남긴다. 그래서 같은 디스코드 계정은
        # 탈퇴하지 않은 팀원끼리만 겹치지 않게 막는다. API의 사전 검사(api/members.py)와 같은 범위다(#166).
        Index(
            "uq_workspace_discord_user", "workspace_id", "discord_user_id",
            unique=True,
            postgresql_where=text("is_deleted IS FALSE"),
            sqlite_where=text("is_deleted IS FALSE"),
        ),
    )

    member_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace.workspace_id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("user.user_id", ondelete="SET NULL"), nullable=True, index=True
    )
    display_name: Mapped[str] = mapped_column(String(100))
    discord_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    notion_name: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    role: Mapped[str] = mapped_column(String(16), default=MemberRole.MEMBER)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    aliases: Mapped[list["MemberAlias"]] = relationship(
        back_populates="member", cascade="all, delete-orphan"
    )


class MemberAlias(Base):
    __tablename__ = "member_alias"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "member_id", "alias_text", name="uq_alias_per_member"
        ),
    )

    alias_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="CASCADE"), index=True
    )
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace.workspace_id", ondelete="CASCADE"), index=True
    )
    alias_text: Mapped[str] = mapped_column(String(100), index=True)
    alias_type: Mapped[str] = mapped_column(String(16))
    source: Mapped[str] = mapped_column(String(20))
    confidence: Mapped[float] = mapped_column(Float, default=0.3)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    member: Mapped["Member"] = relationship(back_populates="aliases")


class AliasResolutionLog(Base):
    __tablename__ = "alias_resolution_log"

    log_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace.workspace_id", ondelete="CASCADE"), index=True
    )
    alias_text: Mapped[str] = mapped_column(String(100), index=True)
    resolved_member_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True
    )
    result: Mapped[str] = mapped_column(String(16))
    candidate_count: Mapped[int] = mapped_column(Integer, default=0)
    meeting_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("meeting.meeting_id", ondelete="SET NULL"), nullable=True
    )
    # 별칭이 나온 발화. 전사가 저장되기 전이나 알 수 없으면 NULL이다.
    source_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("source.source_id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AliasReview(Base):
    __tablename__ = "alias_review"

    review_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    log_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("alias_resolution_log.log_id", ondelete="CASCADE"), index=True
    )
    decision: Mapped[str] = mapped_column(String(16))
    corrected_member_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True
    )
    reviewed_by: Mapped[str] = mapped_column(String(36), ForeignKey("member.member_id"))
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Meeting(Base):
    __tablename__ = "meeting"

    meeting_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace.workspace_id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source: Mapped[str] = mapped_column(String(20), default=MeetingSource.DISCORD)
    status: Mapped[str] = mapped_column(String(16), default=MeetingStatus.CREATED, index=True)

    failed_stage: Mapped[str | None] = mapped_column(String(32), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 전사 길이(ms). 전사가 들어오기 전에는 모르므로 NULL이다.
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    extractions: Mapped[list["Extraction"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan"
    )
    sources: Mapped[list["Source"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan"
    )


class Source(Base):
    """STT 전사의 발화 한 줄. AI의 TranscriptSegment 하나가 한 행이다."""

    __tablename__ = "source"
    __table_args__ = (
        UniqueConstraint("meeting_id", "seq", name="uq_source_meeting_seq"),
    )

    source_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    meeting_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting.meeting_id", ondelete="CASCADE"), index=True
    )
    # 회의 전체에서의 발화 순번. 근거가 발화를 가리키는 안정된 식별자다.
    seq: Mapped[int] = mapped_column(Integer)
    speaker_discord_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 저장할 때의 디스코드 표시 이름. 팀원과 연결되지 않은 화자를 이름으로 보여 줄 때 쓴다
    speaker_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    member_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True, index=True
    )
    # 회의 시작 기준 위치(ms)
    start_ms: Mapped[int] = mapped_column(Integer)
    end_ms: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    meeting: Mapped["Meeting"] = relationship(back_populates="sources")
    evidences: Mapped[list["Evidence"]] = relationship(
        back_populates="source", cascade="all, delete-orphan"
    )


class Extraction(Base):
    __tablename__ = "extraction"

    extraction_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    meeting_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting.meeting_id", ondelete="CASCADE"), index=True
    )
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    meeting: Mapped["Meeting"] = relationship(back_populates="extractions")
    items: Mapped[list["ExtractionItem"]] = relationship(
        back_populates="extraction", cascade="all, delete-orphan"
    )


class ExtractionAction(StrEnum):
    """추출 항목이 새 task인지 기존 task 수정인지. AI의 Terra 2단계(JudgeResult.is_new)가 정한다."""

    CREATE = "create"
    UPDATE = "update"


class ExtractionItem(Base):
    __tablename__ = "extraction_item"

    item_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    extraction_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("extraction.extraction_id", ondelete="CASCADE"), index=True
    )
    action: Mapped[str] = mapped_column(
        String(10), default=ExtractionAction.CREATE, server_default=ExtractionAction.CREATE.value
    )
    # update 항목은 AI가 제목을 보내지 않으므로 대상 task의 현재 제목을 기록한다.
    task_title: Mapped[str] = mapped_column(String(300))
    task_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    assignee_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    assignee_member_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True
    )
    assignee_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    assignee_needs_check: Mapped[bool] = mapped_column(Boolean, default=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    due_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    gate: Mapped[str] = mapped_column(String(10), default=Gate.HOLD)
    # AI 판단 결과(JudgeResult.category/status)와 PM에게 보여 줄 설명(DraftResult.doc_text)
    category: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    doc_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # create: 만들어진 task / update: 수정 대상 task
    task_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("task.task_id", ondelete="SET NULL"), nullable=True
    )
    approval_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("approval_request.approval_id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    extraction: Mapped["Extraction"] = relationship(back_populates="items")
    evidences: Mapped[list["Evidence"]] = relationship(
        back_populates="item", cascade="all, delete-orphan"
    )


class Evidence(Base):
    """추출 항목이나 task의 근거로 쓰인 발화(source). 둘 중 하나는 반드시 가리킨다."""

    __tablename__ = "evidence"
    __table_args__ = (
        UniqueConstraint("item_id", "source_id", "type", name="uq_evidence_item_source_type"),
        # 위 제약은 item_id가 NULL이면 걸리지 않는다. task에만 붙은 근거의 중복은 여기서 막는다.
        # item_id가 있는 행까지 막으면 같은 task를 공유하는 여러 항목이 같은 발화를 근거로 들 수 없다.
        Index(
            "uq_evidence_task_source_type", "task_id", "source_id", "type",
            unique=True,
            postgresql_where=text("item_id IS NULL"),
            sqlite_where=text("item_id IS NULL"),
        ),
        CheckConstraint(
            "item_id IS NOT NULL OR task_id IS NOT NULL", name="ck_evidence_item_or_task"
        ),
    )

    evidence_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    item_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("extraction_item.item_id", ondelete="CASCADE"), nullable=True, index=True
    )
    task_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("task.task_id", ondelete="CASCADE"), nullable=True, index=True
    )
    source_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("source.source_id", ondelete="CASCADE"), index=True
    )
    type: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    item: Mapped["ExtractionItem | None"] = relationship(back_populates="evidences")
    task: Mapped["Task | None"] = relationship(back_populates="evidences")
    source: Mapped["Source"] = relationship(back_populates="evidences")


class Task(Base):
    __tablename__ = "task"

    task_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace.workspace_id", ondelete="CASCADE"), index=True
    )
    meeting_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("meeting.meeting_id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(300))
    assignee_member_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(16), default=TaskStatus.TODO, index=True)
    progress: Mapped[int | None] = mapped_column(Integer, nullable=True)
    blocker: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    notion_page_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 변경이 반영될 때마다 1씩 올라간다. Notion 동기화 작업의 순서·중복 판단 기준.
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    # Notion에 마지막으로 반영된 version. version보다 작으면 아직 반영 대기 중인 변경이 있다.
    notion_synced_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notion_sync_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # 페이지 생성(POST)을 보내기 직전에 찍는다. notion_page_id 없이 이 값만 남아 있으면
    # 이전 POST가 실제로 페이지를 만들었는지 모르는 상태라, 다시 POST하기 전에 조회부터 한다.
    notion_create_attempted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 제목(title)의 임베딩. 생성·제목 변경 시 NULL로 비우고 임베딩 워커가 채운다
    # (app/services/embedding.py). NULL인 동안은 유사 task 검색에서 빠진다.
    # 벡터 1536개를 매 조회마다 읽지 않도록 필요할 때만 불러온다(deferred).
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(EMBEDDING_DIMENSIONS), nullable=True, deferred=True
    )
    # 임베딩 API가 입력 오류(400·413·422)로 거절한 제목. 이 값이 지금 제목과 같으면 워커가
    # 그 task를 다시 고르지 않는다(거절되는 task가 계속 앞자리를 차지해 뒤 task가 굶는 것을 막는다).
    # 제목이 바뀌면 값이 달라져 자동으로 대상에 돌아오므로 따로 지우지 않는다.
    embedding_rejected_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    history: Mapped[list["TaskHistory"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )
    evidences: Mapped[list["Evidence"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )


class NotionSyncJob(Base):
    """Task 변경을 Notion에 반영하는 작업(outbox).

    Task 변경과 같은 트랜잭션에서 커밋되고, 실제 Notion 호출은 워커
    (`services/notion_sync.py`)가 요청과 분리해서 처리한다. (task_id, task_version)은
    한 번만 쌓이므로 같은 변경이 큐에 두 번 들어가지 않는다.
    """

    __tablename__ = "notion_sync_job"
    __table_args__ = (
        UniqueConstraint("task_id", "task_version", name="uq_notion_sync_job_task_version"),
    )

    job_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("task.task_id", ondelete="CASCADE"), index=True
    )
    task_version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(
        String(16), default=NotionSyncJobStatus.PENDING, index=True
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True
    )
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class TaskHistory(Base):
    __tablename__ = "task_history"

    history_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("task.task_id", ondelete="CASCADE"), index=True
    )
    changed_field: Mapped[str] = mapped_column(String(20))
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    change_source: Mapped[str] = mapped_column(String(16))
    changed_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True
    )
    is_rolled_back: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    rolled_back_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    task: Mapped["Task"] = relationship(back_populates="history")


class ApprovalRequest(Base):
    """approval_request 테이블. PM이 승인/반려하기 전까지 모든 변경은 여기서 대기."""

    __tablename__ = "approval_request"

    approval_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace.workspace_id", ondelete="CASCADE"), index=True
    )
    type: Mapped[str] = mapped_column(String(20))
    payload: Mapped[str] = mapped_column(Text)  # JSON 직렬화
    related_task_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("task.task_id", ondelete="SET NULL"), nullable=True, index=True
    )
    requested_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(16), default=ApprovalStatus.PENDING, index=True
    )
    resolved_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )