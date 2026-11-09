import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { focusManager } from '@tanstack/react-query'
import { messageInboxQueryOptions } from '@/entities/message'
import { advanceSessionGeneration } from '@/entities/user'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { notificationFixtures } from '@/shared/mock/fixtures/notification'
import type { MockNotification } from '@/shared/mock/fixtures/notification'
import { openMessageSockets } from '@/shared/mock/handlers/messageSocket'
import { applyScenario } from '@/shared/mock/scenarios'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import { isNotificationListRequest, recordRequests } from '@/shared/test/requests'
import type { RecordedRequest } from '@/shared/test/requests'
import { conversation, detail, reviewList, rowTexts } from './test/messageScreen'
import { renderApp } from './test/renderApp'

/*
 * #371 메시지 화면의 상태 따라가기 (D-136). 상시 polling 은 없다 — AI 초안을 기다리는 동안만 10초마다 다시 받고,
 * 그 밖의 서버 쪽 변화는 알림 종 목록(30초 간격)에 처음 보는 메시지 알림이 들어오면 다시 받는다.
 */

vi.setConfig({ testTimeout: 20_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  vi.useRealTimers()
  focusManager.setFocused(undefined)
})

type Log = ReturnType<typeof recordRequests>

const NEW_BODY = '하늘님, 퍼블리싱이랑 발표 자료 어디까지 됐는지 궁금해요!'

const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
async function until(check: () => void): Promise<void> {
  for (let waited = 0; ; waited += 20) {
    try {
      check()
      return
    } catch (error) {
      if (waited >= 2_000) throw error
      await pause(20)
    }
  }
}

const gets = (log: Log, path: string) =>
  log.started.filter((request) => request.method === 'GET' && request.path === path).length
const inboxGets = (log: Log) => gets(log, '/workspaces/ws_01/messages')
const threadGets = (log: Log) => gets(log, '/workspaces/ws_01/messages/threads/th_03')
const notificationGets = (log: Log) =>
  log.started.filter((r) => isNotificationListRequest(r)).length
const messageRequests = (requests: readonly RecordedRequest[]) =>
  requests.filter(({ path }) => path.startsWith('/workspaces/ws_01/messages'))

function bundleOf(bundleId: string) {
  const found = db.messageBundles.find(({ bundle_id }) => bundle_id === bundleId)
  if (!found) throw new Error(`mock bundle ${bundleId} is missing`)
  return found
}
function finishDraft() {
  Object.assign(bundleOf('bd_02'), {
    body: NEW_BODY,
    body_source: 'ai',
    draft_status: 'done',
    draft_version: 2,
  })
}
function notify(id: string, kind: string, createdAt: string = MOCK_NOW) {
  const notification: MockNotification = {
    notification_id: id,
    workspace_id: 'ws_01',
    member_id: 'mb_01',
    kind,
    text: '이재환님이 답장해 재촉 하나를 보내지 않기로 했어요.',
    link: { type: 'thread', id: 'th_01' },
    read_at: null,
    created_at: createdAt,
  }
  db.notifications.push(notification)
}

const preview = () => detail().getByRole('region', { name: '보낼 메시지 미리보기' })

async function openDraftingReview() {
  const log = recordRequests()
  const app = renderApp(paths.messageReview('ws_01', 'bd_02'))
  await screen.findByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' })
  expect(within(preview()).getByText('문구 다듬는 중')).toBeVisible()
  await pause(150)
  return { app, log }
}

/** 화면의 첫 조회와, 대화 신호 소켓이 열린 뒤의 조회 하나 (#558). 알림 목록은 아직 메시지를 다시 받게 하지 않았다 */
const SETTLED_INBOX_GETS = 2

async function openSettledInbox() {
  finishDraft()
  db.notifications = structuredClone(notificationFixtures)
  const log = recordRequests()
  const app = renderApp(paths.messages('ws_01'))
  await until(() => expect(rowTexts(reviewList())).toHaveLength(2))
  await until(() => expect(notificationGets(log)).toBe(1))
  await until(() => expect(openMessageSockets()).toHaveLength(1))
  await until(() => expect(inboxGets(log)).toBe(SETTLED_INBOX_GETS))
  await pause(150)
  expect(inboxGets(log)).toBe(SETTLED_INBOX_GETS)
  return { app, log }
}

