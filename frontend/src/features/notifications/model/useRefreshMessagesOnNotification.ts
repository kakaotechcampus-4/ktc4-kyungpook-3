import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { messageKeys } from '@/entities/message'
import { NOTIFICATION_LIST_LIMIT, isMessageNotification } from '@/entities/notification'
import type { Notification } from '@/entities/notification'
import { captureSession } from '@/entities/user'

interface SessionBaseline {
  isCurrentSession: () => boolean
  /** 이미 본 메시지 알림 */
  seenMessages: Set<string>
  /** 지난 목록의 알림 전체(종류 무관) */
  previous: Set<string>
}

/**
 * 알림 목록에 처음 보는 메시지 알림이 오면 그 공간의 메시지를 다시 받는다 (D-136).
 * 목록은 최신 `NOTIFICATION_LIST_LIMIT` 개뿐이다. 꽉 찬 새 목록이 지난 목록과 하나도 겹치지 않으면 그 사이에
 * 잘려 보이지 않은 알림이 있을 수 있어 한 번 다시 받는다. 첫 목록과 세션이 바뀐 뒤 첫 목록은 기준으로만 쓴다
 */
export function useRefreshMessagesOnNotification(
  workspaceId: string,
  notifications: readonly Notification[] | undefined,
): void {
  const queryClient = useQueryClient()
  const seen = useRef<SessionBaseline | null>(null)

  useEffect(() => {
    if (notifications === undefined) return
    const all = notifications.map(({ id }) => id)
    const messages = notifications
      .filter(({ kind }) => isMessageNotification(kind))
      .map(({ id }) => id)
    const baseline = seen.current
    if (baseline === null || !baseline.isCurrentSession()) {
      seen.current = {
        isCurrentSession: captureSession(),
        seenMessages: new Set(messages),
        previous: new Set(all),
      }
      return
    }
    const unseen = messages.filter((id) => !baseline.seenMessages.has(id))
    const gap =
      all.length >= NOTIFICATION_LIST_LIMIT && !all.some((id) => baseline.previous.has(id))
    unseen.forEach((id) => baseline.seenMessages.add(id))
    baseline.previous = new Set(all)
    if (unseen.length > 0 || gap)
      void queryClient.invalidateQueries({ queryKey: messageKeys(workspaceId) })
  }, [notifications, queryClient, workspaceId])
}
