import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getResponse, http } from 'msw'
import { messageKeys } from '@/entities/message'
import { advanceSessionGeneration } from '@/entities/user'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { reply } from '@/shared/mock/fixtures/message'
import { handlers } from '@/shared/mock/handlers'
import {
  closeMessageSockets,
  openMessageSockets,
  signalThreadUpdated,
} from '@/shared/mock/handlers/messageSocket'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import type { RequestLog } from '@/shared/test/requests'
import { conversation } from './test/messageScreen'
import { renderApp } from './test/renderApp'

/*
 * #558 메시지 화면이 떠 있는 동안 대화 신호 웹소켓으로 새 글을 바로 받는다 (계약 §5.7 「대화 신호 웹소켓」).
 * 30초 알림 polling 은 그대로라 이 파일은 가짜 시계를 쓰지 않는다 — 기다리지 않고 보이면 신호로 받은 것이다.
 * 연결 규칙(닫힘 코드 표·기다림 간격·늦은 이벤트)은 entities/message 의 messageSignals 테스트가 본다
 */

vi.setConfig({ testTimeout: 20_000 })

const NEW_REPLY = '방금 웹에서 남긴 답장이에요'
/** 첫 다시 붙기(1초)보다 넉넉히 */
const PAST_FIRST_RETRY_MS = 1_500

const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

const messageGets = (log: RequestLog) =>
  log.started.filter(
    ({ method, path }) => method === 'GET' && path.startsWith('/workspaces/ws_01/messages'),
  )

const INBOX_PATH = '/workspaces/ws_01/messages'
const THREAD_PATH = '/workspaces/ws_01/messages/threads/th_01'
const getsTo = (log: RequestLog, path: string) =>
  messageGets(log).filter((request) => request.path === path)

/**
 * 그 경로의 다음 GET 하나를 붙잡는다. 답은 요청을 받은 순간의 서버 상태다 — 풀기 전에 새 글이 생겨도 그 글이 없는 옛 답이다
 */
function holdSnapshot(path: string) {
  const gate = deferred()
  const taken = deferred()
  server.use(
    http.get(
      `/api/v1${path}`,
      async ({ request }) => {
        const snapshot = await getResponse(handlers, request.clone())
        taken.resolve()
        await gate.promise
        return snapshot
      },
      { once: true },
    ),
  )
  return { taken: taken.promise, release: gate.resolve }
}

function threadOf(threadId: string) {
  const found = db.messageThreads.find(({ thread_id }) => thread_id === threadId)
  if (!found) throw new Error(`mock thread ${threadId} is missing`)
  return found
}

/** 신호 없이 db 에만 답장을 넣는다. 소켓이 없던 동안 쓰인 글이다 */
function storeReply(threadId: string, body: string) {
  threadOf(threadId).messages.push(reply('mg_90', body, MOCK_NOW, 'web'))
}

/** 이재환이 다른 기기에서 웹으로 답장했다. 모의 서버의 세션은 이 화면의 PM 하나라 답장은 db 에 직접 쓰고 신호를 보낸다 */
function memberReplies(threadId: string, body: string) {
  const thread = threadOf(threadId)
  thread.messages.push(reply('mg_90', body, MOCK_NOW, 'web'))
  signalThreadUpdated(thread)
}

async function openThread(threadId = 'th_01', options?: { strict?: boolean }) {
  const app = renderApp(paths.messageThread('ws_01', threadId), options)
  expect(await screen.findByRole('heading', { level: 2, name: '이재환' })).toBeVisible()
  await waitFor(() =>
    expect(openMessageSockets()).toEqual([{ workspaceId: 'ws_01', userId: 'us_01' }]),
  )
  return app
}

it('대화를 열어 둔 채 상대가 답장하면 polling 을 기다리지 않고 대화에 나타난다', async () => {
  await openThread()
  expect(within(conversation()).queryByText(NEW_REPLY)).toBeNull()

  memberReplies('th_01', NEW_REPLY)
  expect(await within(conversation()).findByText(NEW_REPLY)).toBeVisible()
})

