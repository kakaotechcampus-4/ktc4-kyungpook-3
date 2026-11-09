import type { Bundle, Message, MessageThread } from '@/entities/message'
import {
  avatarText,
  awaitingDays,
  clockTime,
  dayLabel,
  dmFailureText,
  groupByDay,
  shortDateTime,
} from '../lib/format'
import { isOwnMessage } from './viewer'
import type { Authorship, ThreadPolicy } from './viewer'

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
  /** 말풍선 위에 보이는 작성자. 왼쪽 PM 글만 갖는다 — PM 이 여럿일 수 있다 */
  author: string | null
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
      author: null,
    }
  const dmFailure =
    message.dm.status === 'failed' ? `DM 못 보냄 · ${dmFailureText(message.dm.reason)}` : null
  if (message.sender === 'pm') {
    const author = message.authorName ?? 'PM'
    return {
      ...base,
      speaker: side === 'own' ? '나' : author,
      timeLine: clockTime(message.createdAt),
      dmFailure,
      avatar: side === 'other' ? avatarText(author) : null,
      author: side === 'other' ? author : null,
    }
  }
  return {
    ...base,
    speaker: '봇',
    timeLine: clockTime(message.createdAt),
    dmFailure,
    avatar: side === 'other' ? avatarText(ctx.botName) : null,
    author: null,
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
    author: null,
  }
}

/** 대화의 이름·부제·아바타. 대화 이름과 보는 사람의 규칙만으로 정해 목록 행과 상세 머리가 같은 이름을 쓴다 */
export function threadHeading(
  name: string,
  policy: ThreadPolicy,
  botName: string,
): Pick<ConversationView, 'title' | 'subtitle' | 'avatar'> {
  if (policy.audience === 'pm')
    return {
      title: name,
      subtitle: `Discord 개인 메시지 · ${botName} 봇으로 보냄`,
      avatar: avatarText(name),
    }
  return {
    title: `${botName} 봇`,
    subtitle: 'Discord 개인 메시지 · 웹에서도 답장할 수 있어요',
    avatar: avatarText(botName),
  }
}

/** 대화를 그릴 모양으로. 오른쪽(내 글)은 isOwnMessage 가 정한다 */
export function buildConversation(
  thread: MessageThread,
  ctx: { policy: ThreadPolicy; botName: string; today: string; now: number },
): ConversationView {
  const { policy, botName, today, now } = ctx
  const sideOf = (message: Authorship) => (isOwnMessage(policy, message) ? 'own' : 'other')
  const waitingDays =
    policy.awaiting && thread.awaitingReplySince !== null
      ? awaitingDays(thread.awaitingReplySince, today)
      : null

  const placed: { at: string; item: ConversationItem }[] = thread.messages.map((message) => ({
    at: message.createdAt,
    item: messageBubble(message, sideOf(message), { name: thread.name, botName }),
  }))
  const last = placed.at(-1)
  if (waitingDays !== null && last !== undefined)
    placed.push({ at: last.at, item: { kind: 'waiting', id: 'waiting', days: waitingDays } })
  // 같은 시각이면 메시지가 먼저다 — 정렬은 안정적이다
  for (const bundle of thread.upcoming)
    placed.push({
      at: bundle.scheduledAt,
      item: bundleBubble(bundle, sideOf({ sender: 'bot' }), now),
    })
  placed.sort((left, right) => Date.parse(left.at) - Date.parse(right.at))

  return {
    ...threadHeading(thread.name, policy, botName),
    waitingDays,
    days: groupByDay(placed).map((day) => ({
      date: day.date,
      label: day.date === null ? '' : dayLabel(day.date, today),
      items: day.items.map((entry) => entry.item),
    })),
  }
}
