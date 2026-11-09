import type { MockInstance } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { taskKeys } from '@/entities/task'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { server } from '@/shared/mock/server'
import { toTaskResponse } from '@/shared/mock/task-state'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * #348 — 태스크 응답이 스키마에 맞지 않을 때 화면. 모르는 상태를 할 일로 바꿔 보여 주지 않고 응답을 읽지 못했다고 알린다.
 * 잘못된 응답은 다시 요청해도 같으므로 Query 가 재시도하지 않는다. 받아 둔 본문은 갱신이 실패해도 남는다 (#236)
 */

vi.setConfig({ testTimeout: 15_000 })

const INVALID = '응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.'

let warning: MockInstance<typeof console.warn>
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
  warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  warning.mockRestore()
})

const served = () => db.tasks.map((task) => toTaskResponse(task))
const archived = (taskId: string) => ({
  ...served().find(({ task_id }) => task_id === taskId)!,
  status: 'archived',
})
/** 재시도 대기(1초)보다 길게 기다린다. 재시도가 있었다면 이 사이에 두 번째 요청이 나간다 */
const pastRetryDelay = () => act(() => new Promise((resolve) => setTimeout(resolve, 1_300)))

it('목록에 모르는 상태가 한 건이라도 있으면 목록 전체 대신 안내와 다시 시도를 보이고 재시도하지 않는다', async () => {
  server.use(
    http.get('/api/v1/tasks', () => {
      const items = served().map((task) => (task.task_id === 'tk_02' ? archived('tk_02') : task))
      return ok({ items, total: items.length })
    }),
  )
  const requests = recordRequests()
  renderApp(paths.tasks('ws_01'))
  const panel = await screen.findByRole('tabpanel')
  expect(await within(panel).findByText('태스크 목록을 불러오지 못했어요')).toBeVisible()
  expect(within(panel).getByText(INVALID)).toBeVisible()
  expect(screen.queryByRole('list', { name: '태스크 목록' })).toBeNull()
  expect(screen.queryByText('회원가입 화면')).toBeNull()

  await pastRetryDelay()
  const listRequests = () => requests.started.filter(({ path }) => path.startsWith('/tasks?'))
  expect(listRequests()).toHaveLength(1)

  server.resetHandlers()
  fireEvent.click(within(panel).getByRole('button', { name: '다시 시도' }))
  expect(
    await screen.findByRole('list', { name: '태스크 목록' }, { timeout: 3_000 }),
  ).toBeInTheDocument()
  expect(listRequests()).toHaveLength(2)
})

it('상세가 모르는 상태면 할 일로 그리지 않고 안내와 다시 시도를 보이며 재시도하지 않는다', async () => {
  server.use(http.get('/api/v1/tasks/:taskId', () => ok(archived('tk_01'))))
  const requests = recordRequests()
  renderApp(paths.tasks('ws_01', 'tk_01'))
  expect(
    await screen.findByText('태스크를 불러오지 못했어요', {}, { timeout: 5_000 }),
  ).toBeVisible()
  expect(screen.getByText(INVALID)).toBeVisible()
  expect(screen.queryByRole('heading', { level: 1, name: '로그인 API 연동' })).toBeNull()

  await pastRetryDelay()
  expect(requests.started.filter(({ path }) => path === '/tasks/tk_01')).toHaveLength(1)

  server.resetHandlers()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByRole('heading', { level: 1, name: '로그인 API 연동' })).toBeVisible()
})

it('받아 둔 상세는 갱신 응답이 잘못돼도 본문을 남기고 최신 상태를 받지 못했다고만 알린다', async () => {
  const app = renderApp(paths.tasks('ws_01', 'tk_01'))
  expect(await screen.findByRole('heading', { level: 1, name: '로그인 API 연동' })).toBeVisible()
  expect(screen.getByTestId('task-status')).toHaveTextContent('진행 중')

  server.use(http.get('/api/v1/tasks/:taskId', () => ok(archived('tk_01'))))
  await act(() => app.queryClient.invalidateQueries({ queryKey: taskKeys('ws_01') }))
  expect(await screen.findByText('최신 상태를 받지 못했어요')).toBeVisible()
  expect(screen.getByRole('heading', { level: 1, name: '로그인 API 연동' })).toBeVisible()
  expect(screen.getByTestId('task-status')).toHaveTextContent('진행 중')
})

it('이력의 모르는 필드·출처는 다른 필드로 읽지 않고 알 수 없는 항목·출처로 보인다', async () => {
  server.use(
    http.get('/api/v1/tasks/:taskId/timeline', () =>
      ok({
        items: [
          {
            kind: 'history',
            at: '2026-09-16T06:00:00Z',
            history_id: 'hs_future',
            changed_field: 'priority',
            old_value: 'low',
            new_value: 'high',
            change_source: 'slack',
          },
        ],
        total: 1,
      }),
    ),
  )
  renderApp(paths.tasks('ws_01', 'tk_01'))
  expect(
    await screen.findByText('알 수 없는 항목: low → high', {}, { timeout: 5_000 }),
  ).toBeVisible()
  await waitFor(() => expect(screen.getByText(/알 수 없는 출처/)).toBeVisible())
  expect(screen.queryByText(/제목: low/)).toBeNull()
})
