import uuid
from datetime import date, datetime, timezone
from enum import StrEnum

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
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
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.core.database import Base
from app.schemas.email import normalize_email

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
    DISPLAY_NAME = "display_name"


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
    # 웹 업로드 회의: AI가 화자를 나눴고 PM이 화자를 지정하기를 기다린다(#266). 동시 처리 제한에서 뺀다
    AWAITING_SPEAKERS = "awaiting_speakers"
    DONE = "done"
    FAILED = "failed"


class MeetingProcessingStage(StrEnum):
    """AI 가 처리 중인 회의에서 지금 하는 일(#381). 순서는 services/meeting_stage.py 의 stage_rank 가 정한다."""

    STT = "stt"
    SOURCES = "sources"
    EXTRACT = "extract"
    HANDOFF = "handoff"


class MeetingSource(StrEnum):
    DISCORD = "discord"
    MANUAL_UPLOAD = "manual_upload"
    CHAT = "chat"


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
    BLOCKER = "blocker"


class ChangeSource(StrEnum):
    MEETING = "meeting"
    CHAT = "chat"
    CHECKIN = "checkin"
    NOTION = "notion"
    REMINDER_REPLY = "reminder_reply"
    MANUAL = "manual"
    SCHEDULER = "scheduler"


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

    @validates("email")
    def _normalize_email(self, _key: str, value: str) -> str:
        # 요청 스키마를 거치지 않는 쓰기 경로도 같은 규칙으로 저장한다(#434). SQL 직접 실행과 update() 는 지나지 않는다.
        return normalize_email(value)


