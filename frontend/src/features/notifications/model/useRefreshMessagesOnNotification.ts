import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { messageKeys } from '@/entities/message'
import { isMessageNotification } from '@/entities/notification'
import type { Notification } from '@/entities/notification'
import { captureSession } from '@/entities/user'

interface SessionBaseline {
  ids: Set<string>
  isCurrentSession: () => boolean
}

export function useRefreshMessagesOnNotification(
  workspaceId: string,
  notifications: readonly Notification[] | undefined,
): void {
  const queryClient = useQueryClient()
  const seen = useRef<SessionBaseline | null>(null)

  useEffect(() => {
    if (notifications === undefined) return
    const ids = notifications.filter(({ kind }) => isMessageNotification(kind)).map(({ id }) => id)
    const baseline = seen.current
    if (baseline === null || !baseline.isCurrentSession()) {
      seen.current = { ids: new Set(ids), isCurrentSession: captureSession() }
      return
    }
    const fresh = ids.filter((id) => !baseline.ids.has(id))
    if (fresh.length === 0) return
    fresh.forEach((id) => baseline.ids.add(id))
    void queryClient.invalidateQueries({ queryKey: messageKeys(workspaceId) })
  }, [notifications, queryClient, workspaceId])
}
