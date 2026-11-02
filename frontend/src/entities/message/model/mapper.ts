import type {
  MessageDto,
  MessageInboxDto,
  MessageReviewDto,
  MessageThreadDto,
} from '@/shared/types/api/message'
import type { Message, MessageInbox, MessageReview, MessageThread } from './types'

export function toMessage(dto: MessageDto): Message {
  return {
    id: dto.message_id,
    sender: dto.sender,
    body: dto.body,
    sentAt: dto.sent_at,
    status: dto.status,
    delivery: dto.delivery,
    approvedBy: dto.approved_by,
  }
}

export function toMessageReview(dto: MessageReviewDto): MessageReview {
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
    deadlineSendAt: dto.deadline_send_at,
  }
}

export function toMessageInbox(dto: MessageInboxDto): MessageInbox {
  return {
    reviews: dto.reviews.map(toMessageReview),
    threads: dto.threads.map((thread) => ({
      id: thread.thread_id,
      kind: thread.kind,
      name: thread.name,
      lastMessage: thread.last_message === null ? null : toMessage(thread.last_message),
      awaitingReplySince: thread.awaiting_reply_since,
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
    pendingReviews: dto.pending_reviews.map(({ review_id, body, scheduled_at }) => ({
      id: review_id,
      body,
      scheduledAt: scheduled_at,
    })),
  }
}
