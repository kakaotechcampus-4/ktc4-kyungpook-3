from datetime import datetime

from pydantic import BaseModel, Field


class UploadAttendee(BaseModel):
    member_id: str
    display_name: str


class PendingUpload(BaseModel):
    """AI가 가져갈 업로드 회의 하나. 회의 행과 업로드 정보(`meeting_upload`)를 합친 것이다."""

    meeting_id: str
    workspace_id: str
    title: str | None
    started_at: datetime
    attendees: list[UploadAttendee] = Field(..., description="업로드 때 PM이 고른 참석자")
    original_filename: str | None
    stored_filename: str
    size_bytes: int
    content_type: str | None
    uploaded_at: datetime


class PendingUploadListResponse(BaseModel):
    items: list[PendingUpload]


class UploadClaimResponse(BaseModel):
    meeting_id: str
    status: str