describe('AI 초안을 기다리는 동안만 다시 받는다', () => {
  it('10초마다 목록을 다시 받아 손대지 않아도 새 문구를 보이고, 초안이 끝나면 멈춘다', async () => {
    const { log } = await openDraftingReview()
    const first = inboxGets(log)

    await advance(9_999)
    await pause(100)
    expect(inboxGets(log)).toBe(first)

    finishDraft()
    await advance(1)
    await until(() => expect(within(preview()).getByText(NEW_BODY)).toBeVisible())
    expect(within(preview()).queryByText('문구 다듬는 중')).toBeNull()
    expect(inboxGets(log)).toBe(first + 1)

    await advance(30_000)
    await pause(150)
    expect(inboxGets(log)).toBe(first + 1)
  })

  it('초안을 기다리는 묶음이 없으면 간격으로 다시 받지 않는다', async () => {
    finishDraft()
    const log = recordRequests()
    renderApp(paths.messages('ws_01'))
    await until(() => expect(rowTexts(reviewList())).toHaveLength(2))
    await pause(150)
    const first = inboxGets(log)

    await advance(30_000)
    await pause(150)
    expect(inboxGets(log)).toBe(first)
  })

  it('탭이 가려져 있으면 초안을 기다려도 다시 받지 않는다', async () => {
    const { log } = await openDraftingReview()
    const first = inboxGets(log)
    focusManager.setFocused(false)
    finishDraft()

    await advance(30_000)
    await pause(150)
    expect(inboxGets(log)).toBe(first)
    expect(within(preview()).getByText('문구 다듬는 중')).toBeVisible()
  })

  it('대화도 그 대화의 예정 묶음이 초안을 기다리는 동안 다시 받는다', async () => {
    const log = recordRequests()
    renderApp(paths.messageThread('ws_01', 'th_03'))
    expect(await screen.findByRole('heading', { level: 2, name: '정하늘' })).toBeVisible()
    expect(within(conversation()).getByText('문구 다듬는 중')).toBeVisible()
    await pause(150)
    const first = threadGets(log)

    finishDraft()
    await advance(10_000)
    await until(() => expect(within(conversation()).getByText(NEW_BODY)).toBeVisible())
    expect(within(conversation()).queryByText('문구 다듬는 중')).toBeNull()
    expect(threadGets(log)).toBe(first + 1)

    await advance(30_000)
    await pause(150)
    expect(threadGets(log)).toBe(first + 1)
  })

  it('초안을 기다리는 화면에서 로그아웃하면 그 뒤로 메시지를 다시 받지 않는다', async () => {
    const { app, log } = await openDraftingReview()
    await userEvent.click(screen.getByRole('button', { name: /^내 계정/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '로그아웃' }))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await app.expectPath('/login')
    const loggedOut = log.started.length

    await advance(30_000)
    await pause(150)
    expect(messageRequests(log.started.slice(loggedOut))).toEqual([])
  })
})

