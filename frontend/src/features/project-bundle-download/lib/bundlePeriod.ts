import { isDateOnly } from '@/shared/lib/date'

/** 입력 칸 그대로의 기간. 빈 칸은 그쪽 끝이 없다 */
export interface PeriodInput {
  from: string
  to: string
}

export type PeriodCheck =
  | { kind: 'ok'; params: { from?: string; to?: string }; label: string }
  | { kind: 'invalid_date'; fields: { from: boolean; to: boolean } }
  | { kind: 'reversed' }

export const PERIOD_MESSAGES = {
  invalidDate: 'YYYY-MM-DD 형식의 있는 날짜로 적어 주세요.',
  reversed: '시작일이 종료일보다 늦어요.',
} as const

export function checkPeriod(input: PeriodInput): PeriodCheck {
  const from = input.from.trim()
  const to = input.to.trim()
  const fields = { from: from !== '' && !isDateOnly(from), to: to !== '' && !isDateOnly(to) }
  if (fields.from || fields.to) return { kind: 'invalid_date', fields }
  // YYYY-MM-DD 는 글자 순서가 날짜 순서다
  if (from !== '' && to !== '' && from > to) return { kind: 'reversed' }
  return {
    kind: 'ok',
    params: { ...(from === '' ? {} : { from }), ...(to === '' ? {} : { to }) },
    label: periodLabel(from, to),
  }
}

function periodLabel(from: string, to: string): string {
  if (from === '' && to === '') return '전체 기간'
  if (to === '') return `${from}부터`
  if (from === '') return `${to}까지`
  return `${from} ~ ${to}`
}
