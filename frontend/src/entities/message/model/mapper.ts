import type {
  MessageDto,
  MessageInboxDto,
  MessageReviewDto,
  MessageThreadDto,
  MessageThreadKindDto,
} from '@/shared/types/api/message'
import type { Message, MessageInbox, MessageReview, MessageThread } from './types'

function toMessage(dto: MessageDto): Message {
  return { id: dto.message_id, sender: dto.sender, body: dto.body, sentAt: dto.sent_at }
}

function toMessageReview(dto: MessageReviewDto): MessageReview {
  return {
    id: dto.review_id,
    recipientName: dto.recipient_name,
    summary: dto.summary,
    body: dto.body,
    createdAt: dto.created_at,
  }
}

/**
 * 답장 대기 — 사람별 DM 에서 봇이 마지막으로 보냈고 그 뒤 답장이 없다 (결정 4 의 임시 기본값, D-057·D-058).
 * 며칠째인지는 계산 방식이 정해지지 않아 세지 않는다. 채널은 답장을 기다리지 않는다
 */
function isAwaitingReply(kind: MessageThreadKindDto, last: MessageDto | null | undefined): boolean {
  return kind === 'direct' && last?.sender === 'bot'
}

export function toMessageInbox(dto: MessageInboxDto): MessageInbox {
  return {
    reviews: dto.reviews.map(toMessageReview),
    threads: dto.threads.map((thread) => ({
      id: thread.thread_id,
      kind: thread.kind,
      name: thread.name,
      lastMessage: thread.last_message === null ? null : toMessage(thread.last_message),
      awaitingReply: isAwaitingReply(thread.kind, thread.last_message),
    })),
  }
}

export function toMessageThread(dto: MessageThreadDto): MessageThread {
  return {
    id: dto.thread_id,
    kind: dto.kind,
    name: dto.name,
    messages: dto.messages.map(toMessage),
    awaitingReply: isAwaitingReply(dto.kind, dto.messages.at(-1)),
  }
}
