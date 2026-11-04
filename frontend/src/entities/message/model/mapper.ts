import type {
  BundleDto,
  InboxDto,
  MessageDto,
  ThreadDetailDto,
  ThreadSummaryDto,
} from '@/shared/types/api/message'
import type {
  Bundle,
  BundleStage,
  Message,
  MessageInbox,
  MessageThread,
  MessageThreadSummary,
} from './types'

/** 보낸 쪽과 칸이 맞지 않으면 던진다 — 조회 오류로 보인다 */
function invalidMessage(dto: MessageDto): never {
  throw new Error(`메시지 응답이 보낸 쪽과 맞지 않습니다: ${dto.message_id}`)
}

export function toMessage(dto: MessageDto): Message {
  if (dto.sender === 'member') {
    if (dto.reply_channel === null) invalidMessage(dto)
    return {
      sender: 'member',
      id: dto.message_id,
      body: dto.body,
      createdAt: dto.created_at,
      replyChannel: dto.reply_channel,
    }
  }
  if (dto.dm_status === null) invalidMessage(dto)
  return {
    sender: 'bot',
    id: dto.message_id,
    body: dto.body,
    createdAt: dto.created_at,
    dm:
      dto.dm_status === 'failed'
        ? { status: 'failed', reason: dto.dm_failure_reason ?? 'unknown' }
        : { status: dto.dm_status },
  }
}

function stageOf(dto: BundleDto): BundleStage | null {
  if (dto.status !== 'scheduled') return null
  if (!dto.approved) return { stage: 'awaitingApproval' }
  if (dto.approved_at === null) throw new Error(`승인한 묶음에 승인 시각이 없습니다: ${dto.bundle_id}`)
  return { stage: 'approved', approvedAt: dto.approved_at }
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
    tasks: dto.reminders.map((reminder) => ({
      reminderId: reminder.reminder_id,
      taskId: reminder.task_id,
      title: reminder.task_title,
      dueDate: reminder.due_date,
      note: reminder.note,
    })),
  }
}

function toBundles(dtos: readonly BundleDto[]): Bundle[] {
  return dtos.flatMap((dto) => toBundle(dto) ?? [])
}

function toSummary(dto: ThreadSummaryDto): MessageThreadSummary {
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
          },
    awaitingReplySince: dto.awaiting_reply_since,
    dmFailed: dto.dm_failed,
  }
}

export function toMessageInbox(dto: InboxDto): MessageInbox {
  const threads = dto.threads.map(toSummary)
  if (dto.bundles === null) return { viewer: 'member', threads }
  return { viewer: 'pm', bundles: toBundles(dto.bundles), threads }
}

export function toMessageThread(dto: ThreadDetailDto): MessageThread {
  return {
    ...toSummary(dto.thread),
    messages: dto.messages.map(toMessage),
    upcoming: dto.bundles === null ? [] : toBundles(dto.bundles),
  }
}
