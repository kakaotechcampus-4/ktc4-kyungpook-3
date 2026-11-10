import { z } from 'zod'

/*
 * 메시지·알림 설정 응답 스키마 (backend app/schemas/message_settings.py, 계약 §5.7). FE 가 읽는 필드만 본다.
 * 타입은 이 스키마에서 만든다 (#348)
 */

/**
 * PM 알림 방법. 설정 화면이 고른 값으로 보이고 PM 이 바꿔 저장하는 값이라 모르는 값이면 응답 전체가 `INVALID_RESPONSE` 다.
 * 전에는 `both` 로 읽어 다른 칸을 저장할 때 서버 값과 다르게 보였다
 */
export const pmAlertMethodSchema = z.enum(['web', 'discord_dm', 'both'])
export type PmAlertMethodDto = z.infer<typeof pmAlertMethodSchema>

const nudgeRuleSchema = z.object({
  /** 마감 며칠 전. 입력은 0~3 이고, 응답은 저장된 값을 그대로 준다 */
  days_before: z.number(),
  /** 한국 시간 정시 0~23 */
  hour: z.number(),
})
export type NudgeRuleDto = z.infer<typeof nudgeRuleSchema>

/** `MessageSettingsResponse`. 저장한 적 없으면 기본값과 `saved: false` 다 */
export const messageSettingsSchema = z.object({
  due_reminder: z.boolean(),
  minutes_summary: z.boolean(),
  silence_alert: z.boolean(),
  nudge_rule: nudgeRuleSchema,
  pm_alert_method: pmAlertMethodSchema,
  reminder_auto_approve: z.boolean(),
  saved: z.boolean(),
  /** 탈퇴하지 않은 PM. `discord_linked` 는 공간의 Discord 연동과 그 PM 의 Discord 계정이 모두 있을 때다 */
  pms: z.array(z.object({ member_id: z.string(), name: z.string(), discord_linked: z.boolean() })),
})
export type MessageSettingsDto = z.infer<typeof messageSettingsSchema>

/** `MessageSettingsPatch`. 보낸 키만 바뀐다. 빈 본문·null·모르는 키는 400 이다 */
export interface MessageSettingsPatchDto {
  due_reminder?: boolean
  minutes_summary?: boolean
  silence_alert?: boolean
  reminder_auto_approve?: boolean
  nudge_rule?: NudgeRuleDto
  pm_alert_method?: PmAlertMethodDto
}