it('StrictMode 로 두 번 마운트해도 열린 연결은 하나이고 신호를 받는다', async () => {
  await openThread('th_01', { strict: true })
  await pause(100)
  expect(openMessageSockets()).toHaveLength(1)

  memberReplies('th_01', NEW_REPLY)
  expect(await within(conversation()).findByText(NEW_REPLY)).toBeVisible()
})

it('서버가 재시작(1012)으로 닫으면 다시 붙고, 붙자마자 목록과 대화를 다시 받는다', async () => {
  await openThread()
  await pause(100)
  const log = recordRequests()

  closeMessageSockets(1012)
  await waitFor(() => expect(openMessageSockets()).toHaveLength(0))
  expect(messageGets(log)).toEqual([])

  await waitFor(() => expect(openMessageSockets()).toHaveLength(1))
  await waitFor(() =>
    expect(messageGets(log).map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        '/workspaces/ws_01/messages',
        '/workspaces/ws_01/messages/threads/th_01',
      ]),
    ),
  )
})

it.each([4401, 4403])('서버가 %i 로 닫으면 다시 붙지 않고 화면은 그대로다', async (code) => {
  await openThread()
  closeMessageSockets(code)
  await pause(PAST_FIRST_RETRY_MS)
  expect(openMessageSockets()).toEqual([])
  expect(screen.getByRole('heading', { level: 2, name: '이재환' })).toBeVisible()
})

it('메시지 화면을 떠나면 연결을 닫고 다시 붙지 않는다', async () => {
  const app = await openThread()
  app.navigate(paths.dashboard('ws_01'))
  await app.expectPath(paths.dashboard('ws_01'))
  await waitFor(() => expect(openMessageSockets()).toEqual([]))
  await pause(PAST_FIRST_RETRY_MS)
  expect(openMessageSockets()).toEqual([])
})

it('공간을 바꾸면 이전 공간의 연결을 닫고 새 공간에 붙는다', async () => {
  const other = db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_02')
  if (!other) throw new Error('mock workspace ws_02 is missing')
  other.onboarding.completed = true
  const app = await openThread()
  app.navigate(paths.messages('ws_02'))
  await waitFor(() =>
    expect(openMessageSockets()).toEqual([{ workspaceId: 'ws_02', userId: 'us_01' }]),
  )
  await pause(PAST_FIRST_RETRY_MS)
  expect(openMessageSockets()).toEqual([{ workspaceId: 'ws_02', userId: 'us_01' }])
})

it('로그아웃하면 연결을 닫고 다시 붙지 않는다', async () => {
  const app = await openThread()
  await userEvent.click(screen.getByRole('button', { name: /^내 계정/ }))
  await userEvent.click(await screen.findByRole('menuitem', { name: '로그아웃' }))
  await app.expectPath('/login')
  await waitFor(() => expect(openMessageSockets()).toEqual([]))
  await pause(PAST_FIRST_RETRY_MS)
  expect(openMessageSockets()).toEqual([])
})

it('화면이 떠 있는 채 세션이 바뀌면 이전 세션의 연결을 닫고, 그 뒤의 신호로 다음 세션의 메시지를 다시 받지 않는다', async () => {
  await openThread()
  await pause(100)
  const log = recordRequests()

  act(() => advanceSessionGeneration())
  await waitFor(() => expect(openMessageSockets()).toEqual([]))
  memberReplies('th_01', NEW_REPLY)
  await pause(PAST_FIRST_RETRY_MS)

  expect(openMessageSockets()).toEqual([])
  expect(messageGets(log)).toEqual([])
  expect(within(conversation()).queryByText(NEW_REPLY)).toBeNull()
})

