import { http } from 'msw'
import type {
  MessageDto,
  MessageReviewDto,
  MessageSendResultDto,
  MessageSendTimingDto,
  MessageThreadDto,
  MessageThreadSummaryDto,
} from '@/shared/types/api/message'
import { db } from '../db'
import { ok, fail } from '../envelope'
import { requireMember } from '../auth-guard'
import { MOCK_NOW } from '../fixtures/constants'
import type { MockMessageReview, MockMessageThread } from '../fixtures/message'
import { nextId, readJson } from '../utils'

/*
 * M8 메시지. 메시지 API 가 없어 경로·응답 모양·오류 코드 모두 임시다 — 계약이 아니다 (계획 C-2, C-8).
 * 상태를 바꾸는 요청(발송·보내지 않음·고쳐 쓰기·발송 시점)은 성공 응답을 낼 때만 db 를 바꾼다 (D-137, 계획 C-5).
 * 발송 정책은 목 동작이다 — 소속 팀원이면 누구나 보낼 수 있고, 예약 시각이 지나도 스스로 나가지 않는다.
 * 시각은 MOCK_NOW, ID 는 nextId 다 (msw-guide 「지킬 규칙」)
 */

const serverError = () => fail('INTERNAL_ERROR', '메시지를 불러오지 못했습니다.', 500)
const actionError = () => fail('INTERNAL_ERROR', '메시지 요청을 처리하지 못했습니다.', 500)
const invalid = (message: string) => fail('INVALID_REQUEST', message, 400)
const reviewNotFound = () =>
  fail('MESSAGE_REVIEW_NOT_FOUND', '보내기 전 확인 항목을 찾을 수 없습니다.', 404)

/** Discord DM 한 건의 글자 수 한도 */
const BODY_MAX_LENGTH = 2000
const SEND_TIMINGS: readonly MessageSendTimingDto[] = ['day_before_deadline', 'now', 'custom']

/** 사람별 대화가 먼저, 채널은 뒤다(시안 목록). 같은 종류끼리는 마지막 메시지가 최근인 순이다 */
function byInboxOrder(a: MessageThreadSummaryDto, b: MessageThreadSummaryDto): number {
  if (a.kind !== b.kind) return a.kind === 'direct' ? -1 : 1
  const at = (thread: MessageThreadSummaryDto) =>
    thread.last_message === null ? 0 : Date.parse(thread.last_message.sent_at)
  return at(b) - at(a)
}

const sentMessages = (thread: MockMessageThread) =>
  thread.messages.filter(({ status }) => status === 'sent')

/**
 * 답장 대기 — 사람별 DM 에서 상대의 마지막 답 뒤에 나간 봇 메시지가 있으면 그 첫 메시지의 시각이다.
 * 채널은 답장을 기다리지 않는다. 예약 메시지는 아직 나가지 않아 세지 않는다
 */
function awaitingReplySince(thread: MockMessageThread): string | null {
  if (thread.kind !== 'direct') return null
  let since: string | null = null
  for (const message of sentMessages(thread)) {
    if (message.sender === 'counterpart') since = null
    else since ??= message.sent_at
  }
  return since
}

/** 응답에는 저장용 칸(workspace_id)을 싣지 않는다 */
function withoutWorkspace<T extends { workspace_id: string }>(row: T): Omit<T, 'workspace_id'> {
  const copy: Partial<T> = { ...row }
  delete copy.workspace_id
  return copy as Omit<T, 'workspace_id'>
}

const toReviewDto = (review: MockMessageReview): MessageReviewDto => withoutWorkspace(review)

function findReview(workspaceId: string, reviewId: unknown) {
  return db.messageReviews.find(
    ({ review_id, workspace_id }) => review_id === reviewId && workspace_id === workspaceId,
  )
}

/** 고쳐 쓰기·발송 시점 변경 요청을 읽는다. 틀렸으면 사람이 읽을 이유를 돌려준다 */
function readPatch(
  review: MockMessageReview,
  input: Record<string, unknown> | null,
): Partial<MockMessageReview> | string {
  if (input === null) return '요청 본문이 없습니다.'
  const patch: Partial<MockMessageReview> = {}
  if (input.body !== undefined) {
    if (typeof input.body !== 'string') return '문구가 올바르지 않습니다.'
    const body = input.body.trim()
    if (body.length === 0 || body.length > BODY_MAX_LENGTH)
      return `문구는 1자 이상 ${String(BODY_MAX_LENGTH)}자 이하입니다.`
    patch.body = body
  }
  if (input.send_timing !== undefined) {
    const timing = SEND_TIMINGS.find((value) => value === input.send_timing)
    if (timing === undefined) return '발송 시점이 올바르지 않습니다.'
    if (timing === 'day_before_deadline') {
      if (review.deadline_send_at === null) return '마감이 없는 항목입니다.'
      patch.scheduled_at = review.deadline_send_at
    } else if (timing === 'now') patch.scheduled_at = null
    else {
      const at = typeof input.scheduled_at === 'string' ? Date.parse(input.scheduled_at) : NaN
      if (!(at > Date.parse(MOCK_NOW))) return '발송 시각은 지금 이후여야 합니다.'
      patch.scheduled_at = input.scheduled_at as string
    }
    patch.send_timing = timing
  }
  return Object.keys(patch).length === 0 ? '바꿀 내용이 없습니다.' : patch
}

