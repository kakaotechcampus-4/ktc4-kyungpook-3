import { toNotification, toPushNotification } from './mapper'

const notification = {
  notification_id: 'nt_01',
  kind: 'reminder_sent',
  text: '태스크 진행 상황을 알려 주세요.',
  link: { type: 'thread', id: 'th_01' },
  read_at: null,
  created_at: '2026-11-04T00:00:00Z',
}

it('알림 본문과 링크를 보존하고 읽음·생성 시각을 날짜로 변환한다', () => {
  expect(toNotification(notification, 'ws_01')).toEqual({
    id: 'nt_01',
    workspaceId: 'ws_01',
    kind: 'reminder_sent',
    text: notification.text,
    link: notification.link,
    readAt: null,
    createdAt: new Date(notification.created_at),
  })
  expect(
    toNotification({ ...notification, read_at: '2026-11-04T01:00:00Z' }, 'ws_01').readAt,
  ).toEqual(new Date('2026-11-04T01:00:00Z'))
})

it('모르는 알림 종류도 본문을 보존하며 모르는 링크는 이동 불가 유형으로 바꾼다', () => {
  expect(
    toNotification(
      { ...notification, kind: 'future_kind', link: { type: 'future_link', id: 'future_01' } },
      'ws_01',
    ),
  ).toMatchObject({
    kind: 'future_kind',
    text: notification.text,
    link: { type: 'unknown', rawType: 'future_link', id: 'future_01' },
  })
})

it('푸시 내용은 공간과 링크를 담고, 모양이 다르면 버린다', () => {
  expect(
    toPushNotification({
      notification_id: 'nt_02',
      workspace_id: 'ws_01',
      kind: 'silence_blocked',
      text: '응답이 없어요',
      link: { type: 'task', id: 'tk_03' },
    }),
  ).toEqual({
    id: 'nt_02',
    workspaceId: 'ws_01',
    kind: 'silence_blocked',
    text: '응답이 없어요',
    link: { type: 'task', id: 'tk_03' },
  })
  expect(toPushNotification({ notification_id: 'nt_02' })).toBeNull()
  expect(toPushNotification('not json object')).toBeNull()
})
