import type { Approval } from '@/entities/approval'
import { sortByWaiting } from '@/entities/approval'
import type { Task, TaskStatus, TaskTab } from '@/entities/task'
import { filterByTab, isDueSoon, isOverdue } from '@/entities/task'
import { parseEnumParam } from '@/shared/lib/url'

/*
 * 태스크 목록의 조립 (계획 §3-2 ~ §3-4). 대기 승인과 태스크 두 엔티티를 잇는 자리라 widget 에 있다.
 * 목록과 탭 개수는 같은 함수(`boardItems`)로 만든다 — 개수와 목록이 어긋날 수 없다.
 */

/** URL 의 검색 파라미터 이름. 탭 값은 기존 TaskTab 그대로다 */
export const BOARD_PARAMS = { tab: 'tab', due: 'due' } as const

/** 날짜 조건. `overdue` 기한 지남, `soon` 서울 오늘부터 6일 뒤까지(오늘 포함 7개 날짜). D-046 의 조합을 `due=overdue,soon` 으로 쓴다 */
export type DueCondition = 'overdue' | 'soon'
export const DUE_CONDITIONS = ['overdue', 'soon'] as const satisfies readonly DueCondition[]

/** `soon` 의 마지막 날은 오늘에서 며칠 뒤인가. 오늘 포함 7개 날짜라 6이다 */
export const SOON_LAST_DAY_OFFSET = 6

const PM_TABS = ['all', 'needs_review', 'in_progress', 'done'] as const satisfies readonly TaskTab[]
const MEMBER_TABS = ['all', 'in_progress', 'done'] as const satisfies readonly TaskTab[]

/** 역할이 볼 수 있는 탭. 일반 팀원에게는 확인 필요가 없다 (D-104, D-163) */
export function boardTabs(isPm: boolean): readonly TaskTab[] {
  return isPm ? PM_TABS : MEMBER_TABS
}

export interface BoardQuery {
  tab: TaskTab
  /** 고른 날짜 조건. DUE_CONDITIONS 순서로 중복 없이 담는다. 비었으면 조건 없음 */
  due: readonly DueCondition[]
}

/**
 * URL 검색 파라미터를 목록 조건으로 읽는다. 역할이 볼 수 없는 탭·모르는 값은 `전체` 다.
 * 날짜 조건은 쉼표로 나눈 값 중 아는 것만 받는다 — 순서·중복과 무관하게 같은 조건이다
 */
export function readBoardQuery(params: URLSearchParams, isPm: boolean): BoardQuery {
  const tab = parseEnumParam(params.get(BOARD_PARAMS.tab) ?? undefined, boardTabs(isPm)) ?? 'all'
  const raw = new Set((params.get(BOARD_PARAMS.due) ?? '').split(','))
  return { tab, due: DUE_CONDITIONS.filter((condition) => raw.has(condition)) }
}

/**
 * 목록 조건을 검색 문자열로 쓴다. `전체` 탭과 빈 날짜 조건은 적지 않는다 — 해제하면 파라미터가 사라진다.
 * 다른 파라미터는 그대로 둔다. 날짜 조건의 쉼표는 인코딩하지 않는다(`due=overdue,soon`)
 */
export function boardSearch(current: URLSearchParams, next: BoardQuery): string {
  const rest = new URLSearchParams(current)
  rest.delete(BOARD_PARAMS.tab)
  rest.delete(BOARD_PARAMS.due)
  const parts = [rest.toString()]
  if (next.tab !== 'all') parts.push(`${BOARD_PARAMS.tab}=${next.tab}`)
  const due = DUE_CONDITIONS.filter((condition) => next.due.includes(condition))
  if (due.length > 0) parts.push(`${BOARD_PARAMS.due}=${due.join(',')}`)
  const search = parts.filter(Boolean).join('&')
  return search === '' ? '' : `?${search}`
}

