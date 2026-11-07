import { ApiError } from '@/shared/api/errors'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { NotificationListDto, PushPublicKeyDto } from '@/shared/types/api/notification'
import { db } from './db'
import { MOCK_NOW } from './fixtures/constants'
import { applyScenario } from './scenarios'

/* #330 알림·푸시 handler (계약 §5.7 「알림·푸시」). 화면 흐름은 app/notifications.test.tsx 가 본다 */

const list = (query = '', workspaceId = 'ws_01') =>
  fetchDto<NotificationListDto>(`/workspaces/${workspaceId}/notifications${query}`)
const read = (notificationId: string, workspaceId = 'ws_01') =>
  fetchDto(`/workspaces/${workspaceId}/notifications/${notificationId}/read`, { method: 'POST' })

const SUBSCRIPTION = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-01',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('요청이 성공했다')
}

describe('알림 목록과 읽음', () => {
  beforeEach(() => applyScenario('notifications-default'))

  it('최근 순 목록과 안 읽은 수를 준다. 모르는 종류도 그대로 싣는다', async () => {
    const { items, unread_count } = await list()
    expect(items.map(({ notification_id }) => notification_id)).toEqual([
      'nt_01',
      'nt_02',
      'nt_03',
      'nt_04',
      'nt_05',
    ])
    expect(unread_count).toBe(4)
    expect(items[3]).toEqual({
      notification_id: 'nt_04',
      kind: 'checkin_digest',
      text: '정하늘님의 답장을 태스크에 반영했어요.',
      link: { type: 'reply', id: 'rp_01' },
      read_at: null,
      created_at: '2026-09-17T12:00:00+09:00',
    })
  })

  it('limit 은 목록만 자르고 안 읽은 수는 전체다. 범위 밖은 400 이다', async () => {
    const { items, unread_count } = await list('?limit=2')
    expect(items).toHaveLength(2)
    expect(unread_count).toBe(4)
    expect((await failure(list('?limit=0'))).status).toBe(400)
    expect((await failure(list('?limit=201'))).status).toBe(400)
  })

  it('읽음은 다시 불러도 200 이고 처음 읽은 시각이 남는다', async () => {
    await read('nt_01')
    await read('nt_01')
    const { items, unread_count } = await list()
    expect(items[0].read_at).toBe(MOCK_NOW)
    expect(unread_count).toBe(3)
  })

  it('남의 알림은 404 NOTIFICATION_NOT_FOUND, 다른 공간 목록은 비었다', async () => {
    db.notifications[0].member_id = 'mb_02'
    const error = await failure(read('nt_01'))
    expect([error.status, error.code]).toEqual([404, 'NOTIFICATION_NOT_FOUND'])
    expect((await list()).unread_count).toBe(3)
  })

  it('소속이 아닌 공간은 403 이다', async () => {
    expect((await failure(list('', 'ws_02'))).status).toBe(403)
  })
})

describe('브라우저 푸시 구독', () => {
  it('공개키는 기본이 null 이다', async () => {
    await expect(fetchDto<PushPublicKeyDto>('/push/vapid-public-key')).resolves.toEqual({
      public_key: null,
    })
  })

  it('브라우저 푸시 서비스 주소만 등록하고, 같은 주소는 다시 보내도 하나다. 해제는 204 다', async () => {
    await fetchDto('/push/subscriptions', jsonRequest('POST', SUBSCRIPTION))
    await fetchDto('/push/subscriptions', jsonRequest('POST', SUBSCRIPTION))
    expect(db.push.subscriptions).toEqual([{ ...SUBSCRIPTION, user_id: 'us_01' }])

    const invalid = await failure(
      fetchDto(
        '/push/subscriptions',
        jsonRequest('POST', { ...SUBSCRIPTION, endpoint: 'https://example.com/push' }),
      ),
    )
    expect(invalid.status).toBe(400)

    await expect(
      fetchDto('/push/subscriptions', jsonRequest('DELETE', { endpoint: SUBSCRIPTION.endpoint })),
    ).resolves.toBeUndefined()
    expect(db.push.subscriptions).toEqual([])
  })

  it('로그인하지 않았으면 401 이다', async () => {
    db.authenticated = false
    expect((await failure(fetchDto('/push/vapid-public-key'))).status).toBe(401)
  })
})
