/*
 * 메시지·알림 설정 API 응답·요청 모양. 백엔드 `app/schemas/message_settings.py` 와 칸이 1:1 이다 (계약 §5.7).
 * 응답의 `pm_alert_method` 는 백엔드가 `str` 로 내보내므로 화면 쪽 매퍼가 값을 가른다
 */

export type PmAlertMethodDto = 'web' | 'discord_dm' | 'both'

export interface NudgeRuleDto {
  /** 마감 며칠 전. 입력은 0~3 이고, 응답은 저장된 값을 그대로 준다 */
  days_before: number
  /** 한국 시간 정시 0~23 */
  hour: number
}

/** 탈퇴하지 않은 PM. `discord_linked` 는 공간의 Discord 연동과 그 PM 의 Discord 계정이 모두 있을 때다 */
export interface PmContactDto {
  member_id: string
  name: string
  discord_linked: boolean
}

/** `MessageSettingsResponse`. 저장한 적 없으면 기본값과 `saved: false`, `updated_*` 는 null 이다 */
export interface MessageSettingsDto {
  due_reminder: boolean
  minutes_summary: boolean
  silence_alert: boolean
  nudge_rule: NudgeRuleDto
  pm_alert_method: string
  reminder_auto_approve: boolean
  saved: boolean
  updated_at: string | null
  updated_by: string | null
  pms: PmContactDto[]
}

/** `MessageSettingsPatch`. 보낸 키만 바뀐다. 빈 본문·null·모르는 키는 400 이다 */
export interface MessageSettingsPatchDto {
  due_reminder?: boolean
  minutes_summary?: boolean
  silence_alert?: boolean
  reminder_auto_approve?: boolean
  nudge_rule?: NudgeRuleDto
  pm_alert_method?: PmAlertMethodDto
}
