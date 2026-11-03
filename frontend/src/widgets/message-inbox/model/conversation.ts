import type {
  BotMessage,
  BotMessageStatus,
  MessageThread,
  ReplyAttribution,
} from '@/entities/message'
import { avatarText, clockTime, dayLabel, groupByDay, shortDateTime } from '../lib/format'
import type { ViewerPolicy } from './viewer'

type Look = 'own' | 'other' | 'upcoming' | 'muted'

export interface BubbleItem {
  id: string
  side: 'own' | 'other'
  look: Look
  /** 화면 읽기용 보낸 쪽. 그리면서 `봇: ` 처럼 콜론을 붙인다 */
  speaker: string
  body: string
  timeLine: string
  /** 점선 미리보기의 `확인하기` 대상 */
  reviewId: string | null
  attribution: ReplyAttribution | null
  /** 정한 태스크 한 줄. 없으면 null */
  taskLine: string | null
  /** 왼쪽 말풍선만 */
  avatar: string | null
}

export interface ConversationDay {
  date: string | null
  label: string
  items: BubbleItem[]
}

export interface ConversationView {
  title: string
  subtitle: string
  avatar: string
  channel: boolean
  days: ConversationDay[]
  /** 승인 대기·예약. 서버가 준 순서를 유지한다 */
  upcoming: BubbleItem[]
}

const BOT_STATUS_VIEW: {
  [S in BotMessageStatus]: {
    place: 'day' | 'upcoming'
    look: 'solid' | 'upcoming' | 'muted'
    speaker: string
    at: (message: Extract<BotMessage, { status: S }>) => string | null
    line: (message: Extract<BotMessage, { status: S }>, deliveryNote: boolean) => string
  }
} = {
  pending: {
    place: 'upcoming',
    look: 'upcoming',
    speaker: '봇(승인 대기)',
    at: (message) => message.scheduledAt,
    line: (message) => {
      if (message.scheduledAt === null) return '승인하면 바로 발송'
      const when = `${shortDateTime(message.scheduledAt)} 발송 예정`
      return message.schedulePassed ? `${when} · 지남` : when
    },
  },
  scheduled: {
    place: 'upcoming',
    look: 'upcoming',
    speaker: '봇(예약)',
    at: (message) => message.scheduledAt,
    line: (message) =>
      `${shortDateTime(message.scheduledAt)} 발송 예정 · ${message.approvedBy} 승인`,
  },
  sent: {
    place: 'day',
    look: 'solid',
    speaker: '봇',
    at: (message) => message.sentAt,
    line: (message, note) => {
      const time = clockTime(message.sentAt)
      if (!note) return time
      return message.approvedBy === null
        ? `${time} · 자동 발송`
        : `${time} · ${message.approvedBy} 승인`
    },
  },
  cancelled: {
    place: 'day',
    look: 'muted',
    speaker: '봇(취소됨)',
    at: (message) => message.at,
    line: (message) =>
      message.reason === 'responded'
        ? `${clockTime(message.at)} · 자동 취소됨 · 보내기 전에 응답이 있었어요`
        : `${clockTime(message.at)} · 취소됨`,
  },
  expired: {
    place: 'day',
    look: 'muted',
    speaker: '봇(만료됨)',
    at: (message) => message.at,
    line: (message) => `${clockTime(message.at)} · 만료됨 · 마감이 지나 보내지 않았어요`,
  },
}

/** `solid` 는 보낸 쪽 말풍선이다. 표의 나머지 모양은 그대로 쓴다 */
function bubbleLook(look: 'solid' | 'upcoming' | 'muted', side: 'own' | 'other'): Look {
  return look === 'solid' ? side : look
}

