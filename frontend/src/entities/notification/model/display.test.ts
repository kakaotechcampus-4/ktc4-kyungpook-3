import { DEFAULT_NOTIFICATION_TITLE, notificationPath, notificationTitle } from './display'

it('종류별 제목을 쓰고, 모르는 종류는 기본 제목이다', () => {
  expect(notificationTitle('silence_blocked')).toBe('응답이 없어 태스크가 막혔어요')
  expect(notificationTitle('reply_judged')).toBe(DEFAULT_NOTIFICATION_TITLE)
  expect(notificationTitle('toString')).toBe(DEFAULT_NOTIFICATION_TITLE)
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
