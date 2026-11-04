import type { Approval } from '@/entities/approval'
import { sortByWaiting } from '@/entities/approval'
import type { Task } from '@/entities/task'

/*
 * 리스트·보드의 정렬 (D-175). 정렬마다 무엇을 어떤 순서로 둘지는 아래 표 하나가 정한다 — 리스트·보드는 비교 함수를 직접 쓰지 않는다.
 * 정렬은 받은 목록 안에서만 한다(D-166). 조회 조건·쿼리 키는 정렬과 무관하다.
 */

/** URL `sort` 값. 순서가 메뉴 순서다 */
export const TASK_SORTS = ['due', 'created', 'updated'] as const
export type TaskSort = (typeof TASK_SORTS)[number]

type Sorter<T> = (list: readonly T[]) => T[]

interface SortRule {
  label: string
  /** 리스트의 태스크, 보드의 시작 전·진행 중 칸 */
  tasks: Sorter<Task>
  /** 리스트의 확인 필요 승인 */
  approvals: Sorter<Approval>
  /** 보드의 완료 칸과 그 칸 머리 문구 */
  doneColumn: { sort: Sorter<Task>; note: string }
}

const sorted =
  <T>(compare: (a: T, b: T) => number): Sorter<T> =>
  (list) =>
    [...list].sort(compare)

const newestCreated = <T extends { createdAt: string }>(a: T, b: T): number =>
  Date.parse(b.createdAt) - Date.parse(a.createdAt)

/** 마감 오름차순, 마감 없는 항목은 마지막, 같은 마감은 생성 시각 내림차순 */
const dueFirst = (a: Task, b: Task): number => {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1
    if (b.dueDate === null) return -1
    return a.dueDate < b.dueDate ? -1 : 1
  }
  return newestCreated(a, b)
}

const latestUpdated = (a: Task, b: Task): number =>
  Date.parse(b.updatedAt) - Date.parse(a.updatedAt)

// 변경 시각이 같은 태스크가 흔하다(일괄 반영·픽스처). 같으면 생성 시각, 그것도 같으면 받은 순서다
const recentlyUpdated = (a: Task, b: Task): number => latestUpdated(a, b) || newestCreated(a, b)

const RULES: Record<TaskSort, SortRule> = {
  due: {
    label: '마감 빠른 순',
    tasks: sorted(dueFirst),
    // 승인은 마감이 없는 종류가 많아 지금 규칙(대기 시작 오래된 순)을 그대로 둔다
    approvals: sortByWaiting,
    // 지금 보드의 완료 칸 순서 그대로다 — 같은 변경 시각은 받은 순서
    doneColumn: { sort: sorted(latestUpdated), note: '최근 완료순' },
  },
  created: {
    label: '최근 생성순',
    tasks: sorted(newestCreated),
    approvals: sorted(newestCreated),
    doneColumn: { sort: sorted(newestCreated), note: '최근 생성순' },
  },
  updated: {
    label: '최근 변경순',
    tasks: sorted(recentlyUpdated),
    // 승인에는 변경 시각이 없어 생성 시각으로 둔다 (D-175)
    approvals: sorted(newestCreated),
    doneColumn: { sort: sorted(recentlyUpdated), note: '최근 변경순' },
  },
}

export function sortLabel(sort: TaskSort): string {
  return RULES[sort].label
}

/** 새 배열을 돌려준다. 아래 함수 모두 같다 */
export function sortTasks(tasks: readonly Task[], sort: TaskSort): Task[] {
  return RULES[sort].tasks(tasks)
}

export function sortApprovals(approvals: readonly Approval[], sort: TaskSort): Approval[] {
  return RULES[sort].approvals(approvals)
}

export function sortDoneColumn(tasks: readonly Task[], sort: TaskSort): Task[] {
  return RULES[sort].doneColumn.sort(tasks)
}

export function doneColumnNote(sort: TaskSort): string {
  return RULES[sort].doneColumn.note
}
