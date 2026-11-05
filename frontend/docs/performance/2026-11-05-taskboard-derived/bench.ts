import { toApproval } from '@/entities/approval'
import type { Approval } from '@/entities/approval'
import { toMeetingSummary } from '@/entities/meeting'
import type { MeetingSummary } from '@/entities/meeting'
import { toMember } from '@/entities/member'
import type { Member } from '@/entities/member'
import { toTask } from '@/entities/task'
import type { Task, TaskStatus } from '@/entities/task'
import { addDays, seoulDateOf } from '@/shared/lib/date'
import { MOCK_TODAY } from '@/shared/mock/fixtures/constants'
import { approvalFixtures } from '@/shared/mock/fixtures/approval'
import { meetingSummaryFixtures } from '@/shared/mock/fixtures/meeting'
import { memberFixtures } from '@/shared/mock/fixtures/member'
import { taskFixtures } from '@/shared/mock/fixtures/task'
import { boardItems, buildTaskBoard, withPendingStatus } from '@/widgets/task-board/lib/taskBoard'
import type { DueCondition } from '@/widgets/task-board/lib/taskBoard'
import type { TaskSort } from '@/widgets/task-board/lib/taskSort'
import { createApprovals, filterTasksByAssignee, memberNames } from '@/widgets/task-board/lib/taskViews'
import type { TaskView } from '@/widgets/task-board/lib/taskViews'

export const SIZES = [50, 500, 2000] as const

