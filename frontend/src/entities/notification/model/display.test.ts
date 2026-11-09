import {
  DEFAULT_NOTIFICATION_TITLE,
  notificationPath,
  notificationRefreshes,
  notificationTitle,
} from './display'

it('종류별 제목을 쓰고, 모르는 종류는 기본 제목이다', () => {
  expect(notificationTitle('silence_blocked')).toBe('응답이 없어 태스크가 막혔어요')
  expect(notificationTitle('reply_judged')).toBe('팀원 답장을 판단했어요')
  expect(notificationTitle('reply_unjudged')).toBe('답장을 자동으로 판단하지 못했어요')
  expect(notificationTitle('message_received')).toBe('새 메시지가 왔어요')
  expect(notificationTitle('reply_attributed')).toBe(DEFAULT_NOTIFICATION_TITLE)
  expect(notificationTitle('toString')).toBe(DEFAULT_NOTIFICATION_TITLE)
})

it('종류마다 다시 받을 캐시가 정해져 있고, 모르는 종류는 아무것도 다시 받지 않는다', () => {
  for (const kind of [
    'reminder_sent',
    'nudge_suggested',
    'nudge_reapprove',
    'reminder_auto_cancelled',
    'message_received',
  ])
    expect(notificationRefreshes(kind)).toEqual(['messages'])
  expect(notificationRefreshes('silence_blocked')).toEqual(['tasks'])
  expect(notificationRefreshes('reply_judged')).toEqual(['messages', 'tasks', 'approvals'])
  expect(notificationRefreshes('reply_unjudged')).toEqual(['messages', 'tasks'])
  expect(notificationRefreshes('checkin_digest')).toEqual([])
  expect(notificationRefreshes('toString')).toEqual([])
})

it('링크 종류마다 갈 경로가 있고, 모르는 링크는 옮기지 않는다', () => {
  expect(notificationPath('ws_01', { type: 'thread', id: 'th_01' })).toBe(
    '/workspaces/ws_01/messages/threads/th_01',
  )
  expect(notificationPath('ws_01', { type: 'bundle', id: 'rv_01' })).toBe(
    '/workspaces/ws_01/messages?review=rv_01',
  )
  expect(notificationPath('ws_01', { type: 'task', id: 'tk_03' })).toBe(
    '/workspaces/ws_01/tasks/tk_03',
  )
  expect(notificationPath('ws_01', { type: 'unknown', rawType: 'reply', id: 'rp_01' })).toBeNull()
})
