export type NotificationLink =
  | { type: 'thread' | 'bundle' | 'task'; id: string }
  | { type: 'unknown'; rawType: string; id: string }

/** `kind` 는 열린 문자열이다. 모르는 종류도 `text` 와 `link` 로 그린다 */
export interface Notification {
  id: string
  workspaceId: string
  kind: string
  text: string
  link: NotificationLink
  readAt: Date | null
  createdAt: Date
}

/** 브라우저 푸시로 오는 알림. 읽음·시각이 없다 */
export type PushNotification = Pick<Notification, 'id' | 'workspaceId' | 'kind' | 'text' | 'link'>

export interface NotificationList {
  items: Notification[]
  unreadCount: number
}
