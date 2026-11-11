import { pushPayloadSchema } from '@/shared/types/api/notification'
import type { NotificationDto } from '@/shared/types/api/notification'
import type { Notification, NotificationLink, PushNotification } from './types'

/** 모르는 `type` 은 버리지 않고 `unknown` 으로 남긴다 — 뒤에 링크 종류가 더해진다 */
function toNotificationLink(link: NotificationDto['link']): NotificationLink {
  switch (link.type) {
    case 'thread':
    case 'bundle':
    case 'task':
      return { type: link.type, id: link.id }
    default:
      return { type: 'unknown', rawType: link.type, id: link.id }
  }
}

/** 스키마를 통과한 항목만 받는다. 목록 경로에는 공간이 있고 항목에는 없다. 부른 공간을 넣는다 */
export function toNotification(dto: NotificationDto, workspaceId: string): Notification {
  return {
    id: dto.notification_id,
    workspaceId,
    kind: dto.kind,
    text: dto.text,
    link: toNotificationLink(dto.link),
    readAt: dto.read_at === null ? null : new Date(dto.read_at),
    createdAt: new Date(dto.created_at),
  }
}

/** 서비스 워커 `push` 이벤트의 JSON. 모양이 다르면 null */
export function toPushNotification(input: unknown): PushNotification | null {
  const parsed = pushPayloadSchema.safeParse(input)
  if (!parsed.success) return null
  const dto = parsed.data
  return {
    id: dto.notification_id,
    workspaceId: dto.workspace_id,
    kind: dto.kind,
    text: dto.text,
    link: toNotificationLink(dto.link),
  }
}
