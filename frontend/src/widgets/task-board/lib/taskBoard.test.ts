import { toApproval } from '@/entities/approval'
import type { Approval } from '@/entities/approval'
import { toTask } from '@/entities/task'
import type { Task, TaskTab } from '@/entities/task'
import { todayInSeoul } from '@/shared/lib/date'
import { MOCK_TODAY } from '@/shared/mock/fixtures/constants'
import { approvalFixtures } from '@/shared/mock/fixtures/approval'
import { taskFixtures } from '@/shared/mock/fixtures/task'
import {
  addDays,
  boardItems,
  boardSearch,
  boardTabs,
  buildTaskBoard,
  matchesDue,
  readBoardQuery,
  soonUntil,
  sortTasks,
  withPendingStatus,
} from './taskBoard'
import type { BoardInput, BoardItem, DueCondition } from './taskBoard'

/*
 * M6 S3 — 목록 조립의 공통 판정 (AC-02, AC-03). 화면 통합 테스트는 app/tasks.test.tsx 가 본다.
 * 픽스처: ws_01 의 태스크 10건(미완료 7 · 완료 3), 대기 승인 3건(ap_01 · ap_02 · ap_03), 서울 오늘 2026-09-18.
 */

const tasks = taskFixtures.map(toTask)
const approvals = approvalFixtures.map(toApproval)
const ids = (items: readonly BoardItem[]) =>
  items.map((item) => (item.kind === 'approval' ? item.approval.id : item.task.id))

function task(id: string, patch: Partial<Task> = {}): Task {
  return { ...tasks[0], id, title: id, ...patch }
}

function input(due: readonly DueCondition[] = [], pm = true): BoardInput {
  return { tasks, approvals: pm ? approvals : null, due, today: MOCK_TODAY }
}

describe('날짜 조건 — 서울 날짜 문자열로 판정한다', () => {
  const today = '2026-09-18'

  it.each([
    ['과거', '2026-09-17', 'todo', { overdue: true, soon: false }],
    ['오늘', '2026-09-18', 'todo', { overdue: false, soon: true }],
    ['오늘+6일(마지막 날)', '2026-09-24', 'in_progress', { overdue: false, soon: true }],
    ['오늘+7일', '2026-09-25', 'blocked', { overdue: false, soon: false }],
    ['마감 없음', null, 'todo', { overdue: false, soon: false }],
    ['완료(과거 마감)', '2026-09-10', 'done', { overdue: false, soon: false }],
    ['완료(오늘 마감)', '2026-09-18', 'done', { overdue: false, soon: false }],
  ] as const)('%s', (_, dueDate, status, expected) => {
    const subject = task('tk_x', { dueDate, status })
    expect(matchesDue(subject, ['overdue'], today)).toBe(expected.overdue)
    expect(matchesDue(subject, ['soon'], today)).toBe(expected.soon)
    expect(matchesDue(subject, ['overdue', 'soon'], today)).toBe(expected.overdue || expected.soon)
    // 조건이 없으면 모두 맞다
    expect(matchesDue(subject, [], today)).toBe(true)
  })

  it('soon 은 오늘 포함 7개 날짜다 — 오늘+6일까지', () => {
    expect(soonUntil(today)).toBe('2026-09-24')
    const days = Array.from({ length: 9 }, (_, offset) => addDays(today, offset - 1))
    expect(
      days.filter((dueDate) =>
        matchesDue(task('tk_x', { dueDate, status: 'todo' }), ['soon'], today),
      ),
    ).toEqual([
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
    ])
  })

  it('월·연 경계를 넘어 더한다', () => {
    expect(soonUntil('2026-09-28')).toBe('2026-10-04')
    expect(soonUntil('2026-12-29')).toBe('2027-01-04')
    expect(soonUntil('2028-02-25')).toBe('2028-03-02')
  })

  describe('실행 환경 시간대와 무관하다', () => {
    const original = process.env.TZ
    afterEach(() => {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    })

    it.each(['Pacific/Honolulu', 'Pacific/Kiritimati', 'America/Los_Angeles', 'Asia/Seoul'])(
      '%s 에서도 판정이 같다',
      (timeZone) => {
        process.env.TZ = timeZone
        expect(soonUntil(today)).toBe('2026-09-24')
        expect(ids(boardItems(input(['overdue', 'soon']), 'in_progress'))).toEqual([
          'tk_07',
          'tk_02',
          'tk_06',
          'tk_01',
          'tk_03',
          'tk_04',
        ])
      },
    )

    it('오늘은 서울 날짜다 — UTC 자정 전후에도 서울 기준이다', () => {
      // 서울 2026-09-18 00:00 은 UTC 2026-09-17 15:00
      expect(todayInSeoul(new Date('2026-09-17T15:00:00Z'))).toBe('2026-09-18')
      expect(todayInSeoul(new Date('2026-09-17T14:59:59Z'))).toBe('2026-09-17')
    })
  })
})

