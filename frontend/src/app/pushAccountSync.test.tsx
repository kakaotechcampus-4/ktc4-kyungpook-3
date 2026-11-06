import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { workspaceListQueryOptions } from '@/entities/workspace'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { applyScenario } from '@/shared/mock/scenarios'
import { recordRequests } from '@/shared/test/requests'
import { installPushBrowser } from './test/pushBrowser'
import { renderApp } from './test/renderApp'

/*
 * #411 리뷰 1. 이 기기의 푸시 구독은 지금 로그인한 계정으로 등록돼 있어야 한다.
 * 세션 만료는 구독을 풀지 않으므로, 로그인 세션마다 기존 구독을 그 계정으로 옮긴다 — 알림 띠를 닫았어도 그렇다
 */

vi.setConfig({ testTimeout: 15_000 })

beforeEach(() => {
  window.localStorage.clear()
})

const THREAD = paths.messageThread('ws_01', 'th_06')
const ACCOUNT_A = { id: 'us_01', email: 'pm@example.com' }
const ACCOUNT_B = { id: 'us_02', email: 'member@example.com' }
const closedRecord = (userId: string) =>
  window.localStorage.getItem(`browser-push-prompt-closed:${userId}`)
const owners = () => db.push.subscriptions.map(({ user_id }) => user_id)

function addAccountB() {
  db.accounts.push({
    session: {
      user: { user_id: ACCOUNT_B.id, email: ACCOUNT_B.email, name: '이재환', avatar_url: null },
      workspace_count: 1,
      last_workspace_id: 'ws_01',
    },
    password: 'mock-password',
    workspaceIds: ['ws_01'],
    memberIds: { ws_01: 'mb_03' },
  })
}

/** 다른 요청의 401 로 지금 세션이 만료된다. 직접 로그아웃과 달리 구독을 풀지 않는다 */
async function expireSession(app: ReturnType<typeof renderApp>) {
  db.authenticated = false
  await act(async () => {
    await app.queryClient.invalidateQueries({
      queryKey: workspaceListQueryOptions().queryKey,
      refetchType: 'all',
    })
  })
  await app.expectPath('/login')
}

async function logIn(email: string) {
  await screen.findByRole('heading', { name: '로그인' })
  await userEvent.type(screen.getByLabelText('이메일'), email)
  await userEvent.type(screen.getByLabelText('비밀번호'), 'mock-password')
  await userEvent.click(screen.getByRole('button', { name: '로그인' }))
}

describe('로그인 세션마다 이 기기의 푸시 구독을 지금 계정으로 옮긴다', () => {
  it('만료 뒤 A→B→A 로 바꿔 로그인하면 구독의 수신자는 매번 지금 계정이다. A 가 띠를 닫아 두었어도 그렇다', async () => {
    applyScenario('messages-member')
    db.push.publicKey = 'AQID'
    addAccountB()
    const browser = installPushBrowser({ permission: 'granted', subscribed: true })

    const app = renderApp(THREAD)
    await waitFor(() => expect(owners()).toEqual([ACCOUNT_A.id]))
    await waitFor(() => expect(closedRecord(ACCOUNT_A.id)).not.toBeNull())

    await expireSession(app)
    await logIn(ACCOUNT_B.email)
    await app.expectPath(THREAD)
    // B 는 설정의 브라우저 알림도 지난다. 세션 동기화가 없어도 구독이 B 로 옮겨 가는 길이라, 마지막 A 의 확인이 닫음 기록을 넘는지만 가른다
    act(() => app.navigate(paths.settings('ws_01')))
    expect(await screen.findByText('이 기기에서 브라우저 알림을 받고 있어요.')).toBeInTheDocument()
    expect(owners()).toEqual([ACCOUNT_B.id])
    act(() => app.navigate(THREAD))
    await app.expectPath(THREAD)

    await expireSession(app)
    expect(closedRecord(ACCOUNT_A.id)).not.toBeNull()
    await logIn(ACCOUNT_A.email)
    await app.expectPath(THREAD)
    await screen.findByRole('region', { name: '대화 내용' })

    await waitFor(() => expect(owners()).toEqual([ACCOUNT_A.id]))
    expect(screen.queryByRole('region', { name: '기기 알림' })).toBeNull()
    expect(browser.subscription.unsubscribe).not.toHaveBeenCalled()
    expect(browser.notification.requestPermission).not.toHaveBeenCalled()
  })

  it.each(['default', 'denied'] as const)(
    '알림 허용이 %s 이면 로그인 세션은 구독을 보내지도 허용을 묻지도 않는다',
    async (permission) => {
      const browser = installPushBrowser({ permission, subscribed: true })
      const log = recordRequests()
      renderApp(paths.members('ws_01'))
      await screen.findByText('김서연')

      expect(log.started.filter(({ path }) => path.startsWith('/push/'))).toEqual([])
      expect(browser.notification.requestPermission).not.toHaveBeenCalled()
      expect(browser.pushManager.getSubscription).not.toHaveBeenCalled()
    },
  )

  it('허용돼 있으면 어느 화면이든 로그인 세션이 공개키를 묻거나 허용을 묻지 않고 구독만 한 번 보낸다', async () => {
    const browser = installPushBrowser({ permission: 'granted', subscribed: true })
    const log = recordRequests()
    renderApp(paths.members('ws_01'), { strict: true })
    await screen.findByText('김서연')

    await waitFor(() => expect(owners()).toEqual([ACCOUNT_A.id]))
    expect(log.started.filter(({ path }) => path.startsWith('/push/'))).toEqual([
      { method: 'POST', path: '/push/subscriptions' },
    ])
    expect(browser.notification.requestPermission).not.toHaveBeenCalled()
  })
})
