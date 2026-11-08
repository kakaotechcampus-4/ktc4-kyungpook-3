import { threadPolicy } from './viewer'

it('팀원은 자기 대화를 팀원 화면 규칙으로 보고 태스크를 고르지 않는다', () => {
  expect(threadPolicy({ role: 'member', memberId: 'mb_03' }, 'mb_03')).toEqual({
    ownSender: 'member',
    awaiting: false,
    pushPrompt: true,
    pickTask: false,
    reply: true,
    section: 'threads',
  })
})

it('팀원 행을 모르는 팀원도 대화에 답장한다', () => {
  expect(threadPolicy({ role: 'member', memberId: null }, 'mb_03').reply).toBe(true)
})

it('PM 이 남의 대화를 보면 답장을 기다리는 쪽이고 답장 칸·알림 띠가 없다', () => {
  expect(threadPolicy({ role: 'pm', memberId: 'mb_01' }, 'mb_03')).toEqual({
    ownSender: 'bot',
    awaiting: true,
    pushPrompt: false,
    pickTask: true,
    reply: false,
    section: 'threads',
  })
})

it('PM 의 자기 대화는 맨 위 구역에 두고 팀원 화면 규칙으로 그리되 태스크 고르기는 남긴다', () => {
  expect(threadPolicy({ role: 'pm', memberId: 'mb_01' }, 'mb_01')).toEqual({
    ownSender: 'member',
    awaiting: false,
    pushPrompt: true,
    pickTask: true,
    reply: true,
    section: 'self',
  })
})

it('팀원 행이 없는 PM(옛 백엔드)에게는 자기 대화가 없다', () => {
  expect(threadPolicy({ role: 'pm', memberId: null }, 'mb_01')).toEqual(
    threadPolicy({ role: 'pm', memberId: 'mb_01' }, 'mb_03'),
  )
})