describe('정렬', () => {
  it('태스크는 마감 오름차순, 마감 없는 항목은 마지막, 같은 마감은 생성 시각 내림차순이다', () => {
    const sorted = sortTasks([
      task('none_old', { dueDate: null, createdAt: '2026-09-01T00:00:00Z' }),
      task('d20_old', { dueDate: '2026-09-20', createdAt: '2026-09-01T00:00:00Z' }),
      task('none_new', { dueDate: null, createdAt: '2026-09-10T00:00:00Z' }),
      task('d19', { dueDate: '2026-09-19', createdAt: '2026-09-01T00:00:00Z' }),
      task('d20_new', { dueDate: '2026-09-20', createdAt: '2026-09-05T00:00:00Z' }),
    ])
    expect(sorted.map(({ id }) => id)).toEqual([
      'd19',
      'd20_new',
      'd20_old',
      'none_new',
      'none_old',
    ])
  })

  it('PM 의 전체는 대기 승인(대기 시작 오래된 순)을 먼저, 그 다음 태스크다 — 서버 순서와 무관하다', () => {
    const reversed: BoardInput = { ...input(), approvals: [...approvals].reverse() }
    expect(ids(boardItems(reversed, 'all'))).toEqual([
      'ap_01',
      'ap_02',
      'ap_03',
      'tk_07',
      'tk_08',
      'tk_09',
      'tk_02',
      'tk_10',
      'tk_06',
      'tk_01',
      'tk_03',
      'tk_04',
      'tk_05',
    ])
  })

  it('대기가 아닌 승인은 목록에 넣지 않는다', () => {
    const closed: Approval[] = approvals.map((approval, index) =>
      index === 1 ? { ...approval, status: 'approved' } : approval,
    )
    expect(ids(boardItems({ ...input(), approvals: closed }, 'needs_review'))).toEqual([
      'ap_01',
      'ap_03',
    ])
  })
})

