import { addDays, seoulDateOf } from '@/shared/lib/date'
import type {
  MessageDto,
  MessageReviewDto,
  MessageThreadDto,
  MessageThreadSummaryDto,
} from '@/shared/types/api/message'
import type { MockMessageReview, MockMessageThread, MockThreadMessage } from './fixtures/message'

/** 태스크 제목을 답장 판정에 붙일 때 쓰는 칸. 태스크 DTO 전체가 필요하지 않다 */
interface TaskTitle {
  task_id: string
  workspace_id: string
  title: string
}

/*
 * 재촉 한 건의 단계와 화면 자리. handler 가 부른다. db 에는 쓰지 않는다 (task-state 와 같은 자리).
 * 재촉 자동 승인은 꺼져 있다. 예약 시각이 지나도 스스로 나가지 않는다 (#298 이 설정을 바꾼다).
 */

export const REMINDER_AUTO_APPROVE = false

type ReminderPhase = 'pending' | 'approved' | 'sent' | 'cancelled' | 'expired'

const earlier = (left: string, right: string) =>
  Date.parse(left) <= Date.parse(right) ? left : right

/** 저장한 `pending` 인데 마감일이 오늘보다 앞이면 만료다. 만료는 저장하지 않는다 */
export function reminderStatus(review: MockMessageReview, now: string): ReminderPhase {
  if (review.state === 'pending' && review.deadline !== null) {
    const today = seoulDateOf(now)
    if (today !== null && review.deadline < today) return 'expired'
  }
  return review.state
}

/** 목록에 나오고, 고쳐 쓰기·시점·보내지 않음을 받는 단계 */
export function isOpen(review: MockMessageReview, now: string): boolean {
  const status = reminderStatus(review, now)
  return status === 'pending' || status === 'approved'
}

/** 발송이 가능한가. `gone` 은 404, `time_passed` 는 409 이고 어느 쪽도 db 를 바꾸지 않는다 */
export function sendCheck(review: MockMessageReview, now: string): 'ok' | 'gone' | 'time_passed' {
  if (reminderStatus(review, now) !== 'pending') return 'gone'
  if (
    !REMINDER_AUTO_APPROVE &&
    review.scheduled_at !== null &&
    Date.parse(review.scheduled_at) <= Date.parse(now)
  )
    return 'time_passed'
  return 'ok'
}

/** 승인. 시각이 없으면 지금 나간다. 있으면 승인된 예약으로 목록에 남는다 */
export function approve(review: MockMessageReview, by: string, now: string): void {
  review.approved_by = by
  if (review.scheduled_at === null) {
    review.state = 'sent'
    review.closed_at = now
    return
  }
  review.state = 'approved'
}

/** 보내지 않음. 나가려던 시각이 나중이면 취소한 시각에 놓는다 */
export function dismiss(review: MockMessageReview, now: string): void {
  review.state = 'cancelled'
  review.cancel_reason = 'dismissed'
  review.closed_at = earlier(review.scheduled_at ?? now, now)
}

/** 문구·시점. 이미 승인된 항목이면 다시 승인 대기로 되돌린다 — 이대로 발송만 보낸다 */
export function applyPatch(
  review: MockMessageReview,
  patch: Partial<Pick<MockMessageReview, 'body' | 'send_timing' | 'scheduled_at'>>,
): void {
  if (patch.body !== undefined) review.body = patch.body
  if (patch.send_timing !== undefined) review.send_timing = patch.send_timing
  if ('scheduled_at' in patch) review.scheduled_at = patch.scheduled_at ?? null
  if (review.state === 'approved') {
    review.state = 'pending'
    review.approved_by = null
  }
}

/** 대화에서 이 재촉을 놓는 시각. 승인 대기의 지금 바로는 null */
export function placedAt(review: MockMessageReview, now: string): string | null {
  const status = reminderStatus(review, now)
  if (status === 'pending' || status === 'approved') return review.scheduled_at
  if (status === 'sent' || status === 'cancelled') return review.closed_at
  const boundary = review.deadline === null ? null : `${addDays(review.deadline, 1)}T00:00:00+09:00`
  if (review.scheduled_at === null) return boundary
  if (boundary === null) return review.scheduled_at
  return earlier(review.scheduled_at, boundary)
}

export function reviewDtoOf(review: MockMessageReview, now: string): MessageReviewDto {
  const phase = reminderStatus(review, now)
  return {
    review_id: review.review_id,
    thread_id: review.thread_id,
    recipient_name: review.recipient_name,
    summary: review.summary,
    body: review.body,
    created_at: review.created_at,
    deadline: review.deadline,
    reason: review.reason,
    reason_url: review.reason_url,
    send_timing: review.send_timing,
    scheduled_at: review.scheduled_at,
    deadline_send_at: review.deadline_send_at,
    status: phase === 'approved' ? 'scheduled' : 'pending',
    approved_by: phase === 'approved' ? review.approved_by : null,
    deadline_send_passed:
      review.deadline_send_at !== null && Date.parse(review.deadline_send_at) <= Date.parse(now),
  }
}

function taskRef(tasks: readonly TaskTitle[], workspaceId: string, taskId: string) {
  const task = tasks.find((item) => item.task_id === taskId && item.workspace_id === workspaceId)
  return task === undefined ? null : { task_id: task.task_id, title: task.title }
}

/** 저장한 판정을 응답 모양으로. 팀원 답장만 가지고, 없는 태스크는 후보에서 뺀다 */
function attributionOf(
  message: MockThreadMessage,
  tasks: readonly TaskTitle[],
  workspaceId: string,
): MessageDto['attribution'] {
  if (message.sender !== 'member' || message.attribution === null) return null
  if (message.attribution.status === 'resolved') {
    return {
      status: 'resolved',
      task:
        message.attribution.task_id === null
          ? null
          : taskRef(tasks, workspaceId, message.attribution.task_id),
    }
  }
  return {
    status: 'needs_pm',
    candidates: message.attribution.candidate_task_ids.flatMap((taskId) => {
      const task = taskRef(tasks, workspaceId, taskId)
      return task === null ? [] : [task]
    }),
  }
}

