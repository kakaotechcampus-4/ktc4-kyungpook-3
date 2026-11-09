import { createInvalidResponseError } from '@/shared/api/parseResponse'
import { displayValue, fallbackValue } from '@/shared/api/unknownValue'
import type {
  BundleDto,
  InboxDto,
  MessageDto,
  ReminderDto,
  ReminderWithBundleDto,
  ThreadDetailDto,
  ThreadSummaryDto,
} from '@/shared/types/api/message'
import type { ReplyAttributionDto, TaskRefDto } from '@/shared/types/api/reply'
import { BODY_SOURCES } from './types'
import type {
  Bundle,
  BundleStage,
  CreatedReminder,
  DmDelivery,
  DmFailureReason,
  Message,
  MessageInbox,
  MessageThread,
  MessageThreadSummary,
  ReminderEvidence,
  ReplyAttribution,
  ReplyChannel,
  TaskRef,
  WebReply,
} from './types'

const DM_FAILURE_REASONS: readonly DmFailureReason[] = [
  'dm_blocked',
  'discord_not_linked',
  'unknown',
]
const REPLY_CHANNELS: readonly ReplyChannel[] = ['discord', 'web']
const EVIDENCE_KINDS = ['reply', 'task_change'] as const

/**
 * 보낸 쪽과 칸이 맞는지는 스키마가 이미 봤다(`messageSchema`). 여기 오는 것은 타입을 좁히려는 것이다 —
 * 스키마를 거치지 않은 값이 와도 다른 보낸 쪽으로 그리지 않고 읽지 못한 응답으로 끝낸다
 */
function mismatched(field: string): never {
  throw createInvalidResponseError('message', field)
}

function toDm(dto: MessageDto): DmDelivery {
  if (dto.dm_status === null) mismatched('dm_status')
  return dto.dm_status === 'failed'
    ? {
        status: 'failed',
        // 모르는 이유는 받은 글자를 남긴다. 화면은 서버의 「알 수 없음」과 같은 문구로 읽고 실패했다는 사실은 그대로 보인다
        reason: displayValue(
          dto.dm_failure_reason ?? 'unknown',
          DM_FAILURE_REASONS,
          'dm failure reason',
        ),
      }
    : { status: dto.dm_status }
}

export function toMessage(dto: MessageDto): Message {
  const base = { id: dto.message_id, body: dto.body, createdAt: dto.created_at }
  switch (dto.sender) {
    case 'member':
      if (dto.reply_channel === null) mismatched('reply_channel')
      return {
        ...base,
        sender: 'member',
        // 모르는 경로는 웹 답장 표시 없이 읽는다 — 웹에서 답했다고 말하지 않는다
        replyChannel: fallbackValue(dto.reply_channel, REPLY_CHANNELS, 'discord', 'reply channel'),
      }
    case 'bot':
      return { ...base, sender: 'bot', dm: toDm(dto) }
    // 작성자 칸은 곁가지다. 비어 와도 메시지 하나로 대화 전체를 막지 않는다
    case 'pm':
      return {
        ...base,
        sender: 'pm',
        dm: toDm(dto),
        authorMemberId: dto.author_member_id ?? null,
        authorName: dto.author_name ?? null,
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
  // 승인한 예정 묶음의 승인 시각은 스키마가 이미 봤다(`bundleSchema`)
  if (dto.approved_at === null) throw createInvalidResponseError('message', 'approved_at')
  return { stage: 'approved', approvedAt: dto.approved_at }
}

/** #418 이전 서버는 요약을 보내지 않는다. 그때는 태스크 제목으로 줄인다 — `API 명세서`, `퍼블리싱 외 1건` */
function titleSummary(reminders: readonly ReminderDto[]): string {
  const [first, ...rest] = reminders
  if (first === undefined) return ''
  const title = first.task_title ?? '지워진 태스크'
  return rest.length === 0 ? title : `${title} 외 ${String(rest.length)}건`
}

/**
 * 메시지 ID 없는 답장 근거는 링크만 뺀다. 모르는 종류의 근거도 근거 없음으로 두고 개발 모드에서 경고한다 — 근거 링크 하나로
 * 목록 전체를 막지 않고, 답장이나 태스크 변경으로 짐작해 잘못된 곳으로 보내지도 않는다 (#348)
 */
function toEvidence(dto: ReminderDto['evidence']): ReminderEvidence | null {
  if (dto === null || dto === undefined) return null
  const kind = fallbackValue(dto.kind, EVIDENCE_KINDS, null, 'reminder evidence kind')
  if (kind === 'task_change') return { kind: 'taskChange', at: dto.at }
  if (kind === 'reply' && dto.message_id !== null)
    return { kind: 'reply', at: dto.at, messageId: dto.message_id }
  return null
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
    bodySource: displayValue(dto.body_source, BODY_SOURCES, 'bundle body source'),
    drafting: isDrafting(dto.draft_status),
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

const DRAFT_STATUSES = ['needed', 'claimed', 'done'] as const

/** 초안이 아직 오는 중인가. 모르는 상태는 작성 중으로 본다 — 문구가 바뀔 수 있다고 보고 승인을 늦출 뿐이다 */
function isDrafting(status: string): boolean {
  return fallbackValue(status, DRAFT_STATUSES, 'needed', 'bundle draft status') !== 'done'
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
            authorMemberId: dto.last_message.author_member_id ?? null,
            authorName: dto.last_message.author_name ?? null,
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

/** 막 만든 재촉의 묶음은 늘 예정이다. 스키마가 이미 봤다(`createdReminderSchema`) */
export function toCreatedReminder(dto: ReminderWithBundleDto): CreatedReminder {
  const bundle = toBundle(dto.bundle)
  if (bundle === null) throw createInvalidResponseError('message', 'bundle.status')
  return { reminderId: dto.reminder.reminder_id, bundle }
}
