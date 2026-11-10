import { toMessageSettings } from './mapper'
import { nudgeDayLabel, nudgeRuleLabel, nudgeSendAt } from './nudgeRule'

it('며칠 전은 0 이면 당일, 1 이면 하루 전, 그 밖은 숫자로 읽는다', () => {
  expect([0, 1, 2, 3].map((days) => nudgeDayLabel(days as 0 | 1 | 2 | 3))).toEqual([
    '마감 당일',
    '마감 하루 전',
    '마감 2일 전',
    '마감 3일 전',
  ])
})

it('규칙 문구는 며칠 전과 정시를 함께 쓴다', () => {
  expect(nudgeRuleLabel({ daysBefore: 2, hour: 18 })).toBe('마감 2일 전 18:00')
  expect(nudgeRuleLabel({ daysBefore: 0, hour: 9 })).toBe('마감 당일 09:00')
  expect(nudgeRuleLabel({ daysBefore: 1, hour: 0 })).toBe('마감 하루 전 00:00')
})

it('보낼 시각은 마감일에서 며칠을 빼고 그 날 정시(한국 시간)다. 달이 넘어가도 맞다', () => {
  expect(nudgeSendAt('2026-09-24', { daysBefore: 2, hour: 18 })).toBe('2026-09-22T18:00:00+09:00')
  expect(nudgeSendAt('2026-10-01', { daysBefore: 1, hour: 9 })).toBe('2026-09-30T09:00:00+09:00')
  expect(nudgeSendAt('2026-09-24', { daysBefore: 0, hour: 7 })).toBe('2026-09-24T07:00:00+09:00')
})

it('저장된 규칙이 화면이 고를 수 있는 범위 밖이면 범위 안으로 맞춘다', () => {
  const settings = toMessageSettings({
    due_reminder: true,
    minutes_summary: true,
    silence_alert: true,
    nudge_rule: { days_before: 5, hour: 9 },
    pm_alert_method: 'both',
    reminder_auto_approve: false,
    saved: true,
    pms: [],
  })
  expect(settings.nudgeRule).toEqual({ daysBefore: 3, hour: 9 })
})
