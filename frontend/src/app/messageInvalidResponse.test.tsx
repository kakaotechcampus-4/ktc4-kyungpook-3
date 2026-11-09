import type { MockInstance } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { focusManager, onlineManager } from '@tanstack/react-query'
import { getResponse, http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { ok } from '@/shared/mock/envelope'
import { messageHandlers } from '@/shared/mock/handlers/message'
import { openMessageSockets, signalThreadUpdated } from '@/shared/mock/handlers/messageSocket'
import { server } from '@/shared/mock/server'
import { isNotificationListRequest, recordRequests } from '@/shared/test/requests'
import type { RequestLog } from '@/shared/test/requests'
import { detail, list, reviewList, rowTexts } from './test/messageScreen'
import { renderApp } from './test/renderApp'

/*
 * #348 — 메시지·알림 응답이 스키마에 맞지 않을 때 화면. 모르는 보낸 쪽·묶음 상태는 다른 값으로 그리지 않고 응답을 읽지 못했다고
 * 알리며 재시도하지 않는다. 모르는 문구 출처는 표시용 분류라 묶음을 보이되 출처를 짐작하지 않는다.
 * 읽지 못한 조회는 스스로 다시 묻지 않는다 — 초안 간격(10초)·알림 간격(30초)·창 포커스·연결 복귀·대화 신호 소켓 모두.
 * 사용자의 다시 시도가 성공하면 간격이 다시 돈다 (D-184)
 */

vi.setConfig({ testTimeout: 15_000 })

const INVALID = '응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.'

let warning: MockInstance<typeof console.warn>
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date(MOCK_NOW))
  warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  warning.mockRestore()
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})

const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
async function until(check: () => void): Promise<void> {
  for (let waited = 0; ; waited += 20) {
    try {
      check()
      return
    } catch (error) {
      if (waited >= 3_000) throw error
      await wait(20)
    }
  }
}

const INBOX_PATH = '/workspaces/ws_01/messages'
const THREAD_PATH = '/workspaces/ws_01/messages/threads/th_01'
const ATTRIBUTIONS_PATH = `${THREAD_PATH}/attributions`
const gets = (log: RequestLog, path: string) =>
  log.started.filter((request) => request.method === 'GET' && request.path === path).length
const notificationGets = (log: RequestLog) =>
  log.started.filter((request) => isNotificationListRequest(request)).length

/** 소켓이 열리고 그에 따른 받기(`opened`)까지 끝난 뒤 */
async function socketSettled() {
  await until(() => expect(openMessageSockets()).toHaveLength(1))
  await wait(300)
}

/**
 * 스스로 다시 묻는 길을 모두 지난다 — 초안 간격과 알림 간격을 넘기고(재시도 대기 1초도), 창 포커스와 연결이 돌아오고,
 * 그 공간 대화마다 새 글 신호가 온다
 */
async function passAutomaticRefetches() {
  await advance(31_000)
  await wait(150)
  act(() => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
  await wait(150)
  act(() => {
    onlineManager.setOnline(false)
    onlineManager.setOnline(true)
  })
  await wait(150)
  for (const thread of db.messageThreads.filter(({ workspace_id }) => workspace_id === 'ws_01'))
    signalThreadUpdated(thread)
  await wait(300)
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
  const log = recordRequests()
  renderApp(paths.messageThread('ws_01', 'th_01'))
  expect(await screen.findByText('대화를 불러오지 못했어요', {}, { timeout: 5_000 })).toBeVisible()
  expect(detail().getByText(INVALID)).toBeVisible()

  await socketSettled()
  await passAutomaticRefetches()
  expect(gets(log, THREAD_PATH)).toBe(1)

  server.resetHandlers()
  fireEvent.click(detail().getByRole('button', { name: '다시 시도' }))
  expect(await detail().findByRole('region', { name: '대화 내용' })).toBeVisible()
})

function pausedFirst(data: Inbox): Inbox {
  return {
    ...data,
    bundles:
      data.bundles?.map((bundle, index) =>
        index === 0 ? { ...bundle, status: 'paused' } : bundle,
      ) ?? null,
  }
}

