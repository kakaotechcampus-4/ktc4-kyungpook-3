import { notificationFixtures } from '@/shared/mock/fixtures/notification'
import { applyScenario } from '@/shared/mock/scenarios'
import { fetchDto } from '@/shared/test/api'
import { notificationListSchema, notificationSchema, pushPublicKeySchema } from './notification'

const valid = {
  notification_id: 'nt_01',
  kind: 'message_received',
  text: '이재환 님이 메시지를 보냈어요.',
  link: { type: 'thread', id: 'th_01' },
  read_at: null,
  created_at: '2026-11-04T00:00:00Z',
}

describe('알림 스키마', () => {
  it('모르는 종류·링크 종류는 거절하지 않는다. 화면이 기본 제목으로 보이고 옮기지 않는다', () => {
    expect(
      notificationSchema.safeParse({
        ...valid,
        kind: 'future_kind',
        link: { type: 'meeting', id: 'mt_01' },
      }).success,
    ).toBe(true)
  })

  it.each([
    ['날짜가 아닌 생성 시각', { created_at: 'invalid' }],
    ['링크 누락', { link: undefined }],
    ['숫자 본문', { text: 3 }],
  ])('%s 는 읽지 않는다', (_, patch) => {
    expect(notificationSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
  })

  it('목록 한 건만 틀려도 전체를 읽지 않는다', () => {
    const result = notificationListSchema.safeParse({
      items: [valid, { ...valid, notification_id: 'nt_02', read_at: 'yesterday' }],
      unread_count: 1,
    })
    expect(result.error?.issues[0]?.path).toEqual(['items', 1, 'read_at'])
  })

  it('음수 안 읽은 수는 읽지 않는다', () => {
    expect(notificationListSchema.safeParse({ items: [], unread_count: -1 }).success).toBe(false)
  })
})

describe('MSW handler 응답이 같은 스키마를 따른다', () => {
  it('알림 픽스처', () => {
    for (const fixture of notificationFixtures) notificationSchema.parse(fixture)
  })

  it('notifications-default 상태의 알림 목록', async () => {
    applyScenario('notifications-default')
    const list = notificationListSchema.parse(
      await fetchDto('/workspaces/ws_01/notifications', { params: { limit: 50 } }),
    )
    expect(list.items.length).toBeGreaterThan(0)
  })

  it('messages-member-push 상태의 푸시 공개키', async () => {
    applyScenario('messages-member-push')
    expect(pushPublicKeySchema.parse(await fetchDto('/push/vapid-public-key')).public_key).toBe(
      'AQID',
    )
  })
})
