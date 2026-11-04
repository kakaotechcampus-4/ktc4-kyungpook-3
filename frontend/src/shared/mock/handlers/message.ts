import { http } from 'msw'
import type { MessageSendTimingDto } from '@/shared/types/api/message'
import { db } from '../db'
import { ok, fail } from '../envelope'
import { requireMember, requirePmRole } from '../auth-guard'
import { MOCK_NOW } from '../fixtures/constants'
import { reply } from '../fixtures/message'
import type { MockMessageReview } from '../fixtures/message'
import { roleIn, sessionMemberId } from '../sessions'
import {
  applyPatch,
  approve,
  dismiss,
  isOpen,
  reviewDtoOf,
  sendCheck,
  threadDtoOf,
  threadSummaryOf,
} from '../message-state'
import { nextId, readJson } from '../utils'

/*
 * M8 메시지. 메시지 API 가 없어 경로·응답 모양·오류 코드 모두 임시다 — 계약이 아니다 (계획 C-2, C-8).
 * 상태를 바꾸는 요청(발송·보내지 않음·고쳐 쓰기·발송 시점·답장·답장 판정)은 성공 응답을 낼 때만 db 를 바꾼다 (D-137, 계획 C-5).
 * 발송 정책은 D-174 를 따른다 — 승인·고쳐 쓰기·보내지 않음·발송 시점·답장 판정은 PM 만, 답장은 그 대화의 팀원만 한다. 재촉 자동 승인은 꺼져 있고 예약 시각이 지나도 스스로 나가지 않는다.
 * 시각은 MOCK_NOW, ID 는 nextId 다 (msw-guide 「지킬 규칙」)
 */

const serverError = () => fail('INTERNAL_ERROR', '메시지를 불러오지 못했습니다.', 500)
const actionError = () => fail('INTERNAL_ERROR', '메시지 요청을 처리하지 못했습니다.', 500)
const invalid = (message: string) => fail('INVALID_REQUEST', message, 400)
const reviewNotFound = () =>
  fail('MESSAGE_REVIEW_NOT_FOUND', '보내기 전 확인 항목을 찾을 수 없습니다.', 404)
const replyNotFound = () => fail('MESSAGE_REPLY_NOT_FOUND', '확인할 답장을 찾을 수 없습니다.', 404)

/** Discord DM 한 건의 글자 수 한도 */
const BODY_MAX_LENGTH = 2000
const SEND_TIMINGS: readonly MessageSendTimingDto[] = ['day_before_deadline', 'now', 'custom']

function viewerOf(workspaceId: string): 'pm' | 'member' {
  return roleIn(workspaceId) === 'pm' ? 'pm' : 'member'
}

function byInboxOrder(
  left: { kind: string; last_message: { at: string | null } | null },
  right: { kind: string; last_message: { at: string | null } | null },
): number {
  if (left.kind !== right.kind) return left.kind === 'direct' ? -1 : 1
  const at = (thread: { last_message: { at: string | null } | null }) => {
    const stamp = thread.last_message?.at
    return stamp === null || stamp === undefined ? 0 : Date.parse(stamp)
  }
  return at(right) - at(left)
}

function findReview(workspaceId: string, reviewId: unknown) {
  return db.messageReviews.find(
    ({ review_id, workspace_id }) => review_id === reviewId && workspace_id === workspaceId,
  )
}

