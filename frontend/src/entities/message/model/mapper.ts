import type {
  BundleDto,
  InboxDto,
  MessageDto,
  ReminderDto,
  ReminderEvidenceDto,
  ReminderWithBundleDto,
  ThreadDetailDto,
  ThreadSummaryDto,
} from '@/shared/types/api/message'
import type { ReplyAttributionDto, TaskRefDto } from '@/shared/types/api/reply'
import type {
  Bundle,
  BundleStage,
  CreatedReminder,
  DmDelivery,
  Message,
  MessageInbox,
  MessageThread,
  MessageThreadSummary,
  ReminderEvidence,
  ReplyAttribution,
  TaskRef,
  WebReply,
} from './types'

/** 보낸 쪽과 칸이 맞지 않으면 던진다 — 조회 오류로 보인다 */
function invalidMessage(dto: MessageDto): never {
  throw new Error(`메시지 응답이 보낸 쪽과 맞지 않습니다: ${dto.message_id}`)
}

function toDm(dto: MessageDto): DmDelivery {
  if (dto.dm_status === null) invalidMessage(dto)
  return dto.dm_status === 'failed'
    ? { status: 'failed', reason: dto.dm_failure_reason ?? 'unknown' }
    : { status: dto.dm_status }
}

export function toMessage(dto: MessageDto): Message {
  const base = { id: dto.message_id, body: dto.body, createdAt: dto.created_at }
  switch (dto.sender) {
    case 'member':
      if (dto.reply_channel === null) invalidMessage(dto)
      return { ...base, sender: 'member', replyChannel: dto.reply_channel }
    case 'bot':
      return { ...base, sender: 'bot', dm: toDm(dto) }
    // 작성자 칸은 곁가지다. 비어 와도 메시지 하나로 대화 전체를 막지 않는다
    case 'pm':
      return {
        ...base,
        sender: 'pm',
        dm: toDm(dto),
        authorMemberId: dto.author_member_id,
        authorName: dto.author_name,
      }
  }
}

function toWebReply(available: boolean | undefined): WebReply {
  if (available === undefined) return 'unknown'
  return available ? 'available' : 'unavailable'
}

function stageOf(dto: BundleDto): BundleStage | null {
  if (dto.status !== 'scheduled') return null
  if (!dto.approved) return { stage: 'awaitingApproval' }
  if (dto.approved_at === null)
    throw new Error(`승인한 묶음에 승인 시각이 없습니다: ${dto.bundle_id}`)
  return { stage: 'approved', approvedAt: dto.approved_at }
}

/** #418 이전 서버는 요약을 보내지 않는다. 그때는 태스크 제목으로 줄인다 — `API 명세서`, `퍼블리싱 외 1건` */
function titleSummary(reminders: readonly ReminderDto[]): string {
  const [first, ...rest] = reminders
  if (first === undefined) return ''
  const title = first.task_title ?? '지워진 태스크'
  return rest.length === 0 ? title : `${title} 외 ${String(rest.length)}건`
}

/** 메시지 ID 없는 답장 근거는 링크만 뺀다. DM 실패 이유처럼 곁가지 칸 하나로 목록 전체를 막지 않는다 */
function toEvidence(dto: ReminderEvidenceDto | null | undefined): ReminderEvidence | null {
  if (dto === null || dto === undefined) return null
  if (dto.kind === 'task_change') return { kind: 'taskChange', at: dto.at }
  return dto.message_id === null ? null : { kind: 'reply', at: dto.at, messageId: dto.message_id }
}

/** 예정이 아닌 묶음은 null 이다. 목록·대화 응답에는 예정 묶음만 온다 */
export function toBundle(dto: BundleDto): Bundle | null {
  const stage = stageOf(dto)
  if (stage === null) return null
  return {
    ...stage,
    id: dto.bundle_id,
    threadId: dto.thread_id,
    memberId: dto.member_id,
    recipientName: dto.recipient_name,
    scheduledAt: dto.scheduled_at,
    body: dto.body,
    bodySource: dto.body_source,
    drafting: dto.draft_status !== 'done',
    draftVersion: dto.draft_version,
    summary: dto.summary ?? titleSummary(dto.reminders),
    tasks: dto.reminders.map((reminder) => ({
      reminderId: reminder.reminder_id,
      taskId: reminder.task_id,
      title: reminder.task_title,
      dueDate: reminder.due_date,
      note: reminder.note,
      reason: reminder.reason ?? null,
      evidence: toEvidence(reminder.evidence),
    })),
  }
}

function toBundles(dtos: readonly BundleDto[]): Bundle[] {
  return dtos.flatMap((dto) => toBundle(dto) ?? [])
}

export function toThreadSummary(dto: ThreadSummaryDto): MessageThreadSummary {
  return {
    id: dto.thread_id,
    memberId: dto.member_id,
    name: dto.name,
    lastMessage:
      dto.last_message === null
        ? null
        : {
            id: dto.last_message.message_id,
            sender: dto.last_message.sender,
            body: dto.last_message.body,
            createdAt: dto.last_message.created_at,
            authorMemberId: dto.last_message.author_member_id,
            authorName: dto.last_message.author_name,
          },
    awaitingReplySince: dto.awaiting_reply_since,
    dmFailed: dto.dm_failed,
    webReply: toWebReply(dto.web_reply_available),
  }
}

export function toMessageInbox(dto: InboxDto): MessageInbox {
  const threads = dto.threads.map(toThreadSummary)
  if (dto.bundles === null) return { viewer: 'member', threads }
  return { viewer: 'pm', bundles: toBundles(dto.bundles), threads }
}

export function toMessageThread(dto: ThreadDetailDto): MessageThread {
  return {
    ...toThreadSummary(dto.thread),
    messages: dto.messages.map(toMessage),
    upcoming: dto.bundles === null ? [] : toBundles(dto.bundles),
  }
}

function toTaskRef(dto: TaskRefDto): TaskRef {
  return { id: dto.task_id, title: dto.title }
}

export function toReplyAttribution(dto: ReplyAttributionDto): ReplyAttribution {
  if (dto.status === 'needs_pm')
    return {
      messageId: dto.message_id,
      kind: 'needsPick',
      candidates: dto.candidates.map(toTaskRef),
    }
  return {
    messageId: dto.message_id,
    kind: 'picked',
    task: dto.task === null ? null : toTaskRef(dto.task),
  }
}

/** 막 만든 재촉의 묶음은 늘 예정이다. 아니면 계약 위반이라 던진다 — 만들기 실패로 보인다 */
export function toCreatedReminder(dto: ReminderWithBundleDto): CreatedReminder {
  const bundle = toBundle(dto.bundle)
  if (bundle === null)
    throw new Error(`만든 재촉의 묶음이 예정 상태가 아닙니다: ${dto.bundle.bundle_id}`)
  return { reminderId: dto.reminder.reminder_id, bundle }
}
