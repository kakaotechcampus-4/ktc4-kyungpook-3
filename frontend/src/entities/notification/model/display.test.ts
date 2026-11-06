import {
  DEFAULT_NOTIFICATION_TITLE,
  isMessageNotification,
  notificationPath,
  notificationTitle,
} from './display'

it('종류별 제목을 쓰고, 모르는 종류는 기본 제목이다', () => {
  expect(notificationTitle('silence_blocked')).toBe('응답이 없어 태스크가 막혔어요')
  expect(notificationTitle('reply_judged')).toBe('팀원 답장을 판단했어요')
  expect(notificationTitle('reply_unjudged')).toBe('답장을 자동으로 판단하지 못했어요')
  expect(notificationTitle('reply_attributed')).toBe(DEFAULT_NOTIFICATION_TITLE)
  expect(notificationTitle('toString')).toBe(DEFAULT_NOTIFICATION_TITLE)
})

it('메시지 화면을 바꾸는 종류만 메시지 알림이다. 답장 판단은 대화에 답장이 들어온 것이라 메시지 알림이다. 태스크 알림과 모르는 종류는 아니다', () => {
  expect(
    [
      'reminder_sent',
      'nudge_suggested',
      'nudge_reapprove',
      'reminder_auto_cancelled',
      'reply_judged',
      'reply_unjudged',
    ].filter(isMessageNotification),
  ).toHaveLength(6)
  expect(isMessageNotification('silence_blocked')).toBe(false)
  expect(isMessageNotification('toString')).toBe(false)
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
