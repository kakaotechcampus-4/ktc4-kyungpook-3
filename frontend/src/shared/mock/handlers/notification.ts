import { HttpResponse, http } from 'msw'
import type { NotificationDto, NotificationListDto } from '@/shared/types/api/notification'
import { requireAuth, requireMember } from '../auth-guard'
import { db } from '../db'
import { fail, ok } from '../envelope'
import { MOCK_NOW } from '../fixtures/constants'
import type { MockNotification } from '../fixtures/notification'
import { sessionMemberId } from '../sessions'
import { readJson } from '../utils'

/*
 * 계약 §5.7 「알림·푸시」(#318). 알림은 받는 팀원 단위, 푸시 구독은 로그인 계정 단위다.
 * 세션 팀원을 정할 수 없는 공간은 받은 알림이 없다
 */

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** 백엔드가 받는 브라우저 푸시 서비스 주소. 나머지는 400 이다 */
const PUSH_SERVICE_HOSTS = [
  /(^|\.)fcm\.googleapis\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
]

function toDto({
  notification_id,
  kind,
  text,
  link,
  read_at,
  created_at,
}: MockNotification): NotificationDto {
  return { notification_id, kind, text, link, read_at, created_at }
}

function received(workspaceId: string): MockNotification[] {
  const memberId = sessionMemberId(workspaceId)
  return db.notifications.filter(
    (notification) =>
      notification.workspace_id === workspaceId && notification.member_id === memberId,
  )
}

function readLimit(raw: string | null): number | null {
  if (raw === null) return DEFAULT_LIMIT
  const limit = Number(raw)
  return Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT ? limit : null
}

function validEndpoint(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname))
  } catch {
    return false
  }
}

function hasKeys(value: unknown): value is { p256dh: string; auth: string } {
  if (typeof value !== 'object' || value === null) return false
  const keys = value as Record<string, unknown>
  return typeof keys.p256dh === 'string' && typeof keys.auth === 'string'
}

export const notificationHandlers = [
  http.get('/api/v1/workspaces/:workspaceId/notifications', ({ params, request }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    const limit = readLimit(new URL(request.url).searchParams.get('limit'))
    if (limit === null) return fail('INVALID_REQUEST', '알림 조회 개수가 올바르지 않습니다.', 400)
    const mine = received(workspaceId).sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    )
    return ok({
      items: mine.slice(0, limit).map(toDto),
      unread_count: mine.filter(({ read_at }) => read_at === null).length,
    } satisfies NotificationListDto)
  }),
  http.post('/api/v1/workspaces/:workspaceId/notifications/:notificationId/read', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    const notification = received(workspaceId).find(
      ({ notification_id }) => notification_id === params.notificationId,
    )
    if (!notification) return fail('NOTIFICATION_NOT_FOUND', '알림이 없습니다.', 404)
    notification.read_at ??= MOCK_NOW
    return ok(toDto(notification))
  }),
  http.get('/api/v1/push/vapid-public-key', () => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    return ok({ public_key: db.push.publicKey })
  }),
  // 같은 endpoint 를 다시 보내면 지금 계정으로 옮긴다
  http.post('/api/v1/push/subscriptions', async ({ request }) => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const body = await readJson(request)
    if (!body || !validEndpoint(body.endpoint) || !hasKeys(body.keys))
      return fail('INVALID_REQUEST', '푸시 구독 요청이 올바르지 않습니다.', 400)
    const { endpoint, keys } = body
    db.push.subscriptions = db.push.subscriptions.filter((item) => item.endpoint !== endpoint)
    db.push.subscriptions.push({ endpoint, keys, user_id: db.session.user.user_id })
    return ok({ endpoint }, { status: 201 })
  }),
  // 내 구독만 지운다. 없어도 204 다
  http.delete('/api/v1/push/subscriptions', async ({ request }) => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const body = await readJson(request)
    if (!body || typeof body.endpoint !== 'string')
      return fail('INVALID_REQUEST', '푸시 구독 해제 요청이 올바르지 않습니다.', 400)
    db.push.subscriptions = db.push.subscriptions.filter(
      (item) => item.endpoint !== body.endpoint || item.user_id !== db.session.user.user_id,
    )
    return new HttpResponse(null, { status: 204 })
  }),
]
