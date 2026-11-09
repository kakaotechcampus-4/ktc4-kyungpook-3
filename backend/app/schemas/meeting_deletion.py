from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class MeetingDeletionReceipt(BaseModel):
    meeting_id: str
    deleted_meeting_ids: list[str]
    deleted_at: datetime
    cleanup_status: Literal["pending", "complete"]


class PurgeClaim(BaseModel):
    meeting_id: str
    claim_token: str
    lease_until: datetime


class PurgeAck(BaseModel):
    claim_token: str = Field(min_length=1, max_length=128)
