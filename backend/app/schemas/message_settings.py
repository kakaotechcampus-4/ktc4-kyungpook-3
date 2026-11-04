from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.message_settings import MAX_NUDGE_DAYS_BEFORE


class NudgeRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    days_before: int = Field(ge=0, le=MAX_NUDGE_DAYS_BEFORE)
    hour: int = Field(ge=0, le=23)


class MessageSettingsPatch(BaseModel):
    """보낸 키만 바꾼다. 빈 본문과 명시적 null 은 거절한다."""

    model_config = ConfigDict(extra="forbid")

    due_reminder: bool | None = None
    minutes_summary: bool | None = None
    silence_alert: bool | None = None
    reminder_auto_approve: bool | None = None
    nudge_rule: NudgeRule | None = None
    pm_alert_method: Literal["web", "discord_dm", "both"] | None = None

    @model_validator(mode="after")
    def _only_sent_non_null(self):
        if not self.model_fields_set:
            raise ValueError("바꿀 설정을 하나 이상 보내야 합니다.")
        for key in self.model_fields_set:
            if getattr(self, key) is None:
                raise ValueError(f"{key} 는 null 일 수 없습니다.")
        return self

    def changes(self) -> dict:
        out: dict = {}
        for key in self.model_fields_set:
            if key == "nudge_rule":
                out["nudge_days_before"] = self.nudge_rule.days_before
                out["nudge_hour"] = self.nudge_rule.hour
            else:
                out[key] = getattr(self, key)
        return out


class PmContact(BaseModel):
    member_id: str
    name: str
    discord_linked: bool


class MessageSettingsResponse(BaseModel):
    due_reminder: bool
    minutes_summary: bool
    silence_alert: bool
    nudge_rule: NudgeRule
    pm_alert_method: str
    reminder_auto_approve: bool
    saved: bool
    updated_at: datetime | None
    updated_by: str | None
    pms: list[PmContact]
