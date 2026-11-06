/// <reference lib="webworker" />
// 워커에는 window 가 없다. API 클라이언트를 끌어오는 엔티티 공개 진입점 대신 순수 모듈만 가져온다
import { notificationPath, notificationTitle } from '@/entities/notification/model/display'
import { toPushNotification } from '@/entities/notification/model/mapper'

declare const self: ServiceWorkerGlobalScope

interface NotificationData {
  path: string | null
}

function readPayload(event: PushEvent): unknown {
  try {
    return event.data?.json()
  } catch {
    return null
  }
}

function pathOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('path' in data)) return null
  return typeof data.path === 'string' ? data.path : null
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('push', (event) => {
  const notification = toPushNotification(readPayload(event))
  // userVisibleOnly 구독이라 푸시마다 알림을 띄워야 한다. 읽을 수 없는 내용이면 기본 제목만 띄운다
  const data: NotificationData = {
    path:
      notification === null ? null : notificationPath(notification.workspaceId, notification.link),
  }
  event.waitUntil(
    self.registration.showNotification(notificationTitle(notification?.kind ?? ''), {
      body: notification?.text,
      tag: notification?.id,
      data,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(pathOf(event.notification.data) ?? '/', self.location.origin)
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // 이 워커는 페이지를 관리하지 않아 열린 창을 다른 주소로 옮길 수 없다. 같은 주소의 창만 앞으로 가져온다
      const same = windows.find((client) => client.url === target.href)
      if (same) await same.focus()
      else await self.clients.openWindow(target.href)
    })(),
  )
})
