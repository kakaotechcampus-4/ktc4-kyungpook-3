import type { Approval, TaskCreateApproval } from '@/entities/approval'
import type { Member } from '@/entities/member'
import type { Task } from '@/entities/task'
import { isDueSoon, isOverdue } from '@/entities/task'
import { isDateOnly } from '@/shared/lib/date'
import { parseEnumParam } from '@/shared/lib/url'
import { addDays, soonUntil } from './taskBoard'

/*
 * 태스크 화면의 보기 전환 (Tasks · TasksBoard · TasksCalendar · TasksGantt 시안).
 * 보기·담당자·기간은 탭·날짜 조건과 같은 URL 에 둔다 — 새로고침·뒤로가기가 그대로 되살린다.
 * 탭·날짜 조건은 `boardSearch` 가, 이 파라미터는 `viewSearch` 가 쓴다. 서로의 파라미터는 건드리지 않는다.
 */

export const TASK_VIEWS = ['list', 'board', 'calendar', 'gantt'] as const
export type TaskView = (typeof TASK_VIEWS)[number]

export const VIEW_PARAMS = {
  view: 'view',
  assignee: 'assignee',
  month: 'month',
  from: 'from',
  period: 'period',
} as const

export const BOARD_PERIODS = ['all', 'month'] as const
export type BoardPeriod = (typeof BOARD_PERIODS)[number]

export interface ViewQuery {
  view: TaskView
  /** 담당자 팀원 ID. null 이면 담당자 전체 */
  assignee: string | null
  /** 캘린더의 달 `YYYY-MM`. null 이면 서울 오늘의 달 */
  month: string | null
  /** 간트 창의 시작 날짜. null 이면 서울 오늘이 든 주의 월요일 */
  from: string | null
  /** 보드의 기간. `month` 는 이번 달 마감만 본다 */
  period: BoardPeriod
}

export const DEFAULT_VIEW_QUERY: ViewQuery = {
  view: 'list',
  assignee: null,
  month: null,
  from: null,
  period: 'all',
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/** URL 에서 보기 조건을 읽는다. 모르는 값은 기본값이다 */
export function readViewQuery(params: URLSearchParams): ViewQuery {
  const month = params.get(VIEW_PARAMS.month)
  const from = params.get(VIEW_PARAMS.from)
  const assignee = params.get(VIEW_PARAMS.assignee)
  return {
    view: parseEnumParam(params.get(VIEW_PARAMS.view) ?? undefined, TASK_VIEWS) ?? 'list',
    assignee: assignee === null || assignee === '' ? null : assignee,
    month: month !== null && MONTH_PATTERN.test(month) ? month : null,
    from: from !== null && isDateOnly(from) ? from : null,
    period: parseEnumParam(params.get(VIEW_PARAMS.period) ?? undefined, BOARD_PERIODS) ?? 'all',
  }
}

/** 보기 조건을 검색 문자열로 쓴다. 기본값은 적지 않고, 다른 파라미터(탭·날짜 조건 포함)는 그대로 둔다 */
export function viewSearch(current: URLSearchParams, next: ViewQuery): string {
  const rest = new URLSearchParams(current)
  for (const key of Object.values(VIEW_PARAMS)) rest.delete(key)
  if (next.view !== 'list') rest.set(VIEW_PARAMS.view, next.view)
  if (next.assignee !== null) rest.set(VIEW_PARAMS.assignee, next.assignee)
  if (next.month !== null) rest.set(VIEW_PARAMS.month, next.month)
  if (next.from !== null) rest.set(VIEW_PARAMS.from, next.from)
  if (next.period !== 'all') rest.set(VIEW_PARAMS.period, next.period)
  const search = rest.toString().replace(/%2C/g, ',')
  return search === '' ? '' : `?${search}`
}

/* ---------- 태스크 분류 ---------- */

/**
 * 한 태스크의 색 구분.
 * - `done` 완료
 * - `danger` 위험 — 막혔거나 기한이 지났다
 * - `warn` 주의 — 오늘부터 7일 안에 마감한다
 * - `active` 진행 중, `todo` 시작 전
 */
export type TaskTone = 'done' | 'danger' | 'warn' | 'active' | 'todo'

export function taskTone(task: Task, today: string): TaskTone {
  if (task.status === 'done') return 'done'
  if (task.status === 'blocked' || isOverdue(task, today)) return 'danger'
  if (isDueSoon(task, today, soonUntil(today))) return 'warn'
  return task.status === 'in_progress' ? 'active' : 'todo'
}

/** 담당자로 거른다. 담당자를 고르지 않았으면 모두 맞다 */
export function filterTasksByAssignee(tasks: readonly Task[], assignee: string | null): Task[] {
  return assignee === null ? [...tasks] : tasks.filter((task) => task.assigneeMemberId === assignee)
}

export function filterApprovalsByAssignee(
  approvals: readonly Approval[],
  assignee: string | null,
): Approval[] {
  if (assignee === null) return [...approvals]
  return approvals.filter(
    (approval) => approval.kind === 'task_create' && approval.assigneeMemberId === assignee,
  )
}

export function createApprovals(approvals: readonly Approval[]): TaskCreateApproval[] {
  return approvals.flatMap((approval) => (approval.kind === 'task_create' ? [approval] : []))
}

/* ---------- 날짜 ---------- */

/** `2026-09-17` → `09/17` */
export function shortDate(date: string): string {
  return date.slice(5).replace('-', '/')
}

/** 날짜의 달 `YYYY-MM` */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function addMonths(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number)
  const index = year * 12 + (mon - 1) + delta
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** `2026-09` → `2026년 9월` */
export function monthTitle(month: string): string {
  const [year, mon] = month.split('-').map(Number)
  return `${year}년 ${mon}월`
}

function weekday(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export interface CalendarCell {
  date: string
  /** 보는 달에 속한 날이다. 앞뒤 달의 날은 흐리게 그린다 */
  inMonth: boolean
}

/** 일요일부터 시작하는 6주 격자. 시안과 같다 */
export function calendarGrid(month: string): CalendarCell[] {
  const first = `${month}-01`
  const start = addDays(first, -weekday(first))
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index)
    return { date, inMonth: monthOf(date) === month }
  })
}

