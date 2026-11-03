import { describe, expect, it } from 'vitest'
import { toTask } from '@/entities/task'
import type { Task } from '@/entities/task'
import { taskFixtures } from '@/shared/mock/fixtures/task'
import {
  addMonths,
  calendarGrid,
  cardBadges,
  daysBetween,
  ganttTitle,
  mondayOf,
  readViewQuery,
  taskTone,
  viewSearch,
  weekOfMonth,
} from './taskViews'

const read = (search: string) => readViewQuery(new URLSearchParams(search))

describe('보기 조건 URL', () => {
  it('기본은 리스트·담당자 전체·전체 기간이고 모르는 값은 기본이다', () => {
    expect(read('')).toEqual({
      view: 'list',
      assignee: null,
      month: null,
      from: null,
      period: 'all',
      sort: 'due',
    })
    expect(read('?view=table&month=2026-13&from=2026-02-30&period=week&sort=priority')).toEqual(
      read(''),
    )
  })

  it('쓴 값을 그대로 읽고, 탭·날짜 조건 파라미터는 건드리지 않는다', () => {
    const next = {
      view: 'calendar' as const,
      assignee: 'mb_02',
      month: '2026-09',
      from: null,
      period: 'month' as const,
      sort: 'updated' as const,
    }
    const written = viewSearch(new URLSearchParams('?tab=done&due=overdue,soon'), next)
    expect(written).toBe(
      '?tab=done&due=overdue,soon&view=calendar&assignee=mb_02&month=2026-09&period=month&sort=updated',
    )
    expect(read(written)).toEqual(next)
  })

  it('기본값으로 돌아오면 파라미터가 남지 않는다', () => {
    expect(
      viewSearch(new URLSearchParams('?view=board&assignee=mb_01&sort=created'), read('')),
    ).toBe('')
    expect(viewSearch(new URLSearchParams('?tab=done&view=board'), read(''))).toBe('?tab=done')
  })
})

describe('보드 카드 배지', () => {
  const today = '2026-09-18'
  const task = (status: Task['status'], dueDate: string | null): Task => ({
    ...toTask(taskFixtures[0]),
    status,
    dueDate,
  })

  it.each([
    ['막힘', 'blocked', '2026-10-30', ['blocked']],
    ['막힘 + 기한 지남', 'blocked', '2026-09-17', ['blocked', 'danger']],
    ['막힘 + 7일 안 마감', 'blocked', '2026-09-20', ['blocked']],
    ['막힘 + 마감 없음', 'blocked', null, ['blocked']],
    ['기한 지남', 'in_progress', '2026-09-17', ['danger']],
    ['7일 안 마감', 'todo', '2026-09-24', ['warn']],
    ['여유 있음', 'in_progress', '2026-10-30', []],
    ['완료(과거 마감)', 'done', '2026-09-10', []],
  ] as const)('%s', (_, status, dueDate, expected) => {
    expect(cardBadges(task(status, dueDate), today)).toEqual(expected)
  })

  it('캘린더·간트가 쓰는 색 구분에서는 막힌 태스크가 여전히 위험이다', () => {
    expect(taskTone(task('blocked', '2026-10-30'), today)).toBe('danger')
  })
})

describe('날짜 계산', () => {
  it('달 이동은 해를 넘는다', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })

  it('캘린더 격자는 일요일부터 그 달의 날이 든 주만 그린다 — 2026-09 는 8/30 부터 5주(시안)', () => {
    const grid = calendarGrid('2026-09')
    expect(grid).toHaveLength(35)
    expect(grid[0]).toEqual({ date: '2026-08-30', inMonth: false })
    expect(grid[2]).toEqual({ date: '2026-09-01', inMonth: true })
    // 9/30(수)이 든 주가 마지막이다. 10월 날만 있는 10/4 주는 그리지 않는다
    expect(grid.at(-1)).toEqual({ date: '2026-10-03', inMonth: false })
  })

  it('달이 여섯 주에 걸치면 6주를 그대로 그린다 — 2026-08 은 8/1(토)부터 8/31(월)까지', () => {
    const grid = calendarGrid('2026-08')
    expect(grid).toHaveLength(42)
    expect(grid[0]).toEqual({ date: '2026-07-26', inMonth: false })
    expect(grid[6]).toEqual({ date: '2026-08-01', inMonth: true })
    expect(grid[36]).toEqual({ date: '2026-08-31', inMonth: true })
    expect(grid.at(-1)?.date).toBe('2026-09-05')
  })

  it('일요일에 시작하는 28일 달은 앞뒤 달 없이 4주다 — 2026-02', () => {
    const grid = calendarGrid('2026-02')
    expect(grid).toHaveLength(28)
    expect(grid.every(({ inMonth }) => inMonth)).toBe(true)
    expect(grid.at(-1)?.date).toBe('2026-02-28')
  })

  it('주는 월요일에 시작한다', () => {
    expect(mondayOf('2026-09-11')).toBe('2026-09-07')
    expect(mondayOf('2026-09-13')).toBe('2026-09-07')
    expect(mondayOf('2026-09-14')).toBe('2026-09-14')
    expect(daysBetween('2026-09-07', '2026-09-17')).toBe(10)
  })

  it('월의 주 번호는 1일이 든 주가 1주다 — 시안의 9월 2주 – 4주', () => {
    expect(weekOfMonth('2026-09-07')).toBe(2)
    expect(ganttTitle('2026-09-07')).toBe('9월 2주 – 4주')
    expect(ganttTitle('2026-09-28')).toBe('9월 5주 – 10월 3주')
  })
})
