import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { onTestFinished } from 'vitest'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * #330 브라우저 푸시. jsdom 에는 서비스 워커·푸시가 없어 브라우저 쪽만 바꿔 끼운다. 서버는 MSW 다.
 * 알림 허용은 설정의 버튼을 누른 뒤에만 묻고, 로그아웃은 구독을 지운 뒤에 한다
 */

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-01'
const KEYS = { p256dh: 'p256dh-key', auth: 'auth-key' }

interface PushBrowserOptions {
  permission?: NotificationPermission
  answer?: NotificationPermission
  subscribed?: boolean
}

function installPushBrowser({
  permission = 'default',
  answer = 'granted',
  subscribed = false,
}: PushBrowserOptions = {}) {
  const subscription = {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: KEYS }),
    unsubscribe: vi.fn(() => {
      current = null
      return Promise.resolve(true)
    }),
  }
  let current: typeof subscription | null = subscribed ? subscription : null
  let registered = subscribed
  const pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(current)),
    subscribe: vi.fn<(options: PushSubscriptionOptionsInit) => Promise<typeof subscription>>(() => {
      current = subscription
      return Promise.resolve(subscription)
    }),
  }
  const registration = { active: {}, installing: null, waiting: null, pushManager }
  const container = {
    register: vi.fn<(url: string, options: RegistrationOptions) => Promise<typeof registration>>(
      () => {
        registered = true
        return Promise.resolve(registration)
      },
    ),
    getRegistrations: vi.fn(() => Promise.resolve(registered ? [registration] : [])),
  }
  const notification = {
    permission,
    requestPermission: vi.fn(() => {
      notification.permission = answer
      return Promise.resolve(answer)
    }),
  }
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container })
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('Notification', notification)
  onTestFinished(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker')
    vi.unstubAllGlobals()
  })
  return { container, pushManager, notification, subscription }
}

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

  it('이미 구독한 기기는 켜져 있다고 보인다', async () => {
    db.push.publicKey = 'AQID'
    installPushBrowser({ permission: 'granted', subscribed: true })
    const { control } = await openSettings()
    await waitFor(() =>
      expect(control).toHaveTextContent('이 기기에서 브라우저 알림을 받고 있어요.'),
    )
    expect(within(control).queryByRole('button')).toBeNull()
  })
})

describe('로그아웃의 푸시 구독 해제 (#330)', () => {
  async function logout() {
    const user = userEvent.setup()
    const app = renderApp(paths.members('ws_01'))
    await screen.findByText('김서연')
    await user.click(screen.getByRole('button', { name: /^내 계정/ }))
    await user.click(await screen.findByRole('menuitem', { name: '로그아웃' }))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await app.expectPath('/login')
  }

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
