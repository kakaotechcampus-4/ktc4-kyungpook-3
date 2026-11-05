import type {
  BundleDto,
  InboxDto,
  MessageDto,
  ReminderDto,
  ThreadDetailDto,
  ThreadSummaryDto,
} from '@/shared/types/api/message'
import type { MockBundle, MockMessageThread } from './fixtures/message'

/*
 * 메시지 상태 전이와 응답 모양 (계약 §5.7, 백엔드 api/messages.py·services/messages.py 의 같은 규칙).
 * handler 가 부른다. 시각은 서버처럼 UTC 로 내보낸다.
 * 묶음을 같은 대화의 다른 예정 묶음과 같은 시각으로 옮기면 그쪽으로 합친다. 스케줄러 발송·만료와 AI 초안은 흉내 내지 않는다
 */

export type Viewer = 'pm' | 'member'

const time = (value: number | string) => (typeof value === 'number' ? value : Date.parse(value))

export function utc(timestamp: string): string {
  return new Date(timestamp).toISOString()
}

const utcOrNull = (timestamp: string | null) => (timestamp === null ? null : utc(timestamp))

/** 응답에는 묶음과 같은 상태인 리마인드만 싣는다 */
export function bundleDto(bundle: MockBundle): BundleDto {
  return {
    bundle_id: bundle.bundle_id,
    thread_id: bundle.thread_id,
    member_id: bundle.member_id,
    recipient_name: bundle.recipient_name,
    status: bundle.status,
    approved: bundle.approved,
    body: bundle.body,
    body_source: bundle.body_source,
    draft_status: bundle.draft_status,
    draft_version: bundle.draft_version,
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

/**
 * 상태를 바꾸지 못한 이유. 어느 쪽이든 db 는 그대로다.
 * merge_with_body 는 합쳐지는 시각으로 옮기면서 문구도 고친 요청이다 — 합치면 문구를 다시 만들어 쓸 곳이 없다
 */
export type BundleRefusal = 'not_editable' | 'changed' | 'time_passed' | 'merge_with_body'

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

/**
 * 묶음 구성이 바뀔 때 백엔드가 db 에서 읽는 것 — 합칠 상대가 될 그 공간의 묶음, 규칙 문구에 쓸 지금의 태스크,
 * 문구 틀의 PM 이름·공간 이름·나간 DM
 */
export interface BundleContext {
  bundles: readonly MockBundle[]
  tasks: readonly { task_id: string; title: string; due_date: string | null }[]
  threads: readonly MockMessageThread[]
  pmName: string
  workspaceName: string
}

const WEEKDAYS = '일월화수목금토'
const ASK = '지금 어디까지 됐는지 편하게 알려 주세요!'

/** 규칙 문구(가운데). 백엔드 rule_line. 픽스처는 지운 태스크의 제목을 남기지 않는다 */
function ruleLine(title: string | null, due: string | null): string {
  const name = title ?? '지워진 태스크'
  if (due === null) return `'${name}' 진행 상황 한번 여쭤봐요.\n${ASK}`
  const date = new Date(`${due}T00:00:00Z`)
  const when = `${String(date.getUTCMonth() + 1)}/${String(date.getUTCDate())}(${WEEKDAYS.charAt(date.getUTCDay())})`
  return `'${name}' 마감이 ${when}이라 한번 여쭤봐요.\n${ASK}`
}

/** 이름 뒤 '이에요/예요'. 마지막 글자가 한글이 아니면 받침을 알 수 없다 (백엔드 _copula) */
function copula(name: string): string {
  const last = name.at(-1) ?? ''
  if (!(last >= '가' && last <= '힣')) return '(이)에요'
  return (last.charCodeAt(0) - '가'.charCodeAt(0)) % 28 === 0 ? '예요' : '이에요'
}

/** 가운데 문구에 그 대화의 첫 DM 이면 PM 소개와 맺음을, 아니면 PM 이름을 씌운다 (백엔드 framed_body) */
function framedBody(bundle: MockBundle, middle: string, context: BundleContext): string {
  const { pmName: pm, workspaceName } = context
  const thread = context.threads.find(({ thread_id }) => thread_id === bundle.thread_id)
  const delivered =
    thread?.messages.some(
      ({ sender, dm_status }) => sender === 'bot' && dm_status === 'delivered',
    ) ?? false
  if (delivered) return `${bundle.recipient_name}님, ${pm}${copula(pm)}.\n${middle}`
  return `안녕하세요 ${bundle.recipient_name}님, ${workspaceName} ${pm}${copula(pm)}.\n앞으로 확인용 메시지는 이 봇으로 보낼게요.\n\n${middle}\n여기로 답장하시면 저한테 바로 전달돼요.`
}

const written = (note: string | null): note is string => note !== null && note !== ''

const byCreated = (left: ReminderDto, right: ReminderDto) =>
  time(left.created_at) - time(right.created_at) ||
  left.reminder_id.localeCompare(right.reminder_id)

/**
 * 묶음 구성이 바뀐 뒤 부른다 (백엔드 _rebuild). 판을 올리고 승인을 푼다.
 * 예정 리마인드가 없으면 묶음을 닫고, 메모 있는 하나뿐이면 그 메모가, 아니면 규칙 문구가 새 문구다.
 * 백엔드는 태스크의 지금 제목·마감을 읽는다 — 리마인드에 옮겨 둔 값을 지금 태스크로 고친 뒤 문구를 만든다.
 * 픽스처에 없는 태스크는 옮겨 둔 값 그대로다
 */
export function rebuildBundle(bundle: MockBundle, context: BundleContext): void {
  bundle.reminders.sort(byCreated)
  const reminders = bundle.reminders.filter(({ status }) => status === 'scheduled')
  for (const reminder of reminders) {
    const task = context.tasks.find(({ task_id }) => task_id === reminder.task_id)
    if (task === undefined) continue
    reminder.task_title = task.title
    reminder.due_date = task.due_date
  }
  bundle.draft_version += 1
  bundle.approved = false
  bundle.approved_at = null
  if (reminders.length === 0) {
    bundle.status = 'cancelled'
    return
  }
  const [first] = reminders
  if (reminders.length === 1 && written(first.note)) {
    bundle.body = framedBody(bundle, first.note, context)
    bundle.body_source = 'pm'
    bundle.draft_status = 'done'
    return
  }
  const middle = reminders
    .map(({ note, task_title, due_date }) =>
      written(note) ? note : ruleLine(task_title, due_date),
    )
    .join('\n\n')
  bundle.body = framedBody(bundle, middle, context)
  bundle.body_source = 'rule'
  bundle.draft_status = 'needed'
}

export type BundleEdit = { bundle: MockBundle } | { refusal: BundleRefusal }

/**
 * 문구·시각을 고친다 (백엔드 edit_bundle). 고친 묶음을, 합쳤으면 합친 묶음을 돌려준다. 거절은 아무것도 바꾸기 전에 정한다.
 * - 지금과 같은 시각은 보내지 않은 것으로 본다
 * - 문구를 고치면 판이 오르고, 시각만 옮기면 그대로다. 승인은 그대로다
 * - 옮긴 시각에 같은 대화의 예정 묶음이 있으면 리마인드를 그쪽으로 옮기고 두 묶음을 다시 만든다 — 이 묶음은 닫히고 합친 묶음의 승인이 풀린다
 */
export function editBundle(
  bundle: MockBundle,
  patch: { body?: string; scheduled_at?: string },
  now: string,
  context: BundleContext,
): BundleEdit {
  if (bundle.status !== 'scheduled') return { refusal: 'not_editable' }
  const movedTo =
    patch.scheduled_at !== undefined && time(patch.scheduled_at) !== time(bundle.scheduled_at)
      ? patch.scheduled_at
      : null
  if (movedTo !== null && time(movedTo) <= time(now)) return { refusal: 'time_passed' }
  const into =
    movedTo === null
      ? undefined
      : context.bundles.find(
          (other) =>
            other.thread_id === bundle.thread_id &&
            other.status === 'scheduled' &&
            time(other.scheduled_at) === time(movedTo),
        )
  if (into !== undefined && patch.body !== undefined) return { refusal: 'merge_with_body' }
  if (patch.body !== undefined) {
    bundle.body = patch.body
    bundle.body_source = 'pm'
    bundle.draft_status = 'done'
    bundle.draft_version += 1
  }
  if (movedTo === null) return { bundle }
  if (into === undefined) {
    bundle.scheduled_at = movedTo
    return { bundle }
  }
  for (const reminder of bundle.reminders.filter(({ status }) => status === 'scheduled'))
    into.reminders.push({ ...reminder, bundle_id: into.bundle_id })
  bundle.reminders = bundle.reminders.filter(({ status }) => status !== 'scheduled')
  rebuildBundle(bundle, context)
  rebuildBundle(into, context)
  return { bundle: into }
}

/** 보내지 않음. 안의 리마인드도 모두 취소된다 */
export function cancelBundle(bundle: MockBundle): BundleRefusal | null {
  if (bundle.status !== 'scheduled') return 'not_editable'
  bundle.status = 'cancelled'
  for (const reminder of bundle.reminders)
    if (reminder.status === 'scheduled') reminder.status = 'cancelled'
  return null
}