function historyMessage(
  message: MockThreadMessage,
  tasks: readonly TaskTitle[] = [],
  workspaceId = '',
): MessageDto {
  const member = message.sender === 'member'
  return {
    message_id: message.message_id,
    sender: message.sender,
    body: message.body,
    status: 'sent',
    at: message.sent_at,
    approved_by: member ? null : message.approved_by,
    review_id: null,
    cancel_reason: null,
    source: member ? message.source : null,
    attribution: attributionOf(message, tasks, workspaceId),
    schedule_passed: false,
  }
}

function reminderMessage(review: MockMessageReview, now: string): MessageDto {
  const phase = reminderStatus(review, now)
  const status = phase === 'approved' ? 'scheduled' : phase
  const open = status === 'pending' || status === 'scheduled'
  return {
    message_id: review.review_id,
    sender: 'bot',
    body: review.body,
    status,
    at: placedAt(review, now),
    approved_by: status === 'scheduled' || status === 'sent' ? review.approved_by : null,
    review_id: open ? review.review_id : null,
    cancel_reason: status === 'cancelled' ? review.cancel_reason : null,
    source: null,
    attribution: null,
    schedule_passed:
      status === 'pending' &&
      review.scheduled_at !== null &&
      Date.parse(review.scheduled_at) <= Date.parse(now),
  }
}

/** 시각이 없으면 뒤로 보낸다. 둘 다 없으면 0 이라 들어온 순서가 유지된다 */
function byAt(left: MessageDto, right: MessageDto): number {
  if (left.at === null && right.at === null) return 0
  if (left.at === null) return 1
  if (right.at === null) return -1
  return Date.parse(left.at) - Date.parse(right.at)
}

function reviewsOf(thread: MockMessageThread, reviews: readonly MockMessageReview[]) {
  return reviews.filter(
    (review) =>
      review.thread_id === thread.thread_id && review.workspace_id === thread.workspace_id,
  )
}

/** 이미 대화에 남은 것 — 기록과 발송된 재촉. 목록 미리보기·답장 대기가 이것만 본다 */
function deliveredMessages(
  thread: MockMessageThread,
  reviews: readonly MockMessageReview[],
  now: string,
  tasks: readonly TaskTitle[] = [],
): MessageDto[] {
  return [
    ...thread.messages.map((message) => historyMessage(message, tasks, thread.workspace_id)),
    ...reviewsOf(thread, reviews)
      .filter((review) => reminderStatus(review, now) === 'sent')
      .map((review) => reminderMessage(review, now)),
  ].sort(byAt)
}

function threadMessages(
  thread: MockMessageThread,
  reviews: readonly MockMessageReview[],
  now: string,
  tasks: readonly TaskTitle[] = [],
): MessageDto[] {
  return [
    ...thread.messages.map((message) => historyMessage(message, tasks, thread.workspace_id)),
    ...reviewsOf(thread, reviews).map((review) => reminderMessage(review, now)),
  ].sort(byAt)
}

function awaitingReplySince(
  messages: readonly MessageDto[],
  kind: MockMessageThread['kind'],
): string | null {
  if (kind !== 'direct') return null
  let since: string | null = null
  for (const message of messages) {
    if (message.sender === 'member') since = null
    else since ??= message.at
  }
  return since
}

/** 팀원에게는 이미 전달된 것만 남기고, 승인·답장 대기·태스크 판정은 비운다 */
function forMember(message: MessageDto): MessageDto {
  return { ...message, approved_by: null, attribution: null }
}

/** 전달된 팀원 답장 중에 태스크를 아직 정하지 못한 것이 있는가. 팀원에게는 항상 아니다 */
function needsAttribution(messages: readonly MessageDto[], viewer: 'pm' | 'member'): boolean {
  if (viewer === 'member') return false
  return messages.some(
    (message) => message.sender === 'member' && message.attribution?.status === 'needs_pm',
  )
}

export function threadSummaryOf(
  thread: MockMessageThread,
  reviews: readonly MockMessageReview[],
  now: string,
  viewer: 'pm' | 'member' = 'pm',
  tasks: readonly TaskTitle[] = [],
): MessageThreadSummaryDto {
  const delivered = deliveredMessages(thread, reviews, now, tasks)
  const last = delivered.at(-1) ?? null
  return {
    thread_id: thread.thread_id,
    kind: thread.kind,
    name: thread.name,
    last_message: viewer === 'member' && last !== null ? forMember(last) : last,
    awaiting_reply_since: viewer === 'member' ? null : awaitingReplySince(delivered, thread.kind),
    needs_attribution: needsAttribution(delivered, viewer),
  }
}

export function threadDtoOf(
  thread: MockMessageThread,
  reviews: readonly MockMessageReview[],
  now: string,
  viewer: 'pm' | 'member' = 'pm',
  tasks: readonly TaskTitle[] = [],
): MessageThreadDto {
  const delivered = deliveredMessages(thread, reviews, now, tasks)
  return {
    thread_id: thread.thread_id,
    kind: thread.kind,
    name: thread.name,
    team_role: thread.team_role,
    discord_url: thread.discord_url,
    messages:
      viewer === 'member' ? delivered.map(forMember) : threadMessages(thread, reviews, now, tasks),
    awaiting_reply_since: viewer === 'member' ? null : awaitingReplySince(delivered, thread.kind),
  }
}
