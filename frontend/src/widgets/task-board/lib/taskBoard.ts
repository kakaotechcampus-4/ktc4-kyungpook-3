import type { Approval } from '@/entities/approval'
import type { Task, TaskStatus, TaskTab } from '@/entities/task'
import { filterByTab, isDueSoon, isOverdue } from '@/entities/task'
import { soonUntil } from '@/shared/lib/date'
import { parseEnumParam } from '@/shared/lib/url'
import { sortApprovals, sortTasks } from './taskSort'
import type { TaskSort } from './taskSort'

/*
 * 태스크 목록의 조립 (계획 §3-2 ~ §3-4). 대기 승인과 태스크 두 엔티티를 잇는 자리라 widget 에 있다.
 * 목록과 탭 개수는 같은 함수(`selectTab`)로 만든다 — 개수와 목록이 어긋날 수 없다. 정렬은 고른 탭의 목록에만 한다.
 */

/** URL 의 검색 파라미터 이름. 탭 값은 기존 TaskTab 그대로다 */
export const BOARD_PARAMS = { tab: 'tab', due: 'due' } as const

/**
 * 마감 조건 (D-046, D-176). 날짜 둘과 상태 하나 — `overdue` 기한 지남, `soon` 서울 오늘부터 6일 뒤까지(오늘 포함 7개 날짜),
 * `blocked` 막힘. D-046 의 조합을 `due=overdue,soon` 으로 쓴다. 이 순서가 URL 에 쓰는 순서다 — 새 조건은 끝에 붙인다
 */
export const DUE_CONDITIONS = ['overdue', 'soon', 'blocked'] as const
export type DueCondition = (typeof DUE_CONDITIONS)[number]

// 날짜 계산은 대시보드(M7)와 함께 쓰려고 shared/lib/date 로 옮겼다. 기존 import 경로는 그대로 둔다
export { SOON_LAST_DAY_OFFSET, addDays, soonUntil } from '@/shared/lib/date'

const PM_TABS = ['all', 'needs_review', 'in_progress', 'done'] as const satisfies readonly TaskTab[]
const MEMBER_TABS = ['all', 'in_progress', 'done'] as const satisfies readonly TaskTab[]

/** 역할이 볼 수 있는 탭. 일반 팀원에게는 확인 필요가 없다 (D-104, D-163) */
export function boardTabs(isPm: boolean): readonly TaskTab[] {
  return isPm ? PM_TABS : MEMBER_TABS
}

export interface BoardQuery {
  tab: TaskTab
  /** 고른 마감 조건. DUE_CONDITIONS 순서로 중복 없이 담는다. 비었으면 조건 없음 */
  due: readonly DueCondition[]
}

/**
 * URL 검색 파라미터를 목록 조건으로 읽는다. 역할이 볼 수 없는 탭·모르는 값은 `전체` 다.
 * 마감 조건은 쉼표로 나눈 값 중 아는 것만 받는다 — 순서·중복과 무관하게 같은 조건이다
 */
export function readBoardQuery(params: URLSearchParams, isPm: boolean): BoardQuery {
  const tab = parseEnumParam(params.get(BOARD_PARAMS.tab) ?? undefined, boardTabs(isPm)) ?? 'all'
  const raw = new Set((params.get(BOARD_PARAMS.due) ?? '').split(','))
  return { tab, due: DUE_CONDITIONS.filter((condition) => raw.has(condition)) }
}

/**
 * 목록 조건을 검색 문자열로 쓴다. `전체` 탭과 빈 마감 조건은 적지 않는다 — 해제하면 파라미터가 사라진다.
 * 다른 파라미터는 그대로 둔다. 마감 조건의 쉼표는 인코딩하지 않는다(`due=overdue,soon`)
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

/** 조건마다 맞는 태스크. Record 라 조건을 더하면 여기를 채워야 빌드된다 */
const DUE_MATCH: Record<DueCondition, (task: Task, today: string) => boolean> = {
  overdue: (task, today) => isOverdue(task, today),
  soon: (task, today) => isDueSoon(task, today, soonUntil(today)),
  blocked: (task) => task.status === 'blocked',
}

/**
 * 마감 조건에 맞는 태스크인가. 조건이 없으면 모두 맞다. 고른 조건 중 하나라도 맞으면 맞다(OR).
 * 완료 태스크는 어느 조건에도 맞지 않는다 — 날짜 조건은 isOverdue·isDueSoon 이 미완료·마감 있는 태스크만 보고,
 * `blocked` 는 상태라 완료일 수 없다
 */
export function matchesDue(task: Task, due: readonly DueCondition[], today: string): boolean {
  return due.length === 0 || due.some((condition) => DUE_MATCH[condition](task, today))
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
  /** 승인·태스크 각 묶음의 순서. 탭 개수는 이 값과 무관하다 */
  sort: TaskSort
}

/**
 * 한 탭에 드는 승인과 태스크, 받은 순서 그대로. 마감 조건은 태스크에만 걸고 승인에는 걸지 않는다.
 * - 전체: 대기 승인과 태스크
 * - 확인 필요: 대기 승인만
 * - 진행 중(todo·in_progress·blocked)·완료: 태스크만 (filterByTab)
 */
function selectTab(input: BoardInput, tab: TaskTab): { approvals: Approval[]; tasks: Task[] } {
  const approvals = input.approvals?.filter(({ status }) => status === 'pending') ?? []
  const tasks = input.tasks.filter((task) => matchesDue(task, input.due, input.today))
  switch (tab) {
    case 'all':
      return { approvals, tasks }
    case 'needs_review':
      return { approvals, tasks: [] }
    case 'in_progress':
    case 'done':
      return { approvals: [], tasks: filterByTab(tasks, tab) }
  }
}

/** 한 탭의 항목. 대기 승인 다음 태스크이고, 두 묶음은 섞지 않고 각각 `input.sort` 로 정렬한다 */
export function boardItems(input: BoardInput, tab: TaskTab): BoardItem[] {
  const { approvals, tasks } = selectTab(input, tab)
  return [
    ...sortApprovals(approvals, input.sort).map((approval): BoardItem => ({
      kind: 'approval',
      approval,
    })),
    ...sortTasks(tasks, input.sort).map((task): BoardItem => ({ kind: 'task', task })),
  ]
}

export interface TaskBoard {
  /** 역할이 볼 수 있는 탭과 그 탭의 항목 수 */
  tabs: { tab: TaskTab; count: number }[]
  items: BoardItem[]
}

/** 고른 탭의 목록과 모든 탭의 개수. 개수는 각 탭의 `selectTab` 길이다 — 정렬하지 않고 센다 */
export function buildTaskBoard(input: BoardInput, isPm: boolean, tab: TaskTab): TaskBoard {
  const board = isPm ? input : { ...input, approvals: null }
  const count = (each: TaskTab) => {
    const { approvals, tasks } = selectTab(board, each)
    return approvals.length + tasks.length
  }
  return {
    tabs: boardTabs(isPm).map((each) => ({ tab: each, count: count(each) })),
    items: boardItems(board, boardTabs(isPm).includes(tab) ? tab : 'all'),
  }
}
