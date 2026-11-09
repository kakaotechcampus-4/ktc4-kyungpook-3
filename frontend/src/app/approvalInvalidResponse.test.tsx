import type { MockInstance } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { workspaceKey } from '@/shared/api/queryKeys'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * #348 — 승인 응답이 스키마에 맞지 않을 때 화면. 모르는 상태를 승인 대기로 바꿔 승인·반려를 열지 않고 응답을 읽지 못했다고
 * 알린다. 잘못된 응답은 다시 요청해도 같으므로 Query 가 재시도하지 않는다
 */

vi.setConfig({ testTimeout: 15_000 })

const INVALID = '응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.'
const CREATE = '이 태스크, 승인할까요?'

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

const served = (id: string) =>
  structuredClone(db.approvals.find(({ approval_id }) => approval_id === id)!)
/** 재시도 대기(1초)보다 길게 기다린다. 재시도가 있었다면 이 사이에 두 번째 요청이 나간다 */
const pastRetryDelay = () => act(() => new Promise((resolve) => setTimeout(resolve, 1_300)))

it('상세가 모르는 상태면 승인 대기로 그리지 않고 안내와 다시 시도를 보이며 재시도하지 않는다', async () => {
  server.use(
    http.get('/api/v1/approvals/:approvalId', () => ok({ ...served('ap_01'), status: 'expired' })),
  )
  const requests = recordRequests()
  renderApp(paths.approval('ws_01', 'ap_01'))
  expect(
    await screen.findByText('확인 요청을 불러오지 못했어요', {}, { timeout: 5_000 }),
  ).toBeVisible()
  expect(screen.getByText(INVALID)).toBeVisible()
  expect(screen.queryByRole('button', { name: '승인' })).toBeNull()
  expect(screen.queryByRole('button', { name: '반려' })).toBeNull()

  await pastRetryDelay()
  expect(requests.started.filter(({ path }) => path === '/approvals/ap_01')).toHaveLength(1)

  server.resetHandlers()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByRole('heading', { level: 1, name: CREATE })).toBeVisible()
})

it('대기 목록에 모르는 상태가 한 건이라도 있으면 PM 의 태스크 목록 대신 안내를 보이고 재시도하지 않는다', async () => {
  server.use(
    http.get('/api/v1/approvals', () => {
      const items = db.approvals
        .filter(({ status }) => status === 'pending')
        .map((approval) =>
          approval.approval_id === 'ap_02' ? { ...approval, status: 'expired' } : approval,
        )
      return ok({ items, total: items.length })
    }),
  )
  const requests = recordRequests()
  renderApp(paths.tasks('ws_01'))
  const panel = await screen.findByRole('tabpanel')
  expect(await within(panel).findByText('태스크 목록을 불러오지 못했어요')).toBeVisible()
  expect(within(panel).getByText(INVALID)).toBeVisible()
  expect(screen.queryByRole('list', { name: '태스크 목록' })).toBeNull()

  await pastRetryDelay()
  const listRequests = () => requests.started.filter(({ path }) => path.startsWith('/approvals?'))
  expect(listRequests()).toHaveLength(1)

  server.resetHandlers()
  fireEvent.click(within(panel).getByRole('button', { name: '다시 시도' }))
  expect(
    await screen.findByRole('list', { name: '태스크 목록' }, { timeout: 3_000 }),
  ).toBeInTheDocument()
  expect(listRequests()).toHaveLength(2)
})

it('받아 둔 상세는 갱신 응답이 잘못돼도 카드를 남긴다', async () => {
  const app = renderApp(paths.approval('ws_01', 'ap_01'))
  expect(await screen.findByRole('heading', { level: 1, name: CREATE })).toBeVisible()

  server.use(
    http.get('/api/v1/approvals/:approvalId', () => ok({ ...served('ap_01'), status: 'expired' })),
  )
  await act(() =>
    app.queryClient.invalidateQueries({ queryKey: workspaceKey('ws_01', 'approvals') }),
  )
  await waitFor(() =>
    expect(app.queryClient.getQueryState(workspaceKey('ws_01', 'approvals', 'ap_01'))?.status).toBe(
      'error',
    ),
  )
  expect(screen.getByRole('heading', { level: 1, name: CREATE })).toBeVisible()
  expect(screen.getByRole('button', { name: '반려' })).toBeEnabled()
})

it('반려 응답을 읽지 못하면 실패라고 하지 않고 결과를 확인하지 못했다고 알리며, 새로고침이 승인을 다시 받는다', async () => {
  server.use(
    http.patch('/api/v1/approvals/:approvalId', () =>
      ok({ ...served('ap_01'), status: 'expired' }),
    ),
  )
  const log = recordRequests()
  renderApp(paths.approval('ws_01', 'ap_01'))
  expect(await screen.findByRole('heading', { level: 1, name: CREATE })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '반려' }))

  const notice = (
    await screen.findByText('변경 결과를 확인하지 못했어요', {}, { timeout: 5_000 })
  ).closest('li') as HTMLElement
  expect(within(notice).getByText(/서버에는 반영됐을 수 있어요/)).toBeInTheDocument()
  expect(screen.queryByText(INVALID)).toBeNull()

  await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
  const before = log.started.length
  fireEvent.click(within(notice).getByRole('button', { name: '새로고침' }))
  await waitFor(() =>
    expect(log.started.slice(before)).toContainEqual({ method: 'GET', path: '/approvals/ap_01' }),
  )
})
