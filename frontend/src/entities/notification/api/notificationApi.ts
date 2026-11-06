import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from '@/shared/api/client'
import { workspaceKey } from '@/shared/api/queryKeys'
import { toNotification } from '../model/mapper'
import type { NotificationList } from '../model/types'

/** 새 알림을 놓치지 않을 만큼만 다시 받는다. 푸시를 켜지 않은 기기는 이 간격으로 배지가 바뀐다 */
const NOTIFICATION_POLL_MS = 30_000

const listSchema = z.object({
  items: z.array(z.unknown()),
  unread_count: z.number().int().nonnegative(),
})

export function notificationKeys(workspaceId: string) {
  return workspaceKey(workspaceId, 'notifications')
}

export async function fetchNotifications(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<NotificationList> {
  const response = listSchema.parse(
    await request<unknown>(`/workspaces/${encodeURIComponent(workspaceId)}/notifications`, {
      signal,
    }),
  )
  return {
    items: response.items.map((item) => toNotification(item, workspaceId)),
    unreadCount: response.unread_count,
  }
}

export function notificationListQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: notificationKeys(workspaceId),
    queryFn: ({ signal }) => fetchNotifications(workspaceId, signal),
    refetchInterval: NOTIFICATION_POLL_MS,
  })
}

/** 읽음 표시. 이미 읽었어도 200 이다 */
export async function readNotification(workspaceId: string, notificationId: string): Promise<void> {
  await request(
    `/workspaces/${encodeURIComponent(workspaceId)}/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: 'POST' },
  )
}