/** 날짜가 든 주의 월요일 */
export function mondayOf(date: string): string {
  return addDays(date, -((weekday(date) + 6) % 7))
}

export const GANTT_DAYS = 21

/** 간트 창의 날짜 21일 */
export function ganttDays(from: string): string[] {
  return Array.from({ length: GANTT_DAYS }, (_, index) => addDays(from, index))
}

/** 날짜 사이 일수. `to - from` */
export function daysBetween(from: string, to: string): number {
  const parse = (date: string) => {
    const [year, month, day] = date.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((parse(to) - parse(from)) / 86_400_000)
}

/** 월요일이 든 달의 몇째 주 — 그 달 1일이 든 주가 1주다 (월요일 시작) */
export function weekOfMonth(monday: string): number {
  const firstOffset = (weekday(`${monday.slice(0, 7)}-01`) + 6) % 7
  return Math.ceil((Number(monday.slice(8, 10)) + firstOffset) / 7)
}

/** 간트 창 제목 — `9월 2주 – 4주` */
export function ganttTitle(from: string): string {
  const last = addDays(from, 14)
  const startMonth = Number(from.slice(5, 7))
  const endMonth = Number(last.slice(5, 7))
  const startWeek = weekOfMonth(from)
  const endWeek = weekOfMonth(last)
  return startMonth === endMonth
    ? `${startMonth}월 ${startWeek}주 – ${endWeek}주`
    : `${startMonth}월 ${startWeek}주 – ${endMonth}월 ${endWeek}주`
}

export function memberNames(members: readonly Member[] | undefined): Map<string, string> {
  return new Map((members ?? []).map(({ id, displayName }) => [id, displayName]))
}

export function assigneeOf(task: Task, names: ReadonlyMap<string, string>): string | null {
  return task.assigneeMemberId === null ? null : (names.get(task.assigneeMemberId) ?? null)
}