class PasswordResetToken(Base):
    """비밀번호 재설정 링크 토큰. 원문은 저장하지 않고 sha256 해시만 둔다(#356)."""

    __tablename__ = "password_reset_token"
    __table_args__ = (Index("ix_password_reset_token_user_created", "user_id", "created_at"),)

    token_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("user.user_id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    invalidated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Session(Base):
    __tablename__ = "session"

    session_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("user.user_id", ondelete="CASCADE"), index=True
    )
    # 쿠키 원문이 아니라 그 sha256 hex 가 들어간다(#437). 쓸 때 hash_session_token 으로 바꿔 넣는다.
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
        # Discord는 provider_channel_id에 연결한 서버(guild) ID를 둔다. 한 서버는 한 워크스페이스에만 연결한다.
        # 서버 하나가 여러 워크스페이스에 붙으면 그 서버의 회의를 어느 워크스페이스로 보낼지 정할 수 없다.
        Index(
            "uq_integration_discord_guild", "provider_channel_id",
            unique=True,
            postgresql_where=text("provider = 'discord'"),
            sqlite_where=text("provider = 'discord'"),
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
    # 디스코드 전용: 채팅 수집 채널(#428)
    chat_channel_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    chat_channel_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
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
    status: Mapped[str] = mapped_column(String(32), default=MeetingStatus.CREATED, index=True)

    failed_stage: Mapped[str | None] = mapped_column(String(32), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 전사 길이(ms). 전사가 들어오기 전에는 모르므로 NULL이다.
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # AI 가 알린 처리 단계(MeetingProcessingStage). processing 중에만 쓰고, 알리지 않았으면 NULL 이다
    processing_stage: Mapped[str | None] = mapped_column(String(16), nullable=True)
    processing_stage_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # stt 단계의 전사 진행(끝낸 조각 수 / 전체 조각 수). stt 단계에서 알렸을 때만 값이 있고 그 밖에는 NULL 이다
    processing_stt_done: Mapped[int | None] = mapped_column(Integer, nullable=True)
    processing_stt_total: Mapped[int | None] = mapped_column(Integer, nullable=True)

    extractions: Mapped[list["Extraction"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan"
    )
    sources: Mapped[list["Source"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan"
    )


class MeetingUpload(Base):
    """웹에서 올린 녹음 하나. `source=manual_upload` 회의마다 한 행이다.

    녹음 파일은 디스크(`UPLOAD_DIR/{meeting_id}/{stored_filename}`)에 두고, 업로드 때 받은 나머지 정보는
    여기에 둔다. AI 대기 목록은 이 행으로 만들고 디스크를 읽지 않는다.

    업로드 회의는 처음부터 `processing`이다(프론트가 그 상태로 추적한다). AI가 가져갔는지는 회의 상태가 아니라
    `claimed_at`으로 가린다.
    """

    __tablename__ = "meeting_upload"

    meeting_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting.meeting_id", ondelete="CASCADE"), primary_key=True
    )
    stored_filename: Mapped[str] = mapped_column(String(32))
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    uploaded_by_member_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True
    )
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # 업로드 때 PM이 고른 참석자 [{member_id, display_name}]의 JSON. 이름은 그때 값이다
    attendees: Mapped[str] = mapped_column(Text)
    # AI가 가져간(claim) 시각. 비어 있으면 아직 아무도 가져가지 않았다
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # AI가 알려준 화자 목록(JSON 문자열)과 보고 시각. 비어 있으면 아직 보고하지 않았다
    speakers: Mapped[str | None] = mapped_column(Text, nullable=True)
    speakers_reported_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # PM이 지정한 화자 → 팀원 매핑(JSON 문자열)과 지정 시각
    speaker_mapping: Mapped[str | None] = mapped_column(Text, nullable=True)
    speakers_assigned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 화자 지정 뒤 AI가 처리를 다시 이어 간 시각
    resumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


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
    # AI가 어느 추출 경로로 만든 결과인지(ExtractionPath). 항목이 없거나 판별할 수 없으면 NULL
    extraction_path: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    meeting: Mapped["Meeting"] = relationship(back_populates="extractions")
    items: Mapped[list["ExtractionItem"]] = relationship(
        back_populates="extraction", cascade="all, delete-orphan"
    )


class ExtractionAction(StrEnum):
    """추출 항목이 새 task인지 기존 task 수정인지. AI의 Terra 2단계(JudgeResult.is_new)가 정한다."""

    CREATE = "create"
    UPDATE = "update"


class ExtractionPath(StrEnum):
    """AI의 추출 경로(ai/capture/judge_path.py의 MM_EXTRACT_PATH).

    legacy는 필드마다 확신도를 숫자로 보내고, judge는 확신도 없이 판단 결과(action·category·doc_text)를 보낸다.
    """

    LEGACY = "legacy"
    JUDGE = "judge"


class EvidenceStatus(StrEnum):
    """추출 항목의 값이 원문에 얼마나 드러나 있는지(AI의 task_status·due_status). judge 새 항목의 auto 판단에 쓴다."""

    CERTAIN = "certain"  # 원문에 명시
    INFERRED = "inferred"  # 문맥으로 추측
    MISSING = "missing"  # 원문에 없음


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
    # 확신도는 AI가 보낸 값이다. NULL은 측정하지 않았다는 뜻이고 0.0(측정했는데 낮음)과 다르다
    task_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    assignee_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # 담당자 표현의 종류(first·thirdname·thirdrole 등). 승인 때 이 표현을 별칭으로 배울지 가리는 데 쓴다(#459).
    # 알려진 값(alias_learning.KNOWN_ASSIGNEE_TYPES)이 아니면 NULL이고, 예전 항목도 NULL이라 학습 대상이 아니다
    assignee_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    assignee_member_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True
    )
    assignee_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    assignee_needs_check: Mapped[bool] = mapped_column(Boolean, default=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    due_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 항목 전체 확신도. task_confidence가 NULL이면 최솟값을 알 수 없어 NULL이다
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    gate: Mapped[str] = mapped_column(String(10), default=Gate.HOLD)
    # AI 판단 결과(JudgeResult.category/status)와 PM에게 보여 줄 설명(DraftResult.doc_text)
    category: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    doc_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # judge 새 항목의 auto 판단 근거(EvidenceStatus, AI가 본 유사 검색 결과). 보내지 않았으면 NULL이다
    task_evidence_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    due_evidence_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    similar_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    top_similarity: Mapped[float | None] = mapped_column(Float, nullable=True)
    # auto로 만든 task를 PM이 되돌린 시각과 PM. 되돌리면 task는 지워지고 같은 내용의 생성 승인 요청이 생긴다.
    # gate는 auto로 남겨 처음 판단을 기록한다
    reverted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reverted_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True
    )
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
    blocker: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    notion_page_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # notion_page_id가 들어 있는 Notion DB(연결 행의 provider_channel_id). 연결된 DB가 바뀌면 이 값과 달라지고,
    # 워커는 옛 페이지와 반영 버전을 쓰지 않고 새 DB에 페이지를 새로 만든다. 페이지 ID와 항상 함께 쓴다.
    notion_database_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
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
    # 지운 task. 지금은 auto로 만든 task를 PM이 되돌릴 때만 지운다. 행은 남겨 Notion 동기화 워커가 페이지를
    # 보관(archive)하게 하고, 추출 항목·이력과의 연결도 남긴다. 목록·조회·검색에서는 빠진다
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), index=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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
    """Task를 Notion과 맞춰 달라는 확인 요청(outbox).

    Task 변경과 같은 트랜잭션에서 커밋되고, 실제 Notion 호출은 워커
    (`services/notion_sync.py`)가 요청과 분리해서 처리한다. 같은 Task에 여러 줄 있어도 된다.
    워커가 Task의 Notion 기록과 지금 연결을 보고 할 일이 없으면 Notion을 부르지 않고 끝낸다.
    `task_version`은 요청한 시점의 Task 버전이다(재시도·로그용).
    """

    __tablename__ = "notion_sync_job"

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
    # 답장에서 나온 변경의 이력은 타임라인에서 그 답장 아래에 묶인다. 필드 하나에 이력이 둘일 수 있어(PM 이 고쳐 승인) 이쪽에 둔다.
    reply_change_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("reply_change.change_id", ondelete="SET NULL"), nullable=True, index=True
    )

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
    # 승인 대기 중인 task_create 요청의 제목(payload 의 task_title 또는 title) 임베딩. 임베딩 워커가
    # 채운다(app/services/embedding.py). NULL인 동안은 유사 검색에서 빠진다. 요청이 처리된 뒤에도 지우지 않는다.
    # 벡터 1536개를 매 조회마다 읽지 않도록 필요할 때만 불러온다(deferred).
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(EMBEDDING_DIMENSIONS), nullable=True, deferred=True
    )
    # 임베딩 API가 입력 오류로 거절한 제목. 이 값이 있으면 워커가 그 요청을 다시 고르지 않는다.
    # 빈 문자열("")은 제목이 없거나 문자열이 아니어서 API를 부르지 않고 건너뛴 요청이다.
    embedding_rejected_title: Mapped[str | None] = mapped_column(Text, nullable=True)

