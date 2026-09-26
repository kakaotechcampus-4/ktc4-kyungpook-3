import type { TaskDto, TaskHistoryDto } from '@/shared/types/api/task'
import { enumValue } from '@/shared/lib/enum'
import type { Task, TaskHistoryEntry } from './types'

export function toTask(dto: TaskDto): Task {
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
    isSyncedToNotion: dto.notion_page_id !== null,
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