describe('처음 보는 메시지 알림이 오면 메시지를 다시 받는다', () => {
  it('첫 알림 목록으로는 다시 받지 않고, 자동 취소 알림이 오면 목록을 다시 받아 취소된 묶음이 빠진다', async () => {
    const { log } = await openSettledInbox()
    expect(inboxGets(log)).toBe(SETTLED_INBOX_GETS)

    bundleOf('bd_01').status = 'cancelled'
    notify('nt_10', 'reminder_auto_cancelled')
    await advance(30_000)
    await until(() => expect(rowTexts(reviewList())).toHaveLength(1))
    expect(rowTexts(reviewList())[0]).toContain('정하늘')
    expect(inboxGets(log)).toBe(SETTLED_INBOX_GETS + 1)
  })

  it('태스크 알림(무응답 막힘)으로는 메시지를 다시 받지 않는다', async () => {
    const { log } = await openSettledInbox()

    bundleOf('bd_01').status = 'cancelled'
    notify('nt_10', 'silence_blocked')
    await advance(30_000)
    await until(() => expect(notificationGets(log)).toBe(2))
    await pause(150)
    expect(inboxGets(log)).toBe(SETTLED_INBOX_GETS)
    expect(rowTexts(reviewList())).toHaveLength(2)
  })

  it('메시지 알림이 더 최신 알림 50개에 밀려 목록에 보이지 않아도, 이전 목록과 겹치지 않는 꽉 찬 목록이면 한 번 다시 받는다', async () => {
    const { log } = await openSettledInbox()

    bundleOf('bd_01').status = 'cancelled'
    notify('nt_10', 'reminder_auto_cancelled')
    for (let n = 1; n <= 50; n += 1)
      notify(
        `nt_${100 + n}`,
        'silence_blocked',
        new Date(Date.parse(MOCK_NOW) + n * 1_000).toISOString(),
      )
    await advance(30_000)
    await until(() => expect(rowTexts(reviewList())).toHaveLength(1))
    expect(inboxGets(log)).toBe(SETTLED_INBOX_GETS + 1)

    await advance(30_000)
    await until(() => expect(notificationGets(log)).toBe(3))
    await pause(150)
    expect(inboxGets(log)).toBe(SETTLED_INBOX_GETS + 1)
  })

  it('세션이 바뀐 뒤 처음 받은 알림 목록은 새 기준이라 이전 기준으로 무효화하지 않고, 이전 세션에 남은 화면은 무효화돼도 다시 받지 않는다', async () => {
    const { app, log } = await openSettledInbox()
    const inboxInvalidated = () =>
      app.queryClient.getQueryState(messageInboxQueryOptions('ws_01').queryKey)?.isInvalidated

    act(() => advanceSessionGeneration())
    bundleOf('bd_01').status = 'cancelled'
    notify('nt_10', 'reminder_auto_cancelled')
    await advance(30_000)
    await until(() => expect(notificationGets(log)).toBe(2))
    await pause(150)
    expect(inboxInvalidated()).toBe(false)

    notify('nt_11', 'nudge_suggested')
    await advance(30_000)
    await until(() => expect(inboxInvalidated()).toBe(true))
    await pause(150)
    expect(inboxGets(log)).toBe(SETTLED_INBOX_GETS)
    expect(rowTexts(reviewList())).toHaveLength(2)
  })

  it('PM 이 내 대화에 쓰면 새 메시지 알림이 오고, 처음 보는 그 알림으로 대화를 다시 받아 PM 글이 보인다 (#519)', async () => {
    applyScenario('messages-pm-thread')
    const pmSession = db.session
    // 박민수(mb_02)는 초대를 수락한 us_02 로 이어져 있다
    const minsuSession = {
      user: {
        user_id: 'us_02',
        username: 'minsu',
        email: 'minsu@example.com',
        name: '박민수',
        avatar_url: null,
      },
      workspace_count: 1,
      last_workspace_id: 'ws_01',
    }
    db.consents.push(
      ...db.consents
        .filter(({ user_id }) => user_id === pmSession.user.user_id)
        .map((consent) => ({ ...consent, user_id: minsuSession.user.user_id })),
    )
    db.session = minsuSession
    const log = recordRequests()
    renderApp(paths.messages('ws_01'))
    await until(() =>
      expect(
        within(conversation()).getByText('민수님, 올려 주신 화면 확인했어요. 고마워요!'),
      ).toBeVisible(),
    )
    await until(() => expect(notificationGets(log)).toBe(1))
    await pause(150)
    const threadGetsBefore = gets(log, '/workspaces/ws_01/messages/threads/th_02')

    const body = '민수님, 발표 자료도 같이 봐 주세요.'
    db.session = pmSession
    await fetchDto(
      '/workspaces/ws_01/messages/threads/th_02/replies',
      jsonRequest('POST', { body }),
    )
    db.session = minsuSession
    expect(within(conversation()).queryByText(body)).toBeNull()

    await advance(30_000)
    expect(await within(conversation()).findByText(body)).toBeVisible()
    expect(gets(log, '/workspaces/ws_01/messages/threads/th_02')).toBeGreaterThan(threadGetsBefore)

    await userEvent.click(screen.getByRole('button', { name: '알림, 읽지 않은 알림 1개' }))
    const bell = await screen.findByRole('dialog', { name: '알림 목록' })
    expect(within(bell).getByRole('listitem')).toHaveTextContent('새 메시지가 왔어요')
    expect(within(bell).getByRole('listitem')).toHaveTextContent(`김서연: ${body}`)
  })
})
