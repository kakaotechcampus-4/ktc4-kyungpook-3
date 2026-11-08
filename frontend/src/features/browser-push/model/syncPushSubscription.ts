import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import {
  findPushSubscription,
  savePushSubscription,
  trackPushSubscribing,
} from '@/entities/notification'
import { sessionQueryOptions } from '@/entities/user'
import { captureSessionScope } from '@/shared/api/sessionScope'

/**
 * 이 기기에 이미 있는 구독을 지금 계정으로 다시 등록한다. 허용을 묻거나 구독을 새로 만들지 않는다.
 * 만료로 끝난 세션은 구독을 풀지 않아, 다음에 로그인한 계정으로 옮기지 않으면 서버의 수신자가 앞 계정으로 남는다
 */
function syncPushSubscription(): Promise<void> {
  if (
    !('serviceWorker' in navigator) ||
    typeof PushManager === 'undefined' ||
    typeof Notification === 'undefined' ||
    Notification.permission !== 'granted'
  )
    return Promise.resolve()
  const session = captureSessionScope()
  return trackPushSubscribing(async () => {
    const subscription = await findPushSubscription()
    if (subscription) await savePushSubscription(subscription, session)
  })
}

/**
 * 로그인 세션마다 한 번 이 기기의 구독을 그 계정으로 옮긴다. 알림 띠의 닫음 기록이나 열린 화면과 무관하다.
 * 실패해도 화면에 알리지 않는다 — 설정 화면을 열면 상태를 다시 확인하고 다시 시도할 수 있다
 */
export function useSyncPushSubscription(): void {
  const userId = useQuery(sessionQueryOptions()).data?.user.id
  // StrictMode 의 두 번째 effect 에서 같은 세션을 다시 보내지 않는다
  const synced = useRef<string | null>(null)
  useEffect(() => {
    if (userId === undefined || synced.current === userId) return
    synced.current = userId
    syncPushSubscription().catch(() => undefined)
  }, [userId])
}
