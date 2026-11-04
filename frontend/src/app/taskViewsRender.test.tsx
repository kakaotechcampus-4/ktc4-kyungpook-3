import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { taskListQueryOptions } from '@/entities/task'
import { taskStatusMutationKey } from '@/features/task-status'
import { paths } from '@/shared/config/routes'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * M8 AC-A-04 — 보기의 반복 단위(카드·줄·칩)는 바뀐 태스크만 다시 그린다. 카드·줄·칩마다 상세 링크가 하나라
 * 링크(GuardedLink)가 그려진 횟수를 주소별로 센다. 변경 전에는 태스크 하나의 상태 변경에 모든 카드·줄·칩이 다시 그려졌다.
 */

const renders = vi.hoisted(() => new Map<string, number>())
vi.mock('@/shared/lib/unsaved-changes', async (original) => {
  const actual = await original<typeof import('@/shared/lib/unsaved-changes')>()
  function GuardedLink(props: ComponentProps<typeof actual.GuardedLink>) {
    const key = typeof props.to === 'string' ? props.to : (props.to.pathname ?? '')
    renders.set(key, (renders.get(key) ?? 0) + 1)
    return <actual.GuardedLink {...props} />
  }
  return { ...actual, GuardedLink }
})

vi.setConfig({ testTimeout: 15_000 })
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => vi.useRealTimers())

const settle = (ms = 100) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
const FIRST_PAINT = { timeout: 5_000 }
const TARGET = paths.tasks('ws_01', 'tk_01')
/** 다시 그려진 태스크 상세 링크 — 확인 필요·회의 칩은 태스크가 아니라 뺀다 */
const taskLinkRenders = () => [...renders.entries()].filter(([to]) => /\/tasks\/tk_\d+$/.test(to))

type App = ReturnType<typeof renderApp>
/** 끝나지 않는 상태 변경 하나를 그 공간에 건다 — 목록·보기에 먼저 보이는 겹침(`useTaskStatusOverlay`)만 생긴다 */
function holdStatusChange(app: App, workspaceId: string, taskId: string) {
  const mutation = app.queryClient.getMutationCache().build(app.queryClient, {
    mutationKey: taskStatusMutationKey(workspaceId, taskId),
    mutationFn: () => new Promise(() => {}),
  })
  void mutation.execute({ taskId, status: 'done', isCurrentSession: () => true })
}

const VIEWS = {
  board: () => screen.queryByRole('region', { name: '시작 전' }),
  calendar: () => screen.queryByRole('table', { name: '2026년 9월' }),
  gantt: () => screen.queryByRole('table', { name: '일정' }),
} as const
/** tk_01 이 완료로 바뀐 모습 — 보드는 완료 칸, 캘린더는 취소선 칩, 간트는 완료 막대 */
const SHOWN_DONE = {
  board: () =>
    expect(
      within(screen.getByRole('region', { name: '완료' })).getByRole('link', {
        name: '로그인 API 연동',
      }),
    ).toBeVisible(),
  calendar: () =>
    expect(
      within(screen.getByRole('link', { name: /로그인 API 연동/ })).getByText('로그인 API 연동'),
    ).toHaveClass('line-through'),
  gantt: () =>
    expect(
      within(screen.getByRole('row', { name: /로그인 API 연동/ })).getByText(/ 완료$/),
    ).toBeVisible(),
} as const

describe.each(Object.keys(VIEWS) as (keyof typeof VIEWS)[])('%s 보기 (AC-A-04)', (view) => {
  async function open() {
    const app = renderApp(`${paths.tasks('ws_01')}?view=${view}`)
    await waitFor(() => expect(VIEWS[view]()).toBeVisible(), FIRST_PAINT)
    await settle()
    renders.clear()
    return app
  }

  it('태스크 하나의 상태가 바뀌면 그 태스크만 다시 그리고, 바뀐 상태는 보인다', async () => {
    const app = await open()
    act(() => holdStatusChange(app, 'ws_01', 'tk_01'))
    await settle()
    expect(taskLinkRenders()).toEqual([[TARGET, 1]])
    SHOWN_DONE[view]()
  })

  it('다른 공간의 상태 변경이나 같은 데이터의 재조회는 아무것도 다시 그리지 않는다', async () => {
    const app = await open()
    act(() => holdStatusChange(app, 'ws_02', 'tk_99'))
    await act(() =>
      app.queryClient.refetchQueries({ queryKey: taskListQueryOptions('ws_01').queryKey }),
    )
    await settle()
    expect([...renders.entries()]).toEqual([])
  })
})

describe('보드 정렬 (D-175 · AC-A-04)', () => {
  it('정렬을 바꾸면 카드는 자리만 옮기고 다시 그리지 않는다. 태스크를 다시 부르지도 않는다', async () => {
    const user = userEvent.setup()
    renderApp(`${paths.tasks('ws_01')}?view=board`)
    await waitFor(() => expect(VIEWS.board()).toBeVisible(), FIRST_PAINT)
    await settle()
    const log = recordRequests()
    renders.clear()

    await user.click(screen.getByRole('button', { name: '정렬: 마감 빠른 순' }))
    await user.click(await screen.findByRole('menuitemradio', { name: '최근 생성순' }))
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: '완료' }))
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['토큰 정리', '폰트 적용', '랜딩 카피']),
    )
    await settle()
    expect(taskLinkRenders()).toEqual([])
    expect(log.started.filter(({ path }) => path.startsWith('/tasks'))).toEqual([])
  })
})
