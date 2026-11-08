import { CLIENT_ERROR_CODES, createClientError } from '@/shared/api/errors'
import type { TimelineChangeDto, TimelineItemDto } from '@/shared/types/api/reply'
import type { TaskDto, TaskHistoryDto } from '@/shared/types/api/task'
import { enumValue } from '@/shared/lib/enum'
import type {
  NotionSyncStatus,
  ReplyChangeField,
  ReplyChangeLine,
  ReplyChangeResult,
  Task,
  TaskHistoryEntry,
  TaskTimelineItem,
} from './types'

const notionSyncStatuses: readonly NotionSyncStatus[] = ['pending', 'synced', 'failed']

/**
 * 서버 NotionSyncStatus 만 받는다. 모르는 문자열은 반영 완료로 올리지 않고 null(반영 상태 없음)로 둔다.
 * `enumValue` 를 쓰지 않는 이유: 폴백이 허용 값 중 하나여야 하는데, 여기서는 어느 상태로도 추정하지 않는다
 */
function toNotionSyncStatus(value: string | null | undefined): NotionSyncStatus | null {
  if (value === null || value === undefined) return null
  if ((notionSyncStatuses as readonly unknown[]).includes(value)) return value as NotionSyncStatus
  if (import.meta.env.DEV) console.warn(`Unknown notion sync status: ${value}`)
  return null
}

/** 반영 완료는 서버가 `synced` 라고 답했을 때뿐이다. `notion_page_id` 존재나 승인 성공으로 판단하지 않는다 */
export function isNotionSynced(task: Pick<Task, 'notionSyncStatus'>): boolean {
  return task.notionSyncStatus === 'synced'
}

/**
 * 버전이 유한한 정수가 아니면 매핑하지 않는다. 충돌 확인(confirm_task_version)의 기준이라 추정값으로 채우면
 * PM 이 보지 않은 변경을 덮어쓸 수 있다. 잘못된 응답(INVALID_RESPONSE)으로 던진다
 */
export function toTask(dto: TaskDto): Task {
  const version: unknown = dto.version
  if (typeof version !== 'number' || !Number.isInteger(version))
    throw createClientError(CLIENT_ERROR_CODES.INVALID_RESPONSE)
  if (dto.meeting_deleted !== undefined && typeof dto.meeting_deleted !== 'boolean')
    throw createClientError(CLIENT_ERROR_CODES.INVALID_RESPONSE)
  return {
    id: dto.task_id,
    workspaceId: dto.workspace_id,
    meetingId: dto.meeting_id,
    meetingDeleted: dto.meeting_deleted === true,
    title: dto.title,
    assigneeMemberId: dto.assignee_member_id,
    status: enumValue(
      dto.status,
      ['todo', 'in_progress', 'blocked', 'done'] as const,
      'todo',
      'task status',
    ),
    blocker: dto.blocker,
    dueDate: dto.due_date,
    startDate: dto.start_date ?? dto.created_at.slice(0, 10),
    notionPageId: dto.notion_page_id,
    version,
    notionSyncStatus: toNotionSyncStatus(dto.notion_sync_status),
    autoBlocked: dto.auto_blocked === true,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  }
}
export function toTaskHistory(dto: TaskHistoryDto): TaskHistoryEntry {
  return {
    id: dto.history_id,
    taskId: dto.task_id,
    field: enumValue(
      dto.changed_field,
      [
        'assignee',
        'start_date',
        'due_date',
        'status',
        'title',
        'progress',
        'blocker',
        'scope',
      ] as const,
      'title',
      'history field',
    ),
    oldValue: dto.old_value,
    newValue: dto.new_value,
    source: enumValue(
      dto.change_source,
      ['meeting', 'chat', 'checkin', 'notion', 'reminder_reply', 'manual', 'scheduler'] as const,
      'manual',
      'history source',
    ),
    changedBy: dto.changed_by,
    isAuto: dto.is_auto,
    isRolledBack: dto.is_rolled_back,
    rolledBackAt: dto.rolled_back_at,
    createdAt: dto.created_at,
  }
}

const replyChangeFields: readonly ReplyChangeField[] = [
  'status',
  'due_date',
  'assignee',
  'scope',
  'unknown',
  'due_clear',
  'failed',
  'none',
]

const replyChangeResults: readonly ReplyChangeResult[] = [
  'applied',
  'undone',
  'pending',
  'approved',
  'rejected',
  'noted',
  'recorded',
]

function toReplyChangeLine(dto: TimelineChangeDto): ReplyChangeLine {
  return {
    id: dto.change_id,
    // 모르는 줄은 값을 읽지 못한 줄로, 모르는 결과는 반영하지 않은 것으로 둔다. 되돌리기는 `undoable` 만 따른다
    field: enumValue(dto.field, replyChangeFields, 'failed', 'reply change field'),
    newValue: dto.new_value,
    evidenceStatus: dto.evidence_status,
    summary: dto.summary,
    evidenceQuote: dto.evidence_quote,
    result: enumValue(dto.result, replyChangeResults, 'noted', 'reply change result'),
    undoable: dto.undoable === true,
  }
}

/**
 * 타임라인 응답을 태스크 기록으로 바꾼다. 이력 칸에는 변경자·되돌림 여부가 없어서 `/history` 의 같은 이력(history_id)으로
 * 채우고, 거기 없으면 타임라인 칸만으로 만든다
 */
export function toTaskTimeline(
  items: readonly TimelineItemDto[],
  history: readonly TaskHistoryEntry[],
  taskId: string,
): TaskTimelineItem[] {
  const byId = new Map(history.map((entry) => [entry.id, entry]))
  return items.map((dto): TaskTimelineItem => {
    if (dto.kind === 'reply')
      return {
        kind: 'reply',
        id: dto.message_id,
        at: dto.at,
        memberName: dto.member_name,
        channel: dto.channel,
        body: dto.body,
        changes: dto.changes.map(toReplyChangeLine),
      }
    return {
      kind: 'history',
      entry:
        byId.get(dto.history_id) ??
        toTaskHistory({
          history_id: dto.history_id,
          task_id: taskId,
          changed_field: dto.changed_field,
          old_value: dto.old_value,
          new_value: dto.new_value,
          change_source: dto.change_source,
          changed_by: null,
          is_auto: false,
          is_rolled_back: false,
          rolled_back_at: null,
          created_at: dto.at,
        }),
    }
  })
}
