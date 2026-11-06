import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { onTestFinished } from 'vitest'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import { ENDPOINT, KEYS, installPushBrowser } from './test/pushBrowser'
import { renderApp } from './test/renderApp'

/*
 * #330 브라우저 푸시. jsdom 에는 서비스 워커·푸시가 없어 브라우저 쪽만 바꿔 끼운다. 서버는 MSW 다.
 * 알림 허용은 설정의 버튼을 누른 뒤에만 묻고, 로그아웃은 구독을 지운 뒤에 한다
 */

async function openSettings() {
  const app = renderApp(paths.settings('ws_01'))
  const control = (await screen.findByText('이 기기의 브라우저 알림')).parentElement!
    .parentElement as HTMLElement
  return { app, control }
}

describe('설정의 브라우저 푸시 (#330)', () => {
  it('지원하지 않는 브라우저는 안내만 하고 서버에 묻지 않는다', async () => {
    const log = recordRequests()
    const { control } = await openSettings()
    expect(control).toHaveTextContent('이 브라우저는 푸시 알림을 받을 수 없어요.')
    expect(within(control).queryByRole('button')).toBeNull()
    expect(log.started.some(({ path }) => path.startsWith('/push/'))).toBe(false)
  })

  it('서버에 공개키가 없으면 구독하지 않고 알림 허용도 묻지 않는다', async () => {
    const browser = installPushBrowser()
    const { control } = await openSettings()
    await waitFor(() => expect(control).toHaveTextContent('아직 브라우저 알림을 보낼 수 없어요.'))
    expect(within(control).queryByRole('button')).toBeNull()
    expect(browser.notification.requestPermission).not.toHaveBeenCalled()
    expect(browser.container.register).not.toHaveBeenCalled()
  })

  it('화면을 열 때는 묻지 않고, 누르면 허용을 물은 뒤 구독해 서버에 보낸다', async () => {
    db.push.publicKey = 'AQID'
    const user = userEvent.setup()
    const browser = installPushBrowser()
    const bodies = recordRequestBodies('POST', '/push/subscriptions')
    const { control } = await openSettings()
    const enable = await within(control).findByRole('button', { name: '브라우저 알림 켜기' })
    await waitFor(() => expect(enable).toBeEnabled())
    expect(control).toHaveTextContent('켜면 새 알림이 올 때 이 기기로 바로 알려 드려요.')
    expect(browser.notification.requestPermission).not.toHaveBeenCalled()

    await user.click(enable)

    await waitFor(() =>
      expect(control).toHaveTextContent('이 기기에서 브라우저 알림을 받고 있어요.'),
    )
    expect(browser.notification.requestPermission).toHaveBeenCalledTimes(1)
    const [url, options] = browser.container.register.mock.calls[0]
    // 푸시 워커는 MSW(`/`)와 다른 범위에 등록한다
    expect(new URL(options.scope!).pathname).not.toBe('/')
    expect(new URL(url).href.startsWith(options.scope!)).toBe(true)
    expect(browser.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3]),
    })
    expect(bodies).toEqual([{ endpoint: ENDPOINT, keys: KEYS }])
    expect(db.push.subscriptions).toEqual([{ endpoint: ENDPOINT, keys: KEYS, user_id: 'us_01' }])
  })

  it('허용하지 않으면 막혔다고 안내하고 구독하지 않는다', async () => {
    db.push.publicKey = 'AQID'
    const user = userEvent.setup()
    const browser = installPushBrowser({ answer: 'denied' })
    const { control } = await openSettings()
    const enable = await within(control).findByRole('button', { name: '브라우저 알림 켜기' })
    await waitFor(() => expect(enable).toBeEnabled())
    await user.click(enable)

    await waitFor(() => expect(control).toHaveTextContent('알림이 막혀 있어요.'))
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled()
    expect(db.push.subscriptions).toEqual([])
  })

  it('서버 등록이 실패하면 다시 시도할 수 있다', async () => {
    db.push.publicKey = 'AQID'
    server.use(
      http.post('/api/v1/push/subscriptions', () => fail('INTERNAL_ERROR', 'boom', 500), {
        once: true,
      }),
    )
    const user = userEvent.setup()
    installPushBrowser()
    const { control } = await openSettings()
    const enable = await within(control).findByRole('button', { name: '브라우저 알림 켜기' })
    await waitFor(() => expect(enable).toBeEnabled())
    await user.click(enable)

    expect(await within(control).findByRole('alert')).toHaveTextContent(
      '브라우저 알림을 켜지 못했어요.',
    )
    await user.click(within(control).getByRole('button', { name: '다시 시도' }))
    await waitFor(() =>
      expect(control).toHaveTextContent('이 기기에서 브라우저 알림을 받고 있어요.'),
    )
    expect(db.push.subscriptions).toHaveLength(1)
  })

  it('이미 구독한 기기는 지금 계정으로 다시 등록하고 켜져 있다고 보인다', async () => {
    db.push.publicKey = 'AQID'
    installPushBrowser({ permission: 'granted', subscribed: true })
    const bodies = recordRequestBodies('POST', '/push/subscriptions')
    const { control } = await openSettings()
    await waitFor(() =>
      expect(control).toHaveTextContent('이 기기에서 브라우저 알림을 받고 있어요.'),
    )
    expect(within(control).queryByRole('button')).toBeNull()
    // 로그인 세션의 계정 동기화가 한 번, 설정 화면의 상태 확인이 한 번 보낸다
    expect(bodies).toEqual([
      { endpoint: ENDPOINT, keys: KEYS },
      { endpoint: ENDPOINT, keys: KEYS },
    ])
    expect(db.push.subscriptions).toEqual([{ endpoint: ENDPOINT, keys: KEYS, user_id: 'us_01' }])
  })

  it('서버 등록이 실패한 뒤 다시 열면 다시 등록하고 나서 켜졌다고 보인다 (#330 검증 2)', async () => {
    db.push.publicKey = 'AQID'
    server.use(
      http.post('/api/v1/push/subscriptions', () => fail('INTERNAL_ERROR', 'boom', 500), {
        once: true,
      }),
    )
    const user = userEvent.setup()
    installPushBrowser()
    const bodies = recordRequestBodies('POST', '/push/subscriptions')
    const first = await openSettings()
    const enable = await within(first.control).findByRole('button', { name: '브라우저 알림 켜기' })
    await waitFor(() => expect(enable).toBeEnabled())
    await user.click(enable)
    expect(await within(first.control).findByRole('alert')).toHaveTextContent(
      '브라우저 알림을 켜지 못했어요.',
    )
    expect(db.push.subscriptions).toEqual([])
    first.app.unmount()

    const { control } = await openSettings()

    await waitFor(() =>
      expect(control).toHaveTextContent('이 기기에서 브라우저 알림을 받고 있어요.'),
    )
    // 실패한 켜기 한 번, 다시 연 앱의 로그인 세션 동기화와 설정 화면의 재등록이 한 번씩이다
    expect(bodies).toEqual([
      { endpoint: ENDPOINT, keys: KEYS },
      { endpoint: ENDPOINT, keys: KEYS },
      { endpoint: ENDPOINT, keys: KEYS },
    ])
    expect(db.push.subscriptions).toEqual([{ endpoint: ENDPOINT, keys: KEYS, user_id: 'us_01' }])
  })

  it('다시 열 때 재등록이 실패하면 켜졌다고 하지 않고 다시 시도할 수 있다 (#330 검증 2)', async () => {
    db.push.publicKey = 'AQID'
    // 로그인 세션의 계정 동기화도 같은 등록을 보낸다. 다시 시도를 누르기 전까지는 모두 실패한다
    let serverDown = true
    server.use(
      http.post('/api/v1/push/subscriptions', () =>
        serverDown ? fail('INTERNAL_ERROR', 'boom', 500) : undefined,
      ),
    )
    const user = userEvent.setup()
    installPushBrowser({ permission: 'granted', subscribed: true })
    const { control } = await openSettings()

    expect(await within(control).findByRole('alert')).toHaveTextContent(
      '브라우저 알림을 켜지 못했어요.',
    )
    expect(control).not.toHaveTextContent('이 기기에서 브라우저 알림을 받고 있어요.')
    expect(db.push.subscriptions).toEqual([])

    serverDown = false
    await user.click(within(control).getByRole('button', { name: '다시 시도' }))
    await waitFor(() =>
      expect(control).toHaveTextContent('이 기기에서 브라우저 알림을 받고 있어요.'),
    )
    expect(db.push.subscriptions).toEqual([{ endpoint: ENDPOINT, keys: KEYS, user_id: 'us_01' }])
  })
})