/** 고쳐 쓰기·발송 시점 변경 요청을 읽는다. 틀렸으면 사람이 읽을 이유를 돌려준다 */
function readPatch(
  review: MockMessageReview,
  input: Record<string, unknown> | null,
): Partial<Pick<MockMessageReview, 'body' | 'send_timing' | 'scheduled_at'>> | string {
  if (input === null) return '요청 본문이 없습니다.'
  const patch: Partial<Pick<MockMessageReview, 'body' | 'send_timing' | 'scheduled_at'>> = {}
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
      if (Date.parse(review.deadline_send_at) <= Date.parse(MOCK_NOW))
        return '마감 하루 전 시각이 이미 지났습니다.'
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

export const messageHandlers = [
  http.get('/api/v1/workspaces/:workspaceId/messages', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    if (db.messageFailures.inbox) return serverError()
    const viewer = viewerOf(workspaceId)
    const ownerId = sessionMemberId(workspaceId)
    const reviews = db.messageReviews.filter((review) => review.workspace_id === workspaceId)
    const threads = db.messageThreads
      .filter(({ workspace_id }) => workspace_id === workspaceId)
      .filter((thread) => viewer === 'pm' || (ownerId !== null && thread.member_id === ownerId))
      .map((thread) => threadSummaryOf(thread, reviews, MOCK_NOW, viewer, db.tasks))
      .sort(byInboxOrder)
    return ok({
      reviews:
        viewer === 'member'
          ? []
          : reviews
              .filter((review) => isOpen(review, MOCK_NOW))
              .map((review) => reviewDtoOf(review, MOCK_NOW)),
      threads,
    })
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
    const viewer = viewerOf(workspaceId)
    const ownerId = sessionMemberId(workspaceId)
    if (viewer === 'member' && (ownerId === null || thread.member_id !== ownerId))
      return fail('MESSAGE_THREAD_NOT_FOUND', '대화를 찾을 수 없습니다.', 404)
    if (db.messageFailures.threadIds.includes(thread.thread_id)) return serverError()
    const reviews = db.messageReviews.filter((review) => review.workspace_id === workspaceId)
    return ok(threadDtoOf(thread, reviews, MOCK_NOW, viewer, db.tasks))
  }),

  /** 그 대화의 팀원만 웹에서 답한다. Discord 로는 나가지 않고, 재촉 상태는 바꾸지 않는다 */
  http.post(
    '/api/v1/workspaces/:workspaceId/messages/threads/:threadId/replies',
    async ({ params, request }) => {
      const workspaceId = String(params.workspaceId)
      const denied = requireMember(workspaceId)
      if (denied) return denied
      const thread = db.messageThreads.find(
        ({ thread_id, workspace_id }) =>
          thread_id === params.threadId && workspace_id === workspaceId,
      )
      const ownerId = sessionMemberId(workspaceId)
      if (
        viewerOf(workspaceId) !== 'member' ||
        ownerId === null ||
        !thread ||
        thread.member_id !== ownerId
      )
        return fail('FORBIDDEN', '자기 대화에만 답장할 수 있습니다.', 403)
      const input = await readJson(request)
      const body = typeof input?.body === 'string' ? input.body.trim() : null
      if (body === null || body.length === 0 || body.length > BODY_MAX_LENGTH)
        return invalid(`답장은 1자 이상 ${String(BODY_MAX_LENGTH)}자 이하입니다.`)
      if (db.messageFailures.actions) return actionError()
      const messageId = nextId(
        'mg',
        db.messageThreads.flatMap((item) => item.messages.map(({ message_id }) => message_id)),
      )
      thread.messages.push(reply(messageId, body, MOCK_NOW, 'web'))
      return ok({ message_id: messageId })
    },
  ),

  /** PM 만 답장의 태스크를 정한다. 한 번 정하면 다시 고르지 않고, 재촉 상태는 바꾸지 않는다 */
  http.post(
    '/api/v1/workspaces/:workspaceId/messages/replies/:messageId/attribution',
    async ({ params, request }) => {
      const workspaceId = String(params.workspaceId)
      const denied = requirePmRole(workspaceId)
      if (denied) return denied
      const message = db.messageThreads
        .filter(({ workspace_id }) => workspace_id === workspaceId)
        .flatMap((thread) => thread.messages)
        .find((item) => item.message_id === params.messageId && item.sender === 'member')
      const attribution = message?.attribution
      if (!message || attribution?.status !== 'needs_pm') return replyNotFound()
      const input = await readJson(request)
      if (input === null || !('task_id' in input)) return invalid('후보에 없는 태스크입니다.')
      const taskId: unknown = input.task_id
      if (
        taskId !== null &&
        (typeof taskId !== 'string' || !attribution.candidate_task_ids.includes(taskId))
      )
        return invalid('후보에 없는 태스크입니다.')
      if (db.messageFailures.actions) return actionError()
      message.attribution = { status: 'resolved', task_id: taskId }
      return ok({ message_id: message.message_id })
    },
  ),

  http.patch(
    '/api/v1/workspaces/:workspaceId/messages/reviews/:reviewId',
    async ({ params, request }) => {
      const workspaceId = String(params.workspaceId)
      const denied = requirePmRole(workspaceId)
      if (denied) return denied
      const review = findReview(workspaceId, params.reviewId)
      if (!review || !isOpen(review, MOCK_NOW)) return reviewNotFound()
      const patch = readPatch(review, await readJson(request))
      if (typeof patch === 'string') return invalid(patch)
      if (db.messageFailures.actions) return actionError()
      applyPatch(review, patch)
      return ok(reviewDtoOf(review, MOCK_NOW))
    },
  ),

  /** 승인해서 보낸다. 시각이 있으면 그 시각의 예약으로 같은 항목이 남고, 없으면 지금 나간다 */
  http.post('/api/v1/workspaces/:workspaceId/messages/reviews/:reviewId/send', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requirePmRole(workspaceId)
    if (denied) return denied
    const review = findReview(workspaceId, params.reviewId)
    if (!review) return reviewNotFound()
    const check = sendCheck(review, MOCK_NOW)
    if (check === 'gone') return reviewNotFound()
    if (check === 'time_passed')
      return fail(
        'MESSAGE_SCHEDULE_PASSED',
        '예정 시각이 지났습니다. 발송 시각을 다시 골라 주세요.',
        409,
      )
    if (db.messageFailures.actions) return actionError()
    approve(review, db.session.user.name, MOCK_NOW)
    return ok({ review_id: review.review_id })
  }),

  /** 보내지 않는다. 항목을 지우지 않고 취소된 기록으로 남긴다 */
  http.post('/api/v1/workspaces/:workspaceId/messages/reviews/:reviewId/dismiss', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requirePmRole(workspaceId)
    if (denied) return denied
    const review = findReview(workspaceId, params.reviewId)
    if (!review || !isOpen(review, MOCK_NOW)) return reviewNotFound()
    if (db.messageFailures.actions) return actionError()
    dismiss(review, MOCK_NOW)
    return ok({ review_id: review.review_id })
  }),
]
