import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { messageKeys } from '@/entities/message'
import { NOTIFICATION_LIST_LIMIT, notificationRefreshes } from '@/entities/notification'
import type { Notification, NotificationRefresh } from '@/entities/notification'
import { taskKeys } from '@/entities/task'
import { captureSession } from '@/entities/user'
import { workspaceKey } from '@/shared/api/queryKeys'

interface SessionBaseline {
  isCurrentSession: () => boolean
  /** 이미 본, 무언가를 다시 받게 하는 알림 */
  seen: Set<string>
  /** 지난 목록의 알림 전체(종류 무관) */
  previous: Set<string>
}

const ALL_REFRESHES: readonly NotificationRefresh[] = ['messages', 'tasks', 'approvals']

const REFRESH_KEY: Record<NotificationRefresh, (workspaceId: string) => readonly unknown[]> = {
  messages: messageKeys,
  tasks: taskKeys,
  approvals: (workspaceId) => workspaceKey(workspaceId, 'approvals'),
}

/**
 * 알림 목록에 처음 보는 알림이 오면 그 종류가 바꾼 캐시(메시지·태스크·승인)를 그 공간에서 다시 받는다 (D-136, #344).
 * 목록은 최신 `NOTIFICATION_LIST_LIMIT` 개뿐이다. 꽉 찬 새 목록이 지난 목록과 하나도 겹치지 않으면 그 사이에
 * 잘려 보이지 않은 알림이 있을 수 있어 모두 한 번 다시 받는다. 첫 목록과 세션이 바뀐 뒤 첫 목록은 기준으로만 쓴다
 */
export function useRefreshOnNotification(
  workspaceId: string,
  notifications: readonly Notification[] | undefined,
): void {
  const queryClient = useQueryClient()
  const baselineRef = useRef<SessionBaseline | null>(null)

  useEffect(() => {
    if (notifications === undefined) return
    const all = notifications.map(({ id }) => id)
    const refreshing = notifications.filter(({ kind }) => notificationRefreshes(kind).length > 0)
    const baseline = baselineRef.current
    if (baseline === null || !baseline.isCurrentSession()) {
      baselineRef.current = {
        isCurrentSession: captureSession(),
        seen: new Set(refreshing.map(({ id }) => id)),
        previous: new Set(all),
      }
      return
    }
    const unseen = refreshing.filter(({ id }) => !baseline.seen.has(id))
    const gap =
      all.length >= NOTIFICATION_LIST_LIMIT && !all.some((id) => baseline.previous.has(id))
    unseen.forEach(({ id }) => baseline.seen.add(id))
    baseline.previous = new Set(all)
    const scopes = new Set(
      gap ? ALL_REFRESHES : unseen.flatMap(({ kind }) => notificationRefreshes(kind)),
    )
    for (const scope of scopes)
      void queryClient.invalidateQueries({ queryKey: REFRESH_KEY[scope](workspaceId) })
  }, [notifications, queryClient, workspaceId])
}
