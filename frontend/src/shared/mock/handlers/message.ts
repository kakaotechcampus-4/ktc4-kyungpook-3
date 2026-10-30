import { http } from 'msw'
import type {
  MessageReviewDto,
  MessageThreadDto,
  MessageThreadSummaryDto,
} from '@/shared/types/api/message'
import { db } from '../db'
import { ok, fail } from '../envelope'
import { requireMember } from '../auth-guard'

/*
 * M8 메시지. 메시지 API 가 없어 경로·응답 모양·오류 코드 모두 임시다 — 계약이 아니다 (계획 C-2, C-8).
 * 조회만 있다. 발송·반려는 결정 4 뒤에 더한다 — 그때도 성공 응답을 낼 때만 db 를 바꾼다 (D-137, 계획 C-5).
 */

const serverError = () => fail('INTERNAL_ERROR', '메시지를 불러오지 못했습니다.', 500)

/** 사람별 대화가 먼저, 채널은 뒤다(시안 목록). 같은 종류끼리는 마지막 메시지가 최근인 순이다 */
function byInboxOrder(a: MessageThreadSummaryDto, b: MessageThreadSummaryDto): number {
  if (a.kind !== b.kind) return a.kind === 'direct' ? -1 : 1
  const at = (thread: MessageThreadSummaryDto) =>
    thread.last_message === null ? 0 : Date.parse(thread.last_message.sent_at)
  return at(b) - at(a)
}

export const messageHandlers = [
  http.get('/api/v1/workspaces/:workspaceId/messages', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    if (db.messageFailures.inbox) return serverError()
    const reviews = db.messageReviews
      .filter(({ workspace_id }) => workspace_id === workspaceId)
      .map(({ review_id, recipient_name, summary, body, created_at }): MessageReviewDto => ({
        review_id,
        recipient_name,
        summary,
        body,
        created_at,
      }))
    const threads = db.messageThreads
      .filter(({ workspace_id }) => workspace_id === workspaceId)
      .map(({ thread_id, kind, name, messages }): MessageThreadSummaryDto => ({
        thread_id,
        kind,
        name,
        last_message: messages.at(-1) ?? null,
      }))
      .sort(byInboxOrder)
    return ok({ reviews, threads })
  }),

  http.get('/api/v1/workspaces/:workspaceId/messages/threads/:threadId', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    const thread = db.messageThreads.find(
      ({ thread_id, workspace_id }) =>
        thread_id === params.threadId && workspace_id === workspaceId,
    )
    if (!thread) return fail('MESSAGE_THREAD_NOT_FOUND', '대화를 찾을 수 없습니다.', 404)
    if (db.messageFailures.threadIds.includes(thread.thread_id)) return serverError()
    const { thread_id, kind, name, messages } = thread
    return ok({ thread_id, kind, name, messages } satisfies MessageThreadDto)
  }),
]