describe('역할별 탭과 개수', () => {
  it('PM 은 전체·확인 필요·진행 중·완료, 일반 팀원은 전체·진행 중·완료다', () => {
    expect(boardTabs(true)).toEqual(['all', 'needs_review', 'in_progress', 'done'])
    expect(boardTabs(false)).toEqual(['all', 'in_progress', 'done'])
  })

  it.each([
    ['PM · 조건 없음', true, [], { all: 13, needs_review: 3, in_progress: 7, done: 3 }],
    ['PM · 기한 지남', true, ['overdue'], { all: 5, needs_review: 3, in_progress: 2, done: 0 }],
    ['PM · 7일 안', true, ['soon'], { all: 7, needs_review: 3, in_progress: 4, done: 0 }],
    ['PM · 둘 다', true, ['overdue', 'soon'], { all: 9, needs_review: 3, in_progress: 6, done: 0 }],
    ['팀원 · 조건 없음', false, [], { all: 10, in_progress: 7, done: 3 }],
    ['팀원 · 둘 다', false, ['overdue', 'soon'], { all: 6, in_progress: 6, done: 0 }],
  ] as const)('%s', (_, isPm, due, expected) => {
    const board = buildTaskBoard(input(due, isPm), isPm, 'all')
    expect(Object.fromEntries(board.tabs.map(({ tab, count }) => [tab, count]))).toEqual(expected)
    // 탭 개수와 그 탭의 목록은 같은 판정이다
    for (const { tab, count } of board.tabs)
      expect(buildTaskBoard(input(due, isPm), isPm, tab).items).toHaveLength(count)
  })

  it('일반 팀원은 승인을 넘겨받아도 승인 항목·확인 필요 탭이 없다', () => {
    const board = buildTaskBoard(input([], true), false, 'needs_review')
    expect(board.tabs.map(({ tab }) => tab)).toEqual(['all', 'in_progress', 'done'])
    // 볼 수 없는 탭은 전체로 그린다
    expect(board.items.every((item) => item.kind === 'task')).toBe(true)
    expect(board.items).toHaveLength(10)
  })

  it('날짜 조건은 승인 항목에 걸지 않는다', () => {
    expect(ids(boardItems(input(['overdue']), 'all'))).toEqual([
      'ap_01',
      'ap_02',
      'ap_03',
      'tk_07',
      'tk_02',
    ])
  })

  it('진행 중 탭은 todo·in_progress·blocked 를 모두 담는다', () => {
    const statuses = (tab: TaskTab) =>
      new Set(
        boardItems(input(), tab).flatMap((item) =>
          item.kind === 'task' ? [item.task.status] : [],
        ),
      )
    expect(statuses('in_progress')).toEqual(new Set(['todo', 'in_progress', 'blocked']))
    expect(statuses('done')).toEqual(new Set(['done']))
  })

  it('진행 중인 상태 변경은 그 태스크에만 겹치고 탭 판정에도 쓰인다', () => {
    const pending = new Map([['tk_01', 'done' as const]])
    const shown = withPendingStatus(tasks, pending)
    expect(shown.find(({ id }) => id === 'tk_01')?.status).toBe('done')
    expect(
      shown.filter(({ id }, index) => id !== 'tk_01' && shown[index] !== tasks[index]),
    ).toEqual([])
    const board = buildTaskBoard({ ...input(), tasks: shown }, true, 'done')
    expect(ids(board.items)).toEqual(['tk_08', 'tk_09', 'tk_10', 'tk_01'])
    // 원본은 그대로다
    expect(tasks[0].status).toBe('in_progress')
  })
})

describe('URL 조건', () => {
  const read = (search: string, isPm = true) => readBoardQuery(new URLSearchParams(search), isPm)

  it('비었거나 모르는 값이면 전체·조건 없음이다', () => {
    expect(read('')).toEqual({ tab: 'all', due: [] })
    expect(read('?tab=board&due=later')).toEqual({ tab: 'all', due: [] })
  })

  it('기존 탭 값을 그대로 읽는다', () => {
    expect(read('?tab=needs_review').tab).toBe('needs_review')
    expect(read('?tab=in_progress').tab).toBe('in_progress')
    expect(read('?tab=done').tab).toBe('done')
  })

  it('일반 팀원의 확인 필요 탭은 전체다', () => {
    expect(read('?tab=needs_review', false).tab).toBe('all')
  })

  it('날짜 조건은 순서·중복·인코딩과 무관하다', () => {
    expect(read('?due=soon,overdue').due).toEqual(['overdue', 'soon'])
    expect(read('?due=overdue%2Csoon,soon').due).toEqual(['overdue', 'soon'])
    expect(read('?due=soon').due).toEqual(['soon'])
  })

  it('쓸 때는 전체·빈 조건을 빼고 쉼표를 그대로 둔다. 다른 파라미터는 남는다', () => {
    const current = new URLSearchParams('?keep=1&tab=done&due=soon')
    expect(boardSearch(current, { tab: 'in_progress', due: ['soon', 'overdue'] })).toBe(
      '?keep=1&tab=in_progress&due=overdue,soon',
    )
    expect(boardSearch(current, { tab: 'all', due: [] })).toBe('?keep=1')
    expect(boardSearch(new URLSearchParams(), { tab: 'all', due: [] })).toBe('')
    // 쓴 값을 다시 읽으면 같은 조건이다
    const written = boardSearch(new URLSearchParams(), { tab: 'done', due: ['overdue', 'soon'] })
    expect(read(written)).toEqual({ tab: 'done', due: ['overdue', 'soon'] })
  })
})
