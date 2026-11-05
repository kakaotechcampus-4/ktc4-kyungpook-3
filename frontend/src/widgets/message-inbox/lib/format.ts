import type { Bundle, BundleTask, DmFailureReason } from '@/entities/message'
import { nudgeSendAt } from '@/entities/message-settings'
import type { NudgeRule } from '@/entities/message-settings'
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

/** 마감일 `YYYY-MM-DD` 를 `09/24` 로 */
function dueLabel(date: string): string {
  return date.slice(5).replace('-', '/')
}

/** 서울 날짜 `YYYY-MM-DD` 둘 사이의 날 수. 날짜 문자열만으로 계산해 실행 환경 시간대와 무관하다 */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** 묶음의 태스크 중 가장 이른 마감일. 없으면 null */
export function earliestDue(tasks: readonly BundleTask[]): string | null {
  return tasks.reduce<string | null>(
    (earliest, { dueDate }) =>
      dueDate !== null && (earliest === null || dueDate < earliest) ? dueDate : earliest,
    null,
  )
}

/** 마감 기준 선택지 — 가장 이른 마감에 공간의 재촉 규칙(며칠 전 몇 시, 한국 시간)을 적용한 시각. 마감이 없거나 그 시각이 지났으면 고를 수 없다 */
export type DeadlineSend =
  { status: 'none' } | { status: 'open'; at: string } | { status: 'passed'; at: string }

export function deadlineSend(
  tasks: readonly BundleTask[],
  rule: NudgeRule,
  now: number,
): DeadlineSend {
  const due = earliestDue(tasks)
  if (due === null) return { status: 'none' }
  const at = nudgeSendAt(due, rule)
  return Date.parse(at) <= now ? { status: 'passed', at } : { status: 'open', at }
}

/** 같은 순간인가. 서버는 UTC 로, 화면은 +09:00 으로 쓴다 */
export function sameInstant(left: string, right: string): boolean {
  return Date.parse(left) === Date.parse(right)
}

/** 보내기 전 확인 행의 오른쪽 글자 — 승인했으면 `09/23 발송 예정`, 아니면 가장 이른 마감 `09/24 마감`, 마감이 없으면 `09/19 예정` */
export function bundleDateLabel(bundle: Bundle): string {
  if (bundle.stage === 'approved') return `${shortDate(bundle.scheduledAt)} 발송 예정`
  const due = earliestDue(bundle.tasks)
  return due === null ? `${shortDate(bundle.scheduledAt)} 예정` : `${dueLabel(due)} 마감`
}

/** 태스크가 지워져 제목이 없을 때 */
const DELETED_TASK = '지워진 태스크'

export function taskTitle(task: BundleTask): string {
  return task.title ?? DELETED_TASK
}

/** 보내기 전 확인 행의 한 줄 — `API 명세서`, 여럿이면 `퍼블리싱 외 1건` */
export function bundleSummary(bundle: Bundle): string {
  const [first, ...rest] = bundle.tasks
  if (first === undefined) return ''
  return rest.length === 0 ? taskTitle(first) : `${taskTitle(first)} 외 ${String(rest.length)}건`
}

/** 태스크 한 줄의 마감 — `09/24 마감`, 없으면 `마감 없음` */
export function taskDueLabel(task: BundleTask): string {
  return task.dueDate === null ? '마감 없음' : `${dueLabel(task.dueDate)} 마감`
}

/** DM 을 보내지 못한 이유 (계약 §5.7) */
export const DM_FAILURE_TEXT: Record<DmFailureReason, string> = {
  dm_blocked: '서버 DM이 막혀 있어요',
  discord_not_linked: 'Discord 계정이 연결되지 않았어요',
  unknown: '이유를 알 수 없어요',
}

/** 답장이 없는 지 며칠째인가. 보낸 날이 1일째다 — 9/16 에 보냈으면 9/18 은 3일째 (MessagesThread 시안 `답장 3일째 없음`) */
export function awaitingDays(since: string, today: string): number {
  const date = seoulDateOf(since)
  return date === null ? 1 : Math.max(1, daysBetween(date, today) + 1)
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

/** 아바타 글자 — 이름의 첫 글자 (디자인 시스템 §6: 이름 1~2자, 회색 원) */
export function avatarText(name: string): string {
  return Array.from(name.trim())[0] ?? '?'
}
