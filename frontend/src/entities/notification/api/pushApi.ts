import { z } from 'zod'
import { request } from '@/shared/api/client'

/** 로그아웃을 오래 붙잡지 않는다. 구독 해제 전체가 이 시간을 넘으면 기다리지 않고 로그아웃을 이어 간다 */
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

/**
 * 진행 중인 구독 절차(브라우저 구독 만들기·서버 등록). 로그아웃의 해제가 이것들이 끝나기를 기다린 뒤 구독을 찾는다 —
 * 켜는 중에 로그아웃하면 아직 구독이 없어 해제를 건너뛰고, 그 뒤 만들어진 구독이 남는다 (#330 검증 1)
 */
const subscribing = new Set<Promise<unknown>>()

/** 구독을 만들거나 서버에 등록하는 절차를 돌린다. 끝날 때까지 로그아웃의 해제가 기다린다 */
export function trackPushSubscribing<T>(work: () => Promise<T>): Promise<T> {
  const run = work()
  const settled = run.then(
    () => undefined,
    () => undefined,
  )
  subscribing.add(settled)
  void settled.then(() => subscribing.delete(settled))
  return run
}

/**
 * 이 브라우저의 구독을 지금 계정으로 서버에 등록한다. 같은 endpoint 를 다시 보내면 지금 계정으로 옮기므로 반복해도 된다 (계약 §5.7).
 * 절차를 시작한 세션이 끝났으면 보내지 않고 브라우저 구독을 푼다 — 앞 사람의 구독이 다음 사람의 세션으로 등록되거나 남지 않게 한다.
 * 보내는 동안 세션이 끝나도 브라우저 구독을 푼다. 등록했으면 true, 세션이 바뀌어 그만뒀으면 false
 */
export async function savePushSubscription(
  subscription: PushSubscription,
  isCurrentSession: () => boolean,
): Promise<boolean> {
  if (!isCurrentSession()) {
    await subscription.unsubscribe()
    return false
  }
  await request('/push/subscriptions', {
    method: 'POST',
    body: subscriptionSchema.parse(subscription.toJSON()),
  })
  if (!isCurrentSession()) {
    await subscription.unsubscribe()
    return false
  }
  return true
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

async function removeNow(signal: AbortSignal): Promise<void> {
  await Promise.all(subscribing)
  const subscription = await findPushSubscription()
  if (!subscription) return
  try {
    await request('/push/subscriptions', {
      method: 'DELETE',
      body: { endpoint: subscription.endpoint },
      signal,
    })
  } finally {
    await subscription.unsubscribe()
  }
}

/**
 * 로그아웃 전에 부른다. 진행 중인 구독 절차를 기다린 뒤 서버의 구독을 지우고, 실패해도 이 브라우저의 구독은 해제한다 —
 * 공유 기기에서 앞 사람의 알림이 뜨지 않게 한다. 기다림·찾기·DELETE·`unsubscribe` 전체에 3초 상한을 둔다.
 * 넘거나 실패하면 던지지만 호출한 쪽이 로그아웃을 막지 않는다. 상한 뒤에 끝나는 구독 절차는 바뀐 세션을 보고 브라우저 구독을 푼다
 */
export function removePushSubscription(): Promise<void> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new DOMException('push unsubscribe timed out', 'TimeoutError'))
    }, UNSUBSCRIBE_TIMEOUT_MS)
  })
  return Promise.race([removeNow(controller.signal), deadline]).finally(() => clearTimeout(timer))
}
