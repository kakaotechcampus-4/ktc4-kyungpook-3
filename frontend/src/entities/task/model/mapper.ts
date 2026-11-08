import { displayValue, fallbackValue, isKnownValue } from '@/shared/api/unknownValue'
import type { TimelineChangeDto, TimelineItemDto } from '@/shared/types/api/reply'
import type { TaskDto, TaskHistoryDto } from '@/shared/types/api/task'
import { TASK_HISTORY_FIELDS, TASK_HISTORY_SOURCES } from './types'
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

/** 모르는 값은 없는 것(null)으로 둔다. 반영 상태는 반영 완료로 올리지 않고, 표시 값은 보이지 않는다 */
function orNull<T extends string>(
  value: string | null,
  known: readonly T[],
  field: string,
): T | null {
  return value === null ? null : fallbackValue(value, known, null, field)
}

/** 반영 완료는 서버가 `synced` 라고 답했을 때뿐이다. `notion_page_id` 존재나 승인 성공으로 판단하지 않는다 */
export function isNotionSynced(task: Pick<Task, 'notionSyncStatus'>): boolean {
  return task.notionSyncStatus === 'synced'
}

/** 스키마를 통과한 응답만 받는다. 모르는 상태·정수가 아닌 버전은 이미 `INVALID_RESPONSE` 로 걸렀다 */
export function toTask(dto: TaskDto): Task {
  return {
    id: dto.task_id,
    workspaceId: dto.workspace_id,
    meetingId: dto.meeting_id,
    title: dto.title,
    assigneeMemberId: dto.assignee_member_id,
    status: dto.status,
    blocker: dto.blocker,
    dueDate: dto.due_date,
    startDate: dto.start_date ?? dto.created_at.slice(0, 10),
    notionPageId: dto.notion_page_id,
    version: dto.version,
    notionSyncStatus: orNull(
      dto.notion_sync_status ?? null,
      notionSyncStatuses,
      'notion sync status',
    ),
    autoBlocked: dto.auto_blocked,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  }
}
export function toTaskHistory(dto: TaskHistoryDto): TaskHistoryEntry {
  return {
    id: dto.history_id,
    taskId: dto.task_id,
    field: displayValue(dto.changed_field, TASK_HISTORY_FIELDS, 'history field'),
    oldValue: dto.old_value,
    newValue: dto.new_value,
    source: displayValue(dto.change_source, TASK_HISTORY_SOURCES, 'history source'),
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

const evidenceStatuses: readonly NonNullable<ReplyChangeLine['evidenceStatus']>[] = [
  'certain',
  'inferred',
]

const channels = ['discord', 'web'] as const

/** 무엇을 바꿨는지·결과가 무엇인지 모르는 줄은 읽기 전용이다. 서버가 되돌릴 수 있다고 해도 되돌리기를 두지 않는다 (#348) */
function toReplyChangeLine(dto: TimelineChangeDto): ReplyChangeLine {
  const field = displayValue(dto.field, replyChangeFields, 'reply change field')
  const result = displayValue(dto.result, replyChangeResults, 'reply change result')
  return {
    id: dto.change_id,
    field,
    newValue: dto.new_value,
    evidenceStatus: orNull(dto.evidence_status, evidenceStatuses, 'reply evidence status'),
    summary: dto.summary,
    evidenceQuote: dto.evidence_quote,
    result,
    undoable: dto.undoable && isKnownValue(field) && isKnownValue(result),
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
        channel: orNull(dto.channel, channels, 'reply channel'),
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
