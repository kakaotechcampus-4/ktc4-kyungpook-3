import type {
  BundleDto,
  InboxDto,
  MessageDto,
  ThreadDetailDto,
  ThreadSummaryDto,
} from '@/shared/types/api/message'
import type { MockBundle, MockMessageThread } from './fixtures/message'

/*
 * 메시지 상태 전이와 응답 모양 (계약 §5.7, 백엔드 api/messages.py·services/messages.py 의 같은 규칙).
 * handler 가 부른다. 시각은 서버처럼 UTC 로 내보낸다.
 * 묶음 합치기(같은 시각으로 옮기면 합쳐짐)와 스케줄러 발송·만료는 흉내 내지 않는다
 */

export type Viewer = 'pm' | 'member'

const time = (value: number | string) => (typeof value === 'number' ? value : Date.parse(value))

export function utc(timestamp: string): string {
  return new Date(timestamp).toISOString()
}

const utcOrNull = (timestamp: string | null) => (timestamp === null ? null : utc(timestamp))

/** 응답에는 묶음과 같은 상태인 리마인드만 싣는다 */
export function bundleDto(bundle: MockBundle): BundleDto {
  const { workspace_id: _workspace, ...rest } = bundle
  return {
    ...rest,
    scheduled_at: utc(bundle.scheduled_at),
    approved_at: utcOrNull(bundle.approved_at),
    reminders: bundle.reminders
      .filter((reminder) => reminder.status === bundle.status)
      .map((reminder) => ({ ...reminder, created_at: utc(reminder.created_at) })),
  }
}

function messageDto(thread: MockMessageThread, index: number): MessageDto {
  const message = thread.messages[index]
  return {
    ...message,
    thread_id: thread.thread_id,
    created_at: utc(message.created_at),
    scheduled_at: utcOrNull(message.scheduled_at),
  }
}

function sortedMessages(thread: MockMessageThread): MessageDto[] {
  return thread.messages
    .map((_, index) => messageDto(thread, index))
    .sort((left, right) => time(left.created_at) - time(right.created_at))
}

/** 목록 한 줄. 답장 대기는 팀원의 마지막 답 뒤에 처음 나간 봇 메시지의 시각이다 */
export function threadSummaryOf(thread: MockMessageThread): ThreadSummaryDto {
  const messages = sortedMessages(thread)
  const last = messages.at(-1) ?? null
  let awaiting: string | null = null
  for (const message of messages) {
    if (message.sender === 'member') awaiting = null
    else awaiting ??= message.created_at
  }
  const lastBot = messages.filter((message) => message.sender === 'bot').at(-1)
  return {
    thread_id: thread.thread_id,
    member_id: thread.member_id,
    name: thread.name,
    last_message:
      last === null
        ? null
        : {
            message_id: last.message_id,
            sender: last.sender,
            body: last.body,
            created_at: last.created_at,
          },
    awaiting_reply_since: awaiting,
    dm_failed: lastBot?.dm_status === 'failed',
  }
}

function scheduledBundles(bundles: readonly MockBundle[], threadId?: string): BundleDto[] {
  return bundles
    .filter(
      (bundle) =>
        bundle.status === 'scheduled' && (threadId === undefined || bundle.thread_id === threadId),
    )
    .sort((left, right) => time(left.scheduled_at) - time(right.scheduled_at))
    .map(bundleDto)
}

/** 최근 대화가 위로. 메시지가 없는 대화는 아래로 간다 */
function byRecent(left: ThreadSummaryDto, right: ThreadSummaryDto): number {
  if (left.last_message === null || right.last_message === null)
    return Number(left.last_message === null) - Number(right.last_message === null)
  return time(right.last_message.created_at) - time(left.last_message.created_at)
}

/** PM 은 모든 대화와 예정 묶음을, 팀원은 자기 대화만 본다 */
export function inboxOf(
  threads: readonly MockMessageThread[],
  bundles: readonly MockBundle[],
  viewer: Viewer,
  ownerId: string | null,
): InboxDto {
  return {
    threads: threads
      .filter((thread) => viewer === 'pm' || thread.member_id === ownerId)
      .map(threadSummaryOf)
      .sort(byRecent),
    bundles: viewer === 'pm' ? scheduledBundles(bundles) : null,
  }
}

export function threadDetailOf(
  thread: MockMessageThread,
  bundles: readonly MockBundle[],
  viewer: Viewer,
): ThreadDetailDto {
  return {
    thread: threadSummaryOf(thread),
    messages: sortedMessages(thread),
    bundles: viewer === 'pm' ? scheduledBundles(bundles, thread.thread_id) : null,
  }
}

/** 상태를 바꾸지 못한 이유. 어느 쪽이든 db 는 그대로다 */
export type BundleRefusal = 'not_editable' | 'changed' | 'time_passed'

/** 이미 승인했으면 판과 상관없이 그대로 성공이다. 판이 다르면 changed, 시각이 지났으면 time_passed */
export function approveBundle(
  bundle: MockBundle,
  draftVersion: number,
  now: string,
): BundleRefusal | null {
  if (bundle.status !== 'scheduled') return 'not_editable'
  if (bundle.approved) return null
  if (draftVersion !== bundle.draft_version) return 'changed'
  if (time(bundle.scheduled_at) <= time(now)) return 'time_passed'
  bundle.approved = true
  bundle.approved_at = now
  bundle.draft_status = 'done'
  return null
}

/** 문구·시각을 고친다. 승인은 그대로다. 문구를 고치면 판이 오르고, 시각만 옮기면 그대로다 */
export function editBundle(
  bundle: MockBundle,
  patch: { body?: string; scheduled_at?: string },
  now: string,
): BundleRefusal | null {
  if (bundle.status !== 'scheduled') return 'not_editable'
  const moved =
    patch.scheduled_at !== undefined && time(patch.scheduled_at) !== time(bundle.scheduled_at)
  if (moved && time(patch.scheduled_at as string) <= time(now)) return 'time_passed'
  if (patch.body !== undefined) {
    bundle.body = patch.body
    bundle.body_source = 'pm'
    bundle.draft_status = 'done'
    bundle.draft_version += 1
  }
  if (moved) bundle.scheduled_at = patch.scheduled_at as string
  return null
}

/** 보내지 않음. 안의 리마인드도 모두 취소된다 */
export function cancelBundle(bundle: MockBundle): BundleRefusal | null {
  if (bundle.status !== 'scheduled') return 'not_editable'
  bundle.status = 'cancelled'
  for (const reminder of bundle.reminders)
    if (reminder.status === 'scheduled') reminder.status = 'cancelled'
  return null
}
