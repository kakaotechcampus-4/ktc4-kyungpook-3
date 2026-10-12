import { describe, expect, it } from 'vitest'
import {
  addMonths,
  calendarGrid,
  daysBetween,
  ganttTitle,
  mondayOf,
  readViewQuery,
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
    })
    expect(read('?view=table&month=2026-13&from=2026-02-30&period=week')).toEqual(read(''))
  })

  it('쓴 값을 그대로 읽고, 탭·날짜 조건 파라미터는 건드리지 않는다', () => {
    const next = {
      view: 'calendar' as const,
      assignee: 'mb_02',
      month: '2026-09',
      from: null,
      period: 'month' as const,
    }
    const written = viewSearch(new URLSearchParams('?tab=done&due=overdue,soon'), next)
    expect(written).toBe(
      '?tab=done&due=overdue,soon&view=calendar&assignee=mb_02&month=2026-09&period=month',
    )
    expect(read(written)).toEqual(next)
  })

  it('기본값으로 돌아오면 파라미터가 남지 않는다', () => {
    expect(viewSearch(new URLSearchParams('?view=board&assignee=mb_01'), read(''))).toBe('')
    expect(viewSearch(new URLSearchParams('?tab=done&view=board'), read(''))).toBe('?tab=done')
  })
})

describe('날짜 계산', () => {
  it('달 이동은 해를 넘는다', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })

  it('캘린더 격자는 일요일부터 6주다 — 2026-09 는 8/30 부터', () => {
    const grid = calendarGrid('2026-09')
    expect(grid).toHaveLength(42)
    expect(grid[0]).toEqual({ date: '2026-08-30', inMonth: false })
    expect(grid[2]).toEqual({ date: '2026-09-01', inMonth: true })
    expect(grid.at(-1)?.date).toBe('2026-10-10')
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