class ReminderStatus(StrEnum):
    SCHEDULED = "scheduled"
    SENT = "sent"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class ReminderKind(StrEnum):
    NUDGE = "nudge"


class ReminderOrigin(StrEnum):
    PM = "pm"
    SCHEDULER = "scheduler"


class MessageSender(StrEnum):
    BOT = "bot"
    MEMBER = "member"


class ReplyChannel(StrEnum):
    DISCORD = "discord"
    WEB = "web"


class DmStatus(StrEnum):
    PENDING = "pending"
    CLAIMED = "claimed"
    DELIVERED = "delivered"
    FAILED = "failed"


class DmFailureReason(StrEnum):
    DM_BLOCKED = "dm_blocked"
    DISCORD_NOT_LINKED = "discord_not_linked"
    UNKNOWN = "unknown"


class MessageThread(Base):
    """워크스페이스 x 팀원 한 명의 대화. 처음 필요할 때 만든다."""

    __tablename__ = "message_thread"
    __table_args__ = (
        UniqueConstraint("workspace_id", "member_id", name="uq_message_thread_member"),
    )

    thread_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace.workspace_id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    member: Mapped["Member"] = relationship()


class ThreadMessage(Base):
    """대화에 들어간 메시지 한 통. 봇이 보낸 DM(발송된 묶음)이거나 팀원의 답장이다.

    created_at 은 대화에 들어온 시각이다. 팀원 메시지의 reply_channel·discord_message_id·received_at 과
    봇 메시지의 dm_*·claimed_at·scheduled_at 은 보낸 쪽에 따라 한쪽만 채운다.
    """

    __tablename__ = "thread_message"
    __table_args__ = (
        # 같은 디스코드 메시지를 두 번 저장하지 않는다. 웹 답장은 null 이라 겹쳐도 된다.
        Index("uq_thread_message_discord_message", "discord_message_id", unique=True),
    )

    message_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    thread_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("message_thread.thread_id", ondelete="CASCADE"), index=True
    )
    sender: Mapped[str] = mapped_column(String(16))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    reply_channel: Mapped[str | None] = mapped_column(String(16), nullable=True)
    discord_message_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    dm_status: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    dm_failure_reason: Mapped[str | None] = mapped_column(String(24), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dm_reported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    thread: Mapped["MessageThread"] = relationship()


class ReplyJudgmentState(StrEnum):
    PENDING = "pending"
    DONE = "done"
    NEEDS_PM = "needs_pm"
    FAILED = "failed"
    TIMED_OUT = "timed_out"


class ReplyChangeField(StrEnum):
    STATUS = "status"
    DUE_DATE = "due_date"
    ASSIGNEE = "assignee"
    SCOPE = "scope"
    UNKNOWN = "unknown"
    DUE_CLEAR = "due_clear"
    FAILED = "failed"
    NONE = "none"


class ReplyChangeOutcome(StrEnum):
    APPLIED = "applied"
    PROPOSED = "proposed"
    UNKNOWN = "unknown"
    NOTED = "noted"
    RECORDED = "recorded"
    DISMISSED = "dismissed"
    PICKED = "picked"
    SKIPPED = "skipped"


class ReplyJudgment(Base):
    """리마인드 답장 한 통의 판단 큐이자 기록. 답장 저장과 같은 트랜잭션에서 생긴다. 후보가 없는 답장에는 행이 없다.

    queued_at 은 판단을 기다리기 시작한 시각이다. 저장 시각이고 PM 이 태스크를 고르면 그 시각이다.
    attempt 는 맡길 때마다 오른다. candidates 는 task_id 목록(JSON)이고 PM 이 고르면 그 하나, 해당 없음이면 빈 목록이다.
    claimed_statuses 는 맡길 때 후보의 실제 상태(JSON)다. 판단에 보인 값은 막기 전 상태일 수 있어 따로 둔다.
    failure_reason 에는 예외 종류만 둔다. 답장 글을 싣지 않는다.
    """

    __tablename__ = "reply_judgment"

    message_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("thread_message.message_id", ondelete="CASCADE"), primary_key=True
    )
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace.workspace_id", ondelete="CASCADE"), index=True
    )
    thread_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("message_thread.thread_id", ondelete="CASCADE"), index=True
    )
    state: Mapped[str] = mapped_column(String(16), default=ReplyJudgmentState.PENDING, index=True)
    queued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    candidates: Mapped[str] = mapped_column(Text)
    claimed_statuses: Mapped[str | None] = mapped_column(Text, nullable=True)
    picked_task_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("task.task_id", ondelete="SET NULL"), nullable=True
    )
    failure_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(64), nullable=True)

    message: Mapped["ThreadMessage"] = relationship()


