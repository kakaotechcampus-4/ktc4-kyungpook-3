import { onTestFinished, vi } from 'vitest'

/* jsdom 에는 서비스 워커·푸시가 없다. 브라우저 쪽만 바꿔 끼운다. 서버는 MSW 다 */

export const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-01'
export const KEYS = { p256dh: 'p256dh-key', auth: 'auth-key' }

interface PushBrowserOptions {
  permission?: NotificationPermission
  answer?: NotificationPermission
  subscribed?: boolean
  /** 주면 서비스 워커 등록이 이 약속이 풀릴 때까지 끝나지 않는다 */
  registerGate?: Promise<void>
  /** 브라우저 구독 해제가 끝나지 않는다 */
  unsubscribeHangs?: boolean
}

export function installPushBrowser({
  permission = 'default',
  answer = 'granted',
  subscribed = false,
  registerGate,
  unsubscribeHangs = false,
}: PushBrowserOptions = {}) {
  const subscription = {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: KEYS }),
    unsubscribe: vi.fn(() => {
      if (unsubscribeHangs) return new Promise<boolean>(() => {})
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
      async () => {
        await registerGate
        registered = true
        return registration
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
