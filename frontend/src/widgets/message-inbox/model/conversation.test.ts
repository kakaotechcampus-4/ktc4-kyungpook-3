import type { Bundle, Message, MessageThread } from '@/entities/message'
import { buildConversation } from './conversation'
import type { BubbleItem, ConversationItem } from './conversation'
import { threadPolicy } from './viewer'

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
    webReply: 'unknown',
    messages,
    upcoming,
  }
}

const bot = (id: string, createdAt: string, dm: Extract<Message, { sender: 'bot' }>['dm']) =>
  ({ sender: 'bot', id, body: `${id} 본문`, createdAt, dm }) as const satisfies Message

const pm = (
  id: string,
  author: { id: string; name: string } | null,
  dm: Extract<Message, { sender: 'pm' }>['dm'] = { status: 'delivered' },
) =>
  ({
    sender: 'pm',
    id,
    body: `${id} 본문`,
    createdAt: '2026-09-17T11:00:00+09:00',
    dm,
    authorMemberId: author?.id ?? null,
    authorName: author?.name ?? null,
  }) as const satisfies Message

const SEOYEON = { id: 'mb_01', name: '김서연' }
const JIHYUN = { id: 'mb_06', name: '오지현' }

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

const memberPolicy = threadPolicy({ role: 'member', memberId: 'mb_03' }, 'mb_03')
const pmPolicy = threadPolicy({ role: 'pm', memberId: 'mb_01' }, 'mb_03')
const pmSelfPolicy = threadPolicy({ role: 'pm', memberId: 'mb_03' }, 'mb_03')

const bubbles = (items: ConversationItem[]) =>
  items.filter((item): item is BubbleItem => item.kind === 'bubble')

it('팀원은 봇을 왼쪽에 두고 웹 답장 표시를 붙이며, 답장 대기는 보이지 않는다', () => {
  const view = buildConversation(
    thread([bot('mg_01', '2026-09-16T18:00:00+09:00', { status: 'delivered' }), webReply]),
    { policy: memberPolicy, botName: '카테캠 3팀', today, now },
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
    { policy: pmPolicy, botName: '카테캠 3팀', today, now },
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
    { policy: pmPolicy, botName: '카테캠 3팀', today, now },
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

it('PM 이 자기 대화를 보면 봇은 왼쪽, 자기 답장은 오른쪽이고 답장 대기는 보이지 않는다', () => {
  const view = buildConversation(
    thread(
      [bot('mg_01', '2026-09-16T18:00:00+09:00', { status: 'delivered' }), webReply],
      [bundle({ id: 'bd_01' })],
    ),
    { policy: pmSelfPolicy, botName: '카테캠 3팀', today, now },
  )
  expect(view.title).toBe('카테캠 3팀 봇')
  expect(view.subtitle).toBe('Discord 개인 메시지 · 웹에서도 답장할 수 있어요')
  expect(view.waitingDays).toBeNull()
  expect(
    view.days
      .flatMap((day) => day.items)
      .map((item) => (item.kind === 'bubble' ? [item.id, item.side, item.look] : item.kind)),
  ).toEqual([
    ['mg_01', 'other', 'other'],
    ['mg_web', 'own', 'own'],
    ['bd_01', 'other', 'upcoming'],
  ])
})

const pmBubbles = (messages: Message[], policy: typeof pmPolicy) =>
  bubbles(
    buildConversation(thread(messages), { policy, botName: '카테캠 3팀', today, now }).days.flatMap(
      (day) => day.items,
    ),
  ).map(({ id, side, look, speaker, author, avatar }) => ({
    id,
    side,
    look,
    speaker,
    author,
    avatar,
  }))

it('PM 이 남의 대화를 보면 자기 PM 글은 오른쪽 나이고, 다른 PM 의 글은 왼쪽에 작성자 이름을 보인다', () => {
  expect(
    pmBubbles(
      [
        bot('mg_01', '2026-09-16T18:00:00+09:00', { status: 'delivered' }),
        pm('mg_02', SEOYEON),
        pm('mg_03', JIHYUN),
        pm('mg_04', null),
      ],
      pmPolicy,
    ),
  ).toEqual([
    { id: 'mg_01', side: 'own', look: 'own', speaker: '봇', author: null, avatar: null },
    { id: 'mg_02', side: 'own', look: 'own', speaker: '나', author: null, avatar: null },
    {
      id: 'mg_03',
      side: 'other',
      look: 'other',
      speaker: '오지현',
      author: '오지현',
      avatar: '오',
    },
    // 작성자 칸이 비어 오면 PM 으로 대신한다
    { id: 'mg_04', side: 'other', look: 'other', speaker: 'PM', author: 'PM', avatar: 'P' },
  ])
})

it('팀원 화면과 PM 의 자기 대화에서 PM 글은 왼쪽에 작성자 이름을 보인다', () => {
  for (const policy of [memberPolicy, pmSelfPolicy])
    expect(pmBubbles([pm('mg_02', SEOYEON), webReply], policy)).toEqual([
      {
        id: 'mg_02',
        side: 'other',
        look: 'other',
        speaker: '김서연',
        author: '김서연',
        avatar: '김',
      },
      { id: 'mg_web', side: 'own', look: 'own', speaker: '나', author: null, avatar: null },
    ])
})

it('DM 을 보내지 못한 PM 글도 이유와 함께 알린다', () => {
  const view = buildConversation(
    thread([pm('mg_02', SEOYEON, { status: 'failed', reason: 'discord_not_linked' })]),
    { policy: pmPolicy, botName: '카테캠 3팀', today, now },
  )
  expect(bubbles(view.days.flatMap((day) => day.items))[0].dmFailure).toBe(
    'DM 못 보냄 · Discord 계정이 연결되지 않았어요',
  )
})