/**
 * 날짜 전용 값에 날짜를 더한다. UTC 자정으로만 계산해 실행 환경 시간대와 무관하다 —
 * 서울 날짜 문자열을 받아 서울 날짜 문자열을 돌려준다 (D-144)
 */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/** `soon` 의 마지막 날 — 서울 오늘 + 6일 */
export function soonUntil(today: string): string {
  return addDays(today, SOON_LAST_DAY_OFFSET)
}

/**
 * 날짜 조건에 맞는 태스크인가. 조건이 없으면 모두 맞다. 조건이 있으면 미완료이면서 고른 조건 중 하나에 맞아야 한다 —
 * 완료 태스크와 마감 없는 태스크는 어느 조건에도 맞지 않는다 (isOverdue·isDueSoon)
 */
export function matchesDue(task: Task, due: readonly DueCondition[], today: string): boolean {
  if (due.length === 0) return true
  return (
    (due.includes('overdue') && isOverdue(task, today)) ||
    (due.includes('soon') && isDueSoon(task, today, soonUntil(today)))
  )
}

/** 마감 오름차순, 마감 없는 항목은 마지막, 같은 마감은 생성 시각 내림차순. 새 배열을 돌려준다 */
export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.dueDate !== b.dueDate) {
      if (a.dueDate === null) return 1
      if (b.dueDate === null) return -1
      return a.dueDate < b.dueDate ? -1 : 1
    }
    return Date.parse(b.createdAt) - Date.parse(a.createdAt)
  })
}

/** 진행 중인 상태 변경을 겹친다. 겹칠 것이 없는 태스크는 그대로다 */
export function withPendingStatus(
  tasks: readonly Task[],
  pending: ReadonlyMap<string, TaskStatus>,
): Task[] {
  return tasks.map((task) => {
    const status = pending.get(task.id)
    return status === undefined || status === task.status ? task : { ...task, status }
  })
}

export type BoardItem = { kind: 'approval'; approval: Approval } | { kind: 'task'; task: Task }

export interface BoardInput {
  tasks: readonly Task[]
  /** 대기 승인. 일반 팀원이면 null — 승인 목록을 부르지 않는다 */
  approvals: readonly Approval[] | null
  due: readonly DueCondition[]
  /** 서울 오늘 (`todayInSeoul`) */
  today: string
}

/**
 * 한 탭의 항목. 날짜 조건은 태스크에만 걸고 승인에는 걸지 않는다.
 * - 전체: 대기 승인(대기 시작 오래된 순) 다음 태스크
 * - 확인 필요: 대기 승인만
 * - 진행 중(todo·in_progress·blocked)·완료: 태스크만 (filterByTab)
 */
export function boardItems(input: BoardInput, tab: TaskTab): BoardItem[] {
  const approvals: BoardItem[] =
    input.approvals === null
      ? []
      : sortByWaiting(input.approvals.filter(({ status }) => status === 'pending')).map(
          (approval) => ({ kind: 'approval', approval }),
        )
  const tasks = sortTasks(input.tasks.filter((task) => matchesDue(task, input.due, input.today)))
  const asItems = (list: readonly Task[]): BoardItem[] =>
    list.map((task) => ({ kind: 'task', task }))
  switch (tab) {
    case 'all':
      return [...approvals, ...asItems(tasks)]
    case 'needs_review':
      return approvals
    case 'in_progress':
    case 'done':
      return asItems(filterByTab(tasks, tab))
  }
}

export interface TaskBoard {
  /** 역할이 볼 수 있는 탭과 그 탭의 항목 수 */
  tabs: { tab: TaskTab; count: number }[]
  items: BoardItem[]
}

/** 고른 탭의 목록과 모든 탭의 개수. 개수는 각 탭의 `boardItems` 길이다 */
export function buildTaskBoard(input: BoardInput, isPm: boolean, tab: TaskTab): TaskBoard {
  const board = isPm ? input : { ...input, approvals: null }
  return {
    tabs: boardTabs(isPm).map((each) => ({ tab: each, count: boardItems(board, each).length })),
    items: boardItems(board, boardTabs(isPm).includes(tab) ? tab : 'all'),
  }
}
