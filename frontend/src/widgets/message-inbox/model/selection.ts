import type { MessageInbox, MessageReview } from '@/entities/message'
import type { ViewerPolicy } from './viewer'

export type DetailSelection =
  | { kind: 'invalid' }
  | { kind: 'thread'; threadId: string }
  | { kind: 'review'; review: MessageReview }
  | { kind: 'loading' }
  | { kind: 'choose' }

/** 파라미터가 없으면 아직 결정하지 않은 첫 항목을 연다. 전부 예정이면 목록의 첫 항목이다 */
function defaultReview(reviews: readonly MessageReview[]): MessageReview | undefined {
  return reviews.find((review) => review.state.status === 'pending') ?? reviews[0]
}

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
      ? defaultReview(input.inbox.reviews)
      : input.inbox.reviews.find(({ id }) => id === input.reviewId)
  return review === undefined ? { kind: 'choose' } : { kind: 'review', review }
}
