import type { Bundle, Message, MessageThread } from '@/entities/message'
import { buildConversation } from './conversation'
import type { BubbleItem, ConversationItem } from './conversation'
import { VIEWER_POLICY } from './viewer'

const today = '2026-09-18'
const now = Date.parse('2026-09-18T09:00:00+09:00')

function thread(messages: Message[], upcoming: Bundle[] = []): MessageThread {
  return {
    id: 'th_01',
    memberId: 'mb_03',
    name: '이재환',
    lastMessage: null,
    awaitingReplySince: '2026-09-16T18:00:00+09:00',
    dmFailed: false,
    messages,
    upcoming,
  }
}

const bot = (id: string, createdAt: string, dm: Extract<Message, { sender: 'bot' }>['dm']) =>
  ({ sender: 'bot', id, body: `${id} 본문`, createdAt, dm }) as const satisfies Message

const webReply: Message = {
  sender: 'member',
  id: 'mg_web',
  body: '웹 답',
  createdAt: '2026-09-17T14:20:00+09:00',
  replyChannel: 'web',
}

const bundle = (patch: Partial<Bundle>): Bundle =>
  ({
    stage: 'awaitingApproval',
    id: 'bd_01',
    threadId: 'th_01',
    memberId: 'mb_03',
    recipientName: '이재환',
    scheduledAt: '2026-09-23T09:00:00+09:00',
    body: '재환님,\n어디까지 됐나요?',
    bodySource: 'ai',
    drafting: false,
    draftVersion: 1,
    tasks: [],
    ...patch,
  }) as Bundle

const bubbles = (items: ConversationItem[]) =>
  items.filter((item): item is BubbleItem => item.kind === 'bubble')

it('팀원은 봇을 왼쪽에 두고 웹 답장 표시를 붙이며, 답장 대기는 보이지 않는다', () => {
  const view = buildConversation(
    thread([bot('mg_01', '2026-09-16T18:00:00+09:00', { status: 'delivered' }), webReply]),
    { policy: VIEWER_POLICY.member, replyable: true, botName: '카테캠 3팀', today, now },
  )
  expect(view.title).toBe('카테캠 3팀 봇')
  expect(view.subtitle).toBe('Discord 개인 메시지 · 웹에서도 답장할 수 있어요')
  expect(view.waitingDays).toBeNull()
  expect(
    view.days
      .flatMap((day) => day.items)
      .map((item) => (item.kind === 'bubble' ? [item.body, item.side, item.timeLine] : item.kind)),
  ).toEqual([
    ['mg_01 본문', 'other', '18:00'],
    ['웹 답', 'own', '14:20 · 웹에서 답장'],
  ])
})

it('DM 을 보내지 못한 봇 메시지는 이유와 함께 알린다', () => {
  const view = buildConversation(
    thread([
      bot('mg_01', '2026-09-15T09:00:00+09:00', { status: 'failed', reason: 'dm_blocked' }),
      bot('mg_02', '2026-09-15T10:00:00+09:00', {
        status: 'failed',
        reason: 'discord_not_linked',
      }),
      bot('mg_03', '2026-09-15T11:00:00+09:00', { status: 'failed', reason: 'unknown' }),
      bot('mg_04', '2026-09-15T12:00:00+09:00', { status: 'claimed' }),
    ]),
    { policy: VIEWER_POLICY.pm, replyable: false, botName: '카테캠 3팀', today, now },
  )
  expect(bubbles(view.days.flatMap((day) => day.items)).map(({ dmFailure }) => dmFailure)).toEqual([
    'DM 못 보냄 · 서버 DM이 막혀 있어요',
    'DM 못 보냄 · Discord 계정이 연결되지 않았어요',
    'DM 못 보냄 · 이유를 알 수 없어요',
    null,
  ])
})

it('PM 은 메시지 뒤에 답장 대기를, 예정 묶음은 나갈 시각 자리에 섞어 둔다', () => {
  const view = buildConversation(
    thread(
      [bot('mg_01', '2026-09-16T18:00:00+09:00', { status: 'delivered' })],
      [
        bundle({ id: 'bd_06', scheduledAt: '2026-09-17T09:00:00+09:00', drafting: true }),
        bundle({ id: 'bd_01' }),
        bundle({
          id: 'bd_02',
          stage: 'approved',
          approvedAt: '2026-09-18T00:00:00Z',
          scheduledAt: '2026-09-24T09:00:00+09:00',
        }),
      ],
    ),
    { policy: VIEWER_POLICY.pm, replyable: false, botName: '카테캠 3팀', today, now },
  )
  expect(view.title).toBe('이재환')
  expect(view.subtitle).toBe('Discord 개인 메시지 · 카테캠 3팀 봇으로 보냄')
  expect(view.waitingDays).toBe(3)
  expect(
    view.days.map(({ label, items }) => [
      label,
      items.map((item) =>
        item.kind === 'waiting'
          ? `기다림 ${String(item.days)}`
          : [item.id, item.look, item.timeLine, item.bundleId, item.drafting],
      ),
    ]),
  ).toEqual([
    ['9월 16일 수요일', [['mg_01', 'own', '18:00', null, false], '기다림 3']],
    ['9월 17일 목요일', [['bd_06', 'upcoming', '09/17 09:00 발송 예정 · 지남', 'bd_06', true]]],
    ['9월 23일 수요일', [['bd_01', 'upcoming', '09/23 09:00 발송 예정', 'bd_01', false]]],
    ['9월 24일 목요일', [['bd_02', 'upcoming', '09/24 09:00 발송 예정 · 승인함', 'bd_02', false]]],
  ])
})
