import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '@/shared/config/routes'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import type { buildTaskBoard as BuildTaskBoard } from '@/widgets/task-board/lib/taskBoard'
import { renderApp } from './test/renderApp'

/*
 * #391 — 리스트의 탭 개수·정렬(`buildTaskBoard`)은 리스트 조건이 바뀔 때만 다시 계산한다.
 * 보기 전환과 캘린더 달·간트 주 이동은 URL 만 바꾸므로 다시 계산하지 않는다. 마감 조건·탭·정렬·담당자는 다시 계산한다.
 */

type Build = Parameters<typeof BuildTaskBoard>
const builds = vi.hoisted(() => [] as { due: string; tab: string; sort: string; tasks: number }[])
vi.mock('@/widgets/task-board/lib/taskBoard', async (original) => {
  const actual = await original<typeof import('@/widgets/task-board/lib/taskBoard')>()
  function buildTaskBoard(...args: Build) {
    const [input, , tab] = args
    builds.push({ due: input.due.join(','), tab, sort: input.sort, tasks: input.tasks.length })
    return actual.buildTaskBoard(...args)
  }
  return { ...actual, buildTaskBoard }
})

vi.setConfig({ testTimeout: 15_000 })
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => vi.useRealTimers())

const settle = (ms = 100) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
const FIRST_PAINT = { timeout: 5_000 }

async function open(search: string, ready: () => HTMLElement) {
  const app = renderApp(`${paths.tasks('ws_01')}${search}`)
  await waitFor(() => expect(ready()).toBeVisible(), FIRST_PAINT)
  await settle()
  builds.length = 0
  return app
}

describe('URL 만 바뀌는 이동은 리스트 계산을 다시 하지 않는다 (#391)', () => {
  const calendar = (month: string) => screen.getByRole('table', { name: month })
  const gantt = () => screen.getByRole('table', { name: '일정' })

  it('캘린더 다음 달·이전 달', async () => {
    const user = userEvent.setup()
    const app = await open('?view=calendar&month=2026-09', () => calendar('2026년 9월'))

    await user.click(screen.getByRole('button', { name: '다음 달' }))
    await waitFor(() => expect(calendar('2026년 10월')).toBeVisible())
    await user.click(screen.getByRole('button', { name: '이전 달' }))
    await waitFor(() => expect(calendar('2026년 9월')).toBeVisible())
    await app.expectSearch('?view=calendar&month=2026-09')
    await settle()

    expect(builds).toEqual([])
  })

  it('간트 다음 3주·이전 3주', async () => {
    const user = userEvent.setup()
    const app = await open('?view=gantt&from=2026-09-14', gantt)

    await user.click(screen.getByRole('button', { name: '다음 3주' }))
    await app.expectSearch('?view=gantt&from=2026-10-05')
    await user.click(screen.getByRole('button', { name: '이전 3주' }))
    await app.expectSearch('?view=gantt&from=2026-09-14')
    await settle()

    expect(builds).toEqual([])
  })

  it('마감 조건을 건 채 보기 전환 — 캘린더 → 간트 → 보드', async () => {
    const user = userEvent.setup()
    const app = await open('?due=overdue,soon&view=calendar&month=2026-09', () =>
      calendar('2026년 9월'),
    )

    await user.click(screen.getByRole('radio', { name: '간트' }))
    await waitFor(() => expect(gantt()).toBeVisible(), FIRST_PAINT)
    await user.click(screen.getByRole('radio', { name: '보드' }))
    await waitFor(
      () => expect(screen.getByRole('region', { name: '시작 전' })).toBeVisible(),
      FIRST_PAINT,
    )
    await app.expectSearch('?due=overdue,soon&view=board&month=2026-09')
    await settle()

    expect(builds).toEqual([])
  })
})

describe('리스트 조건을 바꾸면 지금처럼 다시 계산한다 (#391)', () => {
  const openList = () =>
    open('', () => screen.getByRole('tablist', { name: '태스크 구분' })).then(() =>
      userEvent.setup(),
    )
  const last = () => builds.at(-1)

  it('마감 조건', async () => {
    const user = await openList()
    await user.click(screen.getByRole('button', { name: /^마감 조건:/ }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: '기한 지남' }))
    await waitFor(() => expect(last()).toMatchObject({ due: 'overdue' }))
  })

  it('탭', async () => {
    const user = await openList()
    await user.click(screen.getByRole('tab', { name: /^완료/ }))
    await waitFor(() => expect(last()).toMatchObject({ tab: 'done' }))
  })

  it('정렬', async () => {
    const user = await openList()
    await user.click(screen.getByRole('button', { name: /^정렬:/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: '최근 생성순' }))
    await waitFor(() => expect(last()).toMatchObject({ sort: 'created' }))
  })

  it('담당자', async () => {
    const user = await openList()
    await user.click(screen.getByRole('button', { name: /^담당자:/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: '박민수' }))
    await waitFor(() => expect(last()?.tasks).toBe(3))
  })
})