function rng(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done']

export interface Data {
  tasks: Task[]
  approvals: Approval[]
  meetings: MeetingSummary[]
  members: Member[]
}

export function makeData(size: number): Data {
  const random = rng(size)
  const members = memberFixtures.map(toMember)
  const baseTask = toTask(taskFixtures[0])
  const tasks = Array.from({ length: size }, (_, index): Task => {
    const created = new Date(Date.UTC(2026, 6, 1) + Math.floor(random() * 80 * 86400000))
    return {
      ...baseTask,
      id: `tk_${index}`,
      title: `태스크 ${index}`,
      status: STATUSES[Math.floor(random() * STATUSES.length)],
      assigneeMemberId: random() < 0.1 ? null : members[index % members.length].id,
      dueDate: random() < 0.2 ? null : addDays(MOCK_TODAY, Math.floor(random() * 40) - 15),
      notionSyncStatus: random() < 0.5 ? 'synced' : null,
      createdAt: created.toISOString(),
      updatedAt: new Date(created.getTime() + Math.floor(random() * 5) * 3600000).toISOString(),
    }
  })
  const baseApprovals = approvalFixtures.map(toApproval)
  const approvals = Array.from({ length: Math.max(1, size / 10) }, (_, index): Approval => {
    const base = baseApprovals[index % baseApprovals.length]
    return { ...base, id: `ap_${index}`, status: 'pending', createdAt: tasks[index].createdAt }
  })
  const baseMeeting = toMeetingSummary(meetingSummaryFixtures[0])
  const meetings = Array.from({ length: Math.max(1, size / 5) }, (_, index): MeetingSummary => ({
    ...baseMeeting,
    id: `mt_${index}`,
    title: `회의 ${index}`,
    startedAt: tasks[index].createdAt,
  }))
  return { tasks, approvals, meetings, members }
}

export interface Query {
  due: readonly DueCondition[]
  sort: TaskSort
  assignee: string | null
}

export const QUERIES: Record<string, Query> = {
  plain: { due: [], sort: 'due', assignee: null },
  dueFilter: { due: ['overdue', 'soon'], sort: 'due', assignee: null },
}

const NO_PENDING = new Map<string, TaskStatus>()

const input = (data: Data, query: Query) => ({
  tasks: data.tasks,
  approvals: data.approvals,
  due: query.due,
  today: MOCK_TODAY,
  sort: query.sort,
})

/** TaskBoard 의 useMemo 하나씩. 이름은 TaskBoard.tsx 의 변수 이름이다 */
export const PIECES = {
  names: (data: Data) => memberNames(data.members),
  meetingTitles: (data: Data) => new Map(data.meetings.map(({ id, title }) => [id, title])),
  overlaid: (data: Data) => withPendingStatus(data.tasks, NO_PENDING),
  filtered: (data: Data, query: Query) => filterTasksByAssignee(data.tasks, query.assignee),
  board: (data: Data, query: Query) => buildTaskBoard(input(data, query), true, 'all'),
  createList: (data: Data) => createApprovals(data.approvals),
  calendarMeetings: (data: Data) =>
    data.meetings.flatMap(({ id, title, startedAt }) => {
      const date = seoulDateOf(startedAt)
      return date === null ? [] : [{ id, title, date }]
    }),
}
export type Piece = keyof typeof PIECES
export const ALL = Object.keys(PIECES) as Piece[]

/** 분해용: board 의 목록(정렬)만. board − boardItems ≈ 탭 개수 */
const EXTRA = {
  boardItems: (data: Data, query: Query) => boardItems(input(data, query), 'all'),
}

/** 보기가 실제로 읽는 파생값 (TaskBoard.tsx body·BoardTabs 분기) */
export const NEEDED: Record<TaskView, readonly Piece[]> = {
  list: ['names', 'meetingTitles', 'overlaid', 'filtered', 'board'],
  board: ['names', 'overlaid', 'filtered'],
  calendar: ['names', 'overlaid', 'createList', 'calendarMeetings'],
  gantt: ['names', 'overlaid', 'createList'],
}

let sink = 0
function sizeOf(value: unknown): number {
  if (value instanceof Map) return value.size
  if (Array.isArray(value)) return value.length
  const board = value as ReturnType<typeof buildTaskBoard>
  return board.items.length + board.tabs.reduce((sum, { count }) => sum + count, 0)
}

function timeBatch(fn: () => void, iterations: number): number {
  const start = performance.now()
  for (let index = 0; index < iterations; index += 1) fn()
  return ((performance.now() - start) * 1000) / iterations
}

function calibrate(fn: () => void, targetMs: number): number {
  for (let index = 0; index < 20; index += 1) fn()
  let iterations = 1
  while (timeBatch(fn, iterations) * iterations < targetMs * 1000) iterations *= 2
  return iterations
}

export interface Stat {
  median: number
  min: number
  max: number
  iterations: number
}

/** 라운드마다 순서를 뒤집어 번갈아 잰다. 값은 1회 계산의 µs */
export function measure(
  cases: Record<string, () => void>,
  rounds: number,
  targetMs: number,
): Record<string, Stat> {
  const entries = Object.entries(cases)
  const iterations = new Map(entries.map(([name, fn]) => [name, calibrate(fn, targetMs)]))
  const samples = new Map(entries.map(([name]) => [name, [] as number[]]))
  for (let round = 0; round < rounds; round += 1) {
    const order = round % 2 === 0 ? entries : [...entries].reverse()
    for (const [name, fn] of order) samples.get(name)!.push(timeBatch(fn, iterations.get(name)!))
  }
  return Object.fromEntries(
    entries.map(([name]) => {
      const sorted = [...samples.get(name)!].sort((a, b) => a - b)
      return [
        name,
        {
          median: sorted[Math.floor(sorted.length / 2)],
          min: sorted[0],
          max: sorted[sorted.length - 1],
          iterations: iterations.get(name)!,
        },
      ]
    }),
  )
}

export function run(rounds = 15, targetMs = 50) {
  const report: Record<string, unknown> = { rounds, targetMs }
  for (const size of SIZES) {
    const data = makeData(size)
    for (const [queryName, query] of Object.entries(QUERIES)) {
      const cases: Record<string, () => void> = {}
      const pieces = { ...PIECES, ...EXTRA }
      for (const [name, fn] of Object.entries(pieces))
        cases[`piece:${name}`] = () => {
          sink += sizeOf(fn(data, query))
        }
      for (const view of Object.keys(NEEDED) as TaskView[])
        cases[`view:${view}:needed`] = () => {
          for (const piece of NEEDED[view]) sink += sizeOf(PIECES[piece](data, query))
        }
      cases['view:*:current'] = () => {
        for (const piece of ALL) sink += sizeOf(PIECES[piece](data, query))
      }
      report[`${size}:${queryName}`] = {
        tasks: data.tasks.length,
        approvals: data.approvals.length,
        meetings: data.meetings.length,
        results: measure(cases, rounds, targetMs),
      }
    }
  }
  report.sink = sink
  return report
}
