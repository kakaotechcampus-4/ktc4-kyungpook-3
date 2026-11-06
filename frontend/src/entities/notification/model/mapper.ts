import { z } from 'zod'
import type { Notification, NotificationLink, PushNotification } from './types'

const linkSchema = z.object({ type: z.string(), id: z.string() })

const notificationSchema = z.object({
  notification_id: z.string(),
  kind: z.string(),
  text: z.string(),
  link: linkSchema,
  read_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
})

const pushPayloadSchema = z.object({
  notification_id: z.string(),
  workspace_id: z.string(),
  kind: z.string(),
  text: z.string(),
  link: linkSchema,
})

/** 모르는 `type` 은 버리지 않고 `unknown` 으로 남긴다 — 뒤에 링크 종류가 더해진다 */
function toNotificationLink(link: z.infer<typeof linkSchema>): NotificationLink {
  switch (link.type) {
    case 'thread':
    case 'bundle':
    case 'task':
      return { type: link.type, id: link.id }
    default:
      return { type: 'unknown', rawType: link.type, id: link.id }
  }
}

/** 목록 경로에는 공간이 있고 항목에는 없다. 부른 공간을 넣는다 */
export function toNotification(input: unknown, workspaceId: string): Notification {
  const dto = notificationSchema.parse(input)
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
