import { http } from 'msw'
import { ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { fetchNotifications } from './notificationApi'
import { fetchPushPublicKey } from './pushApi'

/*
 * #348 — 알림 응답은 스키마로 읽는다. 전에는 `ZodError` 가 그대로 나가 화면이 공통 오류 문구를 보였다
 */

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const item = {
  notification_id: 'nt_01',
  kind: 'message_received',
  text: '이재환 님이 메시지를 보냈어요.',
  link: { type: 'thread', id: 'th_01' },
  read_at: null,
  created_at: '2026-11-04T00:00:00Z',
}

it('새 메시지 알림(message_received)을 읽는다', async () => {
  server.use(
    http.get('/api/v1/workspaces/:workspaceId/notifications', () =>
      ok({ items: [item], unread_count: 1 }),
    ),
  )
  const list = await fetchNotifications('ws_01')
  expect(list.items[0]).toMatchObject({ kind: 'message_received', link: { type: 'thread' } })
})

it('목록 한 건의 날짜가 틀리면 INVALID_RESPONSE 이고 그 경로를 남긴다', async () => {
  server.use(
    http.get('/api/v1/workspaces/:workspaceId/notifications', () =>
      ok({
        items: [item, { ...item, notification_id: 'nt_02', created_at: 'yesterday' }],
        unread_count: 0,
      }),
    ),
  )
  const requests = recordRequests()
  await expect(fetchNotifications('ws_01')).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
    kind: 'invalid_response',
    details: { entity: 'notification', path: 'items[1].created_at' },
  })
  expect(requests.started).toHaveLength(1)
})

it('푸시 공개키 모양이 틀리면 INVALID_RESPONSE 다', async () => {
  server.use(http.get('/api/v1/push/vapid-public-key', () => ok({ public_key: 7 })))
  await expect(fetchPushPublicKey()).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
    details: { entity: 'notification', path: 'public_key' },
  })
})
