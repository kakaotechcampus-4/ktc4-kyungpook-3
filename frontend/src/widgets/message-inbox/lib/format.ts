import type { Message, MessageThreadKind } from '@/entities/message'
import { formatSeoulDateTime, seoulDateOf } from '@/shared/lib/date'

/* 시각은 모두 한국 시간이다 (D-144). formatSeoulDateTime 은 `YYYY-MM-DD HH:mm` 이다 */

/** 목록의 날짜 — `09/10` (Messages 시안) */
export function shortDate(timestamp: string): string {
  return formatSeoulDateTime(timestamp).slice(5, 10).replace('-', '/')
}

/** 말풍선 아래 시각 — `18:00` */
export function clockTime(timestamp: string): string {
  return formatSeoulDateTime(timestamp).slice(11)
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

export interface MessageDay {
  /** 서울 날짜 `YYYY-MM-DD` */
  date: string
  messages: Message[]
}

/** 보낸 시각 순인 메시지를 서울 날짜별로 묶는다. 시각을 읽을 수 없는 메시지는 앞 묶음에 붙인다 */
export function groupByDay(messages: readonly Message[]): MessageDay[] {
  const days: MessageDay[] = []
  for (const message of messages) {
    const date = seoulDateOf(message.sentAt)
    const last = days.at(-1)
    if (last !== undefined && (date === null || date === last.date)) last.messages.push(message)
    else days.push({ date: date ?? '', messages: [message] })
  }
  return days
}

/** 아바타 글자 — 이름의 첫 글자, 채널은 `#` (디자인 시스템 §6: 이름 1~2자, 회색 원) */
export function avatarText(name: string, kind: MessageThreadKind): string {
  if (kind === 'channel') return '#'
  return Array.from(name.trim())[0] ?? '?'
}
