/** 계약 §5.7 「알림·푸시」. `kind`·`link.type` 은 열린 문자열이다 */
export interface NotificationDto {
  notification_id: string
  kind: string
  text: string
  link: { type: string; id: string }
  read_at: string | null
  created_at: string
}

export interface NotificationListDto {
  items: NotificationDto[]
  unread_count: number
}

export interface PushPublicKeyDto {
  public_key: string | null
}

export interface PushSubscriptionDto {
  endpoint: string
  keys: { p256dh: string; auth: string }
}
