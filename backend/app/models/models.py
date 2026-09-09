import uuid
from datetime import date, datetime, timezone
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


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


class MeetingStatus(StrEnum):
    CREATED = "created"
    RECORDING = "recording"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class MeetingSource(StrEnum):
    DISCORD = "discord"
    MANUAL_UPLOAD = "manual_upload"


class TaskStatus(StrEnum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    DONE = "done"


class ChangedField(StrEnum):
    ASSIGNEE = "assignee"
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
    MANUAL = "manual"


class Gate(StrEnum):
    AUTO = "auto"
    REVIEW = "review"
    HOLD = "hold"


class Member(Base):
    __tablename__ = "member"

    member_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True)
    display_name: Mapped[str] = mapped_column(String(100))
    discord_user_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    notion_name: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    role: Mapped[str] = mapped_column(String(16), default=MemberRole.MEMBER)
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
    workspace_id: Mapped[str] = mapped_column(String(36), index=True)
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
    workspace_id: Mapped[str] = mapped_column(String(36), index=True)
    alias_text: Mapped[str] = mapped_column(String(100), index=True)
    resolved_member: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True
    )
    result: Mapped[str] = mapped_column(String(16))
    candidate_count: Mapped[int] = mapped_column(Integer, default=0)
    evidence_quote: Mapped[str | None] = mapped_column(Text, nullable=True)
    meeting_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AliasReview(Base):
    __tablename__ = "alias_review"

    review_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    log_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("alias_resolution_log.log_id", ondelete="CASCADE"), index=True
    )
    decision: Mapped[str] = mapped_column(String(16))
    corrected_member: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True
    )
    reviewed_by: Mapped[str] = mapped_column(String(36), ForeignKey("member.member_id"))
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Meeting(Base):
    __tablename__ = "meeting"

    meeting_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True)
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source: Mapped[str] = mapped_column(String(20), default=MeetingSource.DISCORD)
    status: Mapped[str] = mapped_column(String(16), default=MeetingStatus.CREATED, index=True)
    audio_merged: Mapped[bool] = mapped_column(Boolean, default=False)
    transcribed: Mapped[bool] = mapped_column(Boolean, default=False)
    extracted: Mapped[bool] = mapped_column(Boolean, default=False)
    failed_stage: Mapped[str | None] = mapped_column(String(32), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    audio: Mapped["MeetingAudio | None"] = relationship(
        back_populates="meeting", uselist=False, cascade="all, delete-orphan"
    )
    segments: Mapped[list["AudioSegment"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan"
    )
    extractions: Mapped[list["Extraction"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan"
    )


class MeetingAudio(Base):
    __tablename__ = "meeting_audio"

    audio_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    meeting_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting.meeting_id", ondelete="CASCADE"), unique=True
    )
    merged_file_path: Mapped[str] = mapped_column(Text)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    track_count: Mapped[int] = mapped_column(Integer, default=0)
    is_complete: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    meeting: Mapped["Meeting"] = relationship(back_populates="audio")


class AudioSegment(Base):
    __tablename__ = "audio_segment"

    segment_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    meeting_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting.meeting_id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("member.member_id", ondelete="SET NULL"), nullable=True
    )
    discord_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    merged_start_ms: Mapped[int] = mapped_column(Integer, index=True)
    merged_end_ms: Mapped[int] = mapped_column(Integer)
    actual_start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    actual_end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    track_file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    meeting: Mapped["Meeting"] = relationship(back_populates="segments")


class Extraction(Base):
    __tablename__ = "extraction"

    extraction_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    meeting_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting.meeting_id", ondelete="CASCADE"), index=True
    )
    transcript_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    meeting: Mapped["Meeting"] = relationship(back_populates="extractions")
    items: Mapped[list["ExtractionItem"]] = relationship(
        back_populates="extraction", cascade="all, delete-orphan"
    )


class ExtractionItem(Base):
    __tablename__ = "extraction_item"

    item_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    extraction_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("extraction.extraction_id", ondelete="CASCADE"), index=True
    )
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
    evidence_quote: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_speaker: Mapped[str | None] = mapped_column(String(100), nullable=True)
    evidence_at_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    extraction: Mapped["Extraction"] = relationship(back_populates="items")


class Task(Base):
    __tablename__ = "task"

    task_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True)
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
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    notion_page_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    history: Mapped[list["TaskHistory"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
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
    is_auto: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_rolled_back: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    rolled_back_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    task: Mapped["Task"] = relationship(back_populates="history")