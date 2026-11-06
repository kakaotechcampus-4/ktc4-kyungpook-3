import { addDays, toSeoulInputValue } from '@/shared/lib/date'
import { nudgeSendAt } from './nudgeRule'
import type { NudgeRule } from './types'

/** 마감 기준 선택지 — 마감에 공간의 재촉 규칙(며칠 전 몇 시, 한국 시간)을 적용한 시각. 마감이 없거나 그 시각이 지났으면 고를 수 없다 */
export type DeadlineSend =
  { status: 'none' } | { status: 'open'; at: string } | { status: 'passed'; at: string }

export function deadlineSend(dueDate: string | null, rule: NudgeRule, now: number): DeadlineSend {
  if (dueDate === null) return { status: 'none' }
  const at = nudgeSendAt(dueDate, rule)
  return Date.parse(at) <= now ? { status: 'passed', at } : { status: 'open', at }
}

/** 같은 순간인가. 서버는 UTC 로, 화면은 +09:00 으로 쓴다 */
export function sameInstant(left: string, right: string): boolean {
  return Date.parse(left) === Date.parse(right)
}

/** 직접 정하기의 처음 값 — 이미 정한 시각, 없으면 내일 09:00 */
export function initialCustomTime(scheduledAt: string | null, today: string): string {
  return scheduledAt === null ? `${addDays(today, 1)}T09:00` : toSeoulInputValue(scheduledAt)
}
