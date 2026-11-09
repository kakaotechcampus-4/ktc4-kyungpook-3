import type { MockInstance } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getResponse, http } from 'msw'
import { paths } from '@/shared/config/routes'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { ok } from '@/shared/mock/envelope'
import { messageHandlers } from '@/shared/mock/handlers/message'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { detail, list } from './test/messageScreen'
import { renderApp } from './test/renderApp'

/*
 * #348 — 메시지·알림 응답이 스키마에 맞지 않을 때 화면. 모르는 보낸 쪽·묶음 상태는 다른 값으로 그리지 않고 응답을 읽지 못했다고
 * 알리며 재시도하지 않는다. 모르는 문구 출처는 표시용 분류라 묶음을 보이되 출처를 짐작하지 않는다
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

const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

/**
 * 안내가 뜬 뒤로는 다시 묻지 않는다. 메시지 화면은 대화 신호 소켓이 열리면 목록·대화를 한 번 다시 받는다(`opened`, 오류 종류와
 * 상관없다). 그 받기가 끝난 뒤의 수에서 재시도 대기(1초)보다 오래 기다려도 늘지 않는지 본다
 */
async function expectNoRetry(requests: () => unknown[]) {
  await wait(300)
  const shown = requests().length
  await wait(1_300)
  expect(requests()).toHaveLength(shown)
}

/** 실제 handler 의 답을 받아 고친다 — 다른 칸은 백엔드 모양 그대로다 */
function patched<T>(path: string, change: (data: T) => T) {
  return http.get(`/api/v1${path}`, async ({ request }) => {
    const response = await getResponse(messageHandlers, request)
    if (response === undefined) return undefined
    const { data } = (await response.json()) as { data: T }
    return ok(change(data))
  })
}

interface Inbox {
  bundles: { body_source: string; status: string }[] | null
}
interface Thread {
  messages: { message_id: string; sender: string }[]
}

it('대화의 메시지 한 건이 모르는 보낸 쪽이면 대화 대신 안내와 다시 시도를 보이고 재시도하지 않는다', async () => {
  server.use(
    patched<Thread>('/workspaces/:workspaceId/messages/threads/:threadId', (data) => ({
      ...data,
      messages: data.messages.map((message, index) =>
        index === 0 ? { ...message, sender: 'system' } : message,
      ),
    })),
  )
  const requests = recordRequests()
  renderApp(paths.messageThread('ws_01', 'th_01'))
  expect(await screen.findByText('대화를 불러오지 못했어요', {}, { timeout: 5_000 })).toBeVisible()
  expect(detail().getByText(INVALID)).toBeVisible()

  await expectNoRetry(() =>
    requests.started.filter(({ path }) => path === '/workspaces/ws_01/messages/threads/th_01'),
  )

  server.resetHandlers()
  fireEvent.click(detail().getByRole('button', { name: '다시 시도' }))
  expect(await detail().findByRole('region', { name: '대화 내용' })).toBeVisible()
})

it('목록의 묶음 한 건이 모르는 상태면 목록 대신 안내를 보이고 재시도하지 않는다', async () => {
  server.use(
    patched<Inbox>('/workspaces/:workspaceId/messages', (data) => ({
      ...data,
      bundles:
        data.bundles?.map((bundle, index) =>
          index === 0 ? { ...bundle, status: 'paused' } : bundle,
        ) ?? null,
    })),
  )
  const requests = recordRequests()
  renderApp(paths.messages('ws_01'))
  expect(
    await screen.findByText('메시지 목록을 불러오지 못했어요', {}, { timeout: 5_000 }),
  ).toBeVisible()
  expect(list().getByText(INVALID)).toBeVisible()
  await expectNoRetry(() =>
    requests.started.filter(({ path }) => path === '/workspaces/ws_01/messages'),
  )
})

it('모르는 문구 출처는 다른 출처로 짐작하지 않고 출처를 알 수 없는 문구로 보인다', async () => {
  server.use(
    patched<Inbox>('/workspaces/:workspaceId/messages', (data) => ({
      ...data,
      bundles: data.bundles?.map((bundle) => ({ ...bundle, body_source: 'template' })) ?? null,
    })),
  )
  renderApp(paths.messageReview('ws_01', 'bd_01'))
  const preview = await screen.findByRole(
    'region',
    { name: '보낼 메시지 미리보기' },
    { timeout: 5_000 },
  )
  expect(
    within(preview).getByText('출처를 알 수 없는 문구 · 문구는 그대로 고칠 수 있어요'),
  ).toBeInTheDocument()
  expect(warning).toHaveBeenCalledWith('Unknown bundle body source: template')
})

it('알림 목록 한 건이 깨지면 종 안에 응답을 읽지 못했다고 보인다', async () => {
  server.use(
    http.get('/api/v1/workspaces/:workspaceId/notifications', () =>
      ok({
        items: [
          {
            notification_id: 'nt_01',
            kind: 'message_received',
            text: '새 메시지',
            link: { type: 'thread', id: 'th_01' },
            read_at: null,
            created_at: 'yesterday',
          },
        ],
        unread_count: 1,
      }),
    ),
  )
  const user = userEvent.setup()
  renderApp(paths.members('ws_01'))
  await user.click(await screen.findByRole('button', { name: /^알림/ }))
  const panel = await screen.findByRole('dialog', { name: '알림 목록' })
  expect(await within(panel).findByText(INVALID)).toBeVisible()
})
