import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, Routes } from 'react-router'
import { paths } from '@/shared/config/routes'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { App } from './App'
import { createApp } from './createApp'
import { appRoutes } from './router/routes'

/*
 * 휴대폰 보드의 칸 고르기 (PwaTasks 시안, D-180). 고른 칸은 URL(`column`)에 있어 상세를 보고 돌아오거나 새로고침해도 남는다.
 * MemoryRouter 는 window.history 를 쓰지 않아 jsdom 의 실제 기록 위에서 BrowserRouter 로 본다 (tasks.test.tsx 와 같은 방식).
 * 픽스처의 ws_01 완료 태스크는 랜딩 카피·폰트 적용·토큰 정리 셋이다.
 */

vi.setConfig({ testTimeout: 15_000 })
beforeAll(() => import('@/widgets/task-board/ui/BoardView'), 60_000)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})

/** 폭을 바꿀 수 있는 matchMedia. 셸은 `(max-width: 767.98px)` 하나만 묻는다 (appShell.test.tsx 와 같다) */
function stubViewportWidth(initial: number) {
  let width = initial
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => {
    const max = /max-width: ([\d.]+)px/.exec(query)
    return {
      get matches() {
        return max === null ? query === '(prefers-reduced-motion: reduce)' : width <= Number(max[1])
      },
      media: query,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }
  })
  return (next: number) => {
    width = next
    act(() => listeners.forEach((listener) => listener()))
  }
}

let opened: (() => void)[] = []
function open(url: string) {
  window.history.replaceState(null, '', url)
  const app = createApp()
  const view = render(
    <App queryClient={app.queryClient}>
      <BrowserRouter>
        <Routes>{appRoutes}</Routes>
      </BrowserRouter>
    </App>,
  )
  const dispose = () => {
    view.unmount()
    app.dispose()
  }
  opened.push(dispose)
  return dispose
}
afterEach(() => {
  for (const dispose of opened) dispose()
  opened = []
  window.history.replaceState(null, '', '/')
  vi.useRealTimers()
})

const BOARD = `${paths.tasks('ws_01')}?view=board`
const FIRST_PAINT = { timeout: 5_000 }
const selectedTab = () =>
  within(screen.getByRole('tablist', { name: '상태' }))
    .getAllByRole('tab')
    .find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent
const panelTitles = () =>
  within(screen.getByRole('tabpanel'))
    .getAllByRole('link')
    .map((link) => link.textContent)

describe('휴대폰 보드의 고른 칸은 URL 에 남는다', () => {
  it('완료를 고르고 카드 상세에 갔다가 뒤로 오면 완료가 그대로다. 새로고침해도 같다', async () => {
    stubViewportWidth(360)
    const user = userEvent.setup()
    const first = open(BOARD)
    await waitFor(() => expect(selectedTab()).toBe('진행 중 4'), FIRST_PAINT)

    await user.click(screen.getByRole('tab', { name: '완료 3' }))
    await waitFor(() => expect(window.location.search).toBe('?view=board&column=done'))
    expect([...panelTitles()].sort()).toEqual(['랜딩 카피', '토큰 정리', '폰트 적용'])

    await user.click(screen.getByRole('link', { name: '랜딩 카피' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: '랜딩 카피' }, FIRST_PAINT),
    ).toBeVisible()

    act(() => window.history.back())
    await waitFor(() => expect(selectedTab()).toBe('완료 3'), FIRST_PAINT)
    expect(window.location.search).toBe('?view=board&column=done')
    expect([...panelTitles()].sort()).toEqual(['랜딩 카피', '토큰 정리', '폰트 적용'])

    first()
    open(`${BOARD}&column=done`)
    await waitFor(() => expect(selectedTab()).toBe('완료 3'), FIRST_PAINT)
  })

  it('넓은 화면의 완료 칸에서 쓰던 중 좁아지면 완료를 고르고, 기록을 쌓지 않고 주소를 고친다', async () => {
    const resize = stubViewportWidth(1024)
    const user = userEvent.setup()
    open(BOARD)
    const done = await screen.findByRole('region', { name: '완료' }, FIRST_PAINT)
    await user.click(within(done).getByRole('button', { name: '완료에 직접 추가' }))
    await user.type(within(done).getByRole('textbox'), '회고 정리')
    const entries = window.history.length

    resize(360)
    await waitFor(() => expect(window.location.search).toBe('?view=board&column=done'))
    expect(window.history.length).toBe(entries)
    expect(selectedTab()).toBe('완료 3')
    const input = within(screen.getByRole('tabpanel')).getByRole('textbox', {
      name: '완료 새 태스크 제목',
    })
    expect(input).toHaveValue('회고 정리')
    expect(input).toHaveFocus()
  })
})
