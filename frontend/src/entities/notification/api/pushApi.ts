import { z } from 'zod'
import { request } from '@/shared/api/client'

/** 로그아웃을 오래 붙잡지 않는다. 넘으면 서버 해제를 포기하고 로그아웃을 이어 간다 */
const UNSUBSCRIBE_TIMEOUT_MS = 3000

const subscriptionSchema = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
})

/** 서버의 VAPID 공개키. 서버에 키가 없으면 null 이고, 그때는 구독하지 않는다 */
export async function fetchPushPublicKey(): Promise<string | null> {
  return z
    .object({ public_key: z.string().nullable() })
    .parse(await request<unknown>('/push/vapid-public-key')).public_key
}

export async function savePushSubscription(subscription: PushSubscription): Promise<void> {
  await request('/push/subscriptions', {
    method: 'POST',
    body: subscriptionSchema.parse(subscription.toJSON()),
  })
}

/**
 * 이 브라우저의 푸시 구독. 구독을 가진 등록은 푸시 워커 하나뿐이다 — 개발 중 MSW 워커는 구독이 없다.
 * 워커 주소를 몰라도 찾을 수 있어 로그아웃처럼 푸시 기능 밖에서도 쓴다
 */
export async function findPushSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || typeof PushManager === 'undefined') return null
  const registrations = await navigator.serviceWorker.getRegistrations()
  for (const registration of registrations) {
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) return subscription
  }
  return null
}

/**
 * 로그아웃 전에 부른다. 서버의 구독을 지우고, 실패해도 이 브라우저의 구독은 해제한다 —
 * 공유 기기에서 앞 사람의 알림이 뜨지 않게 한다. 실패는 던지지만 호출한 쪽이 로그아웃을 막지 않는다
 */
export async function removePushSubscription(): Promise<void> {
  const subscription = await findPushSubscription()
  if (!subscription) return
  try {
    await request('/push/subscriptions', {
      method: 'DELETE',
      body: { endpoint: subscription.endpoint },
      signal: AbortSignal.timeout(UNSUBSCRIBE_TIMEOUT_MS),
    })
  } finally {
    await subscription.unsubscribe()
  }
}
