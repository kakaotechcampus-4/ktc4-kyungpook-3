import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '@/shared/config/routes'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { deferred } from '@/shared/test/deferred'
import { renderApp } from './test/renderApp'

/*
 * M8 AC-A-02 — 보드·캘린더·간트는 그 보기를 고를 때 코드를 받는다. 보기 모듈을 막아 두고 언제 불리는지, 받는 동안 무엇이
 * 보이는지를 본다. 모듈은 한 번만 불리므로 보기마다 처음 부르는 테스트가 하나씩이다.
 */

const modules = vi.hoisted(() => ({ loaded: [] as string[], gates: new Map<string, () => void>() }))
const gate = (name: string) => {
  const { promise, resolve } = deferred()
  modules.gates.set(name, resolve)
  modules.loaded.push(name)
  return promise
}
vi.mock('@/widgets/task-board/ui/BoardView', async (original) => {
  await gate('board')
  return original()
})
vi.mock('@/widgets/task-board/ui/CalendarView', async (original) => {
  await gate('calendar')
  return original()
})
vi.mock('@/widgets/task-board/ui/GanttView', async (original) => {
  await gate('gantt')
  return original()
})

vi.setConfig({ testTimeout: 15_000 })
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => vi.useRealTimers())

const release = (name: string) => modules.gates.get(name)?.()
/** 파일의 첫 화면은 모듈 변환이 겹쳐 기본 1초를 넘길 때가 있다 */
const FIRST_PAINT = { timeout: 5_000 }
const switcher = () => screen.getByLabelText('보기 방식')

describe('보기 코드 나누기 (AC-A-02)', () => {
  it('리스트로 들어오면 세 보기 코드를 부르지 않고, 보드를 고르면 받는 동안 그 자리에 대기를 그린다', async () => {
    const user = userEvent.setup()
    renderApp(paths.tasks('ws_01'))
    await screen.findByRole('list', { name: '태스크 목록' }, FIRST_PAINT)
    expect(modules.loaded).toEqual([])

    await user.click(within(switcher()).getByRole('radio', { name: '보드' }))
    expect(
      await screen.findByRole('status', { name: '보드 화면을 불러오는 중' }, FIRST_PAINT),
    ).toBeVisible()
    expect(screen.queryByRole('region', { name: '시작 전' })).toBeNull()
    expect(modules.loaded).toEqual(['board'])

    release('board')
    expect(await screen.findByRole('region', { name: '시작 전' }, FIRST_PAINT)).toBeVisible()
    expect(screen.queryByRole('status', { name: '보드 화면을 불러오는 중' })).toBeNull()
    expect(modules.loaded).toEqual(['board'])
  })

  it('캘린더 주소로 바로 들어오면 데이터를 받은 뒤 코드를 기다리는 동안 대기를 그린다', async () => {
    renderApp(`${paths.tasks('ws_01')}?view=calendar`)
    expect(
      await screen.findByRole('status', { name: '캘린더 화면을 불러오는 중' }, FIRST_PAINT),
    ).toBeVisible()
    expect(modules.loaded).toContain('calendar')
    expect(modules.loaded).not.toContain('gantt')

    release('calendar')
    expect(await screen.findByRole('table', { name: '2026년 9월' }, FIRST_PAINT)).toBeVisible()
  })

  it('받아 둔 보기에서 간트로 옮기면 간트 코드만 기다린다. 다시 돌아오면 대기 없이 그린다', async () => {
    const user = userEvent.setup()
    renderApp(`${paths.tasks('ws_01')}?view=board`)
    expect(await screen.findByRole('region', { name: '시작 전' }, FIRST_PAINT)).toBeVisible()

    await user.click(within(switcher()).getByRole('radio', { name: '간트' }))
    expect(
      await screen.findByRole('status', { name: '간트 화면을 불러오는 중' }, FIRST_PAINT),
    ).toBeVisible()
    release('gantt')
    expect(await screen.findByRole('table', { name: '일정' }, FIRST_PAINT)).toBeVisible()
    expect(modules.loaded).toEqual(['board', 'calendar', 'gantt'])

    await user.click(within(switcher()).getByRole('radio', { name: '보드' }))
    await waitFor(() => expect(screen.getByRole('region', { name: '시작 전' })).toBeVisible())
    expect(screen.queryByRole('status', { name: /화면을 불러오는 중$/ })).toBeNull()
  })
})
