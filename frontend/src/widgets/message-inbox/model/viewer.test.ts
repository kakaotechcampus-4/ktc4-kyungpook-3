import { isOwnMessage, threadPolicy } from './viewer'
import type { Authorship } from './viewer'

const PM = { role: 'pm', memberId: 'mb_01' } as const

it('팀원은 자기 대화를 팀원 화면 규칙으로 보고 태스크를 고르지 않는다', () => {
  expect(threadPolicy({ role: 'member', memberId: 'mb_03' }, 'mb_03')).toEqual({
    audience: 'member',
    viewerMemberId: 'mb_03',
    awaiting: false,
    pushPrompt: true,
    pickTask: false,
    section: 'threads',
  })
})

it('PM 이 남의 대화를 보면 답장을 기다리는 쪽이고 알림 띠가 없다', () => {
  expect(threadPolicy(PM, 'mb_03')).toEqual({
    audience: 'pm',
    viewerMemberId: 'mb_01',
    awaiting: true,
    pushPrompt: false,
    pickTask: true,
    section: 'threads',
  })
})

it('PM 의 자기 대화는 맨 위 구역에 두고 팀원 화면 규칙으로 그리되 태스크 고르기는 남긴다', () => {
  expect(threadPolicy(PM, 'mb_01')).toEqual({
    audience: 'pmSelf',
    viewerMemberId: 'mb_01',
    awaiting: false,
    pushPrompt: true,
    pickTask: true,
    section: 'self',
  })
})

it('팀원 행이 없는 PM(옛 백엔드)에게는 자기 대화가 없다', () => {
  expect(threadPolicy({ role: 'pm', memberId: null }, 'mb_01')).toMatchObject({
    audience: 'pm',
    section: 'threads',
  })
})

describe('isOwnMessage — 오른쪽 말풍선과 목록의 나:', () => {
  const bot: Authorship = { sender: 'bot' }
  const member: Authorship = { sender: 'member' }
  const mine: Authorship = { sender: 'pm', authorMemberId: 'mb_01' }
  const otherPm: Authorship = { sender: 'pm', authorMemberId: 'mb_06' }
  const unknownPm: Authorship = { sender: 'pm', authorMemberId: null }
  const own = (policy: ReturnType<typeof threadPolicy>) =>
    [bot, member, mine, otherPm, unknownPm].map((message) => isOwnMessage(policy, message))

  it('PM 이 남의 대화를 보면 봇 글과 자기가 쓴 PM 글이 내 글이고, 다른 PM 과 작성자를 모르는 글은 아니다', () => {
    expect(own(threadPolicy(PM, 'mb_03'))).toEqual([true, false, true, false, false])
  })

  it('팀원 행을 모르는 PM 에게는 어느 PM 글도 내 글이 아니다', () => {
    expect(own(threadPolicy({ role: 'pm', memberId: null }, 'mb_03'))).toEqual([
      true,
      false,
      false,
      false,
      false,
    ])
  })

  it('팀원과 PM 의 자기 대화는 팀원 글만 내 글이다 — 봇·PM 글은 상대 쪽이다', () => {
    expect(own(threadPolicy({ role: 'member', memberId: 'mb_01' }, 'mb_01'))).toEqual([
      false,
      true,
      false,
      false,
      false,
    ])
    expect(own(threadPolicy(PM, 'mb_01'))).toEqual([false, true, false, false, false])
  })
})
