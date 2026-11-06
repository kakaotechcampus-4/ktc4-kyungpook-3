export type PmAlertMethod = 'web' | 'discord_dm' | 'both'

export const NUDGE_DAYS_BEFORE = [0, 1, 2, 3] as const
export type NudgeDaysBefore = (typeof NUDGE_DAYS_BEFORE)[number]

/** 재촉 제안을 만드는 시각. 마감 `daysBefore` 일 전 `hour` 시 정각(한국 시간)이다 */
export interface NudgeRule {
  daysBefore: NudgeDaysBefore
  /** 0~23 */
  hour: number
}

export interface PmContact {
  memberId: string
  name: string
  discordLinked: boolean
}

export interface MessageSettings {
  dueReminder: boolean
  minutesSummary: boolean
  silenceAlert: boolean
  reminderAutoApprove: boolean
  nudgeRule: NudgeRule
  pmAlertMethod: PmAlertMethod
  /** 저장한 적 없으면 false 다 — 값은 서버 기본값이다 */
  saved: boolean
  pms: readonly PmContact[]
}

/** PM 이 바꿀 수 있는 칸. 들어 있는 칸만 서버에 보낸다 */
export type MessageSettingsChange = Partial<
  Pick<
    MessageSettings,
    | 'dueReminder'
    | 'minutesSummary'
    | 'silenceAlert'
    | 'reminderAutoApprove'
    | 'nudgeRule'
    | 'pmAlertMethod'
  >
>