describe('신호가 받는 중인 조회와 겹칠 때', () => {
  const showsNewReply = () =>
    waitFor(() => expect(within(conversation()).getByText(NEW_REPLY)).toBeVisible())

  it('첫 조회를 받는 중에 신호가 오면, 신호 이전의 답이 와도 새 글을 다시 받아 보여 준다', async () => {
    const inbox = holdSnapshot(INBOX_PATH)
    const thread = holdSnapshot(THREAD_PATH)
    const log = recordRequests()
    renderApp(paths.messageThread('ws_01', 'th_01'))
    await Promise.all([inbox.taken, thread.taken])
    await waitFor(() => expect(openMessageSockets()).toHaveLength(1))

    memberReplies('th_01', NEW_REPLY)
    await pause(100)
    inbox.release()
    thread.release()

    await showsNewReply()
    expect(getsTo(log, THREAD_PATH).length).toBeGreaterThan(1)
    expect(getsTo(log, INBOX_PATH).length).toBeGreaterThan(1)
  })

  it('첫 조회를 받는 중에 소켓이 열리면, 그 조회가 끝난 뒤 한 번 더 받는다', async () => {
    const inbox = holdSnapshot(INBOX_PATH)
    const thread = holdSnapshot(THREAD_PATH)
    const log = recordRequests()
    renderApp(paths.messageThread('ws_01', 'th_01'))
    await Promise.all([inbox.taken, thread.taken])
    await waitFor(() => expect(openMessageSockets()).toHaveLength(1))
    await pause(100)
    expect(getsTo(log, THREAD_PATH)).toHaveLength(1)

    storeReply('th_01', NEW_REPLY)
    inbox.release()
    thread.release()

    await showsNewReply()
    expect(getsTo(log, THREAD_PATH)).toHaveLength(2)
    expect(getsTo(log, INBOX_PATH)).toHaveLength(2)
  })

  it('끊긴 동안 시작한 조회가 다시 붙은 뒤에 끝나도, 끊긴 동안의 새 글을 받는다', async () => {
    const app = await openThread()
    await pause(100)
    closeMessageSockets(1012)
    await waitFor(() => expect(openMessageSockets()).toHaveLength(0))

    const thread = holdSnapshot(THREAD_PATH)
    const log = recordRequests()
    void app.queryClient.invalidateQueries({ queryKey: messageKeys('ws_01') })
    await thread.taken
    storeReply('th_01', NEW_REPLY)
    await waitFor(() => expect(openMessageSockets()).toHaveLength(1))
    await pause(100)
    thread.release()

    await showsNewReply()
    expect(getsTo(log, THREAD_PATH).length).toBeGreaterThan(1)
  })

  it('받는 중인 조회가 끝나기 전에 화면을 떠나면, 끝난 뒤 메시지를 다시 받지 않는다', async () => {
    const thread = holdSnapshot(THREAD_PATH)
    const app = renderApp(paths.messageThread('ws_01', 'th_01'))
    await thread.taken
    await waitFor(() => expect(openMessageSockets()).toHaveLength(1))
    await pause(100)

    app.navigate(paths.dashboard('ws_01'))
    await app.expectPath(paths.dashboard('ws_01'))
    const log = recordRequests()
    thread.release()
    await pause(PAST_FIRST_RETRY_MS)

    expect(messageGets(log)).toEqual([])
  })

  it('받는 중인 조회가 끝나기 전에 세션이 바뀌면, 끝난 뒤 메시지를 다시 받지 않는다', async () => {
    const thread = holdSnapshot(THREAD_PATH)
    renderApp(paths.messageThread('ws_01', 'th_01'))
    await thread.taken
    await waitFor(() => expect(openMessageSockets()).toHaveLength(1))
    await pause(100)

    const log = recordRequests()
    act(() => advanceSessionGeneration())
    thread.release()
    await pause(PAST_FIRST_RETRY_MS)

    expect(messageGets(log)).toEqual([])
  })
})
