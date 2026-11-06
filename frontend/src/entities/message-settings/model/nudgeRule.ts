import { addDays } from '@/shared/lib/date'
import type { NudgeDaysBefore, NudgeRule } from './types'

/* 재촉 규칙의 문구는 여기 하나다. 설정 화면의 토글 제목과 메시지 화면의 보낼 시각 선택지가 같이 쓴다 */

/** `마감 당일` · `마감 하루 전` · `마감 2일 전` */
export function nudgeDayLabel(daysBefore: NudgeDaysBefore): string {
  if (daysBefore === 0) return '마감 당일'
  if (daysBefore === 1) return '마감 하루 전'
  return `마감 ${String(daysBefore)}일 전`
}

/** `09:00` */
export function nudgeHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/** `마감 2일 전 18:00` */
export function nudgeRuleLabel(rule: NudgeRule): string {
  return `${nudgeDayLabel(rule.daysBefore)} ${nudgeHourLabel(rule.hour)}`
}

/** 마감일 `YYYY-MM-DD` 에 규칙을 적용한 한국 시각(ISO, +09:00) */
export function nudgeSendAt(dueDate: string, rule: NudgeRule): string {
  return `${addDays(dueDate, -rule.daysBefore)}T${nudgeHourLabel(rule.hour)}:00+09:00`
}
