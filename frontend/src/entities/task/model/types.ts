export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done'
export interface Task {
  id: string
  workspaceId: string
  meetingId: string | null
  title: string
  assigneeMemberId: string | null
  status: TaskStatus
  progress: number | null
  blocker: string | null
  dueDate: string | null
  startDate: string
  notionPageId: string | null
  isSyncedToNotion: boolean
  createdAt: string
  updatedAt: string
}
export type TaskTab = 'all' | 'needs_review' | 'in_progress' | 'done'
export interface TaskHistoryEntry {
  id: string
  taskId: string
  field: 'assignee' | 'due_date' | 'status' | 'title' | 'progress' | 'blocker'
  oldValue: string | null
  newValue: string | null
  source: 'meeting' | 'chat' | 'checkin' | 'notion' | 'reminder_reply' | 'manual'
  changedBy: string | null
  isAuto: boolean
  isRolledBack: boolean
  rolledBackAt: string | null
  createdAt: string
}
