import type { Bundle, Message, MessageThread } from '@/entities/message'
import {
  DM_FAILURE_TEXT,
  avatarText,
  awaitingDays,
  clockTime,
  dayLabel,
  groupByDay,
  shortDateTime,
} from '../lib/format'
import type { ViewerPolicy } from './viewer'

export interface BubbleItem {
  kind: 'bubble'
  id: string
  side: 'own' | 'other'
  /** own·other 는 보낸 쪽 말풍선, upcoming 은 아직 나가지 않은 묶음의 점선 말풍선 */
  look: 'own' | 'other' | 'upcoming'
  /** 화면 읽기용 보낸 쪽. 그리면서 `봇: ` 처럼 콜론을 붙인다 */
  speaker: string
  body: string
  timeLine: string
  /** 아직 나가지 않은 묶음이면 `확인하기` 가 여는 묶음 */
  bundleId: string | null
  /** AI 초안이 아직 오는 중이다 */
  drafting: boolean
  /** DM 으로 가지 못한 봇 메시지의 안내. 갔거나 봇 메시지가 아니면 null */
  dmFailure: string | null
  /** 왼쪽 말풍선만 */
  avatar: string | null
}

/** `여기서부터 답장이 없습니다` — 마지막 메시지 바로 뒤에 둔다 */
export interface WaitingNote {
  kind: 'waiting'
  id: 'waiting'
  days: number
}

export type ConversationItem = BubbleItem | WaitingNote

export interface ConversationDay {
  date: string | null
  label: string
  items: ConversationItem[]
}

export interface ConversationView {
  title: string
  subtitle: string
  avatar: string
  /** 답장을 기다린 날 수. 보이지 않으면 null */
  waitingDays: number | null
  /** 메시지와 예정 묶음을 시각 순으로 섞어 서울 날짜별로 묶었다 */
  days: ConversationDay[]
}

function messageBubble(
  message: Message,
  side: 'own' | 'other',
  ctx: { name: string; botName: string },
): BubbleItem {
  const base = {
    kind: 'bubble',
    id: message.id,
    side,
    look: side,
    body: message.body,
    bundleId: null,
    drafting: false,
  } as const
  if (message.sender === 'member')
    return {
      ...base,
      speaker: side === 'own' ? '나' : ctx.name,
      timeLine:
        message.replyChannel === 'web'
          ? `${clockTime(message.createdAt)} · 웹에서 답장`
          : clockTime(message.createdAt),
      dmFailure: null,
      avatar: side === 'other' ? avatarText(ctx.name) : null,
    }
  return {
    ...base,
    speaker: '봇',
    timeLine: clockTime(message.createdAt),
    dmFailure:
      message.dm.status === 'failed' ? `DM 못 보냄 · ${DM_FAILURE_TEXT[message.dm.reason]}` : null,
    avatar: side === 'other' ? avatarText(ctx.botName) : null,
  }
}

function bundleBubble(bundle: Bundle, side: 'own' | 'other', now: number): BubbleItem {
  const when = `${shortDateTime(bundle.scheduledAt)} 발송 예정`
  const passed = Date.parse(bundle.scheduledAt) <= now
  return {
    kind: 'bubble',
    id: bundle.id,
    side,
    look: 'upcoming',
    speaker: bundle.stage === 'approved' ? '봇(승인함)' : '봇(승인 대기)',
    body: bundle.body,
    timeLine: bundle.stage === 'approved' ? `${when} · 승인함` : passed ? `${when} · 지남` : when,
    bundleId: bundle.id,
    drafting: bundle.drafting,
    dmFailure: null,
    avatar: null,
  }
}

/** 대화를 그릴 모양으로. 보낸 쪽이 policy.ownSender 와 같으면 오른쪽이다. replyable 은 보는 사람이 이 대화에 답장할 수 있는지다 */
export function buildConversation(
  thread: MessageThread,
  ctx: { policy: ViewerPolicy; replyable: boolean; botName: string; today: string; now: number },
): ConversationView {
  const { policy, replyable, botName, today, now } = ctx
  const sideOf = (sender: 'bot' | 'member') => (sender === policy.ownSender ? 'own' : 'other')
  const waitingDays =
    policy.awaiting && thread.awaitingReplySince !== null
      ? awaitingDays(thread.awaitingReplySince, today)
      : null

  const placed: { at: string; item: ConversationItem }[] = thread.messages.map((message) => ({
    at: message.createdAt,
    item: messageBubble(message, sideOf(message.sender), { name: thread.name, botName }),
  }))
  const last = placed.at(-1)
  if (waitingDays !== null && last !== undefined)
    placed.push({ at: last.at, item: { kind: 'waiting', id: 'waiting', days: waitingDays } })
  // 같은 시각이면 메시지가 먼저다 — 정렬은 안정적이다
  for (const bundle of thread.upcoming)
    placed.push({ at: bundle.scheduledAt, item: bundleBubble(bundle, sideOf('bot'), now) })
  placed.sort((left, right) => Date.parse(left.at) - Date.parse(right.at))

  return {
    title: policy.ownSender === 'member' ? `${botName} 봇` : thread.name,
    subtitle: replyable
      ? 'Discord 개인 메시지 · 웹에서도 답장할 수 있어요'
      : `Discord 개인 메시지 · ${botName} 봇으로 보냄`,
    avatar: avatarText(policy.ownSender === 'member' ? botName : thread.name),
    waitingDays,
    days: groupByDay(placed).map((day) => ({
      date: day.date,
      label: day.date === null ? '' : dayLabel(day.date, today),
      items: day.items.map((entry) => entry.item),
    })),
  }
}
