import { http } from 'msw'
import { onTestFinished } from 'vitest'
import { captureSessionScope, endSessionScope } from '@/shared/api/sessionScope'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { savePushSubscription } from './pushApi'

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-01'
const KEYS = { p256dh: 'p256dh-key', auth: 'auth-key' }

function browserSubscription() {
  return {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: KEYS }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  }
}

/**
 * 등록 POST 를 풀어 줄 때까지 붙잡는다. MSW 의 XHR 가로채기는 클라이언트의 취소를 request.signal 로 넘기지 않아
 * XHR 의 abort 로 본다. 풀렸을 때 끊긴 요청이면 등록하지 않는다 — 연결이 끊긴 요청을 버리는 서버다
 */
function holdRegistration() {
  const abort = vi.spyOn(XMLHttpRequest.prototype, 'abort')
  onTestFinished(() => abort.mockRestore())
  const arrived = deferred()
  const gate = deferred()
  server.use(
    http.post('/api/v1/push/subscriptions', async () => {
      arrived.resolve()
      await gate.promise
      if (abort.mock.calls.length > 0) return new Response(null, { status: 499 })
    }),
  )
  return { arrived: arrived.promise, release: gate.resolve, abort }
}

describe('구독 서버 등록의 세션 경계', () => {
  it('보내는 중에 세션이 끝나면 답을 기다리지 않고 요청을 취소하며, 브라우저 구독을 풀고 false 다', async () => {
    const held = holdRegistration()
    const subscription = browserSubscription()
    let settled = false
    const saving = savePushSubscription(
      subscription as unknown as PushSubscription,
      captureSessionScope(),
    ).finally(() => {
      settled = true
    })
    await held.arrived

    endSessionScope()

    await vi.waitFor(() => expect(settled).toBe(true))
    await expect(saving).resolves.toBe(false)
    expect(held.abort).toHaveBeenCalledTimes(1)
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1)
    held.release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(db.push.subscriptions).toEqual([])
  })

  it('세션과 무관한 실패는 던지고 브라우저 구독은 그대로 둔다', async () => {
    server.use(http.post('/api/v1/push/subscriptions', () => fail('INTERNAL_ERROR', 'boom', 500)))
    const subscription = browserSubscription()

    await expect(
      savePushSubscription(subscription as unknown as PushSubscription, captureSessionScope()),
    ).rejects.toThrow()
    expect(subscription.unsubscribe).not.toHaveBeenCalled()
  })
})
