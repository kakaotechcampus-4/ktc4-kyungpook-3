import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { advanceSessionGeneration } from '@/entities/user'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { reply } from '@/shared/mock/fixtures/message'
import {
  closeMessageSockets,
  openMessageSockets,
  signalThreadUpdated,
} from '@/shared/mock/handlers/messageSocket'
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

function threadOf(threadId: string) {
  const found = db.messageThreads.find(({ thread_id }) => thread_id === threadId)
  if (!found) throw new Error(`mock thread ${threadId} is missing`)
  return found
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
