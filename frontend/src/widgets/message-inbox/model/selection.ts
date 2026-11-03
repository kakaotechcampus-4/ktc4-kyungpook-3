import type { MessageInbox, MessageReview } from '@/entities/message'
import type { ViewerPolicy } from './viewer'

export type DetailSelection =
  | { kind: 'invalid' }
  | { kind: 'thread'; threadId: string }
  | { kind: 'review'; review: MessageReview }
  | { kind: 'loading' }
  | { kind: 'choose' }

/**
 * URL 과 목록과 보는 사람으로 오른쪽 칸을 정한다.
 * 팀원은 검토 항목을 고르지 않는다. 대화 주소가 없으면 첫 대화를 열고, 주소는 그대로 둔다.
 */
export function selectDetail(input: {
  inbox: MessageInbox | undefined
  threadId: string | null
  reviewId: string | null | undefined
  invalidPath: boolean
  policy: ViewerPolicy
}): DetailSelection {
  if (input.invalidPath) return { kind: 'invalid' }
  if (input.threadId !== null) return { kind: 'thread', threadId: input.threadId }
  if (input.inbox === undefined) return { kind: 'loading' }
  if (!input.policy.reviews) {
    const first = input.inbox.threads[0]
    return first === undefined ? { kind: 'choose' } : { kind: 'thread', threadId: first.id }
  }
  const review =
    input.reviewId === undefined
      ? input.inbox.reviews[0]
      : input.inbox.reviews.find(({ id }) => id === input.reviewId)
  return review === undefined ? { kind: 'choose' } : { kind: 'review', review }
}
