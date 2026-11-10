import type {
  MessageSettingsDto,
  MessageSettingsPatchDto,
} from '@/shared/types/api/messageSettings'
import { NUDGE_DAYS_BEFORE } from './types'
import type { MessageSettings, MessageSettingsChange, NudgeDaysBefore, NudgeRule } from './types'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/** 서버는 입력 범위가 나중에 좁아져도 저장된 값을 그대로 돌려준다. 화면이 고를 수 있는 범위 안으로 맞춘다 */
function toNudgeRule({ days_before, hour }: MessageSettingsDto['nudge_rule']): NudgeRule {
  const last = NUDGE_DAYS_BEFORE[NUDGE_DAYS_BEFORE.length - 1]
  return {
    daysBefore: clamp(days_before, 0, last) as NudgeDaysBefore,
    hour: clamp(hour, 0, 23),
  }
}

export function toMessageSettings(dto: MessageSettingsDto): MessageSettings {
  return {
    dueReminder: dto.due_reminder,
    minutesSummary: dto.minutes_summary,
    silenceAlert: dto.silence_alert,
    reminderAutoApprove: dto.reminder_auto_approve,
    nudgeRule: toNudgeRule(dto.nudge_rule),
    pmAlertMethod: dto.pm_alert_method,
    saved: dto.saved,
    pms: dto.pms.map((pm) => ({
      memberId: pm.member_id,
      name: pm.name,
      discordLinked: pm.discord_linked,
    })),
  }
}

/** 들어 있는 칸만 옮긴다. 재촉 규칙은 늘 두 값을 함께 보낸다 */
export function toMessageSettingsPatch(change: MessageSettingsChange): MessageSettingsPatchDto {
  const patch: MessageSettingsPatchDto = {}
  if (change.dueReminder !== undefined) patch.due_reminder = change.dueReminder
  if (change.minutesSummary !== undefined) patch.minutes_summary = change.minutesSummary
  if (change.silenceAlert !== undefined) patch.silence_alert = change.silenceAlert
  if (change.reminderAutoApprove !== undefined)
    patch.reminder_auto_approve = change.reminderAutoApprove
  if (change.nudgeRule !== undefined)
    patch.nudge_rule = { days_before: change.nudgeRule.daysBefore, hour: change.nudgeRule.hour }
  if (change.pmAlertMethod !== undefined) patch.pm_alert_method = change.pmAlertMethod
  return patch
}
