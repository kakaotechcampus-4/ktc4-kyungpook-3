import type { Approval, TaskCreateApproval } from '@/entities/approval'
import type { Member } from '@/entities/member'
import type { Task } from '@/entities/task'
import { isDueSoon, isOverdue } from '@/entities/task'
import { addDays, isDateOnly, soonUntil } from '@/shared/lib/date'
import { parseEnumParam } from '@/shared/lib/url'
import { TASK_SORTS } from './taskSort'
import type { TaskSort } from './taskSort'

/*
 * 태스크 화면의 보기 전환 (Tasks · TasksBoard · TasksCalendar · TasksGantt 시안).
 * 보기·담당자·기간·정렬은 탭·날짜 조건과 같은 URL 에 둔다 — 새로고침·뒤로가기가 그대로 되살린다.
 * 탭·날짜 조건은 `boardSearch` 가, 이 파라미터는 `viewSearch` 가 쓴다. 서로의 파라미터는 건드리지 않는다.
 */

export const TASK_VIEWS = ['list', 'board', 'calendar', 'gantt'] as const
export type TaskView = (typeof TASK_VIEWS)[number]

export const VIEW_LABEL: Record<TaskView, string> = {
  list: '리스트',
  board: '보드',
  calendar: '캘린더',
  gantt: '간트',
}

export const VIEW_PARAMS = {
  view: 'view',
  assignee: 'assignee',
  month: 'month',
  from: 'from',
  period: 'period',
  sort: 'sort',
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
  /** 리스트·보드의 순서. 캘린더·간트는 쓰지 않고 URL 에 그대로 둔다 */
  sort: TaskSort
}

export const DEFAULT_VIEW_QUERY: ViewQuery = {
  view: 'list',
  assignee: null,
  month: null,
  from: null,
  period: 'all',
  sort: 'due',
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
    sort:
      parseEnumParam(params.get(VIEW_PARAMS.sort) ?? undefined, TASK_SORTS) ??
      DEFAULT_VIEW_QUERY.sort,
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
  if (next.sort !== DEFAULT_VIEW_QUERY.sort) rest.set(VIEW_PARAMS.sort, next.sort)
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

/** 보드 카드의 배지. `taskTone` 의 위험(막힘 또는 기한 지남)을 원인별로 나눈다 */
export type CardBadge = 'blocked' | 'danger' | 'warn'

/**
 * 보드 카드에 붙는 배지 (D-175). 막혔으면 `막힘`, 기한도 지났으면 `위험` 을 함께 단다.
 * 막힌 태스크에는 `주의` 를 달지 않는다 — 위험이 주의보다 앞서던 지금 규칙 그대로다.
 * 캘린더·간트는 `taskTone` 을 그대로 쓴다 (막힘도 위험)
 */
export function cardBadges(task: Task, today: string): readonly CardBadge[] {
  if (task.status === 'done') return []
  if (task.status === 'blocked') return isOverdue(task, today) ? ['blocked', 'danger'] : ['blocked']
  const tone = taskTone(task, today)
  return tone === 'danger' || tone === 'warn' ? [tone] : []
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

/**
 * 일요일부터 시작하는 격자. 그 달의 날이 든 주만 그린다 — 2026-09 는 5주(시안), 2026-08 은 6주다.
 * 다음 달 날만 있는 주는 그리지 않는다
 */
export function calendarGrid(month: string): CalendarCell[] {
  const first = `${month}-01`
  const lead = weekday(first)
  const days = daysBetween(first, `${addMonths(month, 1)}-01`)
  const start = addDays(first, -lead)
  return Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, index) => {
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

/**
 * 담당자 표시 문구. 담당자가 없으면 `none`, 팀원 목록에서 찾지 못하면(팀원 조회 실패 포함) `알 수 없는 담당자`다 —
 * 받지 못한 이름을 `담당자 없음` 으로 쓰지 않는다 (AC-A-05). 리스트 행과 같은 문구다
 */
export function assigneeLabel(
  memberId: string | null,
  names: ReadonlyMap<string, string>,
  none = '담당자 없음',
): string {
  return memberId === null ? none : (names.get(memberId) ?? '알 수 없는 담당자')
}

/* ---------- 조회 상태 ---------- */

/**
 * 조회 하나를 화면 상태로 읽는다. widgets/dashboard 의 `queryView` 와 같은 판정이다 — 위젯끼리는 서로 가져다 쓰지 않아
 * 여기 따로 둔다. #236 에서 shared 로 옮겨지면 그쪽으로 바꾼다.
 * - `loading` 데이터도 오류도 아직 없다 · `error` 처음부터 받지 못했다
 * - `ready` 마지막 조회가 성공했다 · `refreshFailed` 데이터는 있으나 마지막 재조회가 실패했다
 */
export type QueryView = 'loading' | 'error' | 'ready' | 'refreshFailed'

export function queryView({ data, error }: { data: unknown; error: unknown }): QueryView {
  const failed = error !== null && error !== undefined
  if (data !== undefined) return failed ? 'refreshFailed' : 'ready'
  return failed ? 'error' : 'loading'
}