/** 보낸 메시지가 쌓일 대화. 대화가 아직 없으면 수신자 이름으로 연다 */
function threadFor(review: MockMessageReview): MockMessageThread {
  const existing = db.messageThreads.find(
    ({ thread_id, workspace_id }) =>
      thread_id === review.thread_id && workspace_id === review.workspace_id,
  )
  if (existing) return existing
  const created: MockMessageThread = {
    thread_id: review.thread_id,
    workspace_id: review.workspace_id,
    kind: 'direct',
    name: review.recipient_name,
    team_role: null,
    discord_url: null,
    messages: [],
  }
  db.messageThreads.push(created)
  return created
}

function removeReview(review: MockMessageReview): void {
  db.messageReviews = db.messageReviews.filter((candidate) => candidate !== review)
}

export const messageHandlers = [
  http.get('/api/v1/workspaces/:workspaceId/messages', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    if (db.messageFailures.inbox) return serverError()
    const reviews = db.messageReviews
      .filter(({ workspace_id }) => workspace_id === workspaceId)
      .map(toReviewDto)
    const threads = db.messageThreads
      .filter(({ workspace_id }) => workspace_id === workspaceId)
      .map((thread): MessageThreadSummaryDto => ({
        thread_id: thread.thread_id,
        kind: thread.kind,
        name: thread.name,
        last_message: sentMessages(thread).at(-1) ?? null,
        awaiting_reply_since: awaitingReplySince(thread),
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
    return ok({
      ...withoutWorkspace(thread),
      awaiting_reply_since: awaitingReplySince(thread),
      pending_reviews: db.messageReviews
        .filter(
          ({ thread_id, workspace_id }) =>
            thread_id === thread.thread_id && workspace_id === workspaceId,
        )
        .map(({ review_id, body, scheduled_at }) => ({ review_id, body, scheduled_at })),
    } satisfies MessageThreadDto)
  }),

  http.patch(
    '/api/v1/workspaces/:workspaceId/messages/reviews/:reviewId',
    async ({ params, request }) => {
      const workspaceId = String(params.workspaceId)
      const denied = requireMember(workspaceId)
      if (denied) return denied
      const review = findReview(workspaceId, params.reviewId)
      if (!review) return reviewNotFound()
      const patch = readPatch(review, await readJson(request))
      if (typeof patch === 'string') return invalid(patch)
      if (db.messageFailures.actions) return actionError()
      Object.assign(review, patch)
      return ok(toReviewDto(review))
    },
  ),

  /** 승인해서 보낸다. 시각을 정해 두었으면 그 시각을 기다리는 예약 메시지가 된다 */
  http.post('/api/v1/workspaces/:workspaceId/messages/reviews/:reviewId/send', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    const review = findReview(workspaceId, params.reviewId)
    if (!review) return reviewNotFound()
    if (db.messageFailures.actions) return actionError()
    const sentAt = review.scheduled_at ?? MOCK_NOW
    const message: MessageDto = {
      message_id: nextId(
        'mg',
        db.messageThreads.flatMap(({ messages }) => messages.map(({ message_id }) => message_id)),
      ),
      sender: 'bot',
      body: review.body,
      sent_at: sentAt,
      status: Date.parse(sentAt) > Date.parse(MOCK_NOW) ? 'scheduled' : 'sent',
      delivery: 'approved',
      approved_by: db.session.user.name,
    }
    const thread = threadFor(review)
    thread.messages.push(message)
    removeReview(review)
    return ok({ thread_id: thread.thread_id, message } satisfies MessageSendResultDto)
  }),

  /** 보내지 않는다(반려). 항목만 지우고 대화는 그대로다 */
  http.post('/api/v1/workspaces/:workspaceId/messages/reviews/:reviewId/dismiss', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    const review = findReview(workspaceId, params.reviewId)
    if (!review) return reviewNotFound()
    if (db.messageFailures.actions) return actionError()
    removeReview(review)
    return ok({ review_id: review.review_id })
  }),
]