function botBubble(
  message: BotMessage,
  side: 'own' | 'other',
  deliveryNote: boolean,
  botName: string,
): { place: 'day' | 'upcoming'; at: string | null; item: BubbleItem } {
  const base = {
    id: message.id,
    side,
    body: message.body,
    attribution: null,
    taskLine: null,
    avatar: side === 'other' ? avatarText(botName, 'direct') : null,
  }
  switch (message.status) {
    case 'pending':
      return {
        place: BOT_STATUS_VIEW.pending.place,
        at: BOT_STATUS_VIEW.pending.at(message),
        item: {
          ...base,
          look: bubbleLook(BOT_STATUS_VIEW.pending.look, side),
          speaker: BOT_STATUS_VIEW.pending.speaker,
          timeLine: BOT_STATUS_VIEW.pending.line(message, deliveryNote),
          reviewId: message.reviewId,
        },
      }
    case 'scheduled':
      return {
        place: BOT_STATUS_VIEW.scheduled.place,
        at: BOT_STATUS_VIEW.scheduled.at(message),
        item: {
          ...base,
          look: bubbleLook(BOT_STATUS_VIEW.scheduled.look, side),
          speaker: BOT_STATUS_VIEW.scheduled.speaker,
          timeLine: BOT_STATUS_VIEW.scheduled.line(message, deliveryNote),
          reviewId: message.reviewId,
        },
      }
    case 'sent':
      return {
        place: BOT_STATUS_VIEW.sent.place,
        at: BOT_STATUS_VIEW.sent.at(message),
        item: {
          ...base,
          look: bubbleLook(BOT_STATUS_VIEW.sent.look, side),
          speaker: BOT_STATUS_VIEW.sent.speaker,
          timeLine: BOT_STATUS_VIEW.sent.line(message, deliveryNote),
          reviewId: null,
        },
      }
    case 'cancelled':
      return {
        place: BOT_STATUS_VIEW.cancelled.place,
        at: BOT_STATUS_VIEW.cancelled.at(message),
        item: {
          ...base,
          look: bubbleLook(BOT_STATUS_VIEW.cancelled.look, side),
          speaker: BOT_STATUS_VIEW.cancelled.speaker,
          timeLine: BOT_STATUS_VIEW.cancelled.line(message, deliveryNote),
          reviewId: null,
        },
      }
    case 'expired':
      return {
        place: BOT_STATUS_VIEW.expired.place,
        at: BOT_STATUS_VIEW.expired.at(message),
        item: {
          ...base,
          look: bubbleLook(BOT_STATUS_VIEW.expired.look, side),
          speaker: BOT_STATUS_VIEW.expired.speaker,
          timeLine: BOT_STATUS_VIEW.expired.line(message, deliveryNote),
          reviewId: null,
        },
      }
  }
}

function taskLine(attribution: ReplyAttribution | null): string | null {
  if (attribution === null || attribution.status !== 'resolved') return null
  return attribution.task === null ? '태스크: 해당 없음' : `태스크: ${attribution.task.title}`
}

/** 대화를 그릴 모양으로. 보낸 쪽이 policy.ownSender 와 같으면 오른쪽이다 */
export function buildConversation(
  thread: MessageThread,
  ctx: { policy: ViewerPolicy; botName: string; today: string },
): ConversationView {
  const { policy, botName, today } = ctx
  const ownSide = (sender: 'bot' | 'member') => (sender === policy.ownSender ? 'own' : 'other')
  const placed: { at: string; item: BubbleItem }[] = []
  const upcoming: BubbleItem[] = []

  for (const message of thread.messages) {
    if (message.sender === 'member') {
      const side = ownSide('member')
      const item: BubbleItem = {
        id: message.id,
        side,
        look: side,
        speaker: side === 'own' ? '나' : thread.name,
        body: message.body,
        timeLine:
          message.source === 'web'
            ? `${clockTime(message.sentAt)} · 웹에서 답장`
            : clockTime(message.sentAt),
        reviewId: null,
        attribution: message.attribution,
        taskLine: taskLine(message.attribution),
        avatar: side === 'other' ? avatarText(thread.name, thread.kind) : null,
      }
      placed.push({ at: message.sentAt, item })
      continue
    }

    const side = ownSide('bot')
    const built = botBubble(message, side, policy.deliveryNote, botName)
    if (built.place === 'upcoming') upcoming.push(built.item)
    else if (built.at !== null) placed.push({ at: built.at, item: built.item })
  }

  const channel = thread.kind === 'channel'
  const channelOrDm = channel ? 'Discord 채널' : 'Discord 개인 메시지'
  return {
    title: policy.ownSender === 'member' ? `${botName} 봇` : thread.name,
    subtitle:
      policy.foot === 'reply'
        ? 'Discord 개인 메시지 · 웹에서도 답장할 수 있어요'
        : [thread.teamRole, channelOrDm, `${botName} 봇으로 보냄`]
            .filter((part) => part !== null)
            .join(' · '),
    avatar:
      policy.ownSender === 'member'
        ? avatarText(botName, 'direct')
        : avatarText(thread.name, thread.kind),
    channel: channel && policy.ownSender !== 'member',
    days: groupByDay(placed).map((day) => ({
      date: day.date,
      label: day.date === null ? '' : dayLabel(day.date, today),
      items: day.items.map((entry) => entry.item),
    })),
    upcoming,
  }
}
