from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class WorkspaceWithdrawalResponse(BaseModel):
    workspace_id: str
    workspace_name: str
    disposition: Literal["preserve", "delete", "transfer_pm"]


class WithdrawalPlanResponse(BaseModel):
    workspaces: list[WorkspaceWithdrawalResponse]
    blocked_workspace_ids: list[str]


class WithdrawalResponse(BaseModel):
    withdrawal_id: str
    account_deleted_at: datetime
    cleanup_status: Literal["pending", "complete"]


class PrivacyCleanupClaim(BaseModel):
    cleanup_id: str
    workspace_id: str
    identity_epoch: int
    member_ids: list[str]
    meeting_ids: list[str]
    message_ids: list[str] = Field(default_factory=list)
    guild_ids: list[str]
    delete_workspace: bool
    claim_token: str
    lease_until: datetime


class PrivacyCleanupClaimResponse(BaseModel):
    item: PrivacyCleanupClaim | None


class PrivacyCleanupAck(BaseModel):
    claim_token: str = Field(min_length=20, max_length=128)


class PrivacyCleanupAckResponse(BaseModel):
    cleanup_id: str
    complete: bool
