import type {
  MessageAttributionDto,
  MessageDto,
  MessageInboxDto,
  MessageReviewDto,
  MessageThreadDto,
  TaskRefDto,
} from '@/shared/types/api/message'
import type {
  DeliveredMessage,
  Message,
  MessageInbox,
  MessageReview,
  MessageThread,
  ReplyAttribution,
  TaskRef,
} from './types'

/** 상태와 칸이 맞지 않으면 던진다 — 조회 오류로 보인다 */
function invalidMessage(dto: MessageDto): never {
  throw new Error(`메시지 응답이 상태와 맞지 않습니다: ${dto.message_id}`)
}

function taskRef(dto: TaskRefDto): TaskRef {
  return { id: dto.task_id, title: dto.title }
}

function toAttribution(dto: MessageAttributionDto): ReplyAttribution {
  if (dto.status === 'resolved') {
    return { status: 'resolved', task: dto.task === null ? null : taskRef(dto.task) }
  }
  return { status: 'needs_pm', candidates: dto.candidates.map(taskRef) }
}

export function toMessage(dto: MessageDto): Message {
  if (dto.sender === 'member') {
    if (dto.status !== 'sent' || dto.at === null || dto.source === null) invalidMessage(dto)
    return {
      sender: 'member',
      id: dto.message_id,
      body: dto.body,
      sentAt: dto.at,
      source: dto.source,
      attribution: dto.attribution === null ? null : toAttribution(dto.attribution),
    }
  }
  switch (dto.status) {
    case 'pending':
      if (dto.review_id === null) invalidMessage(dto)
      return {
        sender: 'bot',
        status: 'pending',
        id: dto.message_id,
        body: dto.body,
        reviewId: dto.review_id,
        scheduledAt: dto.at,
      }
    case 'scheduled':
      if (dto.review_id === null || dto.at === null || dto.approved_by === null) invalidMessage(dto)
      return {
        sender: 'bot',
        status: 'scheduled',
        id: dto.message_id,
        body: dto.body,
        reviewId: dto.review_id,
        scheduledAt: dto.at,
        approvedBy: dto.approved_by,
      }
    case 'sent':
      if (dto.at === null) invalidMessage(dto)
      return {
        sender: 'bot',
        status: 'sent',
        id: dto.message_id,
        body: dto.body,
        sentAt: dto.at,
        approvedBy: dto.approved_by,
      }
    case 'cancelled':
      if (dto.at === null || dto.cancel_reason === null) invalidMessage(dto)
      return {
        sender: 'bot',
        status: 'cancelled',
        id: dto.message_id,
        body: dto.body,
        at: dto.at,
        reason: dto.cancel_reason,
      }
    case 'expired':
      if (dto.at === null) invalidMessage(dto)
      return {
        sender: 'bot',
        status: 'expired',
        id: dto.message_id,
        body: dto.body,
        at: dto.at,
      }
    default:
      return invalidMessage(dto)
  }
}

function toDelivered(dto: MessageDto): DeliveredMessage {
  const message = toMessage(dto)
  if (message.sender === 'member' || message.status === 'sent') return message
  throw new Error(`목록의 마지막 메시지가 대화에 남은 메시지가 아닙니다: ${dto.message_id}`)
}

export function toMessageReview(dto: MessageReviewDto): MessageReview {
  if (dto.status === 'scheduled' && dto.approved_by === null)
    throw new Error(`예약 항목에 승인자가 없습니다: ${dto.review_id}`)
  if (dto.deadline_send_at === null && dto.deadline_send_passed)
    throw new Error(`마감이 없는 항목이 지났다고 왔습니다: ${dto.review_id}`)
  return {
    id: dto.review_id,
    threadId: dto.thread_id,
    recipientName: dto.recipient_name,
    summary: dto.summary,
    body: dto.body,
    createdAt: dto.created_at,
    deadline: dto.deadline,
    reason: dto.reason,
    reasonUrl: dto.reason_url,
    sendTiming: dto.send_timing,
    scheduledAt: dto.scheduled_at,
    deadlineSend:
      dto.deadline_send_at === null
        ? { status: 'none' }
        : dto.deadline_send_passed
          ? { status: 'passed', at: dto.deadline_send_at }
          : { status: 'open', at: dto.deadline_send_at },
    state:
      dto.status === 'scheduled'
        ? { status: 'scheduled', approvedBy: dto.approved_by as string }
        : { status: 'pending' },
  }
}

export function toMessageInbox(dto: MessageInboxDto): MessageInbox {
  return {
    reviews: dto.reviews.map(toMessageReview),
    threads: dto.threads.map((thread) => ({
      id: thread.thread_id,
      kind: thread.kind,
      name: thread.name,
      lastMessage: thread.last_message === null ? null : toDelivered(thread.last_message),
      awaitingReplySince: thread.awaiting_reply_since,
      needsAttribution: thread.needs_attribution,
    })),
  }
}

export function toMessageThread(dto: MessageThreadDto): MessageThread {
  return {
    id: dto.thread_id,
    kind: dto.kind,
    name: dto.name,
    teamRole: dto.team_role,
    discordUrl: dto.discord_url,
    messages: dto.messages.map(toMessage),
    awaitingReplySince: dto.awaiting_reply_since,
  }
}
