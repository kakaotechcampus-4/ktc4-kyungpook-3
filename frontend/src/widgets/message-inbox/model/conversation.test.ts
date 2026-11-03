import type { Message, MessageThread } from '@/entities/message'
import { buildConversation } from './conversation'
import { VIEWER_POLICY } from './viewer'

const today = '2026-09-18'

function thread(messages: Message[]): MessageThread {
  return {
    id: 'th_01',
    kind: 'direct',
    name: '이재환',
    teamRole: '백엔드',
    discordUrl: null,
    awaitingReplySince: null,
    messages,
  }
}

const sent = (approvedBy: string | null): Message => ({
  sender: 'bot',
  status: 'sent',
  id: 'mg_sent',
  body: '보낸 글',
  sentAt: '2026-09-16T18:00:00+09:00',
  approvedBy,
})

const webReply: Message = {
  sender: 'member',
  id: 'mg_web',
  body: '웹 답',
  sentAt: '2026-09-17T14:20:00+09:00',
  source: 'web',
  attribution: null,
}

it('팀원은 봇을 왼쪽에 두고 발송 표시를 붙이지 않는다', () => {
  const view = buildConversation(thread([sent('최진호'), webReply]), {
    policy: VIEWER_POLICY.member,
    botName: '카테캠 3팀',
    today,
  })
  expect(view.title).toBe('카테캠 3팀 봇')
  expect(view.subtitle).toBe('Discord 개인 메시지 · 웹에서도 답장할 수 있어요')
  expect(view.upcoming).toEqual([])
  expect(
    view.days
      .flatMap((day) => day.items)
      .map(({ body, side, timeLine, look }) => [body, side, timeLine, look]),
  ).toEqual([
    ['보낸 글', 'other', '18:00', 'other'],
    ['웹 답', 'own', '14:20 · 웹에서 답장', 'own'],
  ])
})

it('PM 은 봇을 오른쪽에 두고 자동 발송·승인을 시각 줄에 붙인다', () => {
  const view = buildConversation(thread([sent(null), webReply]), {
    policy: VIEWER_POLICY.pm,
    botName: '카테캠 3팀',
    today,
  })
  expect(view.title).toBe('이재환')
  expect(view.subtitle).toBe('백엔드 · Discord 개인 메시지 · 카테캠 3팀 봇으로 보냄')
  const items = view.days.flatMap((day) => day.items)
  expect(items.map(({ body, side, speaker, timeLine }) => [body, side, speaker, timeLine])).toEqual(
    [
      ['보낸 글', 'own', '봇', '18:00 · 자동 발송'],
      ['웹 답', 'other', '이재환', '14:20 · 웹에서 답장'],
    ],
  )
})

it('승인 대기·예약은 아직 나가지 않은 칸에, 취소·만료는 그날 묶음에 둔다', () => {
  const view = buildConversation(
    thread([
      {
        sender: 'bot',
        status: 'pending',
        id: 'rv_01',
        body: '대기',
        reviewId: 'rv_01',
        scheduledAt: '2026-09-23T09:00:00+09:00',
      },
      {
        sender: 'bot',
        status: 'scheduled',
        id: 'rv_02',
        body: '예약',
        reviewId: 'rv_02',
        scheduledAt: '2026-09-23T09:00:00+09:00',
        approvedBy: '최진호',
      },
      {
        sender: 'bot',
        status: 'cancelled',
        id: 'rv_03',
        body: '취소',
        at: '2026-09-08T09:00:00+09:00',
        reason: 'responded',
      },
      {
        sender: 'bot',
        status: 'expired',
        id: 'rv_04',
        body: '만료',
        at: '2026-09-09T18:00:00+09:00',
      },
    ]),
    { policy: VIEWER_POLICY.pm, botName: '카테캠 3팀', today },
  )
  expect(
    view.upcoming.map(({ body, look, reviewId, timeLine }) => [body, look, reviewId, timeLine]),
  ).toEqual([
    ['대기', 'upcoming', 'rv_01', '09/23 09:00 발송 예정'],
    ['예약', 'upcoming', 'rv_02', '09/23 09:00 발송 예정 · 최진호 승인'],
  ])
  expect(
    view.days.flatMap((day) => day.items).map(({ body, look, timeLine }) => [body, look, timeLine]),
  ).toEqual([
    ['취소', 'muted', '09:00 · 자동 취소됨 · 보내기 전에 응답이 있었어요'],
    ['만료', 'muted', '18:00 · 만료됨 · 마감이 지나 보내지 않았어요'],
  ])
  expect(view.days.map(({ date }) => date)).toEqual(['2026-09-08', '2026-09-09'])
})
