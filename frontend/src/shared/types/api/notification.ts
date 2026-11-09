import { z } from 'zod'

/*
 * 알림·푸시 응답 스키마 (계약 §5.7 「알림·푸시」, backend app/schemas/notification.py). 타입은 이 스키마에서 만든다 (#348).
 * `kind`(reminder_sent·message_received 등)·`link.type` 은 열린 문자열이다. 모르는 종류는 기본 제목, 모르는 링크는 옮기지 않는다
 */

const notificationLinkSchema = z.object({ type: z.string(), id: z.string() })

export const notificationSchema = z.object({
  notification_id: z.string(),
  kind: z.string(),
  text: z.string(),
  link: notificationLinkSchema,
  read_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
})
export type NotificationDto = z.infer<typeof notificationSchema>

/** 목록 한 건만 틀려도 전체가 `INVALID_RESPONSE` 다. `unread_count` 는 배지 숫자다 */
export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  unread_count: z.number().int().nonnegative(),
})
export type NotificationListDto = z.infer<typeof notificationListSchema>

/** 서비스 워커 `push` 이벤트의 JSON. 응답이 아니라 모양이 다르면 그 푸시만 버린다 */
export const pushPayloadSchema = z.object({
  notification_id: z.string(),
  workspace_id: z.string(),
  kind: z.string(),
  text: z.string(),
  link: notificationLinkSchema,
})

/** 서버의 VAPID 공개키. 서버에 키가 없으면 null 이다 */
export const pushPublicKeySchema = z.object({ public_key: z.string().nullable() })
export type PushPublicKeyDto = z.infer<typeof pushPublicKeySchema>

export interface PushSubscriptionDto {
  endpoint: string
  keys: { p256dh: string; auth: string }
}
