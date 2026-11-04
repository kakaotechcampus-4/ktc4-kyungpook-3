import type { MessageReview, MessageThreadKind } from '@/entities/message'
import { addDays, formatSeoulDateTime, seoulDateOf } from '@/shared/lib/date'

/* 시각은 모두 한국 시간이다 (D-144). formatSeoulDateTime 은 `YYYY-MM-DD HH:mm` 이다 */

/** 목록의 날짜 — `09/10` (Messages 시안) */
export function shortDate(timestamp: string): string {
  return formatSeoulDateTime(timestamp).slice(5, 10).replace('-', '/')
}

/** 말풍선 아래 시각 — `18:00` */
export function clockTime(timestamp: string): string {
  return formatSeoulDateTime(timestamp).slice(11)
}

/** 나갈 시각 — `09/23 09:00` (Messages 시안의 `09/16 09:00 예정`) */
export function shortDateTime(timestamp: string): string {
  return `${shortDate(timestamp)} ${clockTime(timestamp)}`
}

/** 서울 날짜 `YYYY-MM-DD` 둘 사이의 날 수. 날짜 문자열만으로 계산해 실행 환경 시간대와 무관하다 */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** 만든 지 얼마나 됐나 — `오늘` · `어제` · `3일 전` (Messages 시안). 오늘은 서울 날짜다 */
export function relativeDay(timestamp: string, today: string): string {
  const date = seoulDateOf(timestamp)
  if (date === null) return ''
  const days = daysBetween(date, today)
  if (days <= 0) return '오늘'
  return days === 1 ? '어제' : `${String(days)}일 전`
}

/** 보내기 전 확인 행의 오른쪽 글자 — 예약은 `09/23 발송 예정`, 마감이 있으면 `09/24 마감`, 없으면 만든 때 `3일 전` */
export function reviewDateLabel(review: MessageReview, today: string): string {
  if (review.state.status === 'scheduled' && review.scheduledAt !== null)
    return `${shortDate(review.scheduledAt)} 발송 예정`
  if (review.deadline === null) return relativeDay(review.createdAt, today)
  return `${review.deadline.slice(5).replace('-', '/')} 마감`
}

/** 답장이 없는 지 며칠째인가. 보낸 날이 1일째다 — 9/16 에 보냈으면 9/18 은 3일째 (MessagesThread 시안 `답장 3일째 없음`) */
export function awaitingDays(since: string, today: string): number {
  const date = seoulDateOf(since)
  return date === null ? 1 : Math.max(1, daysBetween(date, today) + 1)
}

const weekdayFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  weekday: 'long',
})

/** 하루를 넷으로 나눈 때 — 새벽(0~5시) · 아침(6~11시) · 낮(12~17시) · 밤(18~23시) */
function partOfDay(hour: number): string {
  if (hour < 6) return '새벽'
  if (hour < 12) return '아침'
  return hour < 18 ? '낮' : '밤'
}

/** `지금 바로` 카드의 부제 — 지금이 언제인가, `금요일 밤` (Messages 시안) */
export function nowLabel(now: Date): string {
  const hour = Number(formatSeoulDateTime(now.toISOString()).slice(11, 13))
  return `${weekdayFormatter.format(now)} ${partOfDay(hour)}`
}

/** 서울 시각을 `datetime-local` 입력값 `YYYY-MM-DDTHH:mm` 으로 */
export function toSeoulInputValue(timestamp: string): string {
  return formatSeoulDateTime(timestamp).replace(' ', 'T')
}

const INPUT_VALUE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/** `datetime-local` 입력값을 서울 시각(ISO, +09:00)으로. 모양이 틀리면 null 이다 */
export function fromSeoulInputValue(value: string): string | null {
  return INPUT_VALUE.test(value) ? `${value}:00+09:00` : null
}

/** 직접 정하기의 처음 값 — 이미 정한 시각, 없으면 내일 09:00 */
export function initialCustomTime(scheduledAt: string | null, today: string): string {
  return scheduledAt === null ? `${addDays(today, 1)}T09:00` : toSeoulInputValue(scheduledAt)
}

const dayFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
})

/** 날짜 구분선 — `9월 8일 화요일`, 오늘이면 `오늘 · 9월 18일 금요일` (MessagesThread 시안). `date` 는 서울 날짜 `YYYY-MM-DD` */
export function dayLabel(date: string, today: string): string {
  const label = dayFormatter.format(new Date(`${date}T12:00:00+09:00`))
  return date === today ? `오늘 · ${label}` : label
}

export interface DayGroup<T> {
  /** 서울 날짜 `YYYY-MM-DD`. 첫 항목부터 시각을 읽을 수 없으면 null 이다 */
  date: string | null
  items: T[]
}

/** `at` 순인 항목을 서울 날짜별로 묶는다. 시각을 읽을 수 없는 항목은 앞 묶음에 붙이고, 앞 묶음이 없으면 날짜 없는 묶음을 연다 */
export function groupByDay<T extends { at: string }>(entries: readonly T[]): DayGroup<T>[] {
  const days: DayGroup<T>[] = []
  for (const entry of entries) {
    const date = seoulDateOf(entry.at)
    const last = days.at(-1)
    if (last !== undefined && (date === null || date === last.date)) last.items.push(entry)
    else days.push({ date, items: [entry] })
  }
  return days
}

/** 아바타 글자 — 이름의 첫 글자, 채널은 `#` (디자인 시스템 §6: 이름 1~2자, 회색 원) */
export function avatarText(name: string, kind: MessageThreadKind): string {
  if (kind === 'channel') return '#'
  return Array.from(name.trim())[0] ?? '?'
}
