import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  notificationKeys,
  notificationListQueryOptions,
  notificationPath,
  notificationTitle,
  readNotification,
} from '@/entities/notification'
import type { Notification } from '@/entities/notification'
import { captureSession } from '@/entities/user'
import { errorMessage } from '@/shared/api/errorMessages'
import { formatSeoulMonthDayTime } from '@/shared/lib/date/format'
import { useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { useRefreshOnNotification } from '../model/useRefreshOnNotification'

const TRIGGER =
  'relative inline-flex size-36 items-center justify-center rounded-9 text-ink hover:bg-surface-selected data-[state=open]:bg-surface-selected'
const BADGE =
  'absolute -top-2 -right-2 inline-flex h-16 min-w-16 items-center justify-center rounded-999 bg-accent-solid px-4 text-[10.5px] leading-none font-bold text-surface'
const ITEM =
  'flex w-full flex-col gap-4 rounded-9 px-10 py-9 text-left hover:bg-surface-selected disabled:opacity-50'

interface ReadVariables {
  notification: Notification
  isCurrentSession: () => boolean
}

function triggerLabel(unreadCount: number): string {
  return unreadCount > 0 ? `알림, 읽지 않은 알림 ${unreadCount}개` : '알림'
}

/** 앱 머리의 종. 누른 알림은 읽음으로 표시한 뒤 링크로 옮긴다. 모르는 링크는 읽음만 표시한다 */
export function NotificationBell({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)
  const notifications = useQuery(notificationListQueryOptions(workspaceId))
  useRefreshOnNotification(workspaceId, notifications.data?.items)
  const queryClient = useQueryClient()
  const navigate = useGuardedNavigate()
  const read = useMutation({
    mutationFn: ({ notification }: ReadVariables) => readNotification(workspaceId, notification.id),
    onSuccess: (_, { notification, isCurrentSession }) => {
      if (!isCurrentSession()) return
      void queryClient.invalidateQueries({ queryKey: notificationKeys(workspaceId) })
      const path = notificationPath(workspaceId, notification.link)
      if (path === null) return
      setOpen(false)
      navigate(path)
    },
  })
  const unreadCount = notifications.data?.unreadCount ?? 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={triggerLabel(unreadCount)} className={TRIGGER}>
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {unreadCount > 0 ? (
          <span aria-hidden="true" className={BADGE}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        aria-label="알림 목록"
        align="end"
        className="max-h-[70vh] w-[320px] overflow-y-auto"
      >
        <h2 className="text-body font-semibold text-ink">알림</h2>
        {notifications.isPending ? (
          <p role="status" className="text-caption text-dim">
            알림을 불러오고 있어요.
          </p>
        ) : null}
        {notifications.isError && notifications.data === undefined ? (
          <div role="alert" className="flex flex-col items-start gap-8 text-caption text-ink">
            <p>{errorMessage(notifications.error)}</p>
            <Button size="sm" onClick={() => void notifications.refetch()}>
              다시 시도
            </Button>
          </div>
        ) : null}
        {notifications.data?.items.length === 0 ? (
          <p className="text-caption text-dim">아직 알림이 없어요.</p>
        ) : null}
        {read.isError ? (
          <p role="alert" className="text-caption text-ink">
            {errorMessage(read.error)}
          </p>
        ) : null}
        {notifications.data !== undefined && notifications.data.items.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {notifications.data.items.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  disabled={read.isPending}
                  onClick={() => read.mutate({ notification, isCurrentSession: captureSession() })}
                  className={ITEM}
                >
                  <span className="flex items-center gap-6 text-caption font-semibold text-ink">
                    {notification.readAt === null ? (
                      <span
                        aria-hidden="true"
                        className="size-6 shrink-0 rounded-999 bg-accent-point"
                      />
                    ) : null}
                    {notificationTitle(notification.kind)}
                    {notification.readAt === null ? (
                      <span className="sr-only">, 안 읽음</span>
                    ) : null}
                  </span>
                  <span className="text-caption text-sub wrap-anywhere">{notification.text}</span>
                  <time
                    className="text-meta text-dim"
                    dateTime={notification.createdAt.toISOString()}
                  >
                    {formatSeoulMonthDayTime(notification.createdAt.toISOString())}
                  </time>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
