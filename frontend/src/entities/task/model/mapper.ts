import { CLIENT_ERROR_CODES, createClientError } from '@/shared/api/errors'
import type { TaskDto, TaskHistoryDto } from '@/shared/types/api/task'
import { enumValue } from '@/shared/lib/enum'
import type { NotionSyncStatus, Task, TaskHistoryEntry } from './types'

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
  return {
    id: dto.task_id,
    workspaceId: dto.workspace_id,
    meetingId: dto.meeting_id,
    title: dto.title,
    assigneeMemberId: dto.assignee_member_id,
    status: enumValue(
      dto.status,
      ['todo', 'in_progress', 'blocked', 'done'] as const,
      'todo',
      'task status',
    ),
    progress: dto.progress,
    blocker: dto.blocker,
    dueDate: dto.due_date,
    startDate: dto.start_date ?? dto.created_at.slice(0, 10),
    notionPageId: dto.notion_page_id,
    version,
    notionSyncStatus: toNotionSyncStatus(dto.notion_sync_status),
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
      ['assignee', 'start_date', 'due_date', 'status', 'title', 'progress', 'blocker'] as const,
      'title',
      'history field',
    ),
    oldValue: dto.old_value,
    newValue: dto.new_value,
    source: enumValue(
      dto.change_source,
      ['meeting', 'chat', 'checkin', 'notion', 'reminder_reply', 'manual'] as const,
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