class ReplyChange(Base):
    """답장이 태스크에 뜻하는 변경 한 줄. 필드 하나가 한 줄이다. unknown 은 task_id 가 없고 due_clear·failed 는 어느 태스크인지 알 때만 있다.

    승인 결과는 approval_id 로, 되돌림은 reply_change_id 로 이어진 이력으로 읽는다. 여기에 옮겨 적지 않는다.
    """

    __tablename__ = "reply_change"
    __table_args__ = (
        UniqueConstraint("message_id", "task_id", "field", name="uq_reply_change_message_task_field"),
    )

    change_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    message_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("reply_judgment.message_id", ondelete="CASCADE"), index=True
    )
    task_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("task.task_id", ondelete="SET NULL"), nullable=True, index=True
    )
    field: Mapped[str] = mapped_column(String(16))
    outcome: Mapped[str] = mapped_column(String(16))
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_quote: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    approval_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("approval_request.approval_id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class BodySource(StrEnum):
    PM = "pm"
    AI = "ai"
    RULE = "rule"


class DraftStatus(StrEnum):
    NEEDED = "needed"
    CLAIMED = "claimed"
    DONE = "done"


class ReminderBundle(Base):
    """보낼 메시지. 같은 대화·같은 발송 시각의 리마인드를 묶은 한 통이고 PM 이 문구를 보고 고치고 승인하는 단위다.

    구성(리마인드 더하기·빼기·시각 이동)이 바뀔 때마다 규칙 문구로 다시 만들고 draft_version 을 올리고 승인을 푼다.
    AI 초안은 draft_version 이 그대로일 때만 받는다. 발송되면 봇 메시지 한 통(message_id)이 된다.
    """

    __tablename__ = "reminder_bundle"
    __table_args__ = (
        # 한 대화의 같은 시각에 예정인 묶음은 하나다. 지난 묶음(발송·취소·만료)은 겹쳐도 된다.
        Index(
            "uq_reminder_bundle_scheduled_slot", "thread_id", "scheduled_at", unique=True,
            postgresql_where=text("status = 'scheduled'"),
            sqlite_where=text("status = 'scheduled'"),
        ),
    )

    bundle_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace.workspace_id", ondelete="CASCADE"), index=True
    )
    thread_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("message_thread.thread_id", ondelete="CASCADE"), index=True
    )
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default=ReminderStatus.SCHEDULED, index=True)
    body: Mapped[str] = mapped_column(Text)
    body_source: Mapped[str] = mapped_column(String(8))
    draft_status: Mapped[str] = mapped_column(String(16), index=True)
    draft_version: Mapped[int] = mapped_column(Integer, default=0)
    draft_claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True
    )
    message_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("thread_message.message_id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    thread: Mapped["MessageThread"] = relationship()


class Reminder(Base):
    """리마인드. 태스크 하나 x 수신자 한 명이다. 수신자와 발송 시각은 속한 묶음(bundle)이 정한다.

    note 는 PM 이 이 태스크에 대해 따로 쓴 말이다. 스케줄러가 만든 리마인드에는 없다.
    """

    __tablename__ = "reminder"

    reminder_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace.workspace_id", ondelete="CASCADE"), index=True
    )
    bundle_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("reminder_bundle.bundle_id", ondelete="CASCADE"), index=True
    )
    task_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("task.task_id", ondelete="SET NULL"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(16), default=ReminderKind.NUDGE)
    origin: Mapped[str] = mapped_column(String(16))
    created_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default=ReminderStatus.SCHEDULED, index=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    bundle: Mapped["ReminderBundle"] = relationship()
    task: Mapped["Task | None"] = relationship()