describe('로그아웃의 푸시 구독 해제 (#330)', () => {
  async function clickLogout(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /^내 계정/ }))
    await user.click(await screen.findByRole('menuitem', { name: '로그아웃' }))
  }

  async function logout() {
    const user = userEvent.setup()
    const app = renderApp(paths.members('ws_01'))
    await screen.findByText('김서연')
    await clickLogout(user)
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await app.expectPath('/login')
  }

  /** 설정에서 브라우저 알림 켜기를 누른다. 서비스 워커 등록은 걸린 채로 둔다 */
  async function startEnabling(user: ReturnType<typeof userEvent.setup>) {
    const { app, control } = await openSettings()
    const enable = await within(control).findByRole('button', { name: '브라우저 알림 켜기' })
    await waitFor(() => expect(enable).toBeEnabled())
    await user.click(enable)
    expect(control).toHaveTextContent('브라우저 알림을 켜고 있어요.')
    return app
  }

  /** 로그아웃의 3초 상한을 시계로 넘긴다. 그 밖의 시간은 실제처럼 흐른다 */
  function fakeTimeouts() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    onTestFinished(() => {
      vi.useRealTimers()
    })
  }

  it('켜는 중에 로그아웃하면 켜기가 끝나기를 기다린 뒤 그 구독을 서버와 브라우저에서 지운다 (#330 검증 1)', async () => {
    db.push.publicKey = 'AQID'
    const gate = deferred()
    const browser = installPushBrowser({ registerGate: gate.promise })
    const log = recordRequests()
    const user = userEvent.setup()
    const app = await startEnabling(user)
    await waitFor(() => expect(browser.container.register).toHaveBeenCalledTimes(1))

    await clickLogout(user)
    gate.resolve()

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await app.expectPath('/login')
    const saved = log.timeline.indexOf('answer POST /push/subscriptions')
    const removed = log.timeline.indexOf('answer DELETE /push/subscriptions')
    const loggedOut = log.timeline.indexOf('start POST /auth/logout')
    expect(saved).toBeGreaterThanOrEqual(0)
    expect(saved).toBeLessThan(removed)
    expect(removed).toBeLessThan(loggedOut)
    expect(db.push.subscriptions).toEqual([])
    expect(browser.subscription.unsubscribe).toHaveBeenCalledTimes(1)
    expect(await browser.pushManager.getSubscription()).toBeNull()
  })

  it('켜기가 3초를 넘기면 기다리지 않고 로그아웃하고, 늦게 끝난 켜기는 서버에 보내지 않고 브라우저 구독을 푼다 (#330 검증 1·3)', async () => {
    fakeTimeouts()
    db.push.publicKey = 'AQID'
    const gate = deferred()
    const browser = installPushBrowser({ registerGate: gate.promise })
    const bodies = recordRequestBodies('POST', '/push/subscriptions')
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    const app = await startEnabling(user)

    await clickLogout(user)
    await act(() => vi.advanceTimersByTimeAsync(3_000))

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await app.expectPath('/login')
    expect(db.authenticated).toBe(false)

    // 세션이 끝난 뒤에 서비스 워커 등록이 끝난다. 앞 계정의 구독이 서버에도 브라우저에도 남지 않는다
    gate.resolve()
    await waitFor(() => expect(browser.subscription.unsubscribe).toHaveBeenCalledTimes(1))
    expect(bodies).toEqual([])
    expect(db.push.subscriptions).toEqual([])
    expect(await browser.pushManager.getSubscription()).toBeNull()
  })

  it('브라우저 구독 해제가 끝나지 않아도 3초 뒤 로그아웃한다 (#330 검증 3)', async () => {
    fakeTimeouts()
    db.push.subscriptions = [{ endpoint: ENDPOINT, keys: KEYS, user_id: 'us_01' }]
    const browser = installPushBrowser({
      permission: 'granted',
      subscribed: true,
      unsubscribeHangs: true,
    })
    const log = recordRequests()
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    const app = renderApp(paths.members('ws_01'))
    await screen.findByText('김서연')

    await clickLogout(user)
    await waitFor(() => expect(browser.subscription.unsubscribe).toHaveBeenCalledTimes(1))
    expect(log.started.some(({ path }) => path === '/auth/logout')).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(3_000))

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await app.expectPath('/login')
    expect(db.authenticated).toBe(false)
    expect(db.push.subscriptions).toEqual([])
  })

  it('로그아웃 요청 전에 지금 endpoint 의 구독을 서버와 브라우저에서 지운다', async () => {
    db.push.subscriptions = [{ endpoint: ENDPOINT, keys: KEYS, user_id: 'us_01' }]
    const browser = installPushBrowser({ permission: 'granted', subscribed: true })
    const log = recordRequests()
    const bodies = recordRequestBodies('DELETE', '/push/subscriptions')

    await logout()

    expect(bodies).toEqual([{ endpoint: ENDPOINT }])
    expect(db.push.subscriptions).toEqual([])
    expect(browser.subscription.unsubscribe).toHaveBeenCalledTimes(1)
    const removed = log.timeline.indexOf('answer DELETE /push/subscriptions')
    const loggedOut = log.timeline.indexOf('start POST /auth/logout')
    expect(removed).toBeGreaterThanOrEqual(0)
    expect(removed).toBeLessThan(loggedOut)
  })

  it('서버 해제가 실패해도 로그아웃하고 브라우저 구독은 지운다', async () => {
    server.use(http.delete('/api/v1/push/subscriptions', () => fail('INTERNAL_ERROR', 'boom', 500)))
    const browser = installPushBrowser({ permission: 'granted', subscribed: true })

    await logout()

    expect(db.authenticated).toBe(false)
    expect(browser.subscription.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('구독이 없으면 해제 요청을 보내지 않는다', async () => {
    installPushBrowser()
    const log = recordRequests()
    await logout()
    expect(log.started.some(({ path }) => path === '/push/subscriptions')).toBe(false)
  })
})