it('목록의 묶음 한 건이 모르는 상태면 목록 대신 안내를 보이고 스스로 다시 묻지 않다가, 다시 시도가 성공하면 간격이 다시 돈다', async () => {
  let broken = true
  server.use(
    patched<Inbox>('/workspaces/:workspaceId/messages', (data) =>
      broken ? pausedFirst(data) : data,
    ),
  )
  const log = recordRequests()
  renderApp(paths.messages('ws_01'))
  expect(
    await screen.findByText('메시지 목록을 불러오지 못했어요', {}, { timeout: 5_000 }),
  ).toBeVisible()
  expect(list().getByText(INVALID)).toBeVisible()
  await socketSettled()
  await passAutomaticRefetches()
  expect(gets(log, INBOX_PATH)).toBe(1)

  broken = false
  fireEvent.click(list().getByRole('button', { name: '다시 시도' }))
  await until(() => expect(rowTexts(reviewList())).toHaveLength(2))
  expect(gets(log, INBOX_PATH)).toBe(2)
  // 다시 받은 목록에 초안을 기다리는 묶음(bd_02)이 있어 10초 간격이 다시 돈다
  await advance(10_000)
  await until(() => expect(gets(log, INBOX_PATH)).toBe(3))
})

it('초안을 기다리던 목록이 다음 받기에서 읽지 못하면 받아 둔 목록이 있어도 스스로 다시 묻지 않는다', async () => {
  let broken = false
  server.use(
    patched<Inbox>('/workspaces/:workspaceId/messages', (data) =>
      broken ? pausedFirst(data) : data,
    ),
  )
  const log = recordRequests()
  renderApp(paths.messageReview('ws_01', 'bd_02'))
  await screen.findByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' }, { timeout: 5_000 })
  await socketSettled()
  const healthy = gets(log, INBOX_PATH)

  broken = true
  await advance(10_000)
  await until(() => expect(gets(log, INBOX_PATH)).toBe(healthy + 1))
  await wait(150)
  await passAutomaticRefetches()
  expect(gets(log, INBOX_PATH)).toBe(healthy + 1)
})

it('읽지 못한 답장 고르기는 창 포커스·연결 복귀·대화 신호로 다시 묻지 않는다', async () => {
  // 모의 서버의 이 대화에는 고를 답장이 없다. 모르는 상태의 고르기 하나를 준다
  server.use(
    http.get('/api/v1/workspaces/:workspaceId/messages/threads/:threadId/attributions', () =>
      ok({ items: [{ message_id: 'mg_02', status: 'guessed' }] }),
    ),
  )
  const log = recordRequests()
  renderApp(paths.messageThread('ws_01', 'th_01'))
  expect(await screen.findByRole('region', { name: '대화 내용' }, { timeout: 5_000 })).toBeVisible()
  await until(() => expect(gets(log, ATTRIBUTIONS_PATH)).toBeGreaterThan(0))
  await socketSettled()
  const shown = gets(log, ATTRIBUTIONS_PATH)
  const threadShown = gets(log, THREAD_PATH)

  await passAutomaticRefetches()
  expect(gets(log, ATTRIBUTIONS_PATH)).toBe(shown)
  // 같은 신호로 읽을 수 있는 대화는 다시 받는다 — 신호를 통째로 끈 것이 아니다
  expect(gets(log, THREAD_PATH)).toBeGreaterThan(threadShown)
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

it('알림 목록 한 건이 깨지면 종 안에 응답을 읽지 못했다고 보이고, 30초 간격·포커스·연결 복귀로 다시 묻지 않는다', async () => {
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
  const log = recordRequests()
  renderApp(paths.members('ws_01'))
  fireEvent.click(await screen.findByRole('button', { name: /^알림/ }))
  const panel = await screen.findByRole('dialog', { name: '알림 목록' })
  expect(await within(panel).findByText(INVALID)).toBeVisible()
  expect(notificationGets(log)).toBe(1)

  await passAutomaticRefetches()
  await advance(31_000)
  await wait(150)
  expect(notificationGets(log)).toBe(1)

  server.resetHandlers()
  fireEvent.click(within(panel).getByRole('button', { name: '다시 시도' }))
  await until(() => expect(within(panel).queryByText(INVALID)).toBeNull())
  expect(notificationGets(log)).toBe(2)
  await advance(30_000)
  await until(() => expect(notificationGets(log)).toBe(3))
})