class BotDmPart(Base):
    """봇이 보낸 디스코드 DM 한 통. 2,000자를 넘는 메시지는 여러 통으로 나뉜다.

    DM 에는 서버 id 가 없어서, 팀원이 답장 기능으로 고른 DM 이 어느 대화의 메시지인지 이 표로 찾는다.
    """

    __tablename__ = "bot_dm_part"

    discord_message_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    message_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("thread_message.message_id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class PushStatus(StrEnum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    SKIPPED = "skipped"


class Notification(Base):
    """웹 안 알림 하나. 만들면 목록과 배지에 들어가고, 받는 사람 기기 모두로 푸시가 나간다(push_status).

    받는 사람은 워크스페이스의 팀원(member)이다. 푸시는 그 팀원의 계정(user)에 등록된 기기로 간다.
    dedupe_key 가 있으면 같은 일로 두 번 알리지 않는다.
    """

    __tablename__ = "notification"

    notification_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace.workspace_id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(32))
    text: Mapped[str] = mapped_column(Text)
    link_type: Mapped[str] = mapped_column(String(16))
    link_id: Mapped[str] = mapped_column(String(36))
    dedupe_key: Mapped[str | None] = mapped_column(String(120), nullable=True, unique=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    push_status: Mapped[str] = mapped_column(String(16), default=PushStatus.PENDING, index=True)
    push_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    pushed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    member: Mapped["Member"] = relationship()


class PushSubscription(Base):
    """브라우저 한 곳의 웹 푸시 구독. 계정 단위라 그 사람의 모든 워크스페이스 알림이 이 기기로 온다."""

    __tablename__ = "push_subscription"

    subscription_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("user.user_id", ondelete="CASCADE"), index=True
    )
    endpoint: Mapped[str] = mapped_column(String(2048), unique=True)
    p256dh: Mapped[str] = mapped_column(String(255))
    auth: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class WatchState(StrEnum):
    WATCHING = "watching"
    ANSWERED = "answered"
    BLOCKED = "blocked"
    RELEASED = "released"
    STOPPED = "stopped"


class ReminderWatch(Base):
    """나간 리마인드 하나의 72시간 시계. 응답이 없으면 태스크를 막힘으로 바꾸고, 답이 오면 푼다.

    같은 태스크에 리마인드가 다시 나가면 이전 시계는 멈추고(stopped) 새 시계가 센다. 자동 막힘이 걸린 채면 새 시계가
    applied·prev_* 를 이어받는다.
    applied 는 스케줄러가 태스크를 직접 막힘으로 바꿨는지다. 이미 막힘이던 태스크는 알리기만 한다.
    prev_status·prev_blocker 는 막기 전 값이라 PM 이 자동 막힘을 되돌릴 때 쓴다.
    paused_at 은 답장 확인을 기다리는 동안 시계를 멈추는 자리다(D-174 정책 2). 멈춘 시계는 막지 않는다.
    """

    __tablename__ = "reminder_watch"

    watch_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace.workspace_id", ondelete="CASCADE"), index=True
    )
    reminder_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("reminder.reminder_id", ondelete="CASCADE"), unique=True
    )
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("task.task_id", ondelete="CASCADE"), index=True)
    thread_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("message_thread.thread_id", ondelete="CASCADE"), index=True
    )
    message_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("thread_message.message_id", ondelete="CASCADE"), index=True
    )
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # DM 전달 보고가 온 뒤에 정해진다. 그 전에는 비어 있다.
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    state: Mapped[str] = mapped_column(String(16), default=WatchState.WATCHING, index=True)
    applied: Mapped[bool] = mapped_column(Boolean, default=False)
    prev_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    prev_blocker: Mapped[str | None] = mapped_column(Text, nullable=True)
    blocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    task: Mapped["Task"] = relationship()
    message: Mapped["ThreadMessage"] = relationship()


class SchedulerSuggestion(Base):
    """스케줄러가 태스크의 한 마감·담당자에게 재촉을 제안했다는 기록. PM 이 취소해도 다시 제안하지 않는다."""

    __tablename__ = "scheduler_suggestion"
    __table_args__ = (UniqueConstraint("task_id", "due_date", "member_id", name="uq_scheduler_suggestion_task_due_member"),)

    suggestion_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("task.task_id", ondelete="CASCADE"), index=True)
    due_date: Mapped[date] = mapped_column(Date)
    member_id: Mapped[str] = mapped_column(String(36), ForeignKey("member.member_id", ondelete="CASCADE"))
    reminder_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("reminder.reminder_id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class InvitationStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    CANCELED = "canceled"
    REVOKED = "revoked"


class Invitation(Base):
    """PM 이 로그인 계정 없는 팀원에게 가입 이메일로 보낸 초대. 그 이메일로 로그인한 사람이 수락하면 팀원과 계정이 이어진다.

    email 은 앞뒤 공백을 지우고 소문자로 바꿔 저장한다. 끊은(revoked) 초대도 accepted_user_id 를 남겨 누가 들어왔었는지 보인다.
    """

    __tablename__ = "invitation"
    __table_args__ = (
        # 한 팀원에 열린 초대 하나, 한 워크스페이스에서 같은 이메일의 열린 초대 하나. 둘째가 있어야 한 계정이
        # 한 워크스페이스에서 두 팀원에 이어지지 않는다(수락할 때의 소속 확인과 함께).
        Index(
            "uq_invitation_pending_member", "member_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
            sqlite_where=text("status = 'pending'"),
        ),
        Index(
            "uq_invitation_pending_email", "workspace_id", "email",
            unique=True,
            postgresql_where=text("status = 'pending'"),
            sqlite_where=text("status = 'pending'"),
        ),
    )

    invitation_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace.workspace_id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="CASCADE"), index=True
    )
    email: Mapped[str] = mapped_column(String(255), index=True)
    status: Mapped[str] = mapped_column(String(16), default=InvitationStatus.PENDING)
    invited_by_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("user.user_id", ondelete="SET NULL"), nullable=True
    )
    accepted_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("user.user_id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # 마지막으로 상태가 바뀐 시각. 끊으면 수락 시각 대신 끊은 시각이 된다.
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PmAlertMethod(StrEnum):
    WEB = "web"
    DISCORD_DM = "discord_dm"
    BOTH = "both"


class WorkspaceMessageSettings(Base):
    """워크스페이스의 메시지·알림 설정. 행이 없으면 기본값으로 본다(서비스 message_settings.DEFAULTS)."""

    __tablename__ = "workspace_message_settings"

    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace.workspace_id", ondelete="CASCADE"), primary_key=True
    )
    due_reminder: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    minutes_summary: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    silence_alert: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    nudge_days_before: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    nudge_hour: Mapped[int] = mapped_column(Integer, default=9, server_default=text("9"))
    pm_alert_method: Mapped[str] = mapped_column(
        String(16), default=PmAlertMethod.BOTH, server_default=PmAlertMethod.BOTH.value
    )
    reminder_auto_approve: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # reminder_auto_approve 를 켠 시각. 이 시각 이후의 리마인드부터 자동 승인한다.
    auto_approve_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True
    )
